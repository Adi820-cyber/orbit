import { z } from 'zod';

/*
 * Simulator configuration (ADR 0017). Everything comes from environment
 * variables, so nothing secret is ever in the repository, and a bad value stops
 * the process at startup naming the variable only, never echoing its value.
 *
 * Secrets: SIM_*_PASSWORD, SUPABASE_PUBLISHABLE_KEY (public by design, but still
 * kept out of logs), SIM_GROQ_KEYS, SIM_OPENROUTER_KEYS. None is ever logged.
 */

export interface Credentials {
  email: string;
  password: string;
}

export interface LlmProvider {
  /** For logs only, e.g. `groq#2`. Never contains the key. */
  label: string;
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface SimRates {
  absent: number;
  late: number;
  missingOut: number;
  earlyExit: number;
}

export interface SimConfig {
  /** Base URL of the ERP API (an `orbit-api` or `orbit-erp-api` deployment). */
  erpApiUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  admin: Credentials;
  /** Desk accounts by facility key (`avenhurst`). A facility without one is served by the admin. */
  desks: ReadonlyMap<string, Credentials>;
  /** Restrict to these facility keys; null means every facility the admin can see. */
  facilities: readonly string[] | null;
  tickSeconds: number;
  seed: string;
  visitsPerStaffPerDay: number;
  rates: SimRates;
  maxOpenInpatients: number;
  /**
   * A staged outbreak for demonstrations (ADR 0023), off unless set: extra
   * patients with this condition (its code) arrive at every hospital.
   */
  outbreak: { conditionCode: string; perHospitalPerDay: number } | null;
  rosterDaysAhead: number;
  maxWritesPerTick: number;
  /** Reads and plans but writes nothing. */
  paused: boolean;
  /** Hire staff and build a service catalogue when a hospital has none (bootstrap.ts). */
  bootstrap: boolean;
  /** A punch up to this late is recorded by the desk at the real time; later ones are back-dated by the admin. */
  catchupSeconds: number;
  /** Planned events older than this are never back-filled. */
  catchupMaxHours: number;
  /**
   * Single-run mode only (`--once`, e.g. a scheduler every ten minutes): a fresh
   * process cannot tell which services earlier runs already recorded, so it only
   * considers services due within this many seconds and leaves older ones to the
   * runs that came before. Null for the always-on worker, which remembers.
   */
  serviceLookbackSeconds: number | null;
  directorMinutes: number;
  providers: readonly LlmProvider[];
  /** Health endpoint port, for hosts that probe one (Railway, Render web services). */
  port: number | undefined;
}

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const number = (min: number, max: number, fallback: number) =>
  z.preprocess((value) => (value === '' || value === undefined ? undefined : Number(value)), z.number().min(min).max(max).default(fallback));

/** A true/false setting: `1`, `true` or `yes` (any case) is true; unset or empty uses the fallback. */
const boolean = (fallback: boolean) =>
  z.preprocess((value) => (typeof value === 'string' && value !== '' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : fallback), z.boolean());

const EnvSchema = z.object({
  ERP_API_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SIM_ADMIN_EMAIL: z.string().min(3),
  SIM_ADMIN_PASSWORD: z.string().min(1),
  SIM_FACILITIES: optional(z.string()),
  SIM_TICK_SECONDS: number(5, 600, 60),
  SIM_SEED: z.string().min(1).default('orbit-sim'),
  SIM_VISITS_PER_STAFF_PER_DAY: number(0, 5, 0.6),
  SIM_ABSENT_RATE: number(0, 0.5, 0.03),
  SIM_LATE_RATE: number(0, 0.5, 0.06),
  SIM_MISSING_OUT_RATE: number(0, 0.5, 0.03),
  SIM_EARLY_EXIT_RATE: number(0, 0.5, 0.02),
  SIM_MAX_OPEN_INPATIENTS: number(0, 500, 25),
  SIM_OUTBREAK_CONDITION: optional(z.string().regex(/^[A-Z0-9-]{2,24}$/, 'a condition code, e.g. VIRAL-FEVER')),
  SIM_OUTBREAK_PER_HOSPITAL_PER_DAY: number(1, 50, 12),
  SIM_ROSTER_DAYS_AHEAD: number(1, 60, 14),
  SIM_MAX_WRITES_PER_TICK: number(1, 1000, 60),
  SIM_PAUSED: boolean(false),
  SIM_BOOTSTRAP: boolean(true),
  SIM_CATCHUP_SECONDS: number(30, 3600, 300),
  SIM_CATCHUP_MAX_HOURS: number(1, 720, 24),
  SIM_DIRECTOR_MINUTES: number(5, 1440, 60),
  SIM_GROQ_KEYS: optional(z.string()),
  SIM_GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
  SIM_OPENROUTER_KEYS: optional(z.string()),
  SIM_OPENROUTER_MODEL: optional(z.string().min(1)),
  PORT: optional(z.coerce.number().int().min(1).max(65535)),
});

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const csv = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/** `SIM_DESK_AVENHURST_EMAIL` + `SIM_DESK_AVENHURST_PASSWORD` → desk for `avenhurst`. */
export function readDesks(env: Record<string, string | undefined>): Map<string, Credentials> {
  const desks = new Map<string, Credentials>();
  for (const name of Object.keys(env)) {
    const match = /^SIM_DESK_([A-Z0-9]+)_EMAIL$/.exec(name);
    if (!match?.[1]) continue;
    const email = env[name];
    const password = env[`SIM_DESK_${match[1]}_PASSWORD`];
    if (!email || !password) {
      throw new Error(`SIM_DESK_${match[1]}_EMAIL needs SIM_DESK_${match[1]}_PASSWORD`);
    }
    desks.set(match[1].toLowerCase(), { email, password });
  }
  return desks;
}

/** An API URL must be https, except for a local one. Prevents pointing a bot at plain http by mistake. */
function checkApiUrl(raw: string): string {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error('ERP_API_URL must be https (http is allowed only for localhost)');
  }
  return raw.replace(/\/+$/, '');
}

export function loadConfig(env: Record<string, string | undefined> = process.env): SimConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Names only; never echo a value.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid or missing simulator environment variables: ${names.join(', ')}`);
  }
  const vars = parsed.data;

  const groqKeys = csv(vars.SIM_GROQ_KEYS);
  const openRouterKeys = csv(vars.SIM_OPENROUTER_KEYS);
  if (openRouterKeys.length > 0 && !vars.SIM_OPENROUTER_MODEL) {
    throw new Error('SIM_OPENROUTER_KEYS needs SIM_OPENROUTER_MODEL (there is no default on purpose)');
  }
  const providers: LlmProvider[] = [
    ...groqKeys.map((apiKey, index) => ({
      label: `groq#${index + 1}`,
      endpoint: GROQ_ENDPOINT,
      apiKey,
      model: vars.SIM_GROQ_MODEL,
      reasoningEffort: 'low' as const,
    })),
    ...openRouterKeys.map((apiKey, index) => ({
      label: `openrouter#${index + 1}`,
      endpoint: OPENROUTER_ENDPOINT,
      apiKey,
      model: vars.SIM_OPENROUTER_MODEL ?? '',
    })),
  ];

  const facilityKeys = csv(vars.SIM_FACILITIES).map((key) => key.toLowerCase());

  return {
    erpApiUrl: checkApiUrl(vars.ERP_API_URL),
    supabaseUrl: vars.SUPABASE_URL.replace(/\/+$/, ''),
    supabaseKey: vars.SUPABASE_PUBLISHABLE_KEY,
    admin: { email: vars.SIM_ADMIN_EMAIL, password: vars.SIM_ADMIN_PASSWORD },
    desks: readDesks(env),
    facilities: facilityKeys.length > 0 ? facilityKeys : null,
    tickSeconds: vars.SIM_TICK_SECONDS,
    seed: vars.SIM_SEED,
    visitsPerStaffPerDay: vars.SIM_VISITS_PER_STAFF_PER_DAY,
    rates: {
      absent: vars.SIM_ABSENT_RATE,
      late: vars.SIM_LATE_RATE,
      missingOut: vars.SIM_MISSING_OUT_RATE,
      earlyExit: vars.SIM_EARLY_EXIT_RATE,
    },
    maxOpenInpatients: vars.SIM_MAX_OPEN_INPATIENTS,
    outbreak: vars.SIM_OUTBREAK_CONDITION
      ? { conditionCode: vars.SIM_OUTBREAK_CONDITION, perHospitalPerDay: vars.SIM_OUTBREAK_PER_HOSPITAL_PER_DAY }
      : null,
    rosterDaysAhead: vars.SIM_ROSTER_DAYS_AHEAD,
    maxWritesPerTick: vars.SIM_MAX_WRITES_PER_TICK,
    paused: vars.SIM_PAUSED,
    bootstrap: vars.SIM_BOOTSTRAP,
    catchupSeconds: vars.SIM_CATCHUP_SECONDS,
    catchupMaxHours: vars.SIM_CATCHUP_MAX_HOURS,
    serviceLookbackSeconds: null,
    directorMinutes: vars.SIM_DIRECTOR_MINUTES,
    providers,
    port: vars.PORT,
  };
}
