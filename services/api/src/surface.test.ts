import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { API_SURFACES, servesLeaders, servesOperators } from './surface.ts';
import { buildErpApp, LEADER_SUBJECT, OPERATOR_SUBJECT } from '../test/helpers/erp.ts';

const ENV = { SUPABASE_URL: 'https://fixture.supabase.co' };

describe('ORBIT_SURFACE configuration', () => {
  it('defaults to serving both halves', () => {
    expect(loadConfig(ENV).surface).toBe('all');
    expect(loadConfig({ ...ENV, ORBIT_SURFACE: '' }).surface).toBe('all');
  });

  it.each(API_SURFACES)('accepts %s', (surface) => {
    expect(loadConfig({ ...ENV, ORBIT_SURFACE: surface }).surface).toBe(surface);
  });

  it('refuses an unknown surface at startup, naming the variable only', () => {
    expect(() => loadConfig({ ...ENV, ORBIT_SURFACE: 'everything' })).toThrow(/ORBIT_SURFACE/);
  });

  it('maps each surface to the account kinds it serves', () => {
    expect([servesLeaders('all'), servesOperators('all')]).toEqual([true, true]);
    expect([servesLeaders('leader'), servesOperators('leader')]).toEqual([true, false]);
    expect([servesLeaders('erp'), servesOperators('erp')]).toEqual([false, true]);
  });
});

describe('ERP surface (hospital operations deployment)', () => {
  it('serves operators and does not register leader routes at all', async () => {
    const { app, call } = await buildErpApp({}, 'erp');
    expect((await call(OPERATOR_SUBJECT.hospital1, 'GET', '/api/erp/reference')).statusCode).toBe(200);
    expect((await call(OPERATOR_SUBJECT.admin, 'GET', '/api/me')).statusCode).toBe(200);
    // Not registered: 404, not a fail-closed 503 and not a data response.
    for (const route of ['/api/brief', '/api/kpi', '/api/actions', '/api/entities', '/api/audit']) {
      expect((await call(OPERATOR_SUBJECT.admin, 'GET', route)).statusCode, route).toBe(404);
    }
    await app.close();
  });

  it('refuses a leadership account before any route runs', async () => {
    const { app, call, calls } = await buildErpApp({}, 'erp');
    for (const route of ['/api/me', '/api/erp/reference']) {
      const response = await call(LEADER_SUBJECT, 'GET', route);
      expect(response.statusCode, route).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
    // A leader route does not exist here, so it is 404 for everyone.
    expect((await call(LEADER_SUBJECT, 'GET', '/api/brief')).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    await app.close();
  });
});

describe('leader surface (leadership deployment)', () => {
  it('serves leaders and does not register the ERP routes at all', async () => {
    const { app, call } = await buildErpApp({}, 'leader');
    expect((await call(LEADER_SUBJECT, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call(LEADER_SUBJECT, 'GET', '/api/entities')).statusCode).toBe(200);
    for (const route of ['/api/erp/reference', '/api/erp/patients?q=ab', '/api/erp/audit']) {
      expect((await call(LEADER_SUBJECT, 'GET', route)).statusCode, route).toBe(404);
    }
    await app.close();
  });

  it('refuses an ERP operator account before any route runs', async () => {
    const { app, call, calls } = await buildErpApp({}, 'leader');
    for (const subject of [OPERATOR_SUBJECT.hospital1, OPERATOR_SUBJECT.admin]) {
      const response = await call(subject, 'GET', '/api/me');
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });
});

describe('default surface (a single combined deployment)', () => {
  it('keeps serving both kinds of account', async () => {
    const { app, call } = await buildErpApp();
    expect((await call(LEADER_SUBJECT, 'GET', '/api/entities')).statusCode).toBe(200);
    expect((await call(OPERATOR_SUBJECT.hospital1, 'GET', '/api/erp/reference')).statusCode).toBe(200);
    await app.close();
  });
});
