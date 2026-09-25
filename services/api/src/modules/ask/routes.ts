import type { FastifyInstance } from 'fastify';
import { AskPromptsResponseSchema, AskQuestionRequestSchema, AskQuestionResponseSchema, AskRequestSchema } from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { entitlementsFor } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import { auditRead, loadDataset, parseInput } from '../shared.ts';
import { answer, emptyAnswer, narrateAnswer } from './catalogue.ts';
import { interpret } from './interpreter.ts';
import { guidedPrompts } from './prompts.ts';

/**
 * Governed Ask (PRD FR-05, ADR 0005 §2). A member always gets HTTP 200 with a
 * typed outcome; scope refusals are answers, not errors. The raw request is
 * never logged or audited — only the intent and the outcome.
 */

/** Total time a plain-language question may take before rewording is skipped. */
const QUESTION_BUDGET_MS = 6000;
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

  /**
   * A question in the user's own words. The model only chooses a typed
   * request from the caller's own menu (interpreter.ts); the answer comes from
   * the same catalogue and authorization as a guided prompt. The question text
   * is never logged or audited.
   */
  api.post('/ask/question', async (request) => {
    const membership = membershipOf(request);
    const { question } = parseInput(AskQuestionRequestSchema, request.body);
    const context = { membership, period: null, disclosure: deps.disclosure };

    const started = Date.now();
    const interpretation = await interpret(deps, membership, question);
    request.log.info(
      interpretation.status === 'interpreted'
        ? { interpretation: 'interpreted', intent: interpretation.request.intent }
        : interpretation.status === 'unavailable'
          ? { interpretation: 'unavailable', reason: interpretation.reason, detail: interpretation.detail }
          : { interpretation: 'unclear' },
      'ask question',
    );

    let response;
    if (interpretation.status === 'interpreted') {
      const answered = await answer(deps, membership, interpretation.request);
      // PRD §9 target: an assisted answer within about six seconds overall.
      const narrated = await narrateAnswer(deps, answered, QUESTION_BUDGET_MS - (Date.now() - started));
      response = narrated.response;
    } else if (interpretation.status === 'unavailable') {
      response = emptyAnswer(
        'unavailable',
        interpretation.reason === 'not_configured'
          ? 'Questions in your own words need the AI assistant, which is not configured. Choose a guided question instead.'
          : 'The AI assistant could not read that question just now. Try again, or choose a guided question.',
        context,
      );
    } else {
      response = emptyAnswer('clarification_needed', interpretation.message, context);
    }

    await auditRead(deps, request, membership, {
      kind: 'ask_answered',
      target: { type: 'ask', id: interpretation.status === 'interpreted' ? `question:${interpretation.request.intent}` : 'question:unmapped' },
      outcome: response.outcome,
    });
    return AskQuestionResponseSchema.parse({
      interpretedAs:
        interpretation.status === 'interpreted' ? { request: interpretation.request, label: interpretation.label } : null,
      response,
    });
  });
}
