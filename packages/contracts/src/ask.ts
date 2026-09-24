import { z } from 'zod';
import { DisclosureSchema, EvidenceRefSchema, ObservationSchema, PeriodSchema } from './common.ts';
import { ExceptionSchema } from './exceptions.ts';
import { GrainSchema, ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/*
 * Governed Ask payloads (PRD FR-05, ARCH §9, ADR 0005 §2). DRAFT for Gate 1.
 *
 * v1 is a deterministic, typed catalogue: the request names an intent and its
 * parameters. There is no free-text field and no path to arbitrary SQL. A
 * future model adapter would map text onto these same intents.
 */

const WithAssignment = { assignmentId: z.string().min(1) };
const WithTarget = { ...WithAssignment, target: ScopeEntitySchema, period: PeriodSchema };

/** The five v1 question classes (PRD FR-05). */
export const AskRequestSchema = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('explain_definition'), ...WithAssignment }),
  z.strictObject({ intent: z.literal('report_performance'), ...WithTarget }),
  z.strictObject({ intent: z.literal('compare_periods'), ...WithTarget, comparePeriod: PeriodSchema }),
  z.strictObject({ intent: z.literal('explain_contributors'), ...WithTarget, breakdown: GrainSchema }),
  z.strictObject({ intent: z.literal('summarize_exceptions') }),
]);
export type AskRequest = z.infer<typeof AskRequestSchema>;
export type AskIntent = AskRequest['intent'];

/**
 * How an answer's wording was produced (PRD FR-05, ADR 0014 §5).
 * - `deterministic`: every word comes from the typed catalogue templates.
 * - `assisted`: every number, record, citation and disclosure is still
 *   deterministic; only the answer's prose was reworded by a model, and the
 *   rewording was rejected if it introduced any number. The UI must show it.
 */
export const AskModeSchema = z.enum(['deterministic', 'assisted']);
export type AskMode = z.infer<typeof AskModeSchema>;

/** Non-answers are fixed templates and are never narrated. */
const DeterministicModeSchema = z.literal('deterministic');

/** A guided prompt: a label derived from framework data plus the exact request it sends. */
export const GuidedPromptSchema = z.strictObject({
  promptId: z.string().min(1),
  label: z.string().min(1),
  request: AskRequestSchema,
});
export type GuidedPrompt = z.infer<typeof GuidedPromptSchema>;

/** `GET /api/ask/prompts` */
export const AskPromptsResponseSchema = z.strictObject({
  mode: AskModeSchema,
  prompts: z.array(GuidedPromptSchema),
  disclosure: DisclosureSchema,
});
export type AskPromptsResponse = z.infer<typeof AskPromptsResponseSchema>;

/**
 * "Policy basis" is only an approved KPI definition, target basis, governance
 * rule, or entitlement rule available to Orbit — never an external citation.
 */
export const PolicyBasisSchema = z.strictObject({
  kind: z.enum(['kpi_definition', 'target_basis', 'governance_rule', 'entitlement_rule']),
  reference: z.string().min(1),
  text: z.string().min(1),
});
export type PolicyBasis = z.infer<typeof PolicyBasisSchema>;

/** Suggested follow-up. Ask never executes an action; the user records it. */
export const NextActionSchema = z.strictObject({
  kind: z.literal('record_action'),
  assignmentId: z.string().min(1),
  entity: ScopeEntitySchema,
  evidence: EvidenceRefSchema,
});

const CardScopeSchema = z.strictObject({
  role: RoleIdSchema,
  entities: z.array(ScopeEntitySchema).min(1),
});

/** The Evidence Card sections, in PRD FR-05 order. */
const cardFields = {
  answer: z.string().min(1),
  definitionBasis: z.array(PolicyBasisSchema),
  reasoning: z.array(z.string().min(1)),
  scope: CardScopeSchema,
  period: PeriodSchema.nullable(),
  limitations: z.array(z.string().min(1)),
};

const AnsweredCardSchema = z.strictObject({
  ...cardFields,
  relevantRecords: z.strictObject({
    observations: z.array(ObservationSchema),
    exceptions: z.array(ExceptionSchema),
  }),
  nextAction: NextActionSchema.nullable(),
});

/**
 * Every non-answer carries no records and no next action, so a refusal cannot
 * leak entitlement-protected values (ADR 0005 §2).
 */
const EmptyCardSchema = z.strictObject({
  ...cardFields,
  relevantRecords: z.strictObject({
    observations: z.array(ObservationSchema).max(0),
    exceptions: z.array(ExceptionSchema).max(0),
  }),
  nextAction: z.null(),
});

/**
 * `POST /api/ask` — always HTTP 200 for a member; a scope refusal is an answer
 * with outcome `out_of_scope`, not an HTTP error (ADR 0005 §2).
 */
export const AskResponseSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('answered'), mode: AskModeSchema, card: AnsweredCardSchema, disclosure: DisclosureSchema }),
  z.strictObject({ outcome: z.literal('clarification_needed'), mode: DeterministicModeSchema, card: EmptyCardSchema, disclosure: DisclosureSchema }),
  z.strictObject({ outcome: z.literal('no_data'), mode: DeterministicModeSchema, card: EmptyCardSchema, disclosure: DisclosureSchema }),
  z.strictObject({ outcome: z.literal('out_of_scope'), mode: DeterministicModeSchema, card: EmptyCardSchema, disclosure: DisclosureSchema }),
  z.strictObject({ outcome: z.literal('unavailable'), mode: DeterministicModeSchema, card: EmptyCardSchema, disclosure: DisclosureSchema }),
]);
export type AskResponse = z.infer<typeof AskResponseSchema>;
export type AskOutcome = AskResponse['outcome'];

/**
 * `POST /api/ask/question` — a question in the user's own words (ARCH §9's
 * model adapter). The server asks the configured model to map the question to
 * one of the typed intents above, choosing only among the caller's own
 * authorized KPIs, entities and periods; it then re-authorizes and answers
 * through the same deterministic pipeline. No model ever sees a figure or
 * produces SQL. `/api/ask` stays strictly typed.
 */
export const AskQuestionRequestSchema = z.strictObject({
  question: z.string().trim().min(3).max(500),
});
export type AskQuestionRequest = z.infer<typeof AskQuestionRequestSchema>;

export const AskQuestionResponseSchema = z.strictObject({
  /** How Orbit understood the question, shown to the user; null when it could not be mapped. */
  interpretedAs: z
    .strictObject({
      request: AskRequestSchema,
      label: z.string().min(1),
    })
    .nullable(),
  response: AskResponseSchema,
});
export type AskQuestionResponse = z.infer<typeof AskQuestionResponseSchema>;
