import { z } from 'zod';

/**
 * The only module that reads `process.env` (ARCH §13: keep platform-specific
 * env names behind one config module). Variable names follow `.env.example`.
 */
const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_JWKS_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z.string().default(''),
  ORBIT_LIVE_SOURCES: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface ApiConfig {
  issuer: string;
  audience: string;
  jwksUrl: URL;
  databaseUrl: string | undefined;
  allowedOrigins: readonly string[];
  /** Sources switched from fail-closed to real by `ORBIT_LIVE_SOURCES`. Empty by default. */
  liveSources: ReadonlySet<LiveSource>;
  port: number;
}

/**
 * Sources that can be switched on by configuration, each once its
 * prerequisite lands. Everything not listed stays fail-closed (`unavailable`).
 * - `memberships`, `entitlements`, `scope`, `entities`: Maruti's schema (migrations 000400–000500)
 * - `transitions`: Aditya's sign-off of services/api/TRANSITIONS.md
 */
export const LIVE_SOURCES = ['memberships', 'entitlements', 'scope', 'entities', 'transitions'] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

/** Sources that read Postgres and therefore need `DATABASE_URL`. */
export const DATABASE_SOURCES: readonly LiveSource[] = ['memberships', 'entitlements', 'scope', 'entities'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables only; never echo their values.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid or missing API environment variables: ${names.join(', ')}`);
  }
  const vars = parsed.data;
  const base = vars.SUPABASE_URL.replace(/\/+$/, '');

  const liveSources = parseLiveSources(vars.ORBIT_LIVE_SOURCES);
  if (!vars.DATABASE_URL && DATABASE_SOURCES.some((source) => liveSources.has(source))) {
    throw new Error('ORBIT_LIVE_SOURCES names a database source but DATABASE_URL is not set');
  }

  return {
    issuer: `${base}/auth/v1`,
    audience: 'authenticated',
    jwksUrl: new URL(vars.SUPABASE_JWKS_URL ?? `${base}/auth/v1/.well-known/jwks.json`),
    databaseUrl: vars.DATABASE_URL,
    allowedOrigins: parseOrigins(vars.ALLOWED_ORIGINS),
    liveSources,
    port: vars.PORT,
  };
}

/** Exact origins only. Wildcards are rejected until Aditya decides the preview policy. */
function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  for (const origin of origins) {
    const url = new URL(origin);
    if (origin.includes('*') || url.origin !== origin) {
      throw new Error(`ALLOWED_ORIGINS entries must be exact origins, got an invalid entry`);
    }
  }
  return origins;
}

/** Comma-separated source names. An unknown name is a configuration error, never ignored. */
function parseLiveSources(raw: string): ReadonlySet<LiveSource> {
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const known = new Set<string>(LIVE_SOURCES);
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`ORBIT_LIVE_SOURCES has unknown source names: ${unknown.join(', ')}`);
  }
  return new Set(LIVE_SOURCES.filter((source) => names.includes(source)));
}
