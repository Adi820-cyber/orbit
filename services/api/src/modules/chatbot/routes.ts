import type { FastifyInstance } from 'fastify';
import { ChatbotRequestSchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput } from '../shared.ts';
import { generateEmbedding } from './embedder.ts';
import { focus } from './focus.ts';
import { buildChatbotResponse } from './responder.ts';

/*
 * Knowledge chatbot (POST /api/chatbot, ADR 0019).
 *
 * 1. The auth hook verifies the token and loads the membership, as for every route.
 * 2. The question is embedded when a provider is configured. If not (or if the
 *    provider fails), search still runs on the question's words.
 * 3. orbit.search_knowledge() runs under the caller's verified claims. Row-level
 *    security decides what it can see: their organization, a scope that covers
 *    the chunk's entity, and a role or domain grant. The route sends no entity,
 *    role or filter of its own, so a client cannot widen the search.
 * 4. The answer is written from what came back (see responder.ts): a grounded
 *    model answer with citations, or a deterministic one.
 *
 * If search fails the answer says so; it is never invented.
 */

export function registerChatbotRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.post('/chatbot', async (request) => {
    const membership = membershipOf(request);
    const { message } = parseInput(ChatbotRequestSchema, request.body);

    const { provider, model, fetchImpl } = deps.embedding;
    const embedding = provider
      ? await generateEmbedding(message, { provider, model, ...(fetchImpl ? { fetchImpl } : {}) })
      : null;

    let chunks;
    try {
      // Twelve candidates, so near-identical per-hospital copies cannot crowd out
      // the group summary or another topic; at most six are used after focusing.
      chunks = focus(await deps.knowledge.search(membership, { text: message, embedding }, { limit: 12 }), message).slice(0, 6);
    } catch (error) {
      request.log.error({ err: error }, 'chatbot knowledge search failed');
      return {
        answer: 'Knowledge search is temporarily unavailable. Please try again later.',
        mode: 'deterministic',
        sources: [],
        coverage: 'no_sources',
        role: membership.role,
        scope: membership.scopes,
        provenance: 'illustrative',
        disclosure: deps.disclosure,
      };
    }

    const { response, narration } = await buildChatbotResponse(deps, membership, message, chunks);
    request.log.info(
      {
        retrieval: embedding ? 'vector+text' : 'text',
        sources: chunks.length,
        narration: narration?.status ?? 'none',
        ...(narration?.status === 'declined' ? { reason: narration.reason, detail: narration.detail } : {}),
      },
      'chatbot answer',
    );

    await auditRead(deps, request, membership, {
      kind: 'ask_answered',
      target: { type: 'ask', id: 'chatbot' },
      outcome: chunks.length > 0 ? 'answered' : 'no_data',
    });

    return response;
  });
}
