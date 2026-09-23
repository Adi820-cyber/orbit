import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ActionListResponseSchema,
  ActionResponseSchema,
  ActionSchema,
  CreateActionRequestSchema,
  GrainSchema,
  ObservationSchema,
  PageQuerySchema,
  PermittedAssigneeSchema,
  PermittedAssigneesResponseSchema,
  TransitionActionRequestSchema,
  type Action,
  type CreateActionRequest,
  type MembershipClaims,
} from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import { assertInScope, decideScope } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import { loadDataset, parseInput, parseRow, parseRows, sameEntity } from '../shared.ts';

const ActionParamsSchema = z.strictObject({ actionId: z.string().min(1) });
const AssigneeQuerySchema = z.strictObject({
  assignmentId: z.string().min(1),
  grain: GrainSchema,
  entityId: z.string().min(1),
});
const RelationSchema = z.enum(['creator', 'assignee']);

const NOT_FOUND = 'The requested resource does not exist.';
const CHANGED = 'This action was changed by someone else. Reload it and try again.';

/**
 * Internal actions (PRD FR-06, ARCH §10). Stored in Orbit only; nothing is
 * emailed or sent to an external tool. The store writes the action and its
 * audit event in one transaction.
 */
export function registerActionRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/actions', async (request) => {
    const membership = membershipOf(request);
    const page = parseInput(PageQuerySchema, request.query);
    const rows = await deps.actions.list(membership, page);
    return ActionListResponseSchema.parse({
      items: parseRows(ActionSchema, rows.items, 'action_row_failed_contract'),
      nextCursor: rows.nextCursor,
    });
  });

  api.get('/actions/assignees', async (request) => {
    const membership = membershipOf(request);
    const query = parseInput(AssigneeQuerySchema, request.query);
    const entity = { grain: query.grain, entityId: query.entityId };
    await assertInScope(membership, { assignmentId: query.assignmentId, target: entity }, deps.scope);
    const rows = await deps.assignees.permitted(membership, { assignmentId: query.assignmentId, entity });
    return PermittedAssigneesResponseSchema.parse({
      assignees: parseRows(PermittedAssigneeSchema, rows, 'assignee_row_failed_contract'),
    });
  });

  api.get('/actions/:actionId', async (request) => {
    const membership = membershipOf(request);
    const { actionId } = parseInput(ActionParamsSchema, request.params);
    const found = await deps.actions.get(membership, actionId);
    if (!found) {
      throw new ApiError('not_found', NOT_FOUND, 'action_not_visible');
    }
    return ActionResponseSchema.parse({ action: parseRow(ActionSchema, found.action, 'action_row_failed_contract'), replayed: false });
  });

  api.post('/actions', async (request, reply) => {
    const membership = membershipOf(request);
    const body = parseInput(CreateActionRequestSchema, request.body);

    await assertInScope(membership, { assignmentId: body.assignmentId, target: body.entity }, deps.scope);
    await verifyEvidence(deps, membership, body);
    await verifyAssignee(deps, membership, body);

    const result = await deps.actions.create(
      membership,
      { ...body, evidence: { ...body.evidence, observationIds: [...new Set(body.evidence.observationIds)] } },
      { kind: 'action_created', target: { type: 'assignment', id: body.assignmentId }, outcome: 'open', requestId: request.id },
    );
    const action = parseRow(ActionSchema, result.action, 'action_row_failed_contract');

    if (result.replayed && !matchesRequest(action, body)) {
      // The same idempotency key was reused for a different action.
      throw new ApiError('conflict', 'This request was already used for a different action.', 'idempotency_key_reused');
    }
    if (!result.replayed && (action.state !== 'open' || action.version !== 1 || action.creatorRole !== membership.role)) {
      throw new ApiError('internal', 'An internal error occurred.', 'created_action_unexpected_shape');
    }

    reply.status(result.replayed ? 200 : 201);
    return ActionResponseSchema.parse({ action, replayed: result.replayed });
  });

  api.post('/actions/:actionId/transitions', async (request) => {
    const membership = membershipOf(request);
    const { actionId } = parseInput(ActionParamsSchema, request.params);
    const body = parseInput(TransitionActionRequestSchema, request.body);

    const found = await deps.actions.get(membership, actionId);
    if (!found) {
      throw new ApiError('not_found', NOT_FOUND, 'action_not_visible');
    }
    const current = parseRow(ActionSchema, found.action, 'action_row_failed_contract');
    const relation = parseRow(RelationSchema, found.relation, 'action_relation_failed_contract');

    if (current.version !== body.expectedVersion) {
      throw new ApiError('conflict', CHANGED, 'stale_version');
    }

    const decision = await deps.transitions.decide({ role: membership.role, relation, from: current.state, to: body.toState });
    if (decision === 'invalid_transition') {
      throw new ApiError('conflict', 'This action cannot move to that state.', 'invalid_transition');
    }
    if (decision !== 'allowed') {
      throw new ApiError('forbidden', 'You are not permitted to make this change.', 'transition_not_permitted');
    }

    const result = await deps.actions.transition(
      membership,
      { actionId, expectedVersion: body.expectedVersion, toState: body.toState, reason: body.reason },
      { kind: 'action_transitioned', target: { type: 'action', id: actionId }, outcome: body.toState, requestId: request.id },
    );
    if (result.status === 'stale') {
      throw new ApiError('conflict', CHANGED, 'stale_version_on_write');
    }
    if (result.status === 'not_found') {
      throw new ApiError('not_found', NOT_FOUND, 'action_not_visible_on_write');
    }

    const updated = parseRow(ActionSchema, result.action, 'action_row_failed_contract');
    if (updated.actionId !== actionId || updated.state !== body.toState || updated.version !== body.expectedVersion + 1) {
      throw new ApiError('internal', 'An internal error occurred.', 'transition_unexpected_result');
    }
    return ActionResponseSchema.parse({ action: updated, replayed: false });
  });
}

/**
 * Evidence sent back by the client is re-checked, never trusted: it must come
 * from the current dataset and definition version, belong to the action's
 * assignment, and lie inside the caller's scope.
 */
async function verifyEvidence(deps: ModuleDeps, membership: MembershipClaims, body: CreateActionRequest): Promise<void> {
  const dataset = await loadDataset(deps, membership);
  if (body.evidence.datasetChecksum !== dataset.datasetChecksum) {
    throw new ApiError('conflict', 'The evidence is from an older dataset. Reload it and try again.', 'evidence_dataset_changed');
  }

  const ids = [...new Set(body.evidence.observationIds)];
  const rows = await deps.observations.byIds(membership, ids);
  const observations = parseRows(ObservationSchema, rows, 'observation_row_failed_contract');
  if (observations.length !== ids.length || observations.some((observation) => !ids.includes(observation.observationId))) {
    throw new ApiError('invalid_request', 'The request is invalid.', 'evidence_not_found');
  }

  for (const observation of observations) {
    if (observation.assignmentId !== body.assignmentId || observation.definitionVersion !== body.evidence.definitionVersion) {
      throw new ApiError('invalid_request', 'The request is invalid.', 'evidence_does_not_match_action');
    }
    const decision = await decideScope(membership, { assignmentId: body.assignmentId, target: observation.entity }, deps.scope);
    if (!decision.allowed) {
      throw new ApiError('out_of_scope', 'The requested data is outside your authorized scope.', `evidence_${decision.reason}`);
    }
  }
}

/** The assignee must be one the directory says may see this evidence (PRD FR-06). */
async function verifyAssignee(deps: ModuleDeps, membership: MembershipClaims, body: CreateActionRequest): Promise<void> {
  const rows = await deps.assignees.permitted(membership, { assignmentId: body.assignmentId, entity: body.entity });
  const assignees = parseRows(PermittedAssigneeSchema, rows, 'assignee_row_failed_contract');
  if (!assignees.some((assignee) => assignee.assigneeId === body.assigneeId)) {
    throw new ApiError('invalid_request', 'The selected assignee cannot be assigned this action.', 'assignee_not_permitted');
  }
}

function matchesRequest(action: Action, body: CreateActionRequest): boolean {
  const sameEvidence =
    action.evidence.datasetChecksum === body.evidence.datasetChecksum &&
    action.evidence.definitionVersion === body.evidence.definitionVersion &&
    [...action.evidence.observationIds].sort().join('\n') === [...new Set(body.evidence.observationIds)].sort().join('\n');
  return (
    sameEvidence &&
    action.title === body.title &&
    action.assignmentId === body.assignmentId &&
    sameEntity(action.entity, body.entity) &&
    action.assignee.assigneeId === body.assigneeId &&
    action.dueDate === body.dueDate
  );
}
