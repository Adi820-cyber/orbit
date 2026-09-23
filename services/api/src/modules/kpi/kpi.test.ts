import { afterEach, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, KpiDetailResponseSchema, KpiListResponseSchema } from '@orbit/contracts';
import { getAssignment } from '@orbit/kpi-framework';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import {
  buildModuleApp,
  CAPACITY,
  DHO_CAPACITY,
  DHO_SUBJECT,
  MODULE_ENTITLEMENTS,
  observation,
  REGION_A,
  REGION_B,
  REVENUE,
} from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup(...args: Parameters<typeof buildModuleApp>) {
  const built = await buildModuleApp(...args);
  close = () => built.app.close();
  return built;
}

const detail = (assignmentId: string, query: string) => `/api/kpi/${encodeURIComponent(assignmentId)}?${query}`;

describe('GET /api/kpi', () => {
  it('lists only the role entitlements, joined with framework metadata and the disclosure', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/kpi');
    expect(response.statusCode).toBe(200);
    const body = KpiListResponseSchema.parse(response.json());
    expect(body.assignments.map((row) => row.assignmentId)).toEqual([CAPACITY, REVENUE]);
    expect(body.assignments[0]?.kpi).toBe(getAssignment(CAPACITY)?.kpi);
    expect(body.assignments[0]?.breakdowns).toEqual(['facility']);
    expect(body.disclosure).toMatch(/illustrative/);
  });

  it('gives each role only its own entitlements (no inheritance)', async () => {
    const { call } = await setup();
    const body = KpiListResponseSchema.parse((await call(DHO_SUBJECT, 'GET', '/api/kpi')).json());
    expect(body.assignments.map((row) => row.assignmentId)).toEqual([DHO_CAPACITY]);
  });

  it('fails closed when the matrix references an assignment outside the framework', async () => {
    const { call, fixture } = await setup();
    fixture.deps.scope.entitlements = {
      forMembership: async () => [...MODULE_ENTITLEMENTS.slice(0, 1), { ...MODULE_ENTITLEMENTS[0], assignmentId: 'regional-coo:not-a-kpi' }],
    };
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/kpi');
    expect(response.statusCode).toBe(500);
  });
});

describe('GET /api/kpi/:assignmentId', () => {
  it('serves the series, definitions, and scope for an entitled entity', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a&from=2025-12-01'));
    expect(response.statusCode).toBe(200);
    const body = KpiDetailResponseSchema.parse(response.json());
    expect(body.series.map((row) => row.observationId)).toEqual(['obs-cap-a-dec', 'obs-cap-a-jan']);
    expect(body.scope).toEqual(REGION_A);
    expect(body.breakdown).toBeNull();
    expect(body.definitions.length).toBeGreaterThan(0);
  });

  it('serves a permitted facility breakdown for the latest period', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a&breakdown=facility'));
    const body = KpiDetailResponseSchema.parse(response.json());
    expect(body.breakdown?.observations.map((row) => row.entity.entityId).sort()).toEqual([
      'fixture-facility-a1',
      'fixture-facility-a2',
    ]);
  });

  it.each([
    ['the other region', CAPACITY, 'grain=region&entityId=fixture-region-b'],
    ['a breakdown the role does not hold', REVENUE, 'grain=region&entityId=fixture-region-a&breakdown=facility'],
    ["another role's assignment", DHO_CAPACITY, 'grain=facility&entityId=fixture-facility-a1'],
    ['an entity in another organization', CAPACITY, 'grain=facility&entityId=fixture-facility-other-org'],
  ])('refuses %s with out_of_scope and no data', async (_label, assignmentId, query) => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', detail(assignmentId, query));
    expect(response.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('out_of_scope');
    expect(response.body).not.toContain('999');
  });

  it('refuses the symmetric request from the other region', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionB, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a'));
    expect(response.statusCode).toBe(403);
  });

  it('rejects a client-supplied role as invalid input', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a&role=chairman'));
    expect(response.statusCode).toBe(400);
  });

  it('fails closed when a source returns a row for another entity', async () => {
    const { call, fixture } = await setup();
    fixture.deps.observations = {
      ...fixture.deps.observations,
      series: async () => [observation('leak', CAPACITY, REGION_B, { cadence: 'month', start: '2026-01-01', end: '2026-01-31' }, 999)],
    };
    const response = await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a'));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('999');
  });

  it('audits evidence access and scope denials', async () => {
    const { call, fixture } = await setup();
    await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-a'));
    await call(SUBJECT.cooRegionA, 'GET', detail(CAPACITY, 'grain=region&entityId=fixture-region-b'));
    expect(fixture.auditEvents.map((event) => [event.kind, event.outcome])).toEqual([
      ['evidence_viewed', 'served'],
      ['access_denied', 'out_of_scope'],
    ]);
  });
});
