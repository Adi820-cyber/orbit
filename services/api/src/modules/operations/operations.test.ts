import { afterEach, describe, expect, it } from 'vitest';
import { OperationsResponseSchema } from '@orbit/contracts';
import { ApiError } from '../../plugins/errors.ts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { BILLING_SUBJECT, buildModuleApp, FACILITY_A1, FACILITY_A2, REGION_B } from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

const NOW_ISO = new Date().toISOString();
const RECENT = new Date(Date.now() - 5 * 60 * 1000).toISOString();

function snapshot(facilityId: string, overrides: Record<string, unknown> = {}) {
  return {
    facilityId,
    today: NOW_ISO.slice(0, 10),
    asOf: NOW_ISO,
    activeStaff: 50,
    rosteredToday: 30,
    onDutyNow: 12,
    lateToday: 2,
    missingPunchToday: 1,
    absentToday: 3,
    doctorsTotal: 10,
    doctorsActive: 8,
    doctorsExpiring: 1,
    doctorsExpired: 1,
    doctorsSuspended: 0,
    openVisits: 6,
    openInpatients: 4,
    visitsStartedToday: 9,
    visitsStarted7d: 60,
    servicesToday: 20,
    services7d: 140,
    pendingCorrections: 2,
    lastActivityAt: RECENT,
    ...overrides,
  };
}

function day(facilityId: string, date: string, overrides: Record<string, unknown> = {}) {
  return { facilityId, date, rostered: 30, inProgress: 0, onTime: 24, late: 3, earlyExit: 1, missingPunch: 1, absent: 1, onLeave: 2, ...overrides };
}

async function setup(rows: { snapshot?: unknown[]; daily?: unknown[] } = {}) {
  const built = await buildModuleApp({
    operations: {
      snapshot: async () => rows.snapshot ?? [snapshot(FACILITY_A1.entityId), snapshot(FACILITY_A2.entityId, { activeStaff: 40 })],
      daily: async () =>
        rows.daily ?? [
          day(FACILITY_A1.entityId, '2026-10-01'),
          day(FACILITY_A2.entityId, '2026-10-01', { rostered: 20, onTime: 18, late: 1, earlyExit: 0, missingPunch: 0, absent: 1 }),
        ],
    },
  });
  close = () => built.app.close();
  return built;
}

describe('GET /api/operations', () => {
  it('returns each hospital in scope with its name, and a roll-up that sums counts', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/operations');
    expect(response.statusCode).toBe(200);
    const body = OperationsResponseSchema.parse(response.json());
    expect(body.hospitals.map((h) => h.name)).toEqual(['Fixture facility A1', 'Fixture facility A2']);
    expect(body.rollup.hospitals).toBe(2);
    expect(body.rollup.now.staffing.activeStaff).toBe(90);
    expect(body.rollup.daily).toHaveLength(1);
    expect(body.rollup.daily[0]).toMatchObject({ date: '2026-10-01', rostered: 50, onTime: 42 });
    expect(body.provenance).toBe('illustrative');
    expect(body.disclosure).toMatch(/illustrative/);
    expect(body.dataQuality.freshness).toBe('current');
  });

  it('computes rates as counts over finished shifts, with in-progress shifts left out', async () => {
    const { call } = await setup({
      snapshot: [snapshot(FACILITY_A1.entityId)],
      daily: [day(FACILITY_A1.entityId, '2026-10-01', { rostered: 11, inProgress: 1, onTime: 8, late: 1, earlyExit: 0, missingPunch: 1, absent: 0 })],
    });
    const body = OperationsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).json());
    expect(body.rollup.attendance.finished).toBe(10);
    expect(body.rollup.attendance.completed).toBe(9);
    expect(body.rollup.attendance.completionRate).toEqual({ status: 'available', value: 90 });
    expect(body.rollup.attendance.onTimeRate).toEqual({ status: 'available', value: 80 });
  });

  it('reports a rate with no finished shifts as not applicable, never zero', async () => {
    const { call } = await setup({ snapshot: [snapshot(FACILITY_A1.entityId)], daily: [] });
    const body = OperationsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).json());
    expect(body.rollup.attendance.completionRate).toEqual({ status: 'not_applicable', reason: 'zero_denominator' });
  });

  it('marks data stale when nothing has been recorded for a day, and says so when never', async () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { call } = await setup({ snapshot: [snapshot(FACILITY_A1.entityId, { lastActivityAt: old })], daily: [] });
    const stale = OperationsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).json());
    expect(stale.dataQuality.freshness).toBe('stale');
    await close?.();

    const never = await setup({ snapshot: [snapshot(FACILITY_A1.entityId, { lastActivityAt: null })], daily: [] });
    const body = OperationsResponseSchema.parse((await never.call(SUBJECT.cooRegionA, 'GET', '/api/operations')).json());
    expect(body.dataQuality.freshness).toBe('stale');
    expect(body.dataQuality.limitations.join(' ')).toMatch(/nothing yet/);
  });

  it('answers 200 with an empty list when the scope covers no hospital', async () => {
    const { call } = await setup({ snapshot: [], daily: [] });
    const body = OperationsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).json());
    expect(body.hospitals).toEqual([]);
    expect(body.rollup.hospitals).toBe(0);
  });

  it('refuses a role outside the allow-list with 403, not an empty page', async () => {
    const { call } = await setup();
    const response = await call(BILLING_SUBJECT, 'GET', '/api/operations');
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('Fixture facility');
  });

  it('fails closed when the source returns a hospital the caller cannot see', async () => {
    const { call } = await setup({ snapshot: [snapshot(REGION_B.entityId)] });
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/operations');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(REGION_B.entityId);
  });

  it('fails closed on a row that breaks the contract', async () => {
    const { call } = await setup({ snapshot: [snapshot(FACILITY_A1.entityId, { activeStaff: -1 })] });
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).statusCode).toBe(500);
  });

  it('rejects an out-of-range period', async () => {
    const { call } = await setup();
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/operations?days=99')).statusCode).toBe(400);
  });

  it('answers unavailable when the source is down, not an invented picture', async () => {
    const { call, fixture } = await setup();
    fixture.deps.operations = {
      snapshot: async () => {
        throw new ApiError('unavailable', 'Orbit is not available yet.', 'operations_store_not_implemented');
      },
      daily: async () => [],
    };
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/operations')).statusCode).toBe(503);
  });

  it('records the read in the audit trail', async () => {
    const { call, fixture } = await setup();
    await call(SUBJECT.cooRegionA, 'GET', '/api/operations');
    expect(fixture.auditEvents.some((e) => e.kind === 'evidence_viewed' && e.target?.id === 'operations')).toBe(true);
  });
});
