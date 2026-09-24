import { describe, expect, it, vi } from 'vitest';
import {
  groqProvider,
  introducedNumbers,
  narrate,
  numericTokens,
  openRouterProvider,
  type ModelProvider,
} from './narrator.ts';

/**
 * Weighted toward the two properties that make it safe to put a model anywhere
 * near a number surface (ADR 0014):
 *
 *   1. A narration that introduces a figure is discarded, not published.
 *   2. Failure never becomes the caller's problem, and failover happens for
 *      availability reasons only — never on 400, 401, 402 or 403.
 *
 * Nothing here touches the network; `fetch` is injected throughout.
 */

const PROVIDER: ModelProvider = {
  name: 'groq',
  endpoint: 'https://example.invalid/v1/chat/completions',
  apiKey: 'test-key-not-real',
  model: 'openai/gpt-oss-20b',
  strict: true,
};

const SECOND: ModelProvider = { ...PROVIDER, name: 'openrouter', requireParameters: true };

/** An OpenAI-compatible completion whose content is the narration JSON. */
function completion(answer: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer }) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A completion whose content is present but not the narration shape. */
function rawContent(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

/** The JSON body of a recorded request. */
function bodyOf(calls: readonly unknown[][], index = 0): Record<string, unknown> {
  const init = calls[index]?.[1] as RequestInit | undefined;
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('expected a JSON string request body');
  }
  return JSON.parse(body) as Record<string, unknown>;
}

/** The headers of a recorded request. */
function headersOf(calls: readonly unknown[][], index = 0): Record<string, string> {
  const init = calls[index]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('numericTokens', () => {
  it('normalises separators so the same figure compares equal', () => {
    expect(numericTokens('1,234.5')).toEqual(new Set(['1234.5']));
    expect(numericTokens('1234.5')).toEqual(new Set(['1234.5']));
  });

  it('keeps precision distinct, so a rounded figure is a different token', () => {
    // The whole point of the control: 45% is not the same claim as 45.2%.
    expect(numericTokens('45.2%')).toEqual(new Set(['45.2']));
    expect(numericTokens('45%')).toEqual(new Set(['45']));
  });

  it('finds every figure in a sentence', () => {
    expect(numericTokens('Net revenue 12,400 against a plan of 13,000')).toEqual(new Set(['12400', '13000']));
  });

  it('returns nothing for prose with no figures', () => {
    expect(numericTokens('capacity is below plan')).toEqual(new Set());
  });
});

describe('introducedNumbers', () => {
  it('accepts a rewrite that reuses the figures exactly', () => {
    expect(introducedNumbers('Revenue was 12,400 versus 13,000.', 'net revenue 12400 plan 13000')).toEqual([]);
  });

  it('flags an invented figure', () => {
    expect(introducedNumbers('Revenue was 12,400, down 4.6%.', 'net revenue 12400 plan 13000')).toEqual(['4.6']);
  });

  it('flags a rounded figure, because rounding is a new claim', () => {
    expect(introducedNumbers('utilisation near 45%', 'utilisation 45.2%')).toEqual(['45']);
  });

  it('allows prose with no figures at all', () => {
    expect(introducedNumbers('Capacity is below plan.', 'utilisation 45.2%')).toEqual([]);
  });
});

describe('narrate', () => {
  it('declines when no provider is configured, which is the default state', async () => {
    const outcome = await narrate('Net revenue was 12,400.', { providers: [] });
    expect(outcome).toEqual({ status: 'declined', reason: 'not_configured' });
  });

  it('returns the narration when the figures are reused', async () => {
    const outcome = await narrate('Net revenue was 12,400.', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(async () => completion('Net revenue came in at 12,400.')),
    });
    expect(outcome).toEqual({ status: 'narrated', answer: 'Net revenue came in at 12,400.', provider: 'groq' });
  });

  /** The control from ADR 0014 §1, end to end. */
  it('discards a narration that invents a figure', async () => {
    const outcome = await narrate('Net revenue was 12,400.', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(async () => completion('Net revenue was 12,400, a 7.3% shortfall.')),
    });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'introduced_numbers' });
  });

  it('does not try the second provider after an invented figure', async () => {
    // A second model is no more entitled to invent a number than the first;
    // retrying would be shopping for a compliant answer to a failed check.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(completion('up 9.9%'))
      .mockResolvedValueOnce(completion('Clean rewrite of 12,400.'));
    const outcome = await narrate('Net revenue was 12,400.', { providers: [PROVIDER, SECOND], fetchImpl });
    expect(outcome).toMatchObject({ reason: 'introduced_numbers' });
    expect(fetchImpl, 'the second provider must not be called').toHaveBeenCalledTimes(1);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])('fails over to the second provider on %i', async (status) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status }))
      .mockResolvedValueOnce(completion('Revenue 12,400.'));
    const outcome = await narrate('Net revenue was 12,400.', { providers: [PROVIDER, SECOND], fetchImpl });
    expect(outcome).toEqual({ status: 'narrated', answer: 'Revenue 12,400.', provider: 'openrouter' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /**
   * The more important half. Failing over on these is wrong: 400 is our own bug
   * and fails identically downstream, 401/402 are configuration or billing facts,
   * and 403 is a moderation decision rather than an outage.
   */
  it.each([
    [400, 'request_rejected'],
    [401, 'request_rejected'],
    [402, 'request_rejected'],
    [403, 'blocked'],
  ])('does NOT fail over on %i', async (status, reason) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    const outcome = await narrate('ok', { providers: [PROVIDER, SECOND], fetchImpl });
    expect(outcome).toMatchObject({ status: 'declined', reason });
    expect(fetchImpl, 'the second provider must not be called').toHaveBeenCalledTimes(1);
  });

  it('declines when every provider fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    const outcome = await narrate('ok', { providers: [PROVIDER, SECOND], fetchImpl });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'all_providers_failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('declines rather than throwing when the network is unreachable', async () => {
    const outcome = await narrate('ok', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'all_providers_failed' });
  });

  it('declines when the content is not JSON, even on a 200', async () => {
    const outcome = await narrate('ok', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(async () => rawContent('not json at all')),
    });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'all_providers_failed' });
  });

  /**
   * Validated even though Groq documents `strict: true` as a guarantee. A
   * provider's promise is not a boundary check, and every other payload in this
   * service is parsed.
   */
  it('declines when the JSON does not match the narration schema', async () => {
    const outcome = await narrate('ok', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(async () => rawContent(JSON.stringify({ text: 'wrong field' }))),
    });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'all_providers_failed' });
  });

  it('declines when the envelope has no choices', async () => {
    const outcome = await narrate('ok', {
      providers: [PROVIDER],
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    });
    expect(outcome).toMatchObject({ status: 'declined', reason: 'all_providers_failed' });
  });

  it('tolerates the extra envelope fields both providers send', async () => {
    // usage/id/model on Groq, routing metadata on OpenRouter. Rejecting those
    // would be wrong, so the envelope schema is non-strict by design.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-x',
            model: 'openai/gpt-oss-20b',
            usage: { total_tokens: 42 },
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ answer: 'ok' }) } }],
          }),
          { status: 200 },
        ),
    );
    const outcome = await narrate('ok', { providers: [PROVIDER], fetchImpl });
    expect(outcome).toMatchObject({ status: 'narrated', answer: 'ok' });
  });

  it('sends a bearer token, the schema, and no attribution headers', async () => {
    const fetchImpl = vi.fn(async () => completion('ok'));
    await narrate('ok', { providers: [openRouterProvider('k', 'openai/gpt-4.1-nano')], fetchImpl });

    const headers = headersOf(fetchImpl.mock.calls);
    expect(headers.Authorization).toBe('Bearer k');
    // Optional leaderboard attribution; omitted so we do not publish deployment details.
    expect(headers['HTTP-Referer']).toBeUndefined();
    expect(headers['X-Title']).toBeUndefined();

    const body = bodyOf(fetchImpl.mock.calls);
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
    // require_parameters keeps OpenRouter off endpoints that ignore response_format.
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('omits require_parameters for Groq', async () => {
    const fetchImpl = vi.fn(async () => completion('ok'));
    await narrate('ok', { providers: [groqProvider('k')], fetchImpl });
    expect(bodyOf(fetchImpl.mock.calls).provider).toBeUndefined();
  });
});

describe('provider defaults', () => {
  it('uses a Groq model that is generally available, not an Enterprise one', () => {
    // llama-3.3-70b-versatile and llama-3.1-8b-instant are Contact Sales on
    // Groq's models page, so defaulting to one would 4xx on a standard key.
    const provider = groqProvider('k');
    expect(provider.model).toBe('openai/gpt-oss-20b');
    expect(provider.endpoint).toBe('https://api.groq.com/openai/v1/chat/completions');
    // gpt-oss supports constrained decoding, so ask for it.
    expect(provider.strict).toBe(true);
  });

  it('points OpenRouter at its documented endpoint and requires parameter support', () => {
    const provider = openRouterProvider('k', 'openai/gpt-4.1-nano');
    expect(provider.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(provider.requireParameters).toBe(true);
  });
});
