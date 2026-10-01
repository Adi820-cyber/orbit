import { afterEach, describe, expect, it } from 'vitest';
import { ChatbotResponseSchema, ErrorEnvelopeSchema } from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp } from '../../../test/helpers/modules.ts';
import type { KnowledgeChunk } from '../ports.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup(chunks: KnowledgeChunk[] = []) {
  const built = await buildModuleApp({
    knowledge: {
      search: async () => chunks,
    },
  });
  close = () => built.app.close();
  return built;
}

const SAMPLE_CHUNKS: KnowledgeChunk[] = [
  {
    id: 'k-1',
    title: 'Regional Bed Capacity Target',
    content: 'Facility A1 bed capacity target is maintained at 85% occupancy with 240 beds operational.',
    source: 'capacity_sop',
    similarity: 0.92,
  },
  {
    id: 'k-2',
    title: 'Discharge Protocol',
    content: 'Standard discharge time is 11:00 AM across all region facilities.',
    source: 'clinical_protocol',
    similarity: 0.81,
  },
];

describe('POST /api/chatbot', () => {
  it('returns a deterministic answer with role-scoped sources and illustrative provenance', async () => {
    const { call } = await setup(SAMPLE_CHUNKS);
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', {
      message: 'What is the bed capacity target for facility A1?',
    });

    expect(response.statusCode).toBe(200);
    const body = ChatbotResponseSchema.parse(response.json());
    expect(body.mode).toBe('deterministic');
    expect(body.provenance).toBe('illustrative');
    expect(body.role).toBe('regional-coo');
    expect(body.sources).toHaveLength(2);
    expect(body.sources[0]?.chunkId).toBe('k-1');
    expect(body.sources[0]?.title).toBe('Regional Bed Capacity Target');
    expect(body.answer).toContain('Regional Bed Capacity Target');
    expect(body.disclosure).toMatch(/illustrative/i);
  });

  it('rejects questions that are too short', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', {
      message: 'hi',
    });

    expect(response.statusCode).toBe(400);
    const body = ErrorEnvelopeSchema.parse(response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects unauthenticated requests', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/chatbot',
      payload: { message: 'What is the protocol?' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('handles empty retrieval gracefully with a deterministic notice', async () => {
    const { call } = await setup([]);
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/chatbot', {
      message: 'What is the status of unauthorized project X?',
    });

    expect(response.statusCode).toBe(200);
    const body = ChatbotResponseSchema.parse(response.json());
    expect(body.mode).toBe('deterministic');
    expect(body.sources).toHaveLength(0);
    expect(body.answer).toContain('No relevant information was found');
  });
});
