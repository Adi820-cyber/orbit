import { z } from 'zod';
import { EvidenceRefSchema } from './common.ts';
import { ActionStateSchema } from './exceptions.ts';
import { ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

/*
 * Internal actions and audit (PRD FR-06, FR-07; ARCH §10). DRAFT for Gate 1.
 *
 * The allowed state transitions and who may assign to whom are Aditya's open
 * decision (ARCH §17.3). These schemas carry the states and the concurrency
 * fields only; they do not encode a transition matrix.
 */

/**
 * An assignee the caller may choose. `assigneeId` is an opaque server-issued
 * id; the frontend never sees or sends a membership id or subject.
 */
export const PermittedAssigneeSchema = z.strictObject({
  assigneeId: z.string().min(1),
  role: RoleIdSchema,
  scopes: z.array(ScopeEntitySchema).min(1),
});
export type PermittedAssignee = z.infer<typeof PermittedAssigneeSchema>;

/** `GET /api/actions/assignees?assignmentId=&grain=&entityId=` */
export const PermittedAssigneesResponseSchema = z.strictObject({
  assignees: z.array(PermittedAssigneeSchema),
});
export type PermittedAssigneesResponse = z.infer<typeof PermittedAssigneesResponseSchema>;

export const ActionSchema = z.strictObject({
  actionId: z.string().min(1),
  state: ActionStateSchema,
  /** Optimistic-lock version; every accepted transition increments it. */
  version: z.number().int().min(1),
  title: z.string().min(1),
  assignmentId: z.string().min(1),
  entity: ScopeEntitySchema,
  /** The evidence snapshot the action was created from; it does not move when observations change. */
  evidence: EvidenceRefSchema,
  creatorRole: RoleIdSchema,
  assignee: z.strictObject({ assigneeId: z.string().min(1), role: RoleIdSchema }),
  dueDate: z.iso.date(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Action = z.infer<typeof ActionSchema>;

/**
 * `POST /api/actions`. `idempotencyKey` makes a retried create return the
 * original action instead of a duplicate.
 */
export const CreateActionRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  title: z.string().trim().min(1).max(200),
  assignmentId: z.string().min(1),
  entity: ScopeEntitySchema,
  evidence: EvidenceRefSchema,
  assigneeId: z.string().min(1),
  dueDate: z.iso.date(),
});
export type CreateActionRequest = z.infer<typeof CreateActionRequestSchema>;

/**
 * `POST /api/actions/:actionId/transitions`. A stale `expectedVersion` fails
 * with `conflict` rather than overwriting someone else's update.
 */
export const TransitionActionRequestSchema = z.strictObject({
  toState: ActionStateSchema,
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});
export type TransitionActionRequest = z.infer<typeof TransitionActionRequestSchema>;

/** Response for a create, a transition, or a single read. `replayed` is true for an idempotent retry. */
export const ActionResponseSchema = z.strictObject({
  action: ActionSchema,
  replayed: z.boolean(),
});
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

/** `GET /api/actions` — actions the caller created or is assigned. */
export const ActionListResponseSchema = z.strictObject({
  items: z.array(ActionSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type ActionListResponse = z.infer<typeof ActionListResponseSchema>;

/**
 * What the audit trail records (PRD FR-07). Events carry references and
 * outcomes only — never tokens, secrets, or raw question text.
 */
export const AuditEventKindSchema = z.enum([
  'action_created',
  'action_transitioned',
  'ask_answered',
  'access_denied',
  'evidence_viewed',
]);
export type AuditEventKind = z.infer<typeof AuditEventKindSchema>;

export const AuditEventSchema = z.strictObject({
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  kind: AuditEventKindSchema,
  actorRole: RoleIdSchema,
  target: z
    .strictObject({
      type: z.enum(['action', 'assignment', 'ask', 'route']),
      id: z.string().min(1),
    })
    .nullable(),
  /** Short machine outcome, e.g. an Ask outcome or an action state. */
  outcome: z.string().min(1),
  requestId: z.string().min(1),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** `GET /api/audit` — permission-gated; audit access columns are still an open matrix decision. */
export const AuditListResponseSchema = z.strictObject({
  items: z.array(AuditEventSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
