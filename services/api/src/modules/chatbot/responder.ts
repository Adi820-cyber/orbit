import { ChatbotResponseSchema, type ChatbotResponse, type MembershipClaims } from '@orbit/contracts';
import type { KnowledgeChunk, ModuleDeps } from '../ports.ts';
import { narrate, type NarrationOutcome } from '../ask/narrator.ts';

/*
 * Chatbot responder: builds a deterministic answer from retrieved knowledge
 * chunks, then optionally narrates it through the same model pipeline as Ask
 * (ADR 0014). The model may only reword the prose; it cannot change the
 * sources, and any narration that introduces a number absent from the source
 * text is discarded.
 */

/**
 * Builds a deterministic context summary from retrieved chunks.
 * This is the "source text" for the numeric token guard.
 */
function buildContextText(chunks: readonly KnowledgeChunk[]): string {
  if (chunks.length === 0) return '';
  return chunks.map((chunk, index) => `[${index + 1}] ${chunk.title}: ${chunk.content}`).join('\n\n');
}

/**
 * Builds the deterministic answer when no model is available or narration
 * is declined. Summarises the retrieved chunks as a bulleted list.
 */
function deterministicAnswer(chunks: readonly KnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return 'No relevant information was found in the knowledge base for your question within your authorized scope.';
  }
  const lines = chunks.map((chunk) => `• ${chunk.title}: ${chunk.content.slice(0, 200)}${chunk.content.length > 200 ? '…' : ''}`);
  return `Based on ${chunks.length} relevant source${chunks.length === 1 ? '' : 's'} in your scope:\n\n${lines.join('\n')}`;
}

export interface ChatbotAnswerResult {
  response: ChatbotResponse;
  narration: NarrationOutcome | null;
}

/**
 * Produces a chatbot response from retrieved chunks. Tries model narration
 * first; falls back to the deterministic summary. The numeric token guard
 * from ADR 0014 §1 is applied to the model output.
 */
export async function buildChatbotResponse(
  deps: ModuleDeps,
  membership: MembershipClaims,
  _question: string,
  chunks: readonly KnowledgeChunk[],
): Promise<ChatbotAnswerResult> {
  const contextText = buildContextText(chunks);
  const sources = chunks.map((chunk) => ({
    chunkId: chunk.id,
    title: chunk.title,
    similarity: Math.round(chunk.similarity * 1000) / 1000,
  }));

  const base = {
    sources,
    role: membership.role,
    provenance: 'illustrative' as const,
    disclosure: deps.disclosure,
  };

  const defaultAnswer = deterministicAnswer(chunks);

  // If no model is configured, serve the deterministic answer.
  if (deps.askNarration.providers.length === 0 || chunks.length === 0) {
    return {
      response: ChatbotResponseSchema.parse({
        answer: defaultAnswer,
        mode: 'deterministic',
        ...base,
      }),
      narration: null,
    };
  }

  // Try model-assisted answer via the existing narrator pipeline.
  const narration = await narrate(
    defaultAnswer,
    {
      providers: deps.askNarration.providers,
      timeoutMs: deps.askNarration.timeoutMs,
      ...(deps.askNarration.fetchImpl ? { fetchImpl: deps.askNarration.fetchImpl } : {}),
    },
    // The source text for the numeric token guard includes all chunk content.
    `${contextText} | ${defaultAnswer}`,
  );

  if (narration.status === 'narrated') {
    return {
      response: ChatbotResponseSchema.parse({
        answer: narration.answer,
        mode: 'assisted',
        ...base,
      }),
      narration,
    };
  }

  // Narration declined — serve the deterministic answer.
  return {
    response: ChatbotResponseSchema.parse({
      answer: defaultAnswer,
      mode: 'deterministic',
      ...base,
    }),
    narration,
  };
}
