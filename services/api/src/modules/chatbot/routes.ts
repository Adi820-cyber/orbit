import type { FastifyInstance } from 'fastify';
import { ChatbotRequestSchema, ChatbotResponseSchema, EntityDirectoryEntrySchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, parseInput, parseRows } from '../shared.ts';
import { generateEmbedding } from './embedder.ts';
import { focus } from './focus.ts';
import { placesOutsideScope } from './places.ts';
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
 * Before any of that, a question that names a place outside the caller's
 * scope ("the south region" asked by the North COO) gets an explicit
 * out_of_scope answer and nothing is searched (see places.ts): search would
 * otherwise answer with similar-looking data from inside the scope.
 *
 * If search fails the answer says so; it is never invented.
 */

export function registerChatbotRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.post('/chatbot', async (request) => {
    const membership = membershipOf(request);
    const { message } = parseInput(ChatbotRequestSchema, request.body);

    const visible = parseRows(EntityDirectoryEntrySchema, await deps.entities.visible(membership), 'entity_row_failed_contract');
    const outside = placesOutsideScope(message, visible.map((entry) => entry.label));
    if (outside.length > 0) {
      await auditRead(deps, request, membership, {
        kind: 'ask_answered',
        target: { type: 'ask', id: 'chatbot' },
        outcome: 'out_of_scope',
      });
      const inScope = visible.filter((entry) => membership.scopes.some((scope) => scope.entityId === entry.entityId)).map((entry) => entry.label);
      return ChatbotResponseSchema.parse({
        answer:
          `Your question names ${outside.map((word) => `"${word}"`).join(', ')}, which is outside your scope. ` +
          `Your scope covers ${inScope.length > 0 ? inScope.join(', ') : 'only what your membership grants'}. ` +
          'Nothing outside your scope was searched, and no narrower answer is given in its place.',
        mode: 'deterministic',
        sources: [],
        coverage: 'out_of_scope',
        role: membership.role,
        scope: membership.scopes,
        provenance: 'illustrative',
        disclosure: deps.disclosure,
      });
    }

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
