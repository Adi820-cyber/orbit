import { describe, expect, it } from 'vitest';
import { AuthError, createTokenManager } from '../src/auth.ts';
import { createErpApi, SimApiError } from '../src/erp-client.ts';
import { FakeErp } from './fake-erp.ts';

const CREDENTIALS = { email: 'admin@kestrion.demo', password: 'a very secret password' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fetch that answers from a script and records every request. */
function scripted(responses: (Response | Error | ((request: Recorded) => Response))[]) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(request);
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${request.method} ${request.url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request) : next;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const tokenReply = (access: string, refresh: string, expiresIn = 3600) => json({ access_token: access, refresh_token: refresh, expires_in: expiresIn });

describe('token manager', () => {
  const manager = (fetchImpl: typeof fetch, nowMs: () => number = () => 1_000_000) =>
    createTokenManager({ supabaseUrl: 'https://p.supabase.co', publishableKey: 'sb_publishable_x', credentials: CREDENTIALS, fetchImpl, nowMs });

  it('signs in with the password grant and reuses the token while it is fresh', async () => {
    const { fetchImpl, requests } = scripted([tokenReply('tok-1', 'ref-1')]);
    const tokens = manager(fetchImpl);
    expect(await tokens.token()).toBe('tok-1');
    expect(await tokens.token()).toBe('tok-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://p.supabase.co/auth/v1/token?grant_type=password');
    expect(requests[0]?.headers['apikey']).toBe('sb_publishable_x');
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ email: CREDENTIALS.email, password: CREDENTIALS.password });
  });

  it('refreshes shortly before expiry using the refresh token, not the password', async () => {
    let now = 1_000_000;
    const { fetchImpl, requests } = scripted([tokenReply('tok-1', 'ref-1', 600), tokenReply('tok-2', 'ref-2', 600)]);
    const tokens = manager(fetchImpl, () => now);
    await tokens.token();
    now += 600_000 - 60_000; // inside the 90 s refresh margin
    expect(await tokens.token()).toBe('tok-2');
    expect(requests[1]?.url).toContain('grant_type=refresh_token');
    expect(JSON.parse(requests[1]?.body ?? '{}')).toEqual({ refresh_token: 'ref-1' });
  });

  it('signs in again when the refresh token is rejected', async () => {
    let now = 1_000_000;
    const { fetchImpl, requests } = scripted([tokenReply('tok-1', 'ref-1', 100), json({}, 400), tokenReply('tok-3', 'ref-3')]);
    const tokens = manager(fetchImpl, () => now);
    await tokens.token();
    now += 200_000;
    expect(await tokens.token()).toBe('tok-3');
    expect(requests.map((request) => request.url.split('grant_type=')[1])).toEqual(['password', 'refresh_token', 'password']);
  });

  it('shares one sign-in between concurrent callers', async () => {
    const { fetchImpl, requests } = scripted([tokenReply('tok-1', 'ref-1')]);
    const tokens = manager(fetchImpl);
    const results = await Promise.all([tokens.token(), tokens.token(), tokens.token()]);
    expect(results).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(requests).toHaveLength(1);
  });

  it('forgets the token on invalidate, so the next call signs in again', async () => {
    const { fetchImpl, requests } = scripted([tokenReply('tok-1', 'ref-1'), tokenReply('tok-2', 'ref-2')]);
    const tokens = manager(fetchImpl);
    await tokens.token();
    tokens.invalidate();
    expect(await tokens.token()).toBe('tok-2');
    expect(requests).toHaveLength(2);
  });

  it('fails with the status only: no password, email or key in the error', async () => {
    const { fetchImpl } = scripted([json({ error_description: 'Invalid login credentials' }, 400)]);
    const failure = await manager(fetchImpl).token().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as AuthError).status).toBe(400);
    const text = `${(failure as Error).message} ${(failure as Error).stack ?? ''}`;
    expect(text).not.toContain(CREDENTIALS.password);
    expect(text).not.toContain(CREDENTIALS.email);
    expect(text).not.toContain('sb_publishable_x');
  });

  it('rejects an answer that is not a token', async () => {
    const { fetchImpl } = scripted([json({ hello: 'world' })]);
    await expect(manager(fetchImpl).token()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('ERP client', () => {
  const tokens = (values: string[]) => {
    const queue = [...values];
    let current = queue.shift() ?? 'tok';
    return {
      token: async () => current,
      invalidate: () => {
        current = queue.shift() ?? current;
      },
    };
  };
  const clock = { now: () => new Date('2026-10-01T10:00:00Z') };
  const referenceBody = () => new FakeErp('x', clock).reference();

  it('sends the bearer token and returns a validated response', async () => {
    const body = await referenceBody();
    const { fetchImpl, requests } = scripted([json(body)]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['tok-a']), fetchImpl });
    const result = await api.reference();
    expect(result.facilities).toHaveLength(2);
    expect(requests[0]?.url).toBe('https://erp.example.com/api/erp/reference');
    expect(requests[0]?.headers['authorization']).toBe('Bearer tok-a');
  });

  it('only puts defined values in the query string', async () => {
    const empty = { items: [], page: { page: 1, pageSize: 100, total: 0 }, provenance: 'illustrative', disclosure: 'x' };
    const { fetchImpl, requests } = scripted([json(empty)]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl });
    await api.corrections({ facilityId: 'f1', state: undefined, page: 1, pageSize: 100, empty: '', nothing: null });
    expect(new URL(requests[0]?.url ?? '').searchParams.toString()).toBe('facilityId=f1&page=1&pageSize=100');
  });

  it('on a 401 signs in again and repeats the request once with the new token', async () => {
    const body = await referenceBody();
    const { fetchImpl, requests } = scripted([json({ error: { code: 'unauthenticated', message: 'no', requestId: 'r1' } }, 401), json(body)]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['old', 'new']), fetchImpl });
    await api.reference();
    expect(requests.map((request) => request.headers['authorization'])).toEqual(['Bearer old', 'Bearer new']);
  });

  it('does not loop on a second 401', async () => {
    const denied = () => json({ error: { code: 'unauthenticated', message: 'no', requestId: 'r1' } }, 401);
    const { fetchImpl, requests } = scripted([denied(), denied()]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['a', 'b']), fetchImpl });
    await expect(api.reference()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(requests).toHaveLength(2);
  });

  it('retries a read after a rate limit or an unavailable service, then succeeds', async () => {
    const body = await referenceBody();
    const { fetchImpl, requests } = scripted([json({}, 429), json({}, 503), json(body)]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl, retryDelaysMs: [1, 1] });
    await api.reference();
    expect(requests).toHaveLength(3);
  });

  it('retries a punch (it carries an idempotency key) but never a write that would duplicate', async () => {
    const punchBody = await new FakeErp('x', clock).punch({ staffId: 'unused', direction: 'in', idempotencyKey: 'k' }).catch(() => null);
    expect(punchBody).toBeNull(); // the fake has no such person; the shape is built below instead
    const unavailable = () => json({ error: { code: 'unavailable', message: 'Orbit is not available yet.', requestId: 'r' } }, 503);

    const punches = scripted([unavailable(), unavailable(), unavailable()]);
    const keyed = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl: punches.fetchImpl, retryDelaysMs: [1, 1] });
    await expect(keyed.punch({ staffId: '11111111-1111-4111-8111-111111111111', direction: 'in', idempotencyKey: '22222222-2222-4222-8222-222222222222' })).rejects.toMatchObject({ status: 503 });
    expect(punches.requests).toHaveLength(3); // tried, retried, retried

    const patients = scripted([unavailable()]);
    const unkeyed = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl: patients.fetchImpl, retryDelaysMs: [1, 1] });
    await expect(unkeyed.registerPatient({ homeFacilityId: '11111111-1111-4111-8111-111111111111', displayName: 'A B', sex: 'female', birthYear: 1990, confirmNotDuplicate: true })).rejects.toMatchObject({ status: 503 });
    expect(patients.requests).toHaveLength(1); // a second attempt could register the patient twice
  });

  it('turns the API error envelope into a typed error', async () => {
    const { fetchImpl } = scripted([json({ error: { code: 'conflict', message: 'That employee code is already in use.', requestId: 'req-9' } }, 409)]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl });
    const failure = await api.reference().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SimApiError);
    expect(failure).toMatchObject({ status: 409, code: 'conflict', message: 'That employee code is already in use.', requestId: 'req-9' });
  });

  it('reports an answer that breaks the shared contract rather than trusting it', async () => {
    const { fetchImpl } = scripted([json({ facilities: 'nope' })]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl });
    await expect(api.reference()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('refuses to send a request body the contract rejects, without touching the network', async () => {
    const { fetchImpl, requests } = scripted([]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl });
    await expect(api.punch({ staffId: 'not-a-uuid', direction: 'in', idempotencyKey: 'also-not' })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it('reports an unreachable API as such', async () => {
    const { fetchImpl } = scripted([new Error('connect ECONNREFUSED'), new Error('connect ECONNREFUSED'), new Error('connect ECONNREFUSED')]);
    const api = createErpApi({ baseUrl: 'https://erp.example.com', tokens: tokens(['t']), fetchImpl, retryDelaysMs: [1, 1] });
    await expect(api.reference()).rejects.toMatchObject({ code: 'unreachable', status: 0 });
  });
});
