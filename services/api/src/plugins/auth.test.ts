import type { FastifyInstance } from 'fastify';
import { generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, MeResponseSchema } from '@orbit/contracts';
import { buildApp } from '../build.ts';
import { fixtureMemberships, MEMBERSHIPS, SUBJECT } from '../../test/helpers/fixtures.ts';
import { createTestIssuer, signHs256, TEST_AUDIENCE, TEST_ISSUER, unsignedToken } from '../../test/helpers/tokens.ts';

let app: FastifyInstance;
let issuer: Awaited<ReturnType<typeof createTestIssuer>>;

beforeAll(async () => {
  issuer = await createTestIssuer();
  app = await buildApp({
    allowedOrigins: [],
    auth: { getKey: issuer.getKey, issuer: TEST_ISSUER, audience: TEST_AUDIENCE, memberships: fixtureMemberships() },
  });
});

afterAll(async () => {
  await app.close();
});

async function me(authorization?: string, extra: { url?: string; headers?: Record<string, string> } = {}) {
  return app.inject({
    method: 'GET',
    url: extra.url ?? '/api/me',
    headers: { ...(authorization ? { authorization } : {}), ...extra.headers },
  });
}

function errorCode(body: string) {
  return ErrorEnvelopeSchema.parse(JSON.parse(body)).error.code;
}

describe('token verification', () => {
  const denied: Array<[string, () => Promise<string | undefined>]> = [
    ['no Authorization header', async () => undefined],
    ['a non-Bearer scheme', async () => `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['a malformed bearer token', async () => 'Bearer not-a-jwt'],
    ['an expired token', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { exp: Math.floor(Date.now() / 1000) - 60 })}`],
    ['a forged signature', async () => {
      const { privateKey } = await generateKeyPair('ES256');
      return `Bearer ${await issuer.sign(SUBJECT.cooRegionA, {}, privateKey)}`;
    }],
    ['an HS256 token', async () => `Bearer ${await signHs256(SUBJECT.cooRegionA)}`],
    ['an unsigned alg:none token', async () => `Bearer ${unsignedToken(SUBJECT.cooRegionA)}`],
    ['the wrong issuer', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { iss: 'https://evil.example/auth/v1' })}`],
    ['the anon audience', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { aud: 'anon' })}`],
    ['a service_role claim', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { role: 'service_role' })}`],
    ['an anonymous user', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { is_anonymous: true })}`],
    ['a non-uuid subject', async () => `Bearer ${await issuer.sign('not-a-uuid')}`],
    ['a missing subject', async () => `Bearer ${await issuer.sign(SUBJECT.cooRegionA, { sub: undefined })}`],
  ];

  it.each(denied)('rejects %s with 401 unauthenticated', async (_label, header) => {
    const response = await me(await header());
    expect(response.statusCode).toBe(401);
    expect(errorCode(response.body)).toBe('unauthenticated');
  });

  it('never echoes the token in the error body', async () => {
    const token = await issuer.sign(SUBJECT.cooRegionA, { aud: 'anon' });
    const response = await me(`Bearer ${token}`);
    expect(response.body).not.toContain(token);
  });
});

describe('membership loading', () => {
  it.each([
    ['an unknown user', SUBJECT.unknown],
    ['an inactive membership', SUBJECT.inactive],
    ['an ambiguous membership', SUBJECT.ambiguous],
  ])('denies %s with 403 forbidden', async (_label, subject) => {
    const response = await me(`Bearer ${await issuer.sign(subject)}`);
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('forbidden');
  });

  it('fails closed when a membership row violates the contract', async () => {
    const broken = await buildApp({
      allowedOrigins: [],
      auth: {
        getKey: issuer.getKey,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        memberships: fixtureMemberships([{ ...MEMBERSHIPS[0], role: 'super-admin' }]),
      },
    });
    const response = await broken.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${await issuer.sign(SUBJECT.cooRegionA)}` },
    });
    await broken.close();
    expect(response.statusCode).toBe(500);
    expect(errorCode(response.body)).toBe('internal');
  });

  it('returns the verified role and scope for a single active membership', async () => {
    const response = await me(`Bearer ${await issuer.sign(SUBJECT.cooRegionA)}`);
    expect(response.statusCode).toBe(200);
    expect(MeResponseSchema.parse(response.json())).toEqual({
      role: 'regional-coo',
      organizationId: MEMBERSHIPS[0]?.organizationId,
      scopes: [{ grain: 'region', entityId: 'fixture-region-a' }],
    });
  });
});

describe('role and scope never come from the request', () => {
  it('ignores role/scope supplied in headers and query string', async () => {
    const response = await me(`Bearer ${await issuer.sign(SUBJECT.cooRegionA)}`, {
      url: '/api/me?role=chairman&scope=group&organizationId=00000000-0000-4000-8000-00000000000b',
      headers: { 'x-orbit-role': 'chairman', 'x-orbit-scope': 'group' },
    });
    expect(response.statusCode).toBe(200);
    const body = MeResponseSchema.parse(response.json());
    expect(body.role).toBe('regional-coo');
    expect(body.scopes).toEqual([{ grain: 'region', entityId: 'fixture-region-a' }]);
  });

  it('ignores role claims placed inside the token payload', async () => {
    const token = await issuer.sign(SUBJECT.cooRegionA, { orbit_role: 'chairman', app_metadata: { role: 'chairman' } });
    const response = await me(`Bearer ${token}`);
    expect(MeResponseSchema.parse(response.json()).role).toBe('regional-coo');
  });
});
