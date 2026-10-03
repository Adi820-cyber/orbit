import type { Credentials } from './config.ts';

/*
 * Signs in to Supabase Auth with a password and keeps the access token fresh,
 * the same way the web app's login does. Tokens live only in memory. Nothing
 * here logs a token or a password, and an error carries the HTTP status only.
 */

export interface TokenSource {
  /** A valid access token, signing in or refreshing first when needed. */
  token(): Promise<string>;
  /** Forget the cached token, so the next call signs in again (after a 401). */
  invalidate(): void;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

interface Session {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number;
}

/** Refresh this long before the token expires, so a request never carries a stale one. */
const REFRESH_MARGIN_MS = 90_000;

export function createTokenManager(options: {
  supabaseUrl: string;
  publishableKey: string;
  credentials: Credentials;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}): TokenSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;
  let session: Session | null = null;
  let inFlight: Promise<string> | null = null;

  async function requestTokens(grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<Session> {
    const response = await fetchImpl(`${options.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: options.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new AuthError(`Supabase sign-in failed (${grant})`, response.status);
    }
    const json = (await response.json()) as TokenResponse;
    if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
      throw new AuthError('Supabase sign-in returned an unexpected response', 502);
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      expiresAtMs: nowMs() + json.expires_in * 1000,
    };
  }

  async function renew(): Promise<string> {
    if (session?.refreshToken) {
      try {
        session = await requestTokens('refresh_token', { refresh_token: session.refreshToken });
        return session.accessToken;
      } catch {
        // A rejected refresh token is normal after a long pause: sign in again.
        session = null;
      }
    }
    session = await requestTokens('password', { email: options.credentials.email, password: options.credentials.password });
    return session.accessToken;
  }

  return {
    async token() {
      if (session && session.expiresAtMs - nowMs() > REFRESH_MARGIN_MS) return session.accessToken;
      // Single flight: concurrent callers share one sign-in.
      inFlight ??= renew().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate() {
      session = null;
    },
  };
}
