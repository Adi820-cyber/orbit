import { describe, expect, it } from 'vitest';
import { loadConfig, type SimConfig } from '../src/config.ts';
import { NEUTRAL_MOOD, type Mood } from '../src/director.ts';
import { createSimulator, type TickSummary } from '../src/engine.ts';
import { silentLogger } from '../src/log.ts';
import { MINIMUM_STAFF } from '../src/bootstrap.ts';
import { addDays } from '../src/clock.ts';
import { approves, attendancePlan, CORRECTION_REASONS, decisionDelayMinutes, rosterPlan, visitPlan } from '../src/plan.ts';
import { coverFor } from '../src/billing.ts';
import { FAKE_PRICE, FakeErp, ORG_FACILITY_A, ORG_FACILITY_B, SHIFT_AFTERNOON, SHIFT_GENERAL, SHIFT_MORNING, type FakeStaff } from './fake-erp.ts';

const DATE = '2026-10-01';
const A = ORG_FACILITY_A;
const B = ORG_FACILITY_B;
const at = (iso: string) => Date.parse(iso);
const MINUTE = 60_000;

const BASE_ENV = {
  ERP_API_URL: 'http://localhost:3000',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not_a_real_key',
  SIM_ADMIN_EMAIL: 'admin@kestrion.demo',
  SIM_ADMIN_PASSWORD: 'x',
  SIM_FACILITIES: 'avenhurst',
  SIM_BOOTSTRAP: 'false',
  SIM_ABSENT_RATE: '0',
  SIM_LATE_RATE: '0',
  SIM_MISSING_OUT_RATE: '0',
  SIM_EARLY_EXIT_RATE: '0',
  SIM_VISITS_PER_STAFF_PER_DAY: '0',
  SIM_ROSTER_DAYS_AHEAD: '1',
};

const WRITE_METHODS = [
  'punch', 'setRoster', 'registerPatient', 'openEncounter', 'updateEncounter', 'recordDelivery', 'requestCorrection',
  'decideCorrection', 'updateDoctor', 'createStaff', 'createDoctor', 'createService', 'setAvailability', 'addScheduleSlot',
  'setCoverage', 'issueBill', 'recordPayment',
];

function world(env: Record<string, string> = {}, options: { desk?: boolean; moods?: Mood[]; start?: string } = {}) {
  const cfg = loadConfig({ ...BASE_ENV, ...(options.moods ? { SIM_GROQ_KEYS: 'test-key' } : {}), ...env });
  const moods = options.moods ?? [NEUTRAL_MOOD];
  let moodCalls = 0;
  let nowMs = at(options.start ?? `${DATE}T06:00:00Z`);
  const clock = { now: () => new Date(nowMs) };
  const admin = new FakeErp('admin', clock, { isAdmin: true });
  const desk = new FakeErp('desk', clock, { isAdmin: false, shared: admin });
  const desks = options.desk === false ? new Map<string, FakeErp>() : new Map([['avenhurst', desk]]);
  const simWith = (overrides: Partial<SimConfig> = {}) =>
    createSimulator({
      cfg: { ...cfg, ...overrides },
      clock,
      log: silentLogger,
      admin,
      desks,
      director: { decide: async () => moods[Math.min(moodCalls++, moods.length - 1)] ?? NEUTRAL_MOOD },
    });
  const sim = simWith();
  return {
    cfg,
    admin,
    desk,
    sim,
    /** Another simulator process over the same hospital and clock, e.g. one started with --once. */
    simWith,
    setNow: (ms: number) => {
      nowMs = ms;
    },
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

type World = ReturnType<typeof world>;

/** A nurse on the morning shift, with the times the simulator has planned for them. */
function morningNurse(w: World, name = 'Nurse One', date = DATE, facility = A) {
  const person = w.admin.addStaff(facility, 'nurse', name);
  w.admin.assignShift(person, date, SHIFT_MORNING);
  const plan = attendancePlan(w.cfg.seed, person.staffId, date, w.cfg.rates, 1);
  return {
    person,
    plan,
    plannedIn: at(`${date}T07:00:00Z`) + plan.inOffsetMinutes * MINUTE,
    plannedOut: at(`${date}T15:00:00Z`) + (plan.outOffsetMinutes ?? 0) * MINUTE,
  };
}

/** Puts someone on shift right now by recording their arrival directly. */
async function putOnDuty(w: World, person: FakeStaff, shift: string, date = DATE, atIso = `${date}T09:00:00.000Z`) {
  w.admin.assignShift(person, date, shift);
  await w.admin.punch({ staffId: person.staffId, direction: 'in', idempotencyKey: `00000000-0000-4000-8000-${person.staffId.slice(-12)}`, punchedAt: atIso });
}

const ALL_CATEGORIES = ['consultation', 'diagnostics-lab', 'diagnostics-imaging', 'therapy', 'emergency', 'inpatient-stay', 'day-care', 'procedure'] as const;

describe('attendance', () => {
  it('waits for the planned arrival, then the desk punches the person in once', async () => {
    const w = world();
    const { person, plannedIn } = morningNurse(w);

    w.setNow(plannedIn - MINUTE);
    await w.sim.tick();
    expect(w.admin.punches).toHaveLength(0);

    w.setNow(plannedIn + 30_000);
    await w.sim.tick();
    await w.sim.tick(); // repeating a tick must change nothing
    expect(w.admin.punches).toHaveLength(1);
    expect(w.admin.punches[0]).toMatchObject({ staffId: person.staffId, direction: 'in', source: 'desk' });
    expect(w.admin.callsTo('punch', 'desk')).toHaveLength(1);
    expect(w.admin.callsTo('punch', 'admin')).toHaveLength(0);
  });

  it('punches out after the shift ends and leaves a complete day', async () => {
    const w = world();
    const { plannedIn, plannedOut, person } = morningNurse(w);
    w.setNow(plannedIn + 30_000);
    await w.sim.tick();
    w.setNow(plannedOut + 30_000);
    await w.sim.tick();
    expect(w.admin.punches.map((punch) => punch.direction)).toEqual(['in', 'out']);
    const board = await w.admin.board({ facilityId: A, date: DATE });
    expect(board.rows.find((row) => row.staff.staffId === person.staffId)?.day.status).toBe('present');
  });

  it('after downtime an admin back-dates the punch to when it should have happened', async () => {
    const w = world();
    const { plannedIn } = morningNurse(w);
    w.setNow(plannedIn + 2 * 60 * MINUTE);
    await w.sim.tick();
    expect(w.admin.punches).toHaveLength(1);
    expect(w.admin.punches[0]).toMatchObject({ direction: 'in', source: 'admin-entry', at: new Date(plannedIn).toISOString() });
    expect(w.admin.callsTo('punch', 'admin')).toHaveLength(1);
    expect(w.admin.callsTo('punch', 'desk')).toHaveLength(0);
  });

  it('never rewrites history older than the back-fill limit', async () => {
    const w = world({ SIM_CATCHUP_MAX_HOURS: '24' });
    const { plannedIn } = morningNurse(w);
    w.setNow(plannedIn + 30 * 60 * MINUTE);
    await w.sim.tick();
    // Only the old shift is in question. Depending on the person's roster the
    // simulator may also (correctly) put them on the next morning's shift.
    expect(w.admin.punches.filter((punch) => punch.shiftDate === DATE)).toHaveLength(0);
  });

  it('records exactly the people who were not going to be absent', async () => {
    const w = world({ SIM_ABSENT_RATE: '0.5' });
    const staff = Array.from({ length: 30 }, (_, index) => morningNurse(w, `Nurse ${index}`));
    w.setNow(at(`${DATE}T08:00:00Z`));
    await w.sim.tick();
    const expected = new Set(staff.filter((entry) => !entry.plan.absent).map((entry) => entry.person.staffId));
    expect(expected.size).toBeGreaterThan(5);
    expect(expected.size).toBeLessThan(25);
    expect(new Set(w.admin.punches.map((punch) => punch.staffId))).toEqual(expected);
  });

  it("keeps a person's planned day even when the director changes the mood afterwards", async () => {
    const sick: Mood = { headline: 'flu', facilities: { avenhurst: { demand: 1, absence: 3 } }, source: 'test' };
    const w = world({ SIM_ABSENT_RATE: '0.3' }, { moods: [sick, NEUTRAL_MOOD] });
    Array.from({ length: 40 }, (_, index) => morningNurse(w, `Nurse ${index}`));
    w.setNow(at(`${DATE}T07:30:00Z`));
    await w.sim.tick(); // a sickness-heavy hour: many people are planned to be absent
    const punchedDuringFlu = w.admin.punches.length;
    expect(punchedDuringFlu).toBeLessThan(35);
    w.advance(61 * MINUTE); // the director is asked again and calls it an ordinary day
    await w.sim.tick();
    // Nobody who was planned to be off sick turns up just because the mood improved.
    expect(w.sim.state.mood.source).toBe('neutral');
    expect(w.admin.punches).toHaveLength(punchedDuringFlu);
  });

  it('plans more absences when the director says people are off sick', async () => {
    const count = async (absence: number) => {
      const w = world({ SIM_ABSENT_RATE: '0.2', SIM_SEED: 'sick-test' }, { moods: [{ headline: 'x', facilities: { avenhurst: { demand: 1, absence } }, source: 'test' }] });
      for (let index = 0; index < 60; index += 1) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        w.admin.assignShift(w.admin.addStaff(A, 'nurse', `N${index}`, 'active', id), DATE, SHIFT_MORNING);
      }
      w.setNow(at(`${DATE}T08:00:00Z`));
      await w.sim.tick();
      return w.admin.punches.length;
    };
    expect(await count(3)).toBeLessThan(await count(1));
  });

  describe('someone who forgets to punch out', () => {
    async function forgetful(desk: boolean) {
      const w = world({ SIM_MISSING_OUT_RATE: '0.5' }, { desk });
      // The rate is capped at 0.5, so look for an id whose plan includes forgetting, then create only that nurse.
      let number = 0;
      const idFor = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      while (attendancePlan(w.cfg.seed, idFor(number), DATE, w.cfg.rates, 1).outOffsetMinutes !== null) number += 1;
      const person = w.admin.addStaff(A, 'nurse', 'Forgetful nurse', 'active', idFor(number));
      w.admin.assignShift(person, DATE, SHIFT_MORNING);
      const plan = attendancePlan(w.cfg.seed, person.staffId, DATE, w.cfg.rates, 1);
      const entry = { person, plan, plannedIn: at(`${DATE}T07:00:00Z`) + plan.inOffsetMinutes * MINUTE };
      w.setNow(entry.plannedIn + 30_000);
      await w.sim.tick();
      expect(w.admin.punches).toHaveLength(1);
      const noticedAt = at(`${DATE}T15:00:00Z`) + entry.plan.fixAfterMinutes * MINUTE;
      w.setNow(Math.max(noticedAt + MINUTE, at(`${addDays(DATE, 1)}T00:30:00Z`)));
      return { w, entry };
    }

    it('is noticed next morning: the desk asks for a correction, and an admin decides it after a human delay', async () => {
      const { w, entry } = await forgetful(true);
      await w.sim.tick();
      await w.sim.tick(); // never requested twice
      expect(w.admin.correctionRecords).toHaveLength(1);
      const correction = w.admin.correctionRecords[0];
      expect(correction).toMatchObject({ staffId: entry.person.staffId, shiftDate: DATE, state: 'submitted', requestedBy: 'desk' });
      expect(CORRECTION_REASONS).toContain(correction?.reason);
      const proposed = Date.parse(correction?.proposedOut ?? '');
      expect(proposed).toBeGreaterThanOrEqual(at(`${DATE}T15:00:00Z`));
      expect(proposed).toBeLessThanOrEqual(at(`${DATE}T15:20:00Z`));

      const delay = decisionDelayMinutes(w.cfg.seed, correction?.id ?? '');
      const created = w.now();
      w.setNow(created + (delay - 1) * MINUTE);
      await w.sim.tick();
      expect(w.admin.correctionRecords[0]?.state).toBe('submitted');
      w.setNow(created + (delay + 1) * MINUTE);
      await w.sim.tick();
      expect(w.admin.correctionRecords[0]?.state).toBe(approves(w.cfg.seed, correction?.id ?? '') ? 'approved' : 'rejected');
      // Punches are append-only: the fix is a correction, never an edit.
      expect(w.admin.punches).toHaveLength(1);
    });

    it('without a desk the admin records the missed punch itself, because it may not approve its own request', async () => {
      const { w } = await forgetful(false);
      await w.sim.tick();
      await w.sim.tick();
      expect(w.admin.correctionRecords).toHaveLength(0);
      expect(w.admin.punches.map((punch) => punch.direction)).toEqual(['in', 'out']);
      expect(w.admin.punches[1]?.source).toBe('admin-entry');
    });
  });

  it('does not decide a correction the admin itself requested', async () => {
    const w = world({}, { desk: false });
    const { person } = morningNurse(w);
    await w.admin.requestCorrection({ staffId: person.staffId, shiftDate: DATE, proposedOut: `${DATE}T15:05:00.000Z`, reason: 'Forgot to punch out' });
    w.advance(5 * 60 * MINUTE);
    await w.sim.tick();
    expect(w.admin.correctionRecords[0]?.state).toBe('submitted');
    expect(w.admin.callsTo('decideCorrection')).toHaveLength(0);
  });
});

describe('rosters', () => {
  it('plans each empty day once, one hospital-day per tick, following the rotation rules', async () => {
    const w = world({ SIM_ROSTER_DAYS_AHEAD: '3' });
    const people = [
      w.admin.addStaff(A, 'nurse', 'N1'),
      w.admin.addStaff(A, 'nurse', 'N2'),
      w.admin.addStaff(A, 'doctor', 'D1'),
      w.admin.addStaff(A, 'administrative', 'Office'),
    ];
    const shifts = (await w.admin.reference()).shiftTemplates.map((template) => ({ shiftTemplateId: template.shiftTemplateId, code: template.code }));
    const expectedOn = (date: string) => people.filter((person) => rosterPlan(w.cfg.seed, { staffId: person.staffId, staffType: person.type }, date, shifts) !== null).length;

    await w.sim.tick();
    expect(w.admin.count('setRoster')).toBe(expectedOn(DATE));
    await w.sim.tick();
    expect(w.admin.count('setRoster')).toBe(expectedOn(DATE) + expectedOn(addDays(DATE, 1)));
    await w.sim.tick();
    const total = expectedOn(DATE) + expectedOn(addDays(DATE, 1)) + expectedOn(addDays(DATE, 2));
    expect(w.admin.count('setRoster')).toBe(total);
    await w.sim.tick();
    expect(w.admin.count('setRoster')).toBe(total); // everything in the window is planned: nothing more to do
  });

  it('leaves a day alone when anyone already has a shift on it', async () => {
    const w = world({ SIM_ROSTER_DAYS_AHEAD: '2' });
    const early = w.admin.addStaff(A, 'nurse', 'N1');
    w.admin.addStaff(A, 'nurse', 'N2');
    w.admin.assignShift(early, DATE, SHIFT_GENERAL);
    w.admin.assignShift(early, addDays(DATE, 1), SHIFT_GENERAL);
    await w.sim.tick();
    await w.sim.tick();
    expect(w.admin.count('setRoster')).toBe(0);
  });
});

describe('visits', () => {
  /** A hospital with a doctor, a nurse and a technician on shift, every kind of service on offer, and an open visit. */
  async function ward(env: Record<string, string> = {}) {
    const w = world(env, { start: `${DATE}T10:00:00Z` });
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
    const nurse = w.admin.addStaff(A, 'nurse', 'Nurse');
    const technician = w.admin.addStaff(A, 'technician', 'Technician');
    for (const person of [doctor, nurse, technician]) await putOnDuty(w, person, SHIFT_GENERAL);
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);
    return { w, doctor, nurse, technician };
  }

  it('records every planned service by the right kind of person at its planned time, then closes the visit', async () => {
    const { w, doctor, nurse, technician } = await ward();
    const visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:30:00.000Z`);
    const plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 1) * MINUTE);
    await w.sim.tick();

    expect(w.admin.deliveries).toHaveLength(plan.services.length);
    for (const delivery of w.admin.deliveries) {
      const planned = plan.services.find((service) => at(visit.startedAt) + service.offsetMinutes * MINUTE === Date.parse(delivery.at));
      expect(planned, 'each service is recorded at its planned time').toBeDefined();
      const category = w.admin.serviceRecords.find((service) => service.serviceId === delivery.serviceId)?.category;
      expect(category).toBe(planned?.category);
      const performer = category === 'consultation' ? doctor : category === 'diagnostics-lab' || category === 'diagnostics-imaging' ? technician : nurse;
      expect(delivery.staffId).toBe(performer.staffId);
    }
    expect(visit.status).toBe('closed');
    expect(visit.endedAt).not.toBeNull();
    for (const delivery of w.admin.deliveries) expect(delivery.at <= (visit.endedAt ?? '')).toBe(true);
  });

  it('never back-fills a service planned longer ago than the back-fill limit, and still closes the visit', async () => {
    const { w } = await ward({ SIM_CATCHUP_MAX_HOURS: '1' });
    const visit = w.admin.seedEncounter(A, 'inpatient', `${DATE}T10:00:00.000Z`);
    const plan = visitPlan(w.cfg.seed, visit.encounterId, 'inpatient');
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 1) * MINUTE);
    await w.sim.tick();
    const limit = w.now() - 60 * MINUTE;
    expect(w.admin.deliveries.every((delivery) => Date.parse(delivery.at) >= limit)).toBe(true);
    expect(visit.status).toBe('closed');
  });

  it('in single-run mode, only sends services due since the last few runs, so a run does not resend a visit’s history', async () => {
    const lookbackSeconds = 1800;
    const run = async (overrides: Partial<SimConfig>) => {
      const { w } = await ward();
      const visit = w.admin.seedEncounter(A, 'inpatient', `${DATE}T10:00:00.000Z`);
      w.setNow(at(`${DATE}T15:00:00Z`));
      await w.simWith(overrides).tick();
      const cutoff = w.now() - lookbackSeconds * 1000;
      return w.admin.deliveries.filter((delivery) => delivery.encounterId === visit.encounterId && Date.parse(delivery.at) < cutoff).length;
    };
    // The always-on worker catches up on the whole day...
    expect(await run({})).toBeGreaterThan(0);
    // ...a single run leaves what earlier runs covered to them.
    expect(await run({ serviceLookbackSeconds: lookbackSeconds })).toBe(0);
  });

  it('leaves the visit open until it is old enough, and does not record a service before it is due', async () => {
    const { w } = await ward();
    const visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:59:00.000Z`);
    await w.sim.tick();
    expect(visit.status).toBe('open');
    expect(w.admin.deliveries.every((delivery) => Date.parse(delivery.at) <= w.now())).toBe(true);
  });

  it('waits for a suitable person to be on shift, then finishes the visit', async () => {
    const w = world({}, { start: `${DATE}T10:00:00Z` });
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
    await putOnDuty(w, doctor, SHIFT_GENERAL);
    await putOnDuty(w, w.admin.addStaff(A, 'nurse', 'Nurse'), SHIFT_GENERAL);
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);

    // Find a visit whose plan includes a lab test, which only a technician can do.
    let visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:00:00.000Z`);
    let plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    while (!plan.services.some((service) => service.category === 'diagnostics-lab')) {
      visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:00:00.000Z`);
      plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    }
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 5) * MINUTE);
    await w.sim.tick();
    expect(visit.status).toBe('open'); // the lab test cannot be done yet

    const technician = w.admin.addStaff(A, 'technician', 'Technician');
    await putOnDuty(w, technician, SHIFT_GENERAL, DATE, `${DATE}T09:00:00.000Z`);
    await w.sim.tick();
    expect(visit.status).toBe('closed');
  });

  it('skips a kind of service the hospital does not offer, and still closes the visit', async () => {
    const w = world({}, { start: `${DATE}T10:00:00Z` });
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
    const technician = w.admin.addStaff(A, 'technician', 'Technician');
    for (const person of [doctor, technician]) await putOnDuty(w, person, SHIFT_GENERAL);
    w.admin.addService('SVC-consultation', 'consultation');
    w.admin.addService('SVC-lab', 'diagnostics-lab', [B]); // offered at the other hospital only

    let visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:00:00.000Z`);
    let plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    while (!plan.services.some((service) => service.category === 'diagnostics-lab')) {
      visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:00:00.000Z`);
      plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    }
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 5) * MINUTE);
    await w.sim.tick();
    expect(visit.status).toBe('closed');
    const categories = w.admin.deliveries.filter((delivery) => delivery.encounterId === visit.encounterId).map((delivery) => w.admin.serviceRecords.find((service) => service.serviceId === delivery.serviceId)?.category);
    expect(categories).not.toContain('diagnostics-lab');
  });

  it('does not retry a service a rule has refused, and does not let it block the visit', async () => {
    const { w } = await ward();
    w.admin.refusing.add('recordDelivery:*');
    const visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:30:00.000Z`);
    const plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 1) * MINUTE);
    await w.sim.tick();
    const attempts = w.admin.count('recordDelivery');
    expect(attempts).toBe(plan.services.length);
    expect(visit.status).toBe('closed');
    await w.sim.tick();
    expect(w.admin.count('recordDelivery')).toBe(attempts);
  });

  it('admits new patients over time and never exceeds the inpatient limit', async () => {
    const w = world(
      { SIM_VISITS_PER_STAFF_PER_DAY: '5', SIM_TICK_SECONDS: '600', SIM_MAX_OPEN_INPATIENTS: '0', SIM_MAX_WRITES_PER_TICK: '200' },
      { start: `${DATE}T10:00:00Z` },
    );
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
    await putOnDuty(w, doctor, SHIFT_GENERAL);
    for (let index = 0; index < 40; index += 1) w.admin.addStaff(A, 'support', `Support ${index}`);
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);

    let registered = 0;
    for (let tick = 0; tick < 30; tick += 1) {
      const before = w.admin.patientRecords.length;
      await w.sim.tick();
      expect(w.admin.patientRecords.length - before).toBeLessThanOrEqual(6); // arrivals per tick are capped
      registered += w.admin.patientRecords.length - before;
      w.advance(600_000);
    }
    expect(registered).toBeGreaterThanOrEqual(5);
    expect(w.admin.encounterRecords.length).toBeGreaterThanOrEqual(5);
    expect(w.admin.encounterRecords.some((visit) => visit.type === 'inpatient')).toBe(false);
    expect(w.admin.encounterRecords.every((visit) => visit.facilityId === A)).toBe(true);
    expect(w.admin.encounterRecords.some((visit) => visit.doctorId === doctor.staffId)).toBe(true);
  });

  it('sends more patients to a hospital the director says is busy', async () => {
    const patients = async (demand: number) => {
      const w = world(
        { SIM_VISITS_PER_STAFF_PER_DAY: '1', SIM_TICK_SECONDS: '600', SIM_MAX_WRITES_PER_TICK: '500', SIM_SEED: 'mood-test' },
        { start: `${DATE}T10:00:00Z`, moods: [{ headline: 'x', facilities: { avenhurst: { demand, absence: 1 } }, source: 'test' }] },
      );
      const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
      await putOnDuty(w, doctor, SHIFT_GENERAL);
      for (let index = 0; index < 60; index += 1) w.admin.addStaff(A, 'support', `S${index}`);
      for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);
      for (let tick = 0; tick < 12; tick += 1) {
        await w.sim.tick();
        w.advance(600_000);
      }
      return w.admin.patientRecords.length;
    };
    const busy = await patients(2.5);
    const quiet = await patients(0.4);
    expect(busy).toBeGreaterThan(quiet);
  });

  it('records a presenting condition from the fixed list on every new visit', async () => {
    const w = world({ SIM_VISITS_PER_STAFF_PER_DAY: '5', SIM_TICK_SECONDS: '600', SIM_MAX_WRITES_PER_TICK: '200' }, { start: `${DATE}T10:00:00Z` });
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor');
    await putOnDuty(w, doctor, SHIFT_GENERAL);
    for (let index = 0; index < 40; index += 1) w.admin.addStaff(A, 'support', `Support ${index}`);
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);
    for (let tick = 0; tick < 12; tick += 1) {
      await w.sim.tick();
      w.advance(600_000);
    }
    const known = new Set((await w.admin.reference()).conditions.map((condition) => condition.conditionId));
    expect(w.admin.encounterRecords.length).toBeGreaterThan(0);
    expect(w.admin.encounterRecords.every((visit) => typeof visit.conditionId === 'string' && known.has(visit.conditionId))).toBe(true);
  });

  it('stages an outbreak only when configured: extra outpatient visits with that one condition', async () => {
    const outbreakVisits = async (env: Record<string, string>) => {
      const w = world({ SIM_TICK_SECONDS: '600', SIM_MAX_WRITES_PER_TICK: '200', ...env }, { start: `${DATE}T10:00:00Z` });
      for (let tick = 0; tick < 24; tick += 1) {
        await w.sim.tick();
        w.advance(600_000);
      }
      const fever = (await w.admin.reference()).conditions.find((condition) => condition.code === 'VIRAL-FEVER');
      return w.admin.encounterRecords.filter((visit) => visit.conditionId === fever?.conditionId && visit.type === 'outpatient').length;
    };
    expect(await outbreakVisits({})).toBe(0);
    expect(await outbreakVisits({ SIM_OUTBREAK_CONDITION: 'VIRAL-FEVER', SIM_OUTBREAK_PER_HOSPITAL_PER_DAY: '48' })).toBeGreaterThan(3);
    // A code that is not on the list stages nothing rather than inventing a condition.
    expect(await outbreakVisits({ SIM_OUTBREAK_CONDITION: 'NOT-A-CONDITION' })).toBe(0);
  });
});

describe('billing', () => {
  async function closedVisit(env: Record<string, string> = {}) {
    const w = world(env, { start: `${DATE}T10:00:00Z` });
    for (const [type, name] of [['doctor', 'Doctor'], ['nurse', 'Nurse'], ['technician', 'Technician']] as const) {
      await putOnDuty(w, w.admin.addStaff(A, type, name), SHIFT_GENERAL);
    }
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);
    const visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:30:00.000Z`);
    const plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 1) * MINUTE);
    return { w, visit };
  }

  it('gives new patients the dataset\'s mix of cover: 60% insured, mostly government, 50-90% covered', () => {
    const covers = Array.from({ length: 4000 }, (_, i) => coverFor('seed', `patient-${i}`));
    const insured = covers.filter((cover) => cover.payerType !== 'self-pay');
    expect(insured.length / covers.length).toBeGreaterThan(0.56);
    expect(insured.length / covers.length).toBeLessThan(0.64);
    expect(insured.filter((cover) => cover.payerType === 'government').length / insured.length).toBeGreaterThan(0.55);
    expect(new Set(insured.map((cover) => cover.coveragePercent))).toEqual(new Set([50, 60, 70, 80, 90]));
    expect(covers.filter((cover) => cover.payerType === 'self-pay').every((cover) => cover.coveragePercent === 0)).toBe(true);
    expect(coverFor('seed', 'patient-7')).toEqual(coverFor('seed', 'patient-7'));
  });

  it('bills a visit once when it closes, split by the patient\'s cover, and replays rather than re-bills', async () => {
    const { w, visit } = await closedVisit();
    w.admin.coverRecords.set(visit.patientId, { payerType: 'private', coveragePercent: 60 });
    const summary = await w.sim.tick();
    expect(visit.status).toBe('closed');
    expect(w.admin.billRecords).toHaveLength(1);
    const [bill] = w.admin.billRecords;
    const quantity = w.admin.deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0);
    expect(bill).toMatchObject({ encounterId: visit.encounterId, gross: quantity * FAKE_PRICE, insurance: quantity * FAKE_PRICE * 0.6 });
    expect(summary.stats).toMatchObject({ bills: 1, failures: 0 });
    await w.sim.tick();
    expect(w.admin.billRecords).toHaveLength(1);
  });

  it('collects the patient\'s share and settles the insurer\'s later, never more than is owed', async () => {
    const { w, visit } = await closedVisit();
    w.admin.coverRecords.set(visit.patientId, { payerType: 'government', coveragePercent: 70 });
    await w.sim.tick();
    w.advance(11 * 24 * 60 * MINUTE); // past every patient and insurer delay
    await w.sim.tick();
    const [bill] = w.admin.billRecords;
    if (!bill) throw new Error('the visit should have been billed');
    const paid = (payer: 'patient' | 'insurer') => bill.payments.filter((p) => p.payer === payer).reduce((sum, p) => sum + p.amount, 0);
    expect(paid('insurer')).toBe(bill.insurance);
    // A few patients leave their share owed; everyone else has paid it in full, exactly once.
    expect([0, bill.patient]).toContain(paid('patient'));
    expect(bill.payments.filter((p) => p.payer === 'patient').length).toBeLessThanOrEqual(1);
  });

  it('closes a visit with no service on it without billing it or counting a failure', async () => {
    const w = world({}, { start: `${DATE}T10:00:00Z` });
    await putOnDuty(w, w.admin.addStaff(A, 'doctor', 'Doctor'), SHIFT_GENERAL);
    const visit = w.admin.seedEncounter(A, 'outpatient', `${DATE}T09:30:00.000Z`);
    const plan = visitPlan(w.cfg.seed, visit.encounterId, 'outpatient');
    w.setNow(at(visit.startedAt) + (plan.lengthMinutes + 1) * MINUTE);
    const summary = await w.sim.tick(); // nothing is offered here, so no service is recorded
    expect(visit.status).toBe('closed');
    expect(w.admin.billRecords).toHaveLength(0);
    expect(summary.stats).toMatchObject({ bills: 0, unbillable: 0, failures: 0 });
  });

  it('counts a visit with an unpriced service as unbillable, not as a failure', async () => {
    const { w } = await closedVisit();
    for (const category of ALL_CATEGORIES) w.admin.unpriced.add(`SVC-${category}`);
    const summary = await w.sim.tick();
    expect(w.admin.billRecords).toHaveLength(0);
    expect(summary.stats).toMatchObject({ bills: 0, unbillable: 1, failures: 0 });
  });
});

describe('a hospital day', () => {
  it('runs from before the morning shift to the end of the afternoon one without a failure or a duplicate', async () => {
    const w = world(
      { SIM_ABSENT_RATE: '0.05', SIM_LATE_RATE: '0.1', SIM_MISSING_OUT_RATE: '0.05', SIM_EARLY_EXIT_RATE: '0.05', SIM_VISITS_PER_STAFF_PER_DAY: '3', SIM_TICK_SECONDS: '300', SIM_CATCHUP_SECONDS: '300', SIM_MAX_WRITES_PER_TICK: '200' },
      { start: `${DATE}T05:55:00Z` },
    );
    const roster: { person: FakeStaff; shift: string }[] = [];
    for (let index = 0; index < 8; index += 1) roster.push({ person: w.admin.addStaff(A, 'nurse', `Morning nurse ${index}`), shift: SHIFT_MORNING });
    for (let index = 0; index < 4; index += 1) roster.push({ person: w.admin.addStaff(A, 'nurse', `Afternoon nurse ${index}`), shift: SHIFT_AFTERNOON });
    for (let index = 0; index < 2; index += 1) roster.push({ person: w.admin.addStaff(A, 'doctor', `Doctor ${index}`), shift: SHIFT_GENERAL });
    for (let index = 0; index < 3; index += 1) roster.push({ person: w.admin.addStaff(A, 'technician', `Technician ${index}`), shift: SHIFT_MORNING });
    for (let index = 0; index < 30; index += 1) w.admin.addStaff(A, 'support', `Support ${index}`);
    for (const entry of roster) w.admin.assignShift(entry.person, DATE, entry.shift);
    for (const category of ALL_CATEGORIES) w.admin.addService(`SVC-${category}`, category);

    const summaries: TickSummary[] = [];
    while (w.now() < at(`${DATE}T23:40:00Z`)) {
      summaries.push(await w.sim.tick());
      w.advance(300_000);
    }
    expect(summaries.reduce((sum, summary) => sum + summary.stats.failures, 0)).toBe(0);

    // Attendance: everyone not planned to be absent arrived on time, at the real time, by the desk.
    const startOf = (shift: string) => (shift === SHIFT_MORNING ? '07:00' : shift === SHIFT_AFTERNOON ? '15:00' : '09:00');
    const endOf = (shift: string) => (shift === SHIFT_MORNING ? '15:00' : shift === SHIFT_AFTERNOON ? '23:00' : '17:00');
    for (const entry of roster) {
      const plan = attendancePlan(w.cfg.seed, entry.person.staffId, DATE, w.cfg.rates, 1);
      const mine = w.admin.punches.filter((punch) => punch.staffId === entry.person.staffId);
      if (plan.absent) {
        expect(mine).toHaveLength(0);
        continue;
      }
      const plannedIn = at(`${DATE}T${startOf(entry.shift)}:00Z`) + plan.inOffsetMinutes * MINUTE;
      const arrival = mine.find((punch) => punch.direction === 'in');
      expect(arrival?.source).toBe('desk');
      expect(Date.parse(arrival?.at ?? '')).toBeGreaterThanOrEqual(plannedIn);
      expect(Date.parse(arrival?.at ?? '')).toBeLessThanOrEqual(plannedIn + 300_000);
      const out = mine.find((punch) => punch.direction === 'out');
      if (plan.outOffsetMinutes === null) expect(out).toBeUndefined();
      else expect(Date.parse(out?.at ?? '')).toBeGreaterThanOrEqual(at(`${DATE}T${endOf(entry.shift)}:00Z`) + plan.outOffsetMinutes * MINUTE);
    }
    expect(new Set(w.admin.punches.map((punch) => punch.key)).size).toBe(w.admin.punches.length);

    // Patients: people arrived, were seen, and every service sits inside its visit.
    expect(w.admin.patientRecords.length).toBeGreaterThanOrEqual(10);
    expect(w.admin.encounterRecords.filter((visit) => visit.status === 'closed').length).toBeGreaterThanOrEqual(1);
    expect(w.admin.deliveries.length).toBeGreaterThanOrEqual(5);
    for (const delivery of w.admin.deliveries) {
      const visit = w.admin.encounterRecords.find((candidate) => candidate.encounterId === delivery.encounterId);
      expect(visit).toBeDefined();
      expect(delivery.at >= (visit?.startedAt ?? '')).toBe(true);
      if (visit?.endedAt) expect(delivery.at <= visit.endedAt).toBe(true);
    }
    expect(new Set(w.admin.deliveries.map((delivery) => delivery.key)).size).toBe(w.admin.deliveries.length);
    expect(w.admin.encounterRecords.every((visit) => visit.endedAt === null || visit.endedAt >= visit.startedAt)).toBe(true);
  });
});

describe('administration and safety rails', () => {
  it('renews an expired credential once a day, mid-morning, and not before', async () => {
    const w = world({}, { start: `${DATE}T09:00:00Z` });
    const doctor = w.admin.addStaff(A, 'doctor', 'Doctor', 'expired');
    await w.sim.tick();
    expect(w.admin.count('updateDoctor')).toBe(0);
    w.setNow(at(`${DATE}T11:00:00Z`));
    await w.sim.tick();
    await w.sim.tick();
    expect(w.admin.count('updateDoctor')).toBe(1);
    expect(doctor.credentialStatus).toBe('active');
  });

  it('writes nothing while paused, but keeps reading', async () => {
    const w = world({ SIM_PAUSED: 'true', SIM_BOOTSTRAP: 'true' });
    const { plannedIn } = morningNurse(w);
    w.admin.seedEncounter(A, 'outpatient', `${DATE}T05:00:00.000Z`);
    w.setNow(plannedIn + 10 * MINUTE);
    const summary = await w.sim.tick();
    for (const method of WRITE_METHODS) expect(w.admin.count(method), method).toBe(0);
    expect(w.admin.count('board')).toBeGreaterThan(0);
    expect(summary.stats.writes).toBe(0);
  });

  it('stops after its write budget for a tick and carries the rest over to the next', async () => {
    const w = world({ SIM_MAX_WRITES_PER_TICK: '2' });
    const people = Array.from({ length: 5 }, (_, index) => morningNurse(w, `Nurse ${index}`));
    w.setNow(Math.max(...people.map((entry) => entry.plannedIn)) + 30_000);
    await w.sim.tick();
    expect(w.admin.punches).toHaveLength(2);
    await w.sim.tick();
    expect(w.admin.punches).toHaveLength(4);
    await w.sim.tick();
    expect(w.admin.punches).toHaveLength(5);
  });

  it('lets one hospital fail without stopping the others', async () => {
    const w = world({ SIM_FACILITIES: 'avenhurst,brackmoor' });
    const broken = morningNurse(w, 'Broken site nurse', DATE, A);
    const fine = morningNurse(w, 'Fine site nurse', DATE, B);
    w.admin.failing.add(`board:${A}`);
    w.setNow(Math.max(broken.plannedIn, fine.plannedIn) + 30_000);
    const summary = await w.sim.tick();
    expect(summary.stats.failures).toBeGreaterThan(0);
    expect(w.admin.punches.map((punch) => punch.staffId)).toEqual([fine.person.staffId]);
  });

  it('only works on the hospitals it was asked to', async () => {
    const w = world({ SIM_FACILITIES: 'brackmoor' });
    const here = morningNurse(w, 'Avenhurst nurse', DATE, A);
    const there = morningNurse(w, 'Brackmoor nurse', DATE, B);
    w.setNow(Math.max(here.plannedIn, there.plannedIn) + 30_000);
    await w.sim.tick();
    expect(w.admin.punches.map((punch) => punch.staffId)).toEqual([there.person.staffId]);
  });
});

describe('starting from an empty hospital', () => {
  it('hires up to the minimum staff, gives doctors a schedule, builds a catalogue, and only then plans rosters', async () => {
    const w = world({ SIM_BOOTSTRAP: 'true', SIM_ROSTER_DAYS_AHEAD: '2' });
    const target = Object.values(MINIMUM_STAFF).reduce((sum, count) => sum + count, 0);

    await w.sim.tick();
    expect(w.admin.staffList.length).toBeLessThan(target); // hiring is paced over several ticks
    expect(w.admin.count('setRoster')).toBe(0); // nobody is rostered until the hospital is fully staffed
    expect(w.admin.serviceRecords.length).toBeGreaterThanOrEqual(10);
    expect(w.admin.serviceRecords.every((service) => service.offeredAt.has(A))).toBe(true);

    for (let tick = 0; tick < 10 && w.admin.staffList.length < target; tick += 1) await w.sim.tick();
    expect(w.admin.staffList).toHaveLength(target);
    for (const [type, minimum] of Object.entries(MINIMUM_STAFF)) {
      expect(w.admin.staffList.filter((person) => person.type === type)).toHaveLength(minimum);
    }
    const doctors = w.admin.staffList.filter((person) => person.type === 'doctor');
    for (const doctor of doctors) expect(w.admin.slots.filter((slot) => slot.staffId === doctor.staffId).length).toBeGreaterThanOrEqual(2);

    await w.sim.tick();
    await w.sim.tick();
    expect(w.admin.count('setRoster')).toBeGreaterThan(0);
    // Hiring stops once the minimums are met.
    const hires = w.admin.count('createStaff') + w.admin.count('createDoctor');
    await w.sim.tick();
    expect(w.admin.count('createStaff') + w.admin.count('createDoctor')).toBe(hires);
  });

  it('does not hire or build anything over data that is already there', async () => {
    const w = world({ SIM_BOOTSTRAP: 'true' });
    for (const [type, minimum] of Object.entries(MINIMUM_STAFF)) {
      for (let index = 0; index < minimum + 2; index += 1) w.admin.addStaff(A, type as 'nurse', `${type}-${index}`);
    }
    w.admin.addService('EXISTING', 'consultation');
    await w.sim.tick();
    expect(w.admin.count('createStaff')).toBe(0);
    expect(w.admin.count('createDoctor')).toBe(0);
    expect(w.admin.count('createService')).toBe(0);
  });

  it('with bootstrap off leaves an empty hospital empty', async () => {
    const w = world({ SIM_BOOTSTRAP: 'false' });
    await w.sim.tick();
    expect(w.admin.staffList).toHaveLength(0);
    expect(w.admin.serviceRecords).toHaveLength(0);
  });
});
