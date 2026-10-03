import { describe, expect, it } from 'vitest';
import {
  ChatbotRequestSchema,
  ChatbotResponseSchema,
  ChatbotSourceSchema,
} from './chatbot.ts';

describe('ChatbotRequestSchema', () => {
  it('accepts valid questions', () => {
    const valid = { message: 'What is the average occupancy in Facility A1?' };
    expect(ChatbotRequestSchema.parse(valid)).toEqual(valid);
  });

  it('rejects questions that are too short', () => {
    expect(ChatbotRequestSchema.safeParse({ message: 'hi' }).success).toBe(false);
  });

  it('rejects extra unrecognized fields', () => {
    expect(
      ChatbotRequestSchema.safeParse({
        message: 'What is the target?',
        injectedRole: 'chairman',
      }).success,
    ).toBe(false);
  });
});

describe('ChatbotResponseSchema', () => {
  const validResponse = {
    answer: 'Facility A1 bed capacity target is maintained at 85%.',
    mode: 'deterministic' as const,
    sources: [
      {
        chunkId: 'k-1',
        title: 'Bed Capacity SOP',
        similarity: 0.94,
        domain: 'kpi-definitions',
        matchedBy: 'hybrid' as const,
        asOf: '2026-10-03T08:00:00.000Z',
        cited: true,
      },
    ],
    coverage: 'answered' as const,
    role: 'regional-coo' as const,
    scope: [{ grain: 'region' as const, entityId: 'e0000000-0000-4000-8000-00000000000a' }],
    provenance: 'illustrative' as const,
    disclosure: 'Illustrative data for test purposes only.',
  };

  it('parses valid responses', () => {
    expect(ChatbotResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('rejects responses missing required provenance', () => {
    const withoutProvenance = { ...validResponse, provenance: 'production' };
    expect(ChatbotResponseSchema.safeParse(withoutProvenance).success).toBe(false);
  });

  it('rejects a source that does not say how it matched or when it was built', () => {
    const [source] = validResponse.sources;
    const { asOf: _asOf, ...withoutAsOf } = source!;
    expect(ChatbotResponseSchema.safeParse({ ...validResponse, sources: [withoutAsOf] }).success).toBe(false);
    expect(ChatbotResponseSchema.safeParse({ ...validResponse, sources: [{ ...source, matchedBy: 'guess' }] }).success).toBe(false);
  });

  it('rejects an unknown coverage', () => {
    expect(ChatbotResponseSchema.safeParse({ ...validResponse, coverage: 'partial' }).success).toBe(false);
  });

  it('rejects an invalid role in response', () => {
    const invalidRole = { ...validResponse, role: 'super-admin' };
    expect(ChatbotResponseSchema.safeParse(invalidRole).success).toBe(false);
  });
});

describe('ChatbotSourceSchema', () => {
  it('validates a source with its domain, match and build time', () => {
    const source = { chunkId: 'c-1', title: 'Doc', similarity: 0.85, domain: 'kpi', matchedBy: 'text', asOf: '2026-10-03T08:00:00.000Z', cited: false };
    expect(ChatbotSourceSchema.parse(source)).toEqual(source);
  });
});
