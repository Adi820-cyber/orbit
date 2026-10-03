import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/config.ts';
import { createDirector, moodFor, NEUTRAL_MOOD, parseMood, type DirectorContext } from '../src/director.ts';
import { createLogger } from '../src/log.ts';

const KEYS = ['avenhurst', 'brackmoor', 'calderwyn'];
const CONTEXT: DirectorContext = { localTime: '2026-10-01 14:30', weekday: 'Thursday', facilityKeys: KEYS, previous: NEUTRAL_MOOD };

const provider = (label: string, apiKey: string): LlmProvider => ({ label, endpoint: `https://${label}.example/v1/chat/completions`, apiKey, model: 'm' });
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const answer = (facilities: Record<string, { demand: number; absence: number }> = {}) => JSON.stringify({ headline: 'A busy afternoon at Brackmoor', facilities });

function scripted(handlers: Record<string, () => Response | Error>) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const handler = Object.entries(handlers).find(([host]) => url.includes(host))?.[1];
    const result = handler ? handler() : new Error('no handler');
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe('parsing a model answer', () => {
  it('keeps only hospitals it was told about and clamps every number', () => {
    const mood = parseMood(
      JSON.stringify({
        headline: 'Flu surge at Brackmoor',
        facilities: { brackmoor: { demand: 99, absence: -4 }, avenhurst: { demand: 1.4, absence: 1.2 }, unknown: { demand: 2, absence: 2 } },
      }),
      KEYS,
      'groq#1',
    );
    expect(mood?.facilities).toEqual({ brackmoor: { demand: 2.5, absence: 0.3 }, avenhurst: { demand: 1.4, absence: 1.2 } });
    expect(mood?.source).toBe('groq#1');
  });

  it('accepts an answer wrapped in a code fence', () => {
    expect(parseMood('```json\n' + answer({ avenhurst: { demand: 1.5, absence: 1 } }) + '\n```', KEYS, 'x')?.facilities['avenhurst']).toEqual({ demand: 1.5, absence: 1 });
  });

  it.each([
    ['not JSON at all', 'sorry, I cannot help'],
    ['the wrong shape', JSON.stringify({ headline: 'x', facilities: [] })],
    ['a missing headline', JSON.stringify({ facilities: {} })],
    ['non-numeric values', JSON.stringify({ headline: 'x', facilities: { avenhurst: { demand: 'lots', absence: 1 } } })],
    ['an empty string', ''],
  ])('discards %s', (_name, text) => {
    expect(parseMood(text, KEYS, 'x')).toBeNull();
  });

  it('strips markup and bounds the headline, which is only ever logged', () => {
    const mood = parseMood(JSON.stringify({ headline: '<script>alert(1)</script>Surge ' + 'x'.repeat(400), facilities: {} }), KEYS, 'x');
    expect(mood?.headline).not.toMatch(/[<>]/);
    expect((mood?.headline ?? '').length).toBeLessThanOrEqual(140);
  });

  it('falls back to ordinary for a hospital the mood does not mention', () => {
    expect(moodFor(NEUTRAL_MOOD, 'avenhurst')).toEqual({ demand: 1, absence: 1 });
  });
});

describe('the director', () => {
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));

  it('asks the first provider and returns its mood', async () => {
    const { fetchImpl, requests } = scripted({ 'groq#1': () => completion(answer({ brackmoor: { demand: 1.8, absence: 1 } })) });
    const director = createDirector({ providers: [provider('groq#1', 'key-one')], log, fetchImpl });
    const mood = await director.decide(CONTEXT);
    expect(mood.facilities['brackmoor']?.demand).toBe(1.8);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['authorization']).toBe('Bearer key-one');
    expect(requests[0]?.body['model']).toBe('m');
    expect(requests[0]?.body['response_format']).toEqual({ type: 'json_object' });
  });

  it('sends only the hospital keys, the time and the previous mood: nothing personal or clinical', async () => {
    const { fetchImpl, requests } = scripted({ 'groq#1': () => completion(answer()) });
    await createDirector({ providers: [provider('groq#1', 'k')], log, fetchImpl }).decide(CONTEXT);
    const prompt = JSON.stringify(requests[0]?.body['messages']);
    for (const key of KEYS) expect(prompt).toContain(key);
    expect(prompt).toContain('SIMULATED');
    expect(prompt).not.toMatch(/diagnos|password|email|@|mrn/i);
  });

  it('falls back to the next provider on a rate limit, and does not ask the limited one again soon', async () => {
    let now = 1_000_000;
    const { fetchImpl, requests } = scripted({
      'groq#1': () => new Response('{}', { status: 429 }),
      'openrouter#1': () => completion(answer({ avenhurst: { demand: 1.3, absence: 1 } })),
    });
    const director = createDirector({ providers: [provider('groq#1', 'a'), provider('openrouter#1', 'b')], log, fetchImpl, nowMs: () => now });

    expect((await director.decide(CONTEXT)).source).toBe('openrouter#1');
    expect(requests.map((request) => request.url.split('/')[2])).toEqual(['groq#1.example', 'openrouter#1.example']);

    now += 5 * 60_000; // still inside the 10-minute rate-limit cool-down
    await director.decide(CONTEXT);
    expect(requests.filter((request) => request.url.includes('groq#1'))).toHaveLength(1);

    now += 10 * 60_000; // cool-down over: the first provider is tried again
    await director.decide(CONTEXT);
    expect(requests.filter((request) => request.url.includes('groq#1'))).toHaveLength(2);
  });

  it('parks a rejected key for hours and tries the next one', async () => {
    let now = 0;
    const { fetchImpl, requests } = scripted({
      'groq#1': () => new Response('{}', { status: 401 }),
      'groq#2': () => completion(answer()),
    });
    const director = createDirector({ providers: [provider('groq#1', 'dead'), provider('groq#2', 'live')], log, fetchImpl, nowMs: () => now });
    expect((await director.decide(CONTEXT)).source).toBe('groq#2');
    now += 3_600_000;
    await director.decide(CONTEXT);
    expect(requests.filter((request) => request.url.includes('groq#1'))).toHaveLength(1);
  });

  it('moves on when a provider answers with something unusable', async () => {
    const { fetchImpl } = scripted({
      'groq#1': () => completion('I am sorry, here is some prose'),
      'groq#2': () => completion(answer({ avenhurst: { demand: 2, absence: 2 } })),
    });
    const mood = await createDirector({ providers: [provider('groq#1', 'a'), provider('groq#2', 'b')], log, fetchImpl }).decide(CONTEXT);
    expect(mood.source).toBe('groq#2');
  });

  it('survives a network failure and a timeout-style error', async () => {
    const { fetchImpl } = scripted({ 'groq#1': () => new Error('socket hang up'), 'groq#2': () => completion(answer()) });
    expect((await createDirector({ providers: [provider('groq#1', 'a'), provider('groq#2', 'b')], log, fetchImpl }).decide(CONTEXT)).source).toBe('groq#2');
  });

  it('has an ordinary day when every provider fails, and never holds a stale scenario', async () => {
    const { fetchImpl } = scripted({ 'groq#1': () => new Response('{}', { status: 500 }) });
    const surge = { headline: 'Surge', facilities: { avenhurst: { demand: 2.5, absence: 3 } }, source: 'groq#1' };
    const mood = await createDirector({ providers: [provider('groq#1', 'a')], log, fetchImpl }).decide({ ...CONTEXT, previous: surge });
    expect(mood).toBe(NEUTRAL_MOOD);
  });

  it('has an ordinary day with no providers at all, without calling anything', async () => {
    const { fetchImpl, requests } = scripted({});
    expect(await createDirector({ providers: [], log, fetchImpl }).decide(CONTEXT)).toBe(NEUTRAL_MOOD);
    expect(requests).toHaveLength(0);
  });

  it('never writes an API key to the log', async () => {
    lines.length = 0;
    const { fetchImpl } = scripted({
      'groq#1': () => new Response('{}', { status: 429 }),
      'openrouter#1': () => completion(answer()),
    });
    await createDirector({ providers: [provider('groq#1', 'SECRET-KEY-ONE'), provider('openrouter#1', 'SECRET-KEY-TWO')], log, fetchImpl }).decide(CONTEXT);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('SECRET-KEY');
  });
});
