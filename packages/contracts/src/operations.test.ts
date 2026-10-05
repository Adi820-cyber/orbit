import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_FEED_ROLES,
  OperationsQuerySchema,
  OperationsResponseSchema,
  seesOperations,
} from './operations.ts';
import { ROLE_IDS } from './roles.ts';

const COUNTS = { activeStaff: 52, rosteredToday: 40, onDutyNow: 20, lateToday: 2, missingPunchToday: 1, absentToday: 3 };
const NOW = {
  staffing: COUNTS,
  doctors: { total: 11, credentialActive: 10, credentialExpiring: 1, credentialExpired: 0, credentialSuspended: 0 },
  visits: { openNow: 5, openInpatients: 5, startedToday: 14, startedLast7Days: 90 },
  services: { deliveredToday: 31, deliveredLast7Days: 240 },
  pendingCorrections: 2,
};
const ATTENDANCE = {
  days: 14,
  finished: 440,
  completed: 412,
  onTime: 380,
  late: 20,
  earlyExit: 12,
  missingPunch: 9,
  absent: 5,
  completionRate: { status: 'available', value: 93.6 },
  onTimeRate: { status: 'available', value: 86.4 },
  missingPunchRate: { status: 'available', value: 2 },
  absentRate: { status: 'available', value: 1.1 },
} as const;
const DAY = { date: '2026-09-30', rostered: 30, inProgress: 0, onTime: 26, late: 2, earlyExit: 1, missingPunch: 1, absent: 0, onLeave: 1 };

const RESPONSE = {
  source: 'hospital-operations',
  asOf: '2026-10-02T09:00:00.000Z',
  today: '2026-10-02',
  periodDays: 14,
  scope: [{ grain: 'facility', entityId: '11111111-1111-4111-8111-111111111111' }],
  rollup: { hospitals: 1, now: NOW, attendance: ATTENDANCE, daily: [DAY] },
  hospitals: [
    {
      facilityId: '11111111-1111-4111-8111-111111111111',
      name: 'Kestrion Avenhurst Hospital',
      now: NOW,
      attendance: ATTENDANCE,
      daily: [DAY],
      lastActivityAt: '2026-10-02T08:59:30.000Z',
    },
  ],
  dataQuality: { state: 'illustrative', reconciliation: 'not_applicable', freshness: 'current', refreshedAt: '2026-10-02T08:59:30.000Z', limitations: ['Simulated.'] },
  provenance: 'illustrative',
  disclosure: 'Fictional demonstration company.',
};

describe('operations feed contract', () => {
  it('accepts a complete response', () => {
    expect(OperationsResponseSchema.safeParse(RESPONSE).success).toBe(true);
  });

  it('accepts a scope that covers no hospital: an empty list and not_applicable rates, never zero', () => {
    const empty = {
      ...RESPONSE,
      hospitals: [],
      rollup: {
        hospitals: 0,
        now: NOW,
        attendance: { ...ATTENDANCE, finished: 0, completed: 0, completionRate: { status: 'not_applicable', reason: 'zero_denominator' } },
        daily: [],
      },
    };
    expect(OperationsResponseSchema.safeParse(empty).success).toBe(true);
  });

  it('refuses anything that is not illustrative', () => {
    expect(OperationsResponseSchema.safeParse({ ...RESPONSE, provenance: 'measured' }).success).toBe(false);
  });

  it('refuses extra fields, so a person or patient cannot ride along', () => {
    expect(OperationsResponseSchema.safeParse({ ...RESPONSE, patients: [] }).success).toBe(false);
    const withName = { ...RESPONSE, hospitals: [{ ...RESPONSE.hospitals[0], staffNames: ['x'] }] };
    expect(OperationsResponseSchema.safeParse(withName).success).toBe(false);
  });

  it('refuses a negative or fractional count', () => {
    const bad = { ...RESPONSE, rollup: { ...RESPONSE.rollup, now: { ...NOW, pendingCorrections: -1 } } };
    expect(OperationsResponseSchema.safeParse(bad).success).toBe(false);
    const fractional = { ...RESPONSE, rollup: { ...RESPONSE.rollup, now: { ...NOW, visits: { ...NOW.visits, openNow: 1.5 } } } };
    expect(OperationsResponseSchema.safeParse(fractional).success).toBe(false);
  });

  it('defaults the period to 14 days and bounds it', () => {
    expect(OperationsQuerySchema.parse({}).days).toBe(14);
    expect(OperationsQuerySchema.parse({ days: '7' }).days).toBe(7);
    expect(OperationsQuerySchema.safeParse({ days: '0' }).success).toBe(false);
    expect(OperationsQuerySchema.safeParse({ days: '31' }).success).toBe(false);
  });
});

describe('who sees operations', () => {
  it('lists only real workbook roles, without duplicates', () => {
    for (const role of OPERATIONS_FEED_ROLES) expect(ROLE_IDS).toContain(role);
    expect(new Set(OPERATIONS_FEED_ROLES).size).toBe(OPERATIONS_FEED_ROLES.length);
  });

  it('includes the leaders of hospitals and people, and leaves out finance, legal, procurement, analytics and COEs', () => {
    for (const role of ['chairman', 'regional-coo', 'hospital-dho', 'people-executive', 'hr-head'] as const) expect(seesOperations(role)).toBe(true);
    for (const role of ['group-cfo', 'legal-head', 'procurement-head', 'analytics-head', 'coe-lead', 'billing-lead', 'bd-lead'] as const) expect(seesOperations(role)).toBe(false);
  });
});
