import { z } from 'zod';
import type { LlmProvider } from './config.ts';
import type { Logger } from './log.ts';

/*
 * The day director (ADR 0017 §4). About once an hour a language model is asked
 * what kind of hour each hospital is having, as a small structured "mood":
 * more patients at one site, more people off sick at another. That is ALL it
 * does.
 *
 * - It never touches the ERP. The simulator reads the mood and applies it to
 *   its own rules; the model cannot create, change or choose a record.
 * - Its answer is untrusted: it must parse as JSON, match the schema, name only
 *   facilities the simulator gave it, and every number is clamped to a range.
 *   Anything else is discarded and the previous mood stands.
 * - It is never on the critical path. With no key, or every provider failing,
 *   the hospitals simply have an ordinary day. A mood lasts one hour at most.
 * - There is no clinical content in the request or the answer.
 */

export interface FacilityMood {
  /** Multiplier on new arrivals. */
  demand: number;
  /** Multiplier on how many rostered staff do not turn up. */
  absence: number;
}

export interface Mood {
  headline: string;
  facilities: Record<string, FacilityMood>;
  /** `neutral`, or the provider label that produced it (never the key). */
  source: string;
}

export const NEUTRAL_MOOD: Mood = { headline: 'An ordinary day', facilities: {}, source: 'neutral' };

const NEUTRAL_FACILITY: FacilityMood = { demand: 1, absence: 1 };

export function moodFor(mood: Mood, facilityKey: string): FacilityMood {
  return mood.facilities[facilityKey] ?? NEUTRAL_FACILITY;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ModelAnswerSchema = z.object({
  headline: z.string().min(1),
  facilities: z.record(z.string(), z.object({ demand: z.number().finite(), absence: z.number().finite() })),
});

/** Parses and sanitizes a model's text answer; null when it is not usable. */
export function parseMood(text: string, allowedKeys: readonly string[], source: string): Mood | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return null;
  }
  const parsed = ModelAnswerSchema.safeParse(json);
  if (!parsed.success) return null;

  const facilities: Record<string, FacilityMood> = {};
  for (const key of allowedKeys) {
    const entry = parsed.data.facilities[key];
    if (entry) facilities[key] = { demand: clamp(entry.demand, 0.4, 2.5), absence: clamp(entry.absence, 0.3, 4) };
  }
  // A plain-text headline for the log only: no markup, bounded length.
  const headline = parsed.data.headline.replace(/[^\p{L}\p{N} ,.'’:;()/-]/gu, '').slice(0, 140).trim();
  return { headline: headline || 'An ordinary day', facilities, source };
}

export interface DirectorContext {
  /** Local date and time, e.g. `2026-10-01 14:30`. */
  localTime: string;
  weekday: string;
  facilityKeys: readonly string[];
  previous: Mood;
}

export interface Director {
  decide(context: DirectorContext): Promise<Mood>;
}

const SYSTEM_PROMPT = [
  'You direct the daily rhythm of a SIMULATED hospital group used for software demonstrations.',
  'Every hospital, person and number is fictional. Do not give medical advice and do not mention real people or organizations.',
  'Answer with ONE JSON object and nothing else.',
].join(' ');

function userPrompt(context: DirectorContext): string {
  return JSON.stringify({
    task: 'Describe the next hour. Most hours are ordinary: leave most hospitals at 1.0. At most two hospitals differ from normal.',
    now: context.localTime,
    weekday: context.weekday,
    hospitals: context.facilityKeys,
    previous: { headline: context.previous.headline, facilities: context.previous.facilities },
    answerShape: {
      headline: 'one short plain sentence, no more than 100 characters',
      facilities: '{ "<hospital>": { "demand": 0.5-2.0, "absence": 0.5-3.0 } }, using only the hospital names above; omit a hospital to leave it ordinary',
    },
    meaning: { demand: 'multiplier on new patients arriving', absence: 'multiplier on staff not turning up' },
  });
}

const COOLDOWN_MS = { rateLimited: 10 * 60_000, rejected: 6 * 3_600_000, failed: 2 * 60_000 } as const;

export function createDirector(options: {
  providers: readonly LlmProvider[];
  log: Logger;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number;
}): Director {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20_000;
  /** Providers that recently failed are skipped until this time, so a dead key is not retried every hour. */
  const coolUntil = new Map<string, number>();

  async function ask(provider: LlmProvider, context: DirectorContext): Promise<{ text: string } | { cooldownMs: number; reason: string }> {
    let response: Response;
    try {
      response = await fetchImpl(provider.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(context) },
          ],
          temperature: 0.9,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          ...(provider.reasoningEffort ? { reasoning_effort: provider.reasoningEffort } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { cooldownMs: COOLDOWN_MS.failed, reason: 'network error or timeout' };
    }
    if (response.status === 429) return { cooldownMs: COOLDOWN_MS.rateLimited, reason: 'rate limited (429)' };
    if (response.status === 401 || response.status === 403) return { cooldownMs: COOLDOWN_MS.rejected, reason: `key rejected (${response.status})` };
    if (!response.ok) return { cooldownMs: COOLDOWN_MS.failed, reason: `HTTP ${response.status}` };
    try {
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.length > 0) return { text: content };
    } catch {
      // fall through
    }
    return { cooldownMs: COOLDOWN_MS.failed, reason: 'empty or unreadable answer' };
  }

  return {
    async decide(context) {
      for (const provider of options.providers) {
        if ((coolUntil.get(provider.label) ?? 0) > nowMs()) continue;
        const result = await ask(provider, context);
        if ('text' in result) {
          const mood = parseMood(result.text, context.facilityKeys, provider.label);
          if (mood) {
            options.log.info('director chose a mood', { provider: provider.label, headline: mood.headline, hospitalsChanged: Object.keys(mood.facilities).length });
            return mood;
          }
          coolUntil.set(provider.label, nowMs() + COOLDOWN_MS.failed);
          options.log.warn('director answer was not usable, trying the next provider', { provider: provider.label });
          continue;
        }
        coolUntil.set(provider.label, nowMs() + result.cooldownMs);
        options.log.warn('director provider failed, trying the next', { provider: provider.label, reason: result.reason });
      }
      // No provider, or all failed: an ordinary day. Never hold a stale scenario (a surge must not outlive its hour).
      if (options.providers.length > 0) options.log.warn('no director provider answered; using an ordinary day');
      return NEUTRAL_MOOD;
    },
  };
}
