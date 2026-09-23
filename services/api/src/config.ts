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
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface ApiConfig {
  issuer: string;
  audience: string;
  jwksUrl: URL;
  databaseUrl: string | undefined;
  allowedOrigins: readonly string[];
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables only; never echo their values.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid or missing API environment variables: ${names.join(', ')}`);
  }
  const vars = parsed.data;
  const base = vars.SUPABASE_URL.replace(/\/+$/, '');

  return {
    issuer: `${base}/auth/v1`,
    audience: 'authenticated',
    jwksUrl: new URL(vars.SUPABASE_JWKS_URL ?? `${base}/auth/v1/.well-known/jwks.json`),
    databaseUrl: vars.DATABASE_URL,
    allowedOrigins: parseOrigins(vars.ALLOWED_ORIGINS),
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
