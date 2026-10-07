import { afterEach, describe, expect, it } from 'vitest';
import { SurveillanceResponseSchema } from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { BILLING_SUBJECT, buildModuleApp, DHO_SUBJECT, FACILITY_A1, FACILITY_A2, REGION_A, REGION_B } from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

const FEVER = 'c0000000-0000-4000-8000-000000000001';
const HERNIA = 'c0000000-0000-4000-8000-000000000002';

function feedRow(conditionId: string, overrides: Record<string, unknown> = {}) {
  return {
    conditionId,
    code: conditionId === FEVER ? 'VIRAL-FEVER' : 'HERNIA',
    name: conditionId === FEVER ? 'Viral Fever' : 'Hernia',
    category: conditionId === FEVER ? 'Infectious' : 'Surgical',
    windowDays: 7,
    minPatients: 50,
    minHospitals: 5,
    patients: 58,
    hospitals: 6,
    usualPatients: 9.5,
    alert: true,
    expectedPatients: 61.2,
    pPatients: 0.83,
    pHospitals: 0.99,
    ...overrides,
  };
}

const RUN = {
  model: 'XGBoost 3.4.1 count:poisson',
  trainedAt: new Date().toISOString(),
  dataThrough: '2026-10-06',
  horizonDays: 7,
  trainingRows: 1000,
  modelMae: 0.91,
  baselineMae: 0.93,
  notes: 'Test run.',
};

async function setup(rows: { feed?: unknown[]; hospitals?: unknown[]; run?: unknown } = {}, dhoOnly = false) {
  const built = await buildModuleApp({
    ...(dhoOnly ? { entities: { visible: async () => [{ ...FACILITY_A1, label: 'Fixture facility A1', parent: REGION_A }] } } : {}),
    surveillance: {
      feed: async () => rows.feed ?? [feedRow(FEVER), feedRow(HERNIA, { patients: 2, hospitals: 1, alert: false, expectedPatients: null, pPatients: null, pHospitals: null })],
      hospitals: async () =>
        rows.hospitals ?? [
          { facilityId: FACILITY_A1.entityId, conditionId: FEVER, patients: 9, expectedPatients: 10.5 },
          { facilityId: FACILITY_A2.entityId, conditionId: FEVER, patients: 12, expectedPatients: null },
        ],
      run: async () => (rows.run === undefined ? RUN : rows.run),
    },
  });
  close = () => built.app.close();
  return built;
}

describe('GET /api/surveillance', () => {
  it('returns the rule, group totals, the forecast and named hospitals in scope', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance');
    expect(response.statusCode).toBe(200);
    const body = SurveillanceResponseSchema.parse(response.json());
    expect(body.rule).toEqual({ windowDays: 7, minPatients: 50, minHospitals: 5 });
    const [fever, hernia] = body.conditions;
    expect(fever).toMatchObject({ name: 'Viral Fever', patients: 58, hospitals: 6, alert: true });
    expect(fever?.forecast).toEqual({ expectedPatients: 61.2, pPatients: 0.83, pHospitals: 0.99 });
    // Most patients first, each hospital named from the caller's directory.
    expect(fever?.inScope.map((h) => [h.name, h.patients])).toEqual([['Fixture facility A2', 12], ['Fixture facility A1', 9]]);
    expect(hernia?.forecast).toBeNull();
    expect(hernia?.inScope).toEqual([]);
    expect(body.forecastRun).toMatchObject({ model: RUN.model, beatsBaseline: true });
    expect(body.provenance).toBe('illustrative');
    expect(body.limitations.join(' ')).toMatch(/Not a diagnosis/);
  });

  it('says honestly when the model does not beat the naive baseline', async () => {
    const { call } = await setup({ run: { ...RUN, modelMae: 1.2, baselineMae: 0.9 } });
    const body = SurveillanceResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance')).json());
    expect(body.forecastRun?.beatsBaseline).toBe(false);
  });

  it('serves the rule and counts before the first forecast run', async () => {
    const { call } = await setup({ run: null });
    const body = SurveillanceResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance')).json());
    expect(body.forecastRun).toBeNull();
    expect(body.conditions).toHaveLength(2);
  });

  it('lets a hospital DHO see the group surge', async () => {
    const { call } = await setup({ hospitals: [{ facilityId: FACILITY_A1.entityId, conditionId: FEVER, patients: 9, expectedPatients: null }] }, true);
    const response = await call(DHO_SUBJECT, 'GET', '/api/surveillance');
    expect(response.statusCode).toBe(200);
    const body = SurveillanceResponseSchema.parse(response.json());
    expect(body.conditions[0]).toMatchObject({ alert: true, patients: 58 });
    expect(body.conditions[0]?.inScope.map((h) => h.facilityId)).toEqual([FACILITY_A1.entityId]);
  });

  it('refuses a role outside the allow-list with 403, not an empty page', async () => {
    const { call } = await setup();
    const response = await call(BILLING_SUBJECT, 'GET', '/api/surveillance');
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('Viral Fever');
  });

  it('fails closed when the source returns a hospital the caller cannot see', async () => {
    const { call } = await setup({ hospitals: [{ facilityId: REGION_B.entityId, conditionId: FEVER, patients: 3, expectedPatients: null }] });
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(REGION_B.entityId);
  });

  it('fails closed on a row that breaks the contract', async () => {
    const { call } = await setup({ feed: [feedRow(FEVER, { pPatients: 1.5 })] });
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance')).statusCode).toBe(500);
  });

  it('records the read in the audit trail', async () => {
    const { call, fixture } = await setup();
    await call(SUBJECT.cooRegionA, 'GET', '/api/surveillance');
    expect(fixture.auditEvents.some((e) => e.kind === 'evidence_viewed' && e.target?.id === 'surveillance')).toBe(true);
  });
});
