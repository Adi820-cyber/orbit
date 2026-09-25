import { z } from 'zod';

/**
 * Model narration for Ask answers (ADR 0014).
 *
 * ── What this is allowed to do ─────────────────────────────────────────────
 *
 * Rewrite the prose of an answer the deterministic pipeline has already built,
 * authorized and populated. That is the whole surface. It does not retrieve,
 * compute, select records, or cite policy — those stay in
 * `catalogue.ts`, `plugins/scope.ts` and `@orbit/kpi-framework`, because a
 * generated number is a fabricated number and a generated citation is a
 * fabricated citation (RULES.md).
 *
 * This inverts the usual retrieval-augmented shape deliberately. Letting a model
 * choose what to fetch and summarise cannot satisfy "no invented numbers" by
 * construction, only by hope. Narrating a finished card can, and `narrate()`
 * enforces it: a narration containing a numeric token absent from the source is
 * discarded. A policy would be "we told the model not to invent figures"; this
 * is a control.
 *
 * ── Failure is never the caller's problem ──────────────────────────────────
 *
 * Every path returns a `declined` outcome rather than throwing. Ask serves the
 * deterministic answer when narration declines, so the model is never on the
 * critical path. Losing nicer wording must never lose the answer.
 *
 * ── Why hand-rolled `fetch` and no SDK ────────────────────────────────────
 *
 * Both providers are OpenAI-compatible, so this is one POST with a JSON body.
 * `groq-sdk` and `openai` exist to do more than that, and a dependency whose job
 * is building a JSON object is supply-chain surface we do not need (ADR 0014).
 */

/** Which provider a narration came from, for logging and tests. */
export type ProviderName = 'groq' | 'openrouter';

export interface ModelProvider {
  name: ProviderName;
  /** Full chat-completions URL. */
  endpoint: string;
  apiKey: string;
  model: string;
  /**
   * Ask for constrained decoding. Groq's gpt-oss models honour this as a
   * guarantee; OpenRouter's enforcement varies by endpoint and may be treated as
   * a hint, which is exactly why the response is validated either way.
   */
  strict: boolean;
  /**
   * OpenRouter only: refuse to route to an endpoint that does not support
   * `response_format`, rather than silently degrading to free-form text.
   */
  requireParameters?: boolean;
  /**
   * For reasoning models (Groq's gpt-oss): how much hidden reasoning to spend.
   * Reasoning tokens count against `max_tokens`; at a higher effort the model
   * can exhaust the budget before writing the JSON answer.
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export type DeclineReason =
  /** No provider configured. The normal state when no key is set. */
  | 'not_configured'
  /** Every provider was tried and none produced a usable narration. */
  | 'all_providers_failed'
  /** The narration contained a number the source did not. Rejected on purpose. */
  | 'introduced_numbers'
  /** The response did not match the narration schema. */
  | 'invalid_response'
  /** Moderation or guardrail block. A decision, not an outage — not retried. */
  | 'blocked'
  /** 4xx that means our request or credentials are wrong. Surfaced, not retried. */
  | 'request_rejected';

export type NarrationOutcome =
  | { status: 'narrated'; answer: string; provider: ProviderName }
  | { status: 'declined'; reason: DeclineReason; detail?: string };

/**
 * The only shape a provider may return.
 *
 * Satisfies Groq's `strict: true` requirements: every property listed in
 * `required`, `additionalProperties: false`. Kept to a single string field —
 * the narrower the schema, the less there is for a model to get wrong, and
 * anything richer would be a field the deterministic layer already owns.
 */
const NarrationSchema = z.strictObject({ answer: z.string().min(1) });

/**
 * The part of the OpenAI-compatible completion envelope we read.
 *
 * Non-strict: both providers add fields (usage, id, model, and OpenRouter's
 * routing metadata) and rejecting those would be wrong. We only require that the
 * one field we use is present and a string.
 */
const CompletionEnvelopeSchema = z.object({
  choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })]).rest(z.unknown()),
});

/** JSON Schema form of the above, sent to the provider. */
export const NARRATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: 'The rewritten answer. Reuse the given figures exactly; never introduce a new one.',
    },
  },
  required: ['answer'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'You rewrite one sentence of business reporting prose so it reads clearly.',
  'Rules you must follow exactly:',
  '1. Reuse every figure exactly as written. Do not round, convert, recalculate, or add any number.',
  '2. Do not add facts, causes, recommendations, or confidence statements.',
  '3. Keep every statement in the input, including any caveat or limitation; do not drop or merge one away.',
  '4. Do not mention data sources, systems, or that you are a model.',
  '5. Keep it to at most three sentences.',
  'If you cannot comply, return the input unchanged.',
].join('\n');

/**
 * Statuses worth trying the next provider for: the provider is unavailable or
 * throttled, and a different one plausibly succeeds.
 */
const FAILOVER_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Statuses where failing over is wrong, per ADR 0014 §3.
 *
 * 400 is our bug and fails identically downstream, so failing over doubles the
 * latency and hides the defect behind an intermittent symptom. 401/402 are
 * configuration or billing facts. 403 is a moderation decision — shopping it to
 * a second provider is asking the same question hoping for a different answer.
 */
const TERMINAL_STATUS_REASON: Readonly<Record<number, DeclineReason>> = {
  400: 'request_rejected',
  401: 'request_rejected',
  402: 'request_rejected',
  403: 'blocked',
};

/**
 * Numeric tokens in a string, normalised for comparison.
 *
 * Deliberately crude and therefore conservative. A maximal run of digits with
 * internal separators becomes one token with commas and spaces removed, so
 * `1,234.5` and `1234.5` compare equal while `45` and `45.2` do not. Rounding
 * `45.2%` to `45%` is treated as introducing a number, which is the intended
 * strictness: the cost of a false positive is losing a narration, and the cost
 * of a false negative is publishing a figure nobody measured.
 */
export function numericTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/\d[\d,\s]*(?:\.\d+)?/g)) {
    const normalised = match[0].replaceAll(/[,\s]/g, '').replace(/\.$/, '');
    if (normalised.length > 0) {
      tokens.add(normalised);
    }
  }
  return tokens;
}

/**
 * Numbers present in `narration` but not in `source`.
 *
 * Empty means the narration introduced nothing. This is the control behind
 * ADR 0014 §1 — the reason a model can be allowed near a number surface at all.
 */
export function introducedNumbers(narration: string, source: string): readonly string[] {
  const allowed = numericTokens(source);
  return [...numericTokens(narration)].filter((token) => !allowed.has(token));
}

const ProviderErrorSchema = z.object({ error: z.object({ code: z.string() }) });

/** True when a 400 body says the model failed to generate valid JSON, rather than that our request is wrong. */
async function generationFailed(response: Response): Promise<boolean> {
  try {
    const parsed = ProviderErrorSchema.safeParse(await response.json());
    return parsed.success && parsed.data.error.code === 'json_validate_failed';
  } catch {
    return false;
  }
}

interface CompletionAttempt<T> {
  value?: T;
  /** Set when the whole chain should stop rather than try the next provider. */
  terminal?: DeclineReason;
  detail?: string;
  /** For a 429: how long the provider asked us to wait, when it said. */
  retryAfterMs?: number;
}

/** Too little time left to be worth starting a request. */
const MIN_REQUEST_MS = 1000;
/**
 * Total time one Ask step (interpretation, or narration) may spend across
 * retries and providers, on top of one request's own timeout.
 */
const STEP_GRACE_MS = 4000;

/** The longest we wait for one rate-limit retry before moving to the next provider. */
const MAX_RETRY_WAIT_MS = 3000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One request, retried once on the same provider when the failure is
 * transient: a short rate limit (free tiers throttle bursts), an empty reply
 * (OpenRouter occasionally routes to an upstream that returns no content), or
 * a 5xx. Anything else, and any second failure, falls through to the chain.
 */
async function requestJsonWithRetry<T>(
  provider: ModelProvider,
  task: JsonTask<T>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  deadline: number,
): Promise<CompletionAttempt<T>> {
  const budget = () => Math.min(timeoutMs, deadline - Date.now());
  const first = await requestJson(provider, task, fetchImpl, budget());
  if (first.value !== undefined || first.terminal) return first;
  const detail = first.detail ?? '';
  const rateLimited = detail.endsWith(' 429');
  const transient = /missing_content$|content_not_json$| 50[234]$/.test(detail);
  if (rateLimited) {
    const wait = first.retryAfterMs ?? 1000;
    if (wait > MAX_RETRY_WAIT_MS || deadline - Date.now() - wait < MIN_REQUEST_MS) return first;
    await sleep(wait);
  } else if (!transient) {
    return first;
  }
  const second = await requestJson(provider, task, fetchImpl, budget());
  return second.value !== undefined || second.terminal ? second : { ...second, detail: `${detail}, retried: ${second.detail ?? 'failed'}` };
}

/**
 * One structured-output task for a model: a system prompt, the user content,
 * the JSON Schema sent to the provider, and the Zod schema the reply must
 * pass. The reply is parsed at this boundary like any untrusted payload.
 */
export interface JsonTask<T> {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  parse: z.ZodType<T>;
  /** Wording tasks want a little variety; classification tasks want none. */
  temperature: number;
}

/**
 * One request with a single timer that covers sending AND reading the body.
 * Clearing the timer once headers arrived let a stalled body hang a request
 * for minutes (measured: 121 s); now the whole exchange is bounded.
 */
async function requestJson<T>(
  provider: ModelProvider,
  task: JsonTask<T>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<CompletionAttempt<T>> {
  if (timeoutMs < MIN_REQUEST_MS) return { detail: `${provider.name} deadline` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await sendRequest(provider, task, fetchImpl, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function sendRequest<T>(
  provider: ModelProvider,
  task: JsonTask<T>,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<CompletionAttempt<T>> {
  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: task.temperature,
    // Headroom for reasoning models: their hidden reasoning shares this budget
    // with the answer. 400 was measured to run out before the JSON was written.
    max_tokens: 1024,
    messages: [
      { role: 'system', content: task.system },
      { role: 'user', content: task.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: task.schemaName, strict: provider.strict, schema: task.jsonSchema },
    },
  };
  if (provider.reasoningEffort) {
    // Same setting, provider-specific spelling: Groq takes `reasoning_effort`,
    // OpenRouter normalizes it as `reasoning: { effort }`.
    if (provider.name === 'openrouter') {
      body.reasoning = { effort: provider.reasoningEffort };
    } else {
      body.reasoning_effort = provider.reasoningEffort;
    }
  }
  if (provider.requireParameters) {
    // Route only to endpoints that actually support response_format, instead of
    // letting OpenRouter fall back to an endpoint that ignores it.
    body.provider = { require_parameters: true };
  }

  let response: Response;
  try {
    response = await fetchImpl(provider.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    // Network failure, DNS, or our own timeout. Worth the next provider.
    return { detail: error instanceof Error ? error.name : 'network_error' };
  }

  if (!response.ok) {
    // A 400 is normally our own bug and must not fail over. Groq's
    // `json_validate_failed` is the exception: the model failed to produce a
    // schema-valid document (e.g. ran out of tokens), which another provider
    // may well manage, so it is treated as a provider failure.
    if (response.status === 400 && (await generationFailed(response))) {
      return { detail: `${provider.name} 400 json_validate_failed` };
    }
    const terminal = TERMINAL_STATUS_REASON[response.status];
    if (terminal) {
      return { terminal, detail: `${provider.name} ${response.status}` };
    }
    if (FAILOVER_STATUSES.has(response.status)) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        detail: `${provider.name} ${response.status}`,
        ...(response.status === 429 && Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
      };
    }
    // An unexpected status is not assumed retryable.
    return { terminal: 'request_rejected', detail: `${provider.name} ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { detail: `${provider.name} unparseable_body` };
  }

  // Parsed rather than asserted. The envelope is another provider's output, so it
  // gets the same treatment as any untrusted payload instead of a cast that would
  // turn a shape change into an undefined further down.
  const envelope = CompletionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { detail: `${provider.name} missing_content` };
  }
  const content = envelope.data.choices[0].message.content;

  // Parsed even when the provider claims to guarantee the schema. Groq's
  // constrained decoding is a latency and reliability win, never a licence to
  // skip the boundary check every other payload in this service gets.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return { detail: `${provider.name} content_not_json` };
  }
  const parsed = task.parse.safeParse(parsedJson);
  if (!parsed.success) {
    return { detail: `${provider.name} schema_mismatch` };
  }

  return { value: parsed.data };
}

export type JsonOutcome<T> =
  | { status: 'ok'; value: T; provider: ProviderName }
  | { status: 'declined'; reason: DeclineReason; detail?: string };

/**
 * Runs a structured-output task through the provider chain with the same
 * failover rules as narration. For tasks whose output is checked by the
 * caller rather than by the numeric-token guard (e.g. question
 * interpretation, where the reply is constrained to enumerated choices).
 */
export async function completeJson<T>(
  task: JsonTask<T>,
  options: NarrateOptions,
): Promise<JsonOutcome<T>> {
  const { providers, fetchImpl = fetch, timeoutMs = 8000 } = options;
  if (providers.length === 0) {
    return { status: 'declined', reason: 'not_configured' };
  }
  const failures: string[] = [];
  const deadline = Date.now() + timeoutMs + STEP_GRACE_MS;
  for (const provider of providers) {
    // eslint-disable-next-line no-await-in-loop
    const attempt = await requestJsonWithRetry(provider, task, fetchImpl, timeoutMs, deadline);
    if (attempt.terminal) {
      return { status: 'declined', reason: attempt.terminal, detail: attempt.detail };
    }
    if (attempt.value === undefined) {
      failures.push(attempt.detail ?? `${provider.name} failed`);
      continue;
    }
    return { status: 'ok', value: attempt.value, provider: provider.name };
  }
  return { status: 'declined', reason: 'all_providers_failed', detail: failures.join('; ') };
}

export interface NarrateOptions {
  /** Tried in order. Empty means narration is not configured. */
  providers: readonly ModelProvider[];
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Per-provider budget. Ask must stay responsive; a slow model is a declined one. */
  timeoutMs?: number;
}

/**
 * Rewrites `deterministicAnswer`, or declines.
 *
 * `source` is the text whose numbers are permitted — normally the deterministic
 * answer plus any figures already rendered on the card. Anything numeric outside
 * it is treated as invented and the narration is discarded.
 */
export async function narrate(
  deterministicAnswer: string,
  options: NarrateOptions,
  source: string = deterministicAnswer,
): Promise<NarrationOutcome> {
  const { providers, fetchImpl = fetch, timeoutMs = 8000 } = options;
  if (providers.length === 0) {
    return { status: 'declined', reason: 'not_configured' };
  }

  const failures: string[] = [];
  const deadline = Date.now() + timeoutMs + STEP_GRACE_MS;
  for (const provider of providers) {
    // Sequential on purpose: this is a fallback chain, not a race. Calling every
    // provider in parallel would spend a second provider's quota on every request
    // and bill for a completion we intend to discard.
    // eslint-disable-next-line no-await-in-loop
    const attempt = await requestJsonWithRetry(
      provider,
      {
        system: SYSTEM_PROMPT,
        user: deterministicAnswer,
        schemaName: 'orbit_narration',
        jsonSchema: NARRATION_JSON_SCHEMA,
        parse: NarrationSchema,
        // Low but not zero: this is a wording task, not a sampling one.
        temperature: 0.2,
      },
      fetchImpl,
      timeoutMs,
      deadline,
    );

    if (attempt.terminal) {
      // Stop the chain: retrying this elsewhere is either pointless or wrong.
      return { status: 'declined', reason: attempt.terminal, detail: attempt.detail };
    }

    const answer = attempt.value?.answer.trim();
    if (answer === undefined) {
      failures.push(attempt.detail ?? `${provider.name} failed`);
      continue;
    }

    const introduced = introducedNumbers(answer, source);
    if (introduced.length > 0) {
      // Not a provider failure, so do not try the next one — a second model is
      // no more entitled to invent a figure than the first.
      return {
        status: 'declined',
        reason: 'introduced_numbers',
        detail: `${provider.name} introduced ${introduced.join(', ')}`,
      };
    }

    if (answer.length === 0) {
      failures.push(`${provider.name} empty_answer`);
      continue;
    }

    return { status: 'narrated', answer, provider: provider.name };
  }

  return { status: 'declined', reason: 'all_providers_failed', detail: failures.join('; ') };
}

/** Groq, primary. Model IDs verified against Groq's models page (ADR 0014 §2). */
export function groqProvider(apiKey: string, model = 'openai/gpt-oss-20b'): ModelProvider {
  return {
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
    // gpt-oss-20b/120b support constrained decoding.
    strict: true,
    // Rewording one sentence needs little reasoning; low keeps it inside the token budget.
    reasoningEffort: 'low',
  };
}

/**
 * OpenRouter, fallback.
 *
 * `strict` is still requested, but its enforcement varies by endpoint, so
 * `require_parameters` keeps routing to endpoints that at least accept
 * `response_format`. `HTTP-Referer` and `X-Title` are omitted deliberately:
 * they are optional leaderboard attribution and would publish deployment
 * details for no benefit.
 */
export function openRouterProvider(apiKey: string, model: string): ModelProvider {
  return {
    name: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model,
    strict: true,
    requireParameters: true,
    reasoningEffort: 'low',
  };
}
