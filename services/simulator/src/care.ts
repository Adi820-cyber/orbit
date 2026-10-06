import type { DoctorListResponse, EncounterListResponse, ServiceCatalogueResponse, ServiceCategory, StaffType } from '@orbit/contracts';
import { billClosedVisit, recordCover } from './billing.ts';
import { localParts } from './clock.ts';
import { read, write, type Ctx, type FacilityRef } from './ctx.ts';
import type { Boards } from './attendance.ts';
import {
  departmentCodeFor,
  expectedArrivals,
  patientProfile,
  performerTypes,
  visitPlan,
  visitType,
  type EncounterType,
} from './plan.ts';
import { hashInt, rngFor, stableUuid } from './rng.ts';
import { SURNAMES } from './names.ts';
import type { SimState } from './state.ts';

type OpenVisit = EncounterListResponse['items'][number];
type Doctor = DoctorListResponse['items'][number];

const DOCTORS_TTL_MS = 10 * 60_000;
const CATALOGUE_TTL_MS = 15 * 60_000;
const MAX_ARRIVALS_PER_TICK = 6;

async function doctorsOf(ctx: Ctx, state: SimState, facility: FacilityRef): Promise<readonly Doctor[]> {
  const cached = state.doctors.get(facility.facilityId);
  if (cached && ctx.clock.now().getTime() - cached.atMs < DOCTORS_TTL_MS) return cached.items;
  const list = await read(ctx, 'read doctors', () => ctx.deskFor(facility).api.doctors({ facilityId: facility.facilityId, page: 1, pageSize: 100 }));
  if (!list) return cached?.items ?? [];
  state.doctors.set(facility.facilityId, { atMs: ctx.clock.now().getTime(), items: list.items });
  return list.items;
}

async function catalogueOf(ctx: Ctx, state: SimState, facility: FacilityRef): Promise<ServiceCatalogueResponse['items']> {
  const cached = state.catalogues.get(facility.facilityId);
  if (cached && ctx.clock.now().getTime() - cached.atMs < CATALOGUE_TTL_MS) return cached.items;
  const catalogue = await read(ctx, 'read services', () => ctx.deskFor(facility).api.services({ facilityId: facility.facilityId }));
  if (!catalogue) return cached?.items ?? [];
  state.catalogues.set(facility.facilityId, { atMs: ctx.clock.now().getTime(), items: catalogue.items });
  return catalogue.items;
}

/** People on shift right now, from today's and yesterday's boards (a night shift spans both). */
function onDuty(boards: Boards, types: readonly StaffType[]): { staffId: string }[] {
  const seen = new Map<string, { staffId: string }>();
  for (const row of [...boards.today, ...boards.yesterday]) {
    if (row.day.onDuty && types.includes(row.staff.staffType)) seen.set(row.staff.staffId, { staffId: row.staff.staffId });
  }
  return [...seen.values()];
}

const pickBy = <T>(items: readonly T[], ...labels: string[]): T | undefined => (items.length === 0 ? undefined : items[hashInt(...labels) % items.length]);

const MAX_PAGES = 3;
const PAGE_SIZE = 100;

async function openVisits(ctx: Ctx, facility: FacilityRef): Promise<OpenVisit[] | undefined> {
  const all: OpenVisit[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await read(ctx, 'read open visits', () =>
      ctx.deskFor(facility).api.encounters({ facilityId: facility.facilityId, status: 'open', page, pageSize: PAGE_SIZE }),
    );
    if (!list) return page === 1 ? undefined : all;
    all.push(...list.items);
    if (page * PAGE_SIZE >= list.page.total) break;
  }
  return all;
}

/**
 * Looks after the visits already under way: records each planned service once
 * it is due, and closes the visit once its planned length has passed.
 */
async function progressVisits(ctx: Ctx, state: SimState, facility: FacilityRef, boards: Boards, open: readonly OpenVisit[]): Promise<void> {
  const nowMs = ctx.clock.now().getTime();
  const desk = ctx.deskFor(facility);
  const catalogue = await catalogueOf(ctx, state, facility);
  const validDoctors = new Set(
    (await doctorsOf(ctx, state, facility))
      .filter((doctor) => doctor.employmentStatus === 'active' && (doctor.credentialStatus === 'active' || doctor.credentialStatus === 'expiring'))
      .map((doctor) => doctor.staffId),
  );

  const performersFor = (category: ServiceCategory) => {
    const types = performerTypes(category);
    return onDuty(boards, types).filter((person) => !types.includes('doctor') || validDoctors.has(person.staffId));
  };

  for (const { encounter } of open) {
    const plan = visitPlan(ctx.cfg.seed, encounter.encounterId, encounter.encounterType);
    const startedMs = Date.parse(encounter.startedAt);
    const ageMinutes = (nowMs - startedMs) / 60_000;
    let pending = false;
    let lastOffset = 0;

    for (const [index, service] of plan.services.entries()) {
      lastOffset = Math.max(lastOffset, service.offsetMinutes);
      const marker = `${encounter.encounterId}|${index}`;
      if (state.delivered.has(marker) || service.offsetMinutes > ageMinutes) continue;

      const plannedMs = startedMs + service.offsetMinutes * 60_000;
      // Never rewrite history older than the back-fill limit (ADR 0017 §3), and in
      // single-run mode leave what earlier runs covered to them.
      const lookbackMs = Math.min(ctx.cfg.catchupMaxHours * 3_600_000, (ctx.cfg.serviceLookbackSeconds ?? Infinity) * 1000);
      if (nowMs - plannedMs > lookbackMs) {
        state.delivered.add(marker);
        continue;
      }

      const offered = catalogue.filter((item) => item.service.isActive && item.availability?.isAvailable && item.service.category === service.category);
      const chosen = pickBy(offered, ctx.cfg.seed, 'service', encounter.encounterId, String(index));
      if (!chosen) {
        state.delivered.add(marker); // this hospital does not offer that kind of service
        continue;
      }
      const performer = pickBy(performersFor(service.category), ctx.cfg.seed, 'performer', encounter.encounterId, String(index));
      if (!performer) {
        pending = true; // nobody suitable is on shift; try again next tick
        continue;
      }

      const backDated = nowMs - plannedMs > ctx.cfg.catchupSeconds * 1000;
      const result = await write(ctx, 'record service', () =>
        desk.api.recordDelivery(encounter.encounterId, {
          serviceId: chosen.service.serviceId,
          performedByStaffId: performer.staffId,
          quantity: service.quantity,
          idempotencyKey: stableUuid(ctx.cfg.seed, 'delivery', encounter.encounterId, String(index)),
          ...(backDated ? { performedAt: new Date(plannedMs).toISOString() } : {}),
        }),
      );
      if (result.status === 'ok') {
        state.delivered.add(marker);
        ctx.stats.services += 1;
      } else if (result.status === 'failed' && result.permanent) {
        state.delivered.add(marker); // a rule refused it; never retry the same thing
      } else {
        pending = true;
      }
    }

    if (ageMinutes >= plan.lengthMinutes && !pending) {
      const plannedEndMs = startedMs + plan.lengthMinutes * 60_000;
      const overdue = nowMs - plannedEndMs > ctx.cfg.catchupSeconds * 1000;
      // Back-date the end to when the visit should have finished, but never before the last service stamped for it.
      const endedAtMs = Math.max(plannedEndMs, startedMs + lastOffset * 60_000 + ctx.cfg.catchupSeconds * 1000);
      const result = await write(ctx, 'close visit', () =>
        desk.api.updateEncounter(encounter.encounterId, {
          version: encounter.version,
          status: 'closed',
          ...(overdue ? { endedAt: new Date(Math.min(endedAtMs, nowMs)).toISOString() } : {}),
        }),
      );
      if (result.status === 'ok') {
        ctx.stats.closed += 1;
        await billClosedVisit(ctx, facility, encounter.encounterId);
      }
    }
  }

  // Forget markers for visits that are no longer open, so memory stays bounded.
  const openIds = new Set(open.map((visit) => visit.encounter.encounterId));
  for (const marker of state.delivered) {
    if (!openIds.has(marker.slice(0, marker.indexOf('|')))) state.delivered.delete(marker);
  }
}

/** New patients arriving at the front desk this tick. */
async function receiveArrivals(ctx: Ctx, state: SimState, facility: FacilityRef, boards: Boards, open: readonly OpenVisit[]): Promise<void> {
  const nowMs = ctx.clock.now().getTime();
  const parts = localParts(ctx.clock.now(), ctx.timeZone);
  const mean = expectedArrivals({
    staffCount: boards.today.length,
    visitsPerStaffPerDay: ctx.cfg.visitsPerStaffPerDay,
    hour: parts.hour,
    tickSeconds: ctx.cfg.tickSeconds,
    demand: ctx.moodFor(facility).demand,
  });
  const bucket = String(Math.floor(nowMs / (ctx.cfg.tickSeconds * 1000)));
  const arrivals = Math.min(MAX_ARRIVALS_PER_TICK, rngFor(ctx.cfg.seed, 'arrivals', facility.facilityId, bucket).poisson(mean));
  if (arrivals === 0) return;

  const desk = ctx.deskFor(facility);
  const busy = new Set(open.map((visit) => visit.encounter.patientId));
  let openInpatients = open.filter((visit) => visit.encounter.encounterType === 'inpatient').length;
  const doctors = await doctorsOf(ctx, state, facility);
  const validDoctors = new Set(
    doctors.filter((doctor) => doctor.employmentStatus === 'active' && (doctor.credentialStatus === 'active' || doctor.credentialStatus === 'expiring')).map((doctor) => doctor.staffId),
  );
  const onDutyDoctors = onDuty(boards, ['doctor']).filter((person) => validDoctors.has(person.staffId));

  for (let index = 0; index < arrivals; index += 1) {
    const rand = rngFor(ctx.cfg.seed, 'arrival', facility.facilityId, bucket, String(index));
    let type: EncounterType = visitType(rand);
    if (type === 'inpatient' && openInpatients >= ctx.cfg.maxOpenInpatients) type = 'outpatient';

    // Some patients are returning: find one registered here who is not already in a visit.
    let patientId: string | undefined;
    if (rand.chance(0.4)) {
      const surname = rand.pick(SURNAMES);
      const found = await read(ctx, 'search patients', () => desk.api.patients({ q: surname, page: 1, pageSize: 20 }));
      const candidates = (found?.items ?? []).filter((patient) => patient.status === 'active' && !busy.has(patient.patientId));
      patientId = candidates.length > 0 ? rand.pick(candidates).patientId : undefined;
    }
    if (!patientId) {
      const profile = patientProfile(rand, Number(parts.date.slice(0, 4)));
      const registered = await write(ctx, 'register patient', () =>
        desk.api.registerPatient({ homeFacilityId: facility.facilityId, ...profile, confirmNotDuplicate: true }),
      );
      if (registered.status !== 'ok') continue;
      patientId = registered.value.patient.patientId;
      ctx.stats.patients += 1;
      await recordCover(ctx, facility, patientId);
    }

    const resolvedPatientId: string = patientId;
    const wantedDepartment = departmentCodeFor(type);
    const department = ctx.ref.departments.find((item) => item.code === wantedDepartment) ?? ctx.ref.departments[0];
    if (!department) continue;
    const doctor = onDutyDoctors.length > 0 ? rand.pick(onDutyDoctors) : undefined;

    const opened = await write(ctx, 'open visit', () =>
      desk.api.openEncounter({
        patientId: resolvedPatientId,
        facilityId: facility.facilityId,
        departmentId: department.departmentId,
        encounterType: type,
        ...(doctor ? { attendingDoctorId: doctor.staffId } : {}),
      }),
    );
    if (opened.status === 'ok') {
      ctx.stats.visits += 1;
      busy.add(resolvedPatientId);
      if (type === 'inpatient') openInpatients += 1;
    }
  }
}

export async function runCare(ctx: Ctx, state: SimState, facility: FacilityRef, boards: Boards): Promise<void> {
  const open = await openVisits(ctx, facility);
  if (!open) return;
  await progressVisits(ctx, state, facility, boards, open);
  await receiveArrivals(ctx, state, facility, boards, open);
}
