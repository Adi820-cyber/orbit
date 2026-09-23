import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ErrorEnvelopeSchema } from '@orbit/contracts';
import { buildApp } from '../build.ts';
import { fixtureMemberships, SUBJECT } from '../../test/helpers/fixtures.ts';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from '../../test/helpers/tokens.ts';
import { pendingModuleDeps } from './pending.ts';

let app: FastifyInstance;
let sign: (subject: string) => Promise<string>;

beforeAll(async () => {
  const issuer = await createTestIssuer();
  sign = (subject) => issuer.sign(subject);
  app = await buildApp({
    allowedOrigins: [],
    modules: pendingModuleDeps(),
    auth: { getKey: issuer.getKey, issuer: TEST_ISSUER, audience: TEST_AUDIENCE, memberships: fixtureMemberships() },
  });
});

afterAll(async () => {
  await app.close();
});

describe('pending module wiring (deployment until the schema exists)', () => {
  it.each([
    ['GET', '/api/brief'],
    ['GET', '/api/inbox'],
    ['GET', '/api/kpi'],
    ['GET', '/api/ask/prompts'],
    ['GET', '/api/actions'],
    ['GET', '/api/audit'],
  ] as const)('%s %s fails closed as unavailable, never with fixture data', async (method, url) => {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${await sign(SUBJECT.cooRegionA)}` } });
    expect(response.statusCode).toBe(503);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('unavailable');
  });

  it('answers Ask with an unavailable outcome rather than an invented answer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ask',
      headers: { authorization: `Bearer ${await sign(SUBJECT.cooRegionA)}` },
      payload: { intent: 'summarize_exceptions' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'unavailable', card: { relevantRecords: { observations: [], exceptions: [] } } });
  });
});
