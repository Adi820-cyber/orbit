import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localParts, weekNumber } from '../src/clock.ts';
import {
  approves,
  attendancePlan,
  decisionDelayMinutes,
  departmentCodeFor,
  expectedArrivals,
  patientProfile,
  performerTypes,
  renewalLagDays,
  rosterPlan,
  visitPlan,
  visitType,
  type EncounterType,
} from '../src/plan.ts';
import { hashInt, rngFor, stableUuid } from '../src/rng.ts';

const NO_RATES = { absent: 0, late: 0, missingOut: 0, earlyExit: 0 };
const SHIFTS = [
  { shiftTemplateId: 'm', code: 'M' },
  { shiftTemplateId: 'a', code: 'A' },
  { shiftTemplateId: 'n', code: 'N' },
  { shiftTemplateId: 'g', code: 'G' },
];

describe('stable ids and random streams', () => {
  it('derives the same uuid from the same labels, a different one from different labels', () => {
    expect(stableUuid('seed', 'punch', 'a', '2026-10-01', 'in')).toBe(stableUuid('seed', 'punch', 'a', '2026-10-01', 'in'));
    expect(stableUuid('seed', 'punch', 'a', '2026-10-01', 'in')).not.toBe(stableUuid('seed', 'punch', 'a', '2026-10-01', 'out'));
    expect(stableUuid('a', 'bc')).not.toBe(stableUuid('ab', 'c'));
  });

  it('makes valid v4-shaped uuids and does not collide across many keys', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 20_000; index += 1) {
      const id = stableUuid('seed', 'key', String(index));
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(20_000);
  });

  it('replays the same stream for the same labels and a different one otherwise', () => {
    const draw = (...labels: string[]) => {
      const rand = rngFor(...labels);
      return [rand.int(0, 1000), rand.int(0, 1000), rand.int(0, 1000)];
    };
    expect(draw('s', 'x')).toEqual(draw('s', 'x'));
    expect(draw('s', 'x')).not.toEqual(draw('s', 'y'));
  });

  it('keeps integers in range and rejects an empty pick', () => {
    const rand = rngFor('range');
    for (let index = 0; index < 500; index += 1) {
      const value = rand.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
    expect(() => rand.pick([])).toThrow();
    expect(() => rand.int(5, 1)).toThrow();
  });

  it('draws poisson counts whose mean matches', () => {
    const rand = rngFor('poisson');
    expect(rand.poisson(0)).toBe(0);
    for (const mean of [0.3, 2.8]) {
      let total = 0;
      for (let index = 0; index < 4000; index += 1) total += rand.poisson(mean);
      expect(total / 4000).toBeGreaterThan(mean * 0.9);
      expect(total / 4000).toBeLessThan(mean * 1.1);
    }
  });

  it('gives a stable small integer', () => {
    expect(hashInt('a', 'b')).toBe(hashInt('a', 'b'));
    expect(hashInt('a', 'b')).not.toBe(hashInt('a', 'c'));
  });
});

describe('time helpers', () => {
  it('reads local date and minutes in a time zone', () => {
    expect(localParts(new Date('2026-10-01T20:00:00Z'), 'UTC')).toEqual({ date: '2026-10-01', hour: 20, minutes: 1200 });
    // Asia/Kolkata is UTC+5:30, so 20:00Z is 01:30 the next day.
    expect(localParts(new Date('2026-10-01T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-10-02', hour: 1, minutes: 90 });
  });

  it('adds calendar days across month ends and finds the weekday', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoWeekday('2026-10-01')).toBe(4); // a Thursday
    expect(isoWeekday('2026-10-04')).toBe(7); // a Sunday
    expect(weekNumber('2026-10-08')).toBe(weekNumber('2026-10-01') + 1);
  });
});

describe('attendance plan', () => {
  it('is the same every time it is asked', () => {
    expect(attendancePlan('s', 'staff-1', '2026-10-01', NO_RATES)).toEqual(attendancePlan('s', 'staff-1', '2026-10-01', NO_RATES));
  });

  it('with no mishaps has everyone present, near their start, leaving just after their end', () => {
    for (let index = 0; index < 300; index += 1) {
      const plan = attendancePlan('s', `staff-${index}`, '2026-10-01', NO_RATES);
      expect(plan.absent).toBe(false);
      expect(plan.inOffsetMinutes).toBeGreaterThanOrEqual(-12);
      expect(plan.inOffsetMinutes).toBeLessThanOrEqual(6);
      expect(plan.outOffsetMinutes).not.toBeNull();
      expect(plan.outOffsetMinutes ?? -1).toBeGreaterThanOrEqual(0);
      expect(plan.fixAfterMinutes).toBeGreaterThanOrEqual(480);
    }
  });

  it('makes the configured share of people late, absent, forgetful or early out', () => {
    const rates = { absent: 0.2, late: 0.3, missingOut: 0.25, earlyExit: 0.4 };
    const plans = Array.from({ length: 4000 }, (_, index) => attendancePlan('s', `p-${index}`, '2026-10-01', rates));
    const share = (count: number) => count / plans.length;
    expect(share(plans.filter((plan) => plan.absent).length)).toBeGreaterThan(0.17);
    expect(share(plans.filter((plan) => plan.absent).length)).toBeLessThan(0.23);
    expect(share(plans.filter((plan) => plan.inOffsetMinutes >= 12).length)).toBeGreaterThan(0.27);
    expect(share(plans.filter((plan) => plan.inOffsetMinutes >= 12).length)).toBeLessThan(0.33);
    expect(share(plans.filter((plan) => plan.outOffsetMinutes === null).length)).toBeGreaterThan(0.22);
    expect(share(plans.filter((plan) => plan.outOffsetMinutes === null).length)).toBeLessThan(0.28);
    // early exits are a share of those who do punch out
    const leavers = plans.filter((plan) => plan.outOffsetMinutes !== null);
    expect(leavers.filter((plan) => (plan.outOffsetMinutes ?? 0) < 0).length / leavers.length).toBeGreaterThan(0.36);
  });

  it('a higher absence multiplier only adds absences, it never makes anyone else absent', () => {
    const base = { ...NO_RATES, absent: 0.1 };
    for (let index = 0; index < 500; index += 1) {
      const calm = attendancePlan('s', `p-${index}`, '2026-10-01', base, 1);
      const sick = attendancePlan('s', `p-${index}`, '2026-10-01', base, 3);
      if (calm.absent) expect(sick.absent).toBe(true);
      expect(sick.inOffsetMinutes).toBe(calm.inOffsetMinutes); // the rest of the day is unchanged
    }
  });
});

describe('roster plan', () => {
  const types = ['doctor', 'nurse', 'technician', 'administrative', 'support'] as const;

  it('gives everyone at least two rest days in every week and never an unknown shift', () => {
    for (const staffType of types) {
      for (let index = 0; index < 40; index += 1) {
        for (let week = 0; week < 6; week += 1) {
          const start = addDays('2026-10-05', week * 7); // a Monday
          let working = 0;
          for (let day = 0; day < 7; day += 1) {
            const shift = rosterPlan('s', { staffId: `${staffType}-${index}`, staffType }, addDays(start, day), SHIFTS);
            if (shift !== null) {
              working += 1;
              expect(['m', 'a', 'n', 'g']).toContain(shift);
            }
          }
          expect(working).toBeLessThanOrEqual(5);
          expect(working).toBeGreaterThanOrEqual(5); // exactly two rest days, never fewer shifts than that
        }
      }
    }
  });

  it('keeps office staff on weekdays and general shifts only', () => {
    for (let day = 0; day < 14; day += 1) {
      const date = addDays('2026-10-05', day);
      const shift = rosterPlan('s', { staffId: 'office-1', staffType: 'administrative' }, date, SHIFTS);
      if (isoWeekday(date) >= 6) expect(shift).toBeNull();
      else expect(shift).toBe('g');
    }
  });

  it('rotates nurses through morning, afternoon and night across the weeks', () => {
    const seen = new Set<string | null>();
    for (let week = 0; week < 6; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const shift = rosterPlan('s', { staffId: 'nurse-1', staffType: 'nurse' }, addDays('2026-10-05', week * 7 + day), SHIFTS);
        if (shift) seen.add(shift);
      }
    }
    expect(seen).toEqual(new Set(['m', 'a', 'n']));
  });

  it('returns no shift when the organization has no matching shift pattern', () => {
    expect(rosterPlan('s', { staffId: 'x', staffType: 'support' }, '2026-10-06', [])).toBeNull();
  });
});

describe('visit plan', () => {
  const kinds: EncounterType[] = ['outpatient', 'emergency', 'day-care', 'inpatient'];

  it('is repeatable and keeps every service inside the visit', () => {
    for (const kind of kinds) {
      for (let index = 0; index < 300; index += 1) {
        const plan = visitPlan('s', `e-${index}`, kind);
        expect(plan).toEqual(visitPlan('s', `e-${index}`, kind));
        expect(plan.services.length).toBeGreaterThan(0);
        for (const service of plan.services) {
          expect(service.offsetMinutes).toBeGreaterThanOrEqual(0);
          expect(service.offsetMinutes).toBeLessThan(plan.lengthMinutes);
          expect(service.quantity).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('plans realistic lengths by type', () => {
    expect(visitPlan('s', 'a', 'outpatient').lengthMinutes).toBeLessThanOrEqual(150);
    expect(visitPlan('s', 'a', 'emergency').lengthMinutes).toBeLessThanOrEqual(360);
    const stay = visitPlan('s', 'a', 'inpatient');
    expect(stay.lengthMinutes).toBeGreaterThanOrEqual(2 * 1440);
    expect(stay.services.filter((service) => service.category === 'inpatient-stay').length).toBeGreaterThanOrEqual(2);
  });

  it('has a consultation in every outpatient visit and an emergency assessment in every emergency', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(visitPlan('s', `o-${index}`, 'outpatient').services.some((service) => service.category === 'consultation')).toBe(true);
      expect(visitPlan('s', `x-${index}`, 'emergency').services.some((service) => service.category === 'emergency')).toBe(true);
    }
  });

  it('names who performs each category and where each kind of visit starts', () => {
    expect(performerTypes('consultation')).toEqual(['doctor']);
    expect(performerTypes('diagnostics-lab')).toEqual(['technician']);
    expect(performerTypes('inpatient-stay')).toEqual(['nurse']);
    expect(departmentCodeFor('emergency')).toBe('EMER');
    expect(departmentCodeFor('inpatient')).toBe('WARD');
    expect(departmentCodeFor('outpatient')).toBe('OPD');
  });
});

describe('arrivals', () => {
  it('is busier at the late-morning peak than in the small hours', () => {
    const at = (hour: number) => expectedArrivals({ staffCount: 50, visitsPerStaffPerDay: 0.6, hour, tickSeconds: 60, demand: 1 });
    expect(at(10)).toBeGreaterThan(at(3) * 8);
  });

  it('adds up to the configured visits per staff member over a day, scaled by demand', () => {
    const day = (demand: number) =>
      Array.from({ length: 24 }, (_, hour) => expectedArrivals({ staffCount: 50, visitsPerStaffPerDay: 0.6, hour, tickSeconds: 3600, demand })).reduce((a, b) => a + b, 0);
    expect(day(1)).toBeCloseTo(30, 5);
    expect(day(2)).toBeCloseTo(60, 5);
  });

  it('mixes visit types and makes only fictional patients', () => {
    const rand = rngFor('mix');
    const counts: Record<string, number> = {};
    for (let index = 0; index < 4000; index += 1) {
      const kind = visitType(rand);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect((counts['outpatient'] ?? 0) / 4000).toBeGreaterThan(0.6);
    expect(Object.keys(counts).sort()).toEqual(['day-care', 'emergency', 'inpatient', 'outpatient']);
    for (let index = 0; index < 200; index += 1) {
      const profile = patientProfile(rand, 2026);
      expect(profile.birthYear).toBeGreaterThanOrEqual(1935);
      expect(profile.birthYear).toBeLessThanOrEqual(2026);
      expect(profile.displayName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });
});

describe('administration', () => {
  it('takes a person-like time to decide, approves most requests, and spreads renewals', () => {
    let approved = 0;
    for (let index = 0; index < 2000; index += 1) {
      const delay = decisionDelayMinutes('s', `c-${index}`);
      expect(delay).toBeGreaterThanOrEqual(5);
      expect(delay).toBeLessThanOrEqual(45);
      if (approves('s', `c-${index}`)) approved += 1;
      expect(renewalLagDays('s', `d-${index}`)).toBeGreaterThanOrEqual(0);
      expect(renewalLagDays('s', `d-${index}`)).toBeLessThanOrEqual(5);
    }
    expect(approved / 2000).toBeGreaterThan(0.87);
    expect(approved / 2000).toBeLessThan(0.93);
  });
});
