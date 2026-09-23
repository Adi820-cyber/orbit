import type { FastifyInstance } from 'fastify';
import { AskPromptsResponseSchema, AskRequestSchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { entitlementsFor } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, loadDataset } from '../shared.ts';
import { answer, emptyAnswer } from './catalogue.ts';
import { guidedPrompts } from './prompts.ts';

/**
 * Governed Ask (PRD FR-05, ADR 0005 §2). A member always gets HTTP 200 with a
 * typed outcome; scope refusals are answers, not errors. The raw request is
 * never logged or audited — only the intent and the outcome.
 */
export function registerAskRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/ask/prompts', async (request) => {
    const membership = membershipOf(request);
    const [dataset, entitlements] = await Promise.all([
      loadDataset(deps, membership),
      entitlementsFor(membership, deps.scope),
    ]);
    return AskPromptsResponseSchema.parse({
      mode: 'deterministic',
      prompts: guidedPrompts(membership, entitlements, dataset.currentPeriod),
      disclosure: deps.disclosure,
    });
  });

  api.post('/ask', async (request) => {
    const membership = membershipOf(request);
    const parsed = AskRequestSchema.safeParse(request.body);

    const response = parsed.success
      ? await answer(deps, membership, parsed.data)
      : emptyAnswer(
          'clarification_needed',
          'Choose one of the guided questions, or supply every detail the question needs.',
          { membership, period: null, disclosure: deps.disclosure },
        );

    await auditRead(deps, request, membership, {
      kind: 'ask_answered',
      target: { type: 'ask', id: parsed.success ? parsed.data.intent : 'unrecognized' },
      outcome: response.outcome,
    });
    return response;
  });
}
