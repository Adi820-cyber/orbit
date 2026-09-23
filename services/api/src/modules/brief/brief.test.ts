import { afterEach, describe, expect, it } from 'vitest';
import { BriefResponseSchema, ErrorEnvelopeSchema, InboxResponseSchema } from '@orbit/contracts';
import { ApiError } from '../../plugins/errors.ts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp, CAPACITY, EXCEPTIONS, JAN, REGION_B } from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const built = await buildModuleApp();
  close = () => built.app.close();
  return built;
}

describe('GET /api/brief', () => {
  it('returns the FR-02 sections for the current period with the disclosure', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/brief');
    expect(response.statusCode).toBe(200);
    const body = BriefResponseSchema.parse(response.json());
    expect(body.period).toEqual(JAN);
    expect(body.actNow.map((item) => item.exceptionId)).toEqual(['exc-cap-a1']);
    expect(body.monitor.map((item) => item.exceptionId)).toEqual(['exc-rev-a']);
    expect(body.dataLimitations).toHaveLength(1);
    expect(body.disclosure).toMatch(/illustrative/);
  });

  it('fails closed instead of silently dropping an out-of-scope row', async () => {
    const { call, fixture } = await setup();
    const leaked = { ...EXCEPTIONS[0], exceptionId: 'leak', assignmentId: CAPACITY, entity: REGION_B };
    fixture.deps.exceptions = { ...fixture.deps.exceptions, brief: async () => ({ exceptions: [...EXCEPTIONS, leaked], onTrack: [], dataLimitations: [] }) };
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/brief');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('leak');
  });

  it('fails closed on a row that breaks the contract (e.g. an unlabelled threshold rule)', async () => {
    const { call, fixture } = await setup();
    const broken = { ...EXCEPTIONS[0], detection: { kind: 'threshold', below: 85 } };
    fixture.deps.exceptions = { ...fixture.deps.exceptions, brief: async () => ({ exceptions: [broken], onTrack: [], dataLimitations: [] }) };
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/brief')).statusCode).toBe(500);
  });

  it('answers unavailable rather than fabricating content when the source is down', async () => {
    const { call, fixture } = await setup();
    fixture.deps.exceptions = {
      ...fixture.deps.exceptions,
      brief: async () => {
        throw new ApiError('unavailable', 'Orbit is not available yet.');
      },
    };
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/brief');
    expect(response.statusCode).toBe(503);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('unavailable');
  });
});

describe('GET /api/inbox', () => {
  it('returns items with the source ordering basis', async () => {
    const { call } = await setup();
    const body = InboxResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/inbox')).json());
    expect(body.items).toHaveLength(2);
    expect(body.orderingBasis).toBe('Fixture order.');
  });

  it('rejects a page size above the limit', async () => {
    const { call } = await setup();
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/inbox?limit=500')).statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/inbox' })).statusCode).toBe(401);
  });
});
