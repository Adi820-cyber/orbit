import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, HealthResponseSchema } from '@orbit/contracts';
import { buildApp } from './build.ts';
import { fixtureMemberships } from '../test/helpers/fixtures.ts';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from '../test/helpers/tokens.ts';
import { ApiError } from './plugins/errors.ts';
import { pendingModuleDeps } from './modules/pending.ts';

const ALLOWED = 'https://orbit-web.fixture.example';
let app: FastifyInstance;

beforeAll(async () => {
  const issuer = await createTestIssuer();
  app = await buildApp({
    allowedOrigins: [ALLOWED],
    modules: pendingModuleDeps(),
    auth: {
      getKey: issuer.getKey,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      memberships: fixtureMemberships(),
    },
  });
  // Test-only routes that exercise the error handler.
  app.get('/__test/throws', async () => {
    throw new Error('connection string postgresql://orbit_app:secret@host/db failed');
  });
  app.get('/__test/api-error', async () => {
    throw new ApiError('conflict', 'The action was changed by someone else.', 'stale_version');
  });
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  /**
   * Both paths, because the deployment needs `/api/health` and a developer
   * needs `/health`.
   *
   * Under the same-origin topology (ADR 0013) a rewrite sends `/api/(.*)` here
   * and a catch-all sends everything else to the SPA, with the original path
   * forwarded unstripped. A probe of `/health` would be answered by the SPA,
   * which returns 200 with `index.html` for unknown paths — so a health check
   * would report the API healthy while it was down. `/api/health` is the path
   * the deployed check must use.
   *
   * The 401 assertion is the point of the loop: these sit next to a plugin that
   * applies `requireAuth` to everything under `/api`, and `/api/health` has to
   * stay outside it. If someone later moves the registration inside that plugin
   * the status becomes 401 and this fails, which is the regression worth
   * catching.
   */
  for (const url of ['/health', '/api/health']) {
    it(`${url} is reachable without authentication and matches the contract`, async () => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, `${url} should not require a token`).toBe(200);
      expect(HealthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
    });
  }
});

describe('protected routes', () => {
  it('require authentication under /api', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
  });

  it('answer unknown /api paths with the not_found envelope and no data', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('not_found');
  });
});

describe('errors', () => {
  it('uses the contract envelope for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('hides internal error details', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/throws' });
    expect(response.statusCode).toBe(500);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('internal');
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });

  it('maps ApiError to its status and code without the server-side reason', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/api-error' });
    expect(response.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('conflict');
    expect(response.body).not.toContain('stale_version');
  });
});

describe('CORS', () => {
  function preflight(origin: string) {
    return app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
  }

  it('grants the exact allowed origin', async () => {
    const response = await preflight(ALLOWED);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  });

  it.each([
    'https://evil.example',
    `${ALLOWED}.evil.example`,
    'http://orbit-web.fixture.example',
    'null',
  ])('grants nothing to %s', async (origin) => {
    const response = await preflight(origin);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never allows credentials or a wildcard', async () => {
    const response = await preflight(ALLOWED);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});
