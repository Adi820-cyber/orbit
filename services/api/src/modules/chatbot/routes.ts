import type { FastifyInstance } from 'fastify';
import { ChatbotRequestSchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput } from '../shared.ts';
import { generateEmbedding } from './embedder.ts';
import { buildChatbotResponse } from './responder.ts';

/*
 * RAG chatbot route (POST /api/chatbot).
 *
 * Authorization flow:
 * 1. Auth hook verifies the token and loads the membership (same as every route).
 * 2. The user's message is embedded via the configured model provider.
 * 3. The embedding is used to search `orbit.knowledge_chunks` under RLS,
 *    which filters by organization and role. Entity-scope is taken from the
 *    caller's primary scope entity.
 * 4. Retrieved chunks are assembled into a context card and narrated.
 * 5. The numeric token guard (ADR 0014 §1) rejects any narration that
 *    introduces a number not present in the source chunks.
 *
 * If embedding or retrieval fails, the response is an explicit "unavailable"
 * rather than a fabricated answer.
 */

export function registerChatbotRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.post('/chatbot', async (request) => {
    const membership = membershipOf(request);
    const { message } = parseInput(ChatbotRequestSchema, request.body);

    // Use the first configured provider for embeddings when available.
    const provider = deps.askNarration.providers[0];
    let embedding: number[] | null = null;
    if (provider) {
      embedding = await generateEmbedding(message, {
        provider,
        ...(deps.askNarration.fetchImpl ? { fetchImpl: deps.askNarration.fetchImpl } : {}),
      });
    }

    // When no provider is configured (e.g. local preview or tests without keys),
    // fall back to a zero vector so role-scoped knowledge search still functions.
    const queryEmbedding = embedding ?? new Array(1536).fill(0);

    // Search knowledge chunks scoped to the caller's org, role (via RLS),
    // and primary entity scope.
    const primaryScope = membership.scopes[0];
    let chunks;
    try {
      chunks = await deps.knowledge.search(membership, queryEmbedding, {
        entityGrain: primaryScope?.grain,
        entityId: primaryScope?.entityId,
      });
    } catch (error) {
      request.log.error({ err: error }, 'chatbot knowledge search failed');
      return {
        answer: 'Knowledge search is temporarily unavailable. Please try again later.',
        mode: 'deterministic',
        sources: [],
        role: membership.role,
        provenance: 'illustrative',
        disclosure: deps.disclosure,
      };
    }

    // Build the response: deterministic card + optional narration.
    const { response, narration } = await buildChatbotResponse(deps, membership, message, chunks);
    if (narration) {
      request.log.info(
        narration.status === 'narrated'
          ? { narration: 'narrated', provider: narration.provider }
          : { narration: 'declined', reason: narration.reason, detail: narration.detail },
        'chatbot narration',
      );
    }

    // Audit the interaction (read-side, not blocking the response).
    await auditRead(deps, request, membership, {
      kind: 'ask_answered',
      target: { type: 'ask', id: 'chatbot' },
      outcome: chunks.length > 0 ? 'answered' : 'no_data',
    });

    return response;
  });
}
