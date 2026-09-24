import type { FastifyInstance } from 'fastify';
import { AskPromptsResponseSchema, AskRequestSchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { entitlementsFor } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, loadDataset } from '../shared.ts';
import { answer, emptyAnswer, narrateAnswer } from './catalogue.ts';
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
      // Assisted whenever a narration provider is configured (ADR 0014 §5), so the UI never
      // tells users no model is involved when one may reword answers.
      mode: deps.askNarration.providers.length > 0 ? 'assisted' : 'deterministic',
      prompts: guidedPrompts(membership, entitlements, dataset.currentPeriod),
      disclosure: deps.disclosure,
    });
  });

  api.post('/ask', async (request) => {
    const membership = membershipOf(request);
    const parsed = AskRequestSchema.safeParse(request.body);

    const deterministic = parsed.success
      ? await answer(deps, membership, parsed.data)
      : emptyAnswer(
          'clarification_needed',
          'Choose one of the guided questions, or supply every detail the question needs.',
          { membership, period: null, disclosure: deps.disclosure },
        );

    // Narration never fails the request: a declined rewording serves the
    // deterministic answer. Only the outcome is logged, never the text.
    const { response, narration } = await narrateAnswer(deps, deterministic);
    if (narration) {
      request.log.info(
        narration.status === 'narrated'
          ? { narration: 'narrated', provider: narration.provider }
          : { narration: 'declined', reason: narration.reason, detail: narration.detail },
        'ask narration',
      );
    }

    await auditRead(deps, request, membership, {
      kind: 'ask_answered',
      target: { type: 'ask', id: parsed.success ? parsed.data.intent : 'unrecognized' },
      outcome: response.outcome,
    });
    return response;
  });
}
