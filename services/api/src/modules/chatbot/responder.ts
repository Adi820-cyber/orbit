import { z } from 'zod';
import { ChatbotResponseSchema, type ChatbotResponse, type MembershipClaims } from '@orbit/contracts';
import type { KnowledgeChunk, ModuleDeps } from '../ports.ts';
import { completeJson, introducedNumbers, type DeclineReason, type JsonTask } from '../ask/narrator.ts';

/*
 * Chatbot responder (ADR 0019).
 *
 * Retrieval has already happened, and the database has already decided what this
 * caller may read, so everything that reaches here is inside their role and
 * scope. This module only writes the answer from those chunks.
 *
 *  - A deterministic answer is always built first. It is what is served when no
 *    model is configured, or when the model's answer is refused.
 *  - A model, when configured, answers the question from the numbered sources.
 *    It is refused (and the deterministic answer served) if it cites a source
 *    that does not exist, or writes a number that is in none of the sources
 *    (ADR 0014 §1). It cannot add sources: the list returned is the retrieved
 *    one, with `cited` marking the ones the answer used.
 */

const MAX_CHUNK_CHARS = 1200;

export const CHATBOT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: 'The answer, using only the sources. Cite sources as [n]. Reuse figures exactly.',
    },
  },
  required: ['answer'],
  additionalProperties: false,
} as const;

const ChatbotModelAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(2500) });

function roleName(role: string): string {
  return role.replaceAll('-', ' ');
}

function systemPrompt(role: string): string {
  return [
    `You answer one question for a leader of a healthcare group whose role is "${roleName(role)}", using ONLY the numbered sources you are given.`,
    'Rules you must follow exactly:',
    '1. Use only facts stated in the sources. If they do not answer the question, say plainly that the knowledge available to this role does not cover it. Never guess.',
    '2. Reuse every figure exactly as written. Do not round, convert, calculate, or introduce any number.',
    '3. After each statement, cite the source it came from as [n]. Cite only numbers that appear in the source list.',
    '4. Say which hospital, region or the group each figure belongs to.',
    '5. Keep any caveat a source states: illustrative or simulated data, late or stale data, unreconciled data, no approved target.',
    '6. Where sources mark an exception "act now" or "monitor", mention act now first. Do not recommend actions the sources do not state.',
    '7. Be brief: at most six short sentences or bullets, plain text, no markdown headings.',
  ].join('\n');
}

function sourceText(chunk: KnowledgeChunk): string {
  const content = chunk.content.length > MAX_CHUNK_CHARS ? `${chunk.content.slice(0, MAX_CHUNK_CHARS)}…` : chunk.content;
  return `${chunk.title} (${chunk.domain}, as of ${chunk.updatedAt.slice(0, 16).replace('T', ' ')} UTC): ${content}`;
}

/** The text whose numbers a model answer may reuse. Source indices are not part of it. */
function figuresText(chunks: readonly KnowledgeChunk[], question: string): string {
  return [question, ...chunks.map((chunk) => `${chunk.title} ${chunk.content}`)].join('\n');
}

/** Answer built without a model: the retrieved sources, in order, with their text. */
function deterministicAnswer(role: string, chunks: readonly KnowledgeChunk[]): string {
  const lines = chunks.map((chunk) => `• ${chunk.title}: ${chunk.content.slice(0, 260)}${chunk.content.length > 260 ? '…' : ''}`);
  return `For your role (${roleName(role)}), ${chunks.length} relevant source${chunks.length === 1 ? ' was' : 's were'} found in your scope:\n\n${lines.join('\n')}`;
}

function noSourcesAnswer(role: string): string {
  return `Nothing available to your role (${roleName(role)}) and scope matches this question. It may fall outside what your role covers, or it may not have been recorded yet.`;
}

/** `[n]` markers in an answer. A marker outside 1..count is an invented citation. */
function citedIndices(answer: string, count: number): { valid: Set<number>; invented: boolean } {
  const valid = new Set<number>();
  let invented = false;
  for (const match of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= count) valid.add(index);
    else invented = true;
  }
  return { valid, invented };
}

export type ChatbotNarration =
  | { status: 'narrated'; provider: string }
  | { status: 'declined'; reason: DeclineReason | 'invented_citation' | 'no_citation'; detail?: string };

export interface ChatbotAnswerResult {
  response: ChatbotResponse;
  narration: ChatbotNarration | null;
}

/**
 * Produces the chatbot response from retrieved chunks. Tries a grounded model
 * answer; falls back to the deterministic one.
 */
export async function buildChatbotResponse(
  deps: ModuleDeps,
  membership: MembershipClaims,
  question: string,
  chunks: readonly KnowledgeChunk[],
): Promise<ChatbotAnswerResult> {
  const base = {
    role: membership.role,
    scope: membership.scopes,
    provenance: 'illustrative' as const,
    disclosure: deps.disclosure,
  };
  const sourcesFor = (cited: ReadonlySet<number>) =>
    chunks.map((chunk, index) => ({
      chunkId: chunk.id,
      title: chunk.title,
      similarity: Math.round(chunk.similarity * 1000) / 1000,
      domain: chunk.domain,
      matchedBy: chunk.matchedBy,
      asOf: chunk.updatedAt,
      cited: cited.has(index + 1),
    }));

  if (chunks.length === 0) {
    return {
      response: ChatbotResponseSchema.parse({
        answer: noSourcesAnswer(membership.role),
        mode: 'deterministic',
        sources: [],
        coverage: 'no_sources',
        ...base,
      }),
      narration: null,
    };
  }

  const fallback = ChatbotResponseSchema.parse({
    answer: deterministicAnswer(membership.role, chunks),
    mode: 'deterministic',
    sources: sourcesFor(new Set()),
    coverage: 'answered',
    ...base,
  });
  if (deps.askNarration.providers.length === 0) return { response: fallback, narration: null };

  const task: JsonTask<z.infer<typeof ChatbotModelAnswerSchema>> = {
    system: systemPrompt(membership.role),
    user: [
      `Question: ${question}`,
      '',
      'Sources:',
      ...chunks.map((chunk, index) => `[${index + 1}] ${sourceText(chunk)}`),
    ].join('\n'),
    schemaName: 'orbit_chatbot_answer',
    jsonSchema: CHATBOT_JSON_SCHEMA,
    parse: ChatbotModelAnswerSchema,
    temperature: 0.1,
  };
  const outcome = await completeJson(task, {
    providers: deps.askNarration.providers,
    timeoutMs: Math.max(deps.askNarration.timeoutMs, 12_000),
    ...(deps.askNarration.fetchImpl ? { fetchImpl: deps.askNarration.fetchImpl } : {}),
  });
  if (outcome.status === 'declined') {
    return { response: fallback, narration: { status: 'declined', reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) } };
  }

  const answer = outcome.value.answer;
  const { valid, invented } = citedIndices(answer, chunks.length);
  if (invented) {
    return { response: fallback, narration: { status: 'declined', reason: 'invented_citation' } };
  }
  // The citation markers are not figures; everything else must come from the sources or the question.
  const introduced = introducedNumbers(answer.replaceAll(/\[\d{1,3}\]/g, ''), figuresText(chunks, question));
  if (introduced.length > 0) {
    return {
      response: fallback,
      narration: { status: 'declined', reason: 'introduced_numbers', detail: `${outcome.provider} introduced ${introduced.join(', ')}` },
    };
  }
  // An answer drawn from sources must say where from.
  if (valid.size === 0) {
    return { response: fallback, narration: { status: 'declined', reason: 'no_citation' } };
  }

  return {
    response: ChatbotResponseSchema.parse({
      answer,
      mode: 'assisted',
      sources: sourcesFor(valid),
      coverage: 'answered',
      ...base,
    }),
    narration: { status: 'narrated', provider: outcome.provider },
  };
}
