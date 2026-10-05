import { afterEach, describe, expect, it } from 'vitest';
import { ChatbotResponseSchema, ErrorEnvelopeSchema } from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp } from '../../../test/helpers/modules.ts';
import { groqProvider, openRouterProvider } from '../ask/narrator.ts';
import type { KnowledgeChunk, KnowledgeQuery, ModuleDeps } from '../ports.ts';
import { EMBEDDING_DIMENSIONS, embeddingProvider, generateEmbeddings } from './embedder.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

const BUILT_AT = '2026-10-03T08:00:00.000Z';

const SAMPLE_CHUNKS: KnowledgeChunk[] = [
  {
    id: 'k-1',
    title: 'Hospital operations: Fixture facility A1',
    content: 'Staffing: 52 active staff, 40 rostered today, 3 late, 1 absent. Simulated demonstration data.',
    source: 'auto:operations',
    domain: 'hospital-operations',
    similarity: 0.92,
    matchedBy: 'hybrid',
    updatedAt: BUILT_AT,
  },
  {
    id: 'k-2',
    title: 'Exception (act now): Capacity',
    content: 'Exception, act now, performance, for Fixture facility A1. Occupancy fell to 71 percent. Owner role: regional-coo.',
    source: 'auto:kpi-exception',
    domain: 'kpi-exceptions',
    similarity: 0.8,
    matchedBy: 'text',
    updatedAt: BUILT_AT,
  },
];

async function setup(chunks: KnowledgeChunk[] = [], overrides: Partial<ModuleDeps> = {}) {
  const searches: KnowledgeQuery[] = [];
  const built = await buildModuleApp({
    knowledge: {
      search: async (_membership, query) => {
        searches.push(query);
        return chunks;
      },
    },
    ...overrides,
  });
  close = () => built.app.close();
  return { ...built, searches };
}

const provider = openRouterProvider('test-key', 'test-model');

/** A scripted OpenRouter: embeddings return a vector of the right size; chat returns `answer`. */
function scriptedFetch(answer: string | null, calls: string[] = []): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = new Request(input).url;
    calls.push(url);
    if (url.endsWith('/embeddings')) {
      return Response.json({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1) }] });
    }
    if (answer === null) return new Response('boom', { status: 500 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ answer }) } }] });
  };
}

function withModel(answer: string | null, calls: string[] = []): Partial<ModuleDeps> {
  const fetchImpl = scriptedFetch(answer, calls);
  return {
    askNarration: { providers: [provider], timeoutMs: 5000, fetchImpl },
    embedding: { provider, model: 'embed-model', fetchImpl },
  };
}

async function ask(call: Awaited<ReturnType<typeof setup>>['call'], message = 'How many staff are late at facility A1?') {
  const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', { message });
  expect(response.statusCode).toBe(200);
  return ChatbotResponseSchema.parse(response.json());
}

describe('POST /api/chatbot', () => {
  it('serves a deterministic answer for the caller’s role and scope, with sources and provenance', async () => {
    const { call } = await setup(SAMPLE_CHUNKS);
    const body = await ask(call);
    expect(body.mode).toBe('deterministic');
    expect(body.coverage).toBe('answered');
    expect(body.provenance).toBe('illustrative');
    expect(body.role).toBe('regional-coo');
    expect(body.scope).toEqual([{ grain: 'region', entityId: 'e0000000-0000-4000-8000-00000000000a' }]);
    expect(body.sources.map((s) => s.chunkId)).toEqual(['k-1', 'k-2']);
    expect(body.sources[0]).toMatchObject({ domain: 'hospital-operations', matchedBy: 'hybrid', asOf: BUILT_AT, cited: false });
    expect(body.answer).toContain('regional coo');
    expect(body.answer).toContain('Hospital operations: Fixture facility A1');
    expect(body.disclosure).toMatch(/illustrative/i);
  });

  it('says nothing was found for this role, and does not claim whether it exists elsewhere', async () => {
    const { call } = await setup([]);
    const body = await ask(call, 'What is the status of unauthorized project X?');
    expect(body.coverage).toBe('no_sources');
    expect(body.sources).toHaveLength(0);
    expect(body.answer).toContain('Nothing available to your role (regional coo)');
    expect(body.answer).not.toMatch(/restricted|forbidden|exists/i);
  });

  it('sends only the words and a vector to search: no entity, role or filter chosen by the client', async () => {
    const { call, searches } = await setup(SAMPLE_CHUNKS);
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', {
      message: 'Show me everything',
      entityId: 'e0000000-0000-4000-8000-00000000000b',
      role: 'chairman',
    });
    // The strict request schema refuses the extra fields outright.
    expect(response.statusCode).toBe(400);
    expect(searches).toHaveLength(0);
    await ask(call, 'Show me everything');
    expect(searches[0]).toEqual({ text: 'Show me everything', embedding: null });
  });

  it('embeds the question when a provider is configured, and searches by words alone when it fails', async () => {
    const calls: string[] = [];
    const { call, searches } = await setup(SAMPLE_CHUNKS, withModel('x [1]', calls));
    await ask(call);
    expect(calls[0]).toMatch(/\/embeddings$/);
    expect(searches[0]?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    await close?.();

    const failing = await setup(SAMPLE_CHUNKS, {
      embedding: { provider, model: 'embed-model', fetchImpl: async () => new Response('down', { status: 503 }) },
    });
    await ask(failing.call);
    expect(failing.searches[0]).toEqual({ text: 'How many staff are late at facility A1?', embedding: null });
  });

  it('writes a model answer from the sources, marks which it cited, and reuses their figures', async () => {
    const { call } = await setup(
      SAMPLE_CHUNKS,
      withModel('Facility A1 has 52 active staff, 40 rostered today and 3 late [1]. Occupancy fell to 71 percent, an act now exception [2].'),
    );
    const body = await ask(call);
    expect(body.mode).toBe('assisted');
    expect(body.answer).toContain('52 active staff');
    expect(body.sources.map((s) => s.cited)).toEqual([true, true]);
  });

  it('refuses a model answer that introduces a number the sources do not contain', async () => {
    const { call } = await setup(SAMPLE_CHUNKS, withModel('Facility A1 has 99 staff late [1].'));
    const body = await ask(call);
    expect(body.mode).toBe('deterministic');
    expect(body.answer).not.toContain('99');
    expect(body.sources.every((s) => !s.cited)).toBe(true);
  });

  it('asks the next model when the first answer fails a check, and keeps the checks for it', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new Request(input).url;
      calls.push(url);
      if (url.endsWith('/embeddings')) return Response.json({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1) }] });
      const answer = url.includes('groq') ? 'Facility A1 has 99 staff late [1].' : 'Facility A1 has 3 late of 40 rostered [1, 2].';
      return Response.json({ choices: [{ message: { content: JSON.stringify({ answer }) } }] });
    }) as typeof fetch;
    const { call } = await setup(SAMPLE_CHUNKS, {
      askNarration: { providers: [groqProvider('g'), provider], timeoutMs: 5000, fetchImpl },
      embedding: { provider, model: 'embed-model', fetchImpl },
    });
    const body = await ask(call);
    expect(calls.some((u) => u.includes('groq'))).toBe(true);
    expect(body.mode).toBe('assisted');
    expect(body.answer).toBe('Facility A1 has 3 late of 40 rostered [1][2].');
    expect(body.answer).not.toContain('99');
    expect(body.sources.map((s) => s.cited)).toEqual([true, true]);
  });

  it('refuses a model answer that cites a source that does not exist', async () => {
    const { call } = await setup(SAMPLE_CHUNKS, withModel('Three staff are late [7].'));
    expect((await ask(call)).mode).toBe('deterministic');
  });

  it('refuses a model answer that cites nothing when it could be from either of several sources', async () => {
    const { call } = await setup(SAMPLE_CHUNKS, withModel('Some staff are late.'));
    expect((await ask(call)).mode).toBe('deterministic');
  });

  it('attributes an uncited answer to the only source, after checking its figures against it', async () => {
    const { call } = await setup([SAMPLE_CHUNKS[0]!], withModel('Facility A1 has 3 late of 40 rostered.'));
    const body = await ask(call);
    expect(body.mode).toBe('assisted');
    expect(body.answer).toBe('Facility A1 has 3 late of 40 rostered. [1]');
    expect(body.sources.map((s) => s.cited)).toEqual([true]);

    await close?.();
    const invented = await setup([SAMPLE_CHUNKS[0]!], withModel('Facility A1 has 9 late.'));
    expect((await ask(invented.call)).mode).toBe('deterministic');
  });

  it('lets an answer repeat the as-of time it was shown (live case: Groq quoting "as of 2026-10-03 08:00 UTC")', async () => {
    const { call } = await setup(SAMPLE_CHUNKS, withModel('As of 2026‑10‑03 08:00 UTC, 3 staff are late at Facility A1 [1].'));
    expect((await ask(call)).mode).toBe('assisted');
    await close?.();
    const otherDate = await setup(SAMPLE_CHUNKS, withModel('As of 2026-10-04 09:30 UTC, 3 staff are late [1].'));
    expect((await ask(otherDate.call)).mode).toBe('deterministic');
  });

  it('serves the deterministic answer when the model is down', async () => {
    const { call } = await setup(SAMPLE_CHUNKS, withModel(null));
    expect((await ask(call)).mode).toBe('deterministic');
  });

  it('answers that search is unavailable rather than inventing content when the knowledge store fails', async () => {
    const { call } = await setup([], {
      knowledge: {
        search: async () => {
          throw new Error('db down');
        },
      },
    });
    const body = await ask(call);
    expect(body.sources).toHaveLength(0);
    expect(body.coverage).toBe('no_sources');
    expect(body.answer).toContain('temporarily unavailable');
  });

  it('rejects questions that are too short', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', { message: 'hi' });
    expect(response.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('invalid_request');
  });

  it('rejects unauthenticated requests', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/chatbot', payload: { message: 'What is the protocol?' } });
    expect(response.statusCode).toBe(401);
  });
});

describe('embeddings', () => {
  it('uses only OpenRouter: Groq has no embeddings endpoint', () => {
    expect(embeddingProvider([groqProvider('g')])).toBeUndefined();
    expect(embeddingProvider([groqProvider('g'), provider])?.name).toBe('openrouter');
  });

  it('returns vectors in input order and refuses a wrong dimension', async () => {
    const vector = (value: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
    const reversed = (async () =>
      Response.json({ data: [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }] })) as typeof fetch;
    const ok = await generateEmbeddings(['a', 'b'], { provider, fetchImpl: reversed });
    expect(ok?.[0]?.[0]).toBe(1);
    expect(ok?.[1]?.[0]).toBe(2);

    const short = (async () => Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] })) as typeof fetch;
    expect(await generateEmbeddings(['a'], { provider, fetchImpl: short })).toBeNull();

    const missing = (async () => Response.json({ data: [{ index: 0, embedding: vector(1) }] })) as typeof fetch;
    expect(await generateEmbeddings(['a', 'b'], { provider, fetchImpl: missing })).toBeNull();
  });

  it('returns null instead of throwing when the provider is down', async () => {
    const down = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    expect(await generateEmbeddings(['a'], { provider, fetchImpl: down })).toBeNull();
  });
});
