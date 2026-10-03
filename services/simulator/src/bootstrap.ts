import type { StaffType } from '@orbit/contracts';
import { addDays } from './clock.ts';
import { read, write, type Ctx, type FacilityRef } from './ctx.ts';
import { GIVEN_NAMES, SURNAMES } from './names.ts';
import { hashInt, rngFor } from './rng.ts';
import type { SimState } from './state.ts';

/*
 * Starting from an empty hospital (ADR 0017 §5).
 *
 * The organization, its hospitals, departments, specialties, shift patterns
 * and settings are configuration that the database provides (migrations and
 * seed 0001/0008). Everything about PEOPLE and ACTIVITY comes from here:
 * if a hospital has fewer staff than the minimums below the admin "hires" up
 * to them through the API, and if the whole service catalogue is empty the
 * admin builds one. With data already present nothing is hired or created, so
 * this is safe to leave on.
 */

/** Minimum headcount per hospital by type. Deliberately small: a hospital that works, not a large one. */
export const MINIMUM_STAFF: Record<StaffType, number> = { doctor: 3, nurse: 10, technician: 3, administrative: 2, support: 3 };

const LETTER: Record<StaffType, string> = { doctor: 'D', nurse: 'N', technician: 'T', administrative: 'A', support: 'S' };
const DESIGNATION: Record<StaffType, string> = {
  doctor: 'Attending physician',
  nurse: 'Staff nurse',
  technician: 'Technician',
  administrative: 'Administrator',
  support: 'Support assistant',
};
const DEPARTMENTS: Record<StaffType, readonly string[]> = {
  doctor: ['OPD', 'EMER', 'WARD', 'ICU'],
  nurse: ['WARD', 'OPD', 'EMER', 'ICU'],
  technician: ['LAB', 'RAD'],
  administrative: ['ADMIN'],
  support: ['SUPP'],
};

const HIRES_PER_TICK = 6;

function departmentId(ctx: Ctx, codes: readonly string[], pick: number): string | undefined {
  const code = codes[pick % codes.length];
  return (ctx.ref.departments.find((department) => department.code === code) ?? ctx.ref.departments[0])?.departmentId;
}

/**
 * Hires up to the minimums at one hospital. Returns true once the hospital is
 * fully staffed (so rosters can be planned for everyone at once).
 */
export async function bootstrapStaff(ctx: Ctx, state: SimState, facility: FacilityRef, today: string): Promise<boolean> {
  if (state.staffed.has(facility.facilityId)) return true;

  let hired = 0;
  let short = false;
  for (const type of Object.keys(MINIMUM_STAFF) as StaffType[]) {
    const have = await read(ctx, 'count staff', () => ctx.admin.staff({ facilityId: facility.facilityId, staffType: type, page: 1, pageSize: 1 }));
    if (!have) return false;
    const missing = MINIMUM_STAFF[type] - have.page.total;
    if (missing <= 0) continue;
    short = true;

    for (let i = 0; i < missing && hired < HIRES_PER_TICK; i += 1) {
      const number = have.page.total + i + 1;
      const code = `SIM-${facility.key.slice(0, 3).toUpperCase()}-${LETTER[type]}-${String(number).padStart(3, '0')}`;
      const rand = rngFor(ctx.cfg.seed, 'hire', facility.facilityId, code);
      const base = {
        facilityId: facility.facilityId,
        departmentId: departmentId(ctx, DEPARTMENTS[type], rand.int(0, 9)) ?? '',
        employeeCode: code,
        displayName: `${rand.pick(GIVEN_NAMES)} ${rand.pick(SURNAMES)}`,
        designation: DESIGNATION[type],
        joinedOn: addDays(today, -rand.int(30, 2000)),
        isCriticalRole: (type === 'doctor' || type === 'nurse') && rand.chance(0.15),
      };
      if (!base.departmentId) return false;
      hired += 1;

      if (type === 'doctor') {
        const specialty = ctx.ref.specialties.length > 0 ? rand.pick(ctx.ref.specialties) : undefined;
        if (!specialty) return false;
        const created = await write(ctx, 'hire doctor', () =>
          ctx.admin.createDoctor({
            ...base,
            specialtyId: specialty.specialtyId,
            registrationNumber: `DEMO-REG-${String(900_000 + (hashInt(ctx.cfg.seed, 'reg', code) % 99_000))}`,
            credentialExpiresOn: addDays(today, rand.int(150, 900)),
            employmentType: 'employed',
          }),
        );
        if (created.status === 'ok') {
          ctx.stats.hires += 1;
          // Two consultation sessions a week, so the doctor has a schedule.
          for (const weekday of [rand.int(1, 3), rand.int(4, 5)]) {
            await write(
              ctx,
              'add consultation slot',
              () => ctx.admin.addScheduleSlot(created.value.doctor.staffId, { facilityId: facility.facilityId, weekday, startTime: weekday % 2 === 0 ? '14:00' : '09:00', endTime: weekday % 2 === 0 ? '17:00' : '12:00' }),
              { counted: false },
            );
          }
        }
      } else {
        const created = await write(ctx, `hire ${type}`, () => ctx.admin.createStaff({ ...base, staffType: type as Exclude<StaffType, 'doctor'> }));
        if (created.status === 'ok') ctx.stats.hires += 1;
      }
    }
  }
  if (!short) {
    state.staffed.add(facility.facilityId);
    return true;
  }
  if (hired > 0) ctx.log.info('hired staff', { hospital: facility.key, people: hired });
  return false;
}

/** A compact default catalogue, used only when the organization has no services at all. */
const DEFAULT_CATALOGUE: readonly { code: string; name: string; category: string; dept: string; unit: string }[] = [
  { code: 'CON-GEN', name: 'General consultation', category: 'consultation', dept: 'OPD', unit: 'per-visit' },
  { code: 'CON-SPEC', name: 'Specialist consultation', category: 'consultation', dept: 'OPD', unit: 'per-visit' },
  { code: 'EMR-TRIAGE', name: 'Emergency assessment', category: 'emergency', dept: 'EMER', unit: 'per-visit' },
  { code: 'LAB-BLOOD', name: 'Blood count panel', category: 'diagnostics-lab', dept: 'LAB', unit: 'per-test' },
  { code: 'LAB-CHEM', name: 'Chemistry panel', category: 'diagnostics-lab', dept: 'LAB', unit: 'per-test' },
  { code: 'IMG-XRAY', name: 'X-ray imaging', category: 'diagnostics-imaging', dept: 'RAD', unit: 'per-test' },
  { code: 'IMG-US', name: 'Ultrasound imaging', category: 'diagnostics-imaging', dept: 'RAD', unit: 'per-test' },
  { code: 'PROC-MINOR', name: 'Minor procedure', category: 'procedure', dept: 'OPD', unit: 'per-procedure' },
  { code: 'WARD-DAY', name: 'Ward stay', category: 'inpatient-stay', dept: 'WARD', unit: 'per-day' },
  { code: 'DAY-SESS', name: 'Day-care session', category: 'day-care', dept: 'OPD', unit: 'per-session' },
  { code: 'REHAB-SESS', name: 'Rehabilitation session', category: 'therapy', dept: 'REHAB', unit: 'per-session' },
];

/** Builds the catalogue and offers it at every hospital, once, if there is none. */
export async function bootstrapCatalogue(ctx: Ctx, state: SimState, facilities: readonly FacilityRef[]): Promise<void> {
  const first = facilities[0];
  if (state.catalogueChecked || !first || ctx.cfg.paused) return;
  const existing = await read(ctx, 'read catalogue', () => ctx.admin.services({ facilityId: first.facilityId, includeInactive: 'true' }));
  if (!existing) return;
  state.catalogueChecked = true;
  if (existing.items.length > 0) return;

  ctx.log.info('the service catalogue is empty; building one', { services: DEFAULT_CATALOGUE.length, hospitals: facilities.length });
  for (const item of DEFAULT_CATALOGUE) {
    const department = ctx.ref.departments.find((candidate) => candidate.code === item.dept) ?? ctx.ref.departments[0];
    if (!department) continue;
    const created = await write(
      ctx,
      'create service',
      () =>
        ctx.admin.createService({
          serviceCode: item.code,
          name: item.name,
          category: item.category as 'consultation',
          departmentId: department.departmentId,
          unit: item.unit as 'per-visit',
        }),
      { counted: false },
    );
    if (created.status !== 'ok') continue;
    for (const facility of facilities) {
      await write(
        ctx,
        'offer service',
        () => ctx.admin.setAvailability(facility.facilityId, created.value.service.serviceId, { isAvailable: true }),
        { counted: false },
      );
    }
  }
}
