import { afterEach, describe, expect, it } from 'vitest';
import { EntityDirectoryResponseSchema } from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp, FACILITY_A1, REGION_A, REGION_B } from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const built = await buildModuleApp();
  close = () => built.app.close();
  return built;
}

describe('GET /api/entities', () => {
  it('returns the caller-visible entities with names, in grain order', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/entities');
    expect(response.statusCode).toBe(200);
    const { entities } = EntityDirectoryResponseSchema.parse(response.json());
    expect(entities.map((entity) => entity.label)).toEqual(['Fixture region A', 'Fixture facility A1', 'Fixture facility A2']);
    expect(entities[1]?.parent).toEqual(REGION_A);
  });

  it('fails closed if the directory returns an entity outside the caller scope', async () => {
    const { call, fixture } = await setup();
    fixture.deps.entities = { visible: async () => [{ ...FACILITY_A1, label: 'ok', parent: REGION_A }, { ...REGION_B, label: 'Leaked region', parent: null }] };
    const response = await call(SUBJECT.cooRegionA, 'GET', '/api/entities');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('Leaked region');
  });

  it('fails closed on a row that breaks the contract', async () => {
    const { call, fixture } = await setup();
    fixture.deps.entities = { visible: async () => [{ ...FACILITY_A1, label: '', parent: REGION_A }] };
    expect((await call(SUBJECT.cooRegionA, 'GET', '/api/entities')).statusCode).toBe(500);
  });

  it('requires authentication', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/entities' })).statusCode).toBe(401);
  });
});
