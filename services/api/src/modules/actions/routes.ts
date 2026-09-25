import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ActionDetailResponseSchema,
  ActionEventSchema,
  ActionListResponseSchema,
  ActionResponseSchema,
  ActionSchema,
  CreateActionRequestSchema,
  DelegateActionRequestSchema,
  EntityDirectoryEntrySchema,
  GrainSchema,
  ObservationSchema,
  PageQuerySchema,
  PermittedAssigneeSchema,
  PermittedAssigneesResponseSchema,
  TransitionActionRequestSchema,
  type Action,
  type ActionState,
  type CreateActionRequest,
  type DelegateActionRequest,
  type MembershipClaims,
  type PermittedAssignee,
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
const TERMINAL: ReadonlySet<ActionState> = new Set(['completed', 'cancelled']);
/** States in which the assignee may still hand part of the work on. */
const DELEGABLE: ReadonlySet<ActionState> = new Set(['open', 'acknowledged', 'in_progress']);
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
    return PermittedAssigneesResponseSchema.parse({
      assignees: await loadAssignees(deps, membership, { assignmentId: query.assignmentId, entity }),
    });
  });

  api.get('/actions/:actionId', async (request) => {
    const membership = membershipOf(request);
    const { actionId } = parseInput(ActionParamsSchema, request.params);
    const { action, relation } = await loadVisible(deps, membership, actionId);
    const [moves, historyRows, childRows] = await Promise.all([
      deps.transitions.moves({ role: membership.role, relation, from: action.state }),
      deps.actions.history(membership, actionId),
      deps.actions.children(membership, actionId),
    ]);
    const parent = action.parentActionId ? await deps.actions.get(membership, action.parentActionId) : null;
    const parentAction = parent ? parseRow(ActionSchema, parent.action, 'action_row_failed_contract') : null;
    return ActionDetailResponseSchema.parse({
      action,
      viewer: { relation, moves, canDelegate: relation === 'assignee' && DELEGABLE.has(action.state) },
      history: parseRows(ActionEventSchema, historyRows, 'action_event_row_failed_contract'),
      children: parseRows(ActionSchema, childRows, 'action_row_failed_contract'),
      parent: parentAction ? { actionId: parentAction.actionId, title: parentAction.title } : null,
    });
  });

  api.get('/actions/:actionId/delegates', async (request) => {
    const membership = membershipOf(request);
    const { actionId } = parseInput(ActionParamsSchema, request.params);
    const { action } = await loadDelegable(deps, membership, actionId);
    return PermittedAssigneesResponseSchema.parse({
      assignees: await loadAssignees(deps, membership, { assignmentId: action.assignmentId, entity: action.entity }),
    });
  });

  api.post('/actions/:actionId/delegations', async (request, reply) => {
    const membership = membershipOf(request);
    const { actionId } = parseInput(ActionParamsSchema, request.params);
    const body = parseInput(DelegateActionRequestSchema, request.body);
    const { action: parent } = await loadDelegable(deps, membership, actionId);

    const assignees = await loadAssignees(deps, membership, { assignmentId: parent.assignmentId, entity: parent.entity });
    if (!assignees.some((assignee) => assignee.assigneeId === body.assigneeId)) {
      throw new ApiError('invalid_request', 'The selected person cannot be given this work.', 'delegate_not_permitted');
    }

    // The child carries the parent's fixed evidence snapshot (FR-07): the
    // delegate sees the same references the delegator was given, no more.
    const result = await deps.actions.create(
      membership,
      {
        idempotencyKey: body.idempotencyKey,
        title: body.title,
        assignmentId: parent.assignmentId,
        entity: parent.entity,
        evidence: parent.evidence,
        assigneeId: body.assigneeId,
        dueDate: body.dueDate,
        parentActionId: parent.actionId,
        entityLabel: parent.entityLabel,
      },
      { kind: 'action_created', target: { type: 'action', id: parent.actionId }, outcome: 'delegated', requestId: request.id },
    );
    const child = parseRow(ActionSchema, result.action, 'action_row_failed_contract');
    if (result.replayed && !matchesDelegation(child, parent, body)) {
      throw new ApiError('conflict', 'This request was already used for a different action.', 'idempotency_key_reused');
    }
    if (!result.replayed && (child.parentActionId !== parent.actionId || child.state !== 'open')) {
      throw new ApiError('internal', 'An internal error occurred.', 'delegated_action_unexpected_shape');
    }
    reply.status(result.replayed ? 200 : 201);
    return ActionResponseSchema.parse({ action: child, replayed: result.replayed });
  });

  api.post('/actions', async (request, reply) => {
    const membership = membershipOf(request);
    const body = parseInput(CreateActionRequestSchema, request.body);

    await assertInScope(membership, { assignmentId: body.assignmentId, target: body.entity }, deps.scope);
    await verifyEvidence(deps, membership, body);
    await verifyAssignee(deps, membership, body);

    const result = await deps.actions.create(
      membership,
      {
        ...body,
        evidence: { ...body.evidence, observationIds: [...new Set(body.evidence.observationIds)] },
        entityLabel: await entityLabelFor(deps, membership, body.entity),
      },
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
    if (body.toState === 'submitted') {
      const children = parseRows(ActionSchema, await deps.actions.children(membership, actionId), 'action_row_failed_contract');
      if (children.some((child) => !TERMINAL.has(child.state))) {
        throw new ApiError(
          'conflict',
          'Work you delegated from this action is still open. Close or cancel it before submitting for approval.',
          'delegated_work_open',
        );
      }
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
 * The entity's name from the creator's own directory, snapshotted onto the
 * action. The directory is optional: without it the action simply has no label.
 */
async function entityLabelFor(deps: ModuleDeps, membership: MembershipClaims, entity: CreateActionRequest['entity']) {
  try {
    const entries = parseRows(EntityDirectoryEntrySchema, await deps.entities.visible(membership), 'entity_row_failed_contract');
    return entries.find((entry) => sameEntity(entry, entity))?.label ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unavailable') return null;
    throw error;
  }
}

async function loadVisible(deps: ModuleDeps, membership: MembershipClaims, actionId: string) {
  const found = await deps.actions.get(membership, actionId);
  if (!found) {
    throw new ApiError('not_found', NOT_FOUND, 'action_not_visible');
  }
  return {
    action: parseRow(ActionSchema, found.action, 'action_row_failed_contract'),
    relation: parseRow(RelationSchema, found.relation, 'action_relation_failed_contract'),
  };
}

/** Only the assignee delegates, and only while the work is still theirs to do. */
async function loadDelegable(deps: ModuleDeps, membership: MembershipClaims, actionId: string) {
  const visible = await loadVisible(deps, membership, actionId);
  if (visible.relation !== 'assignee') {
    throw new ApiError('forbidden', 'Only the person this action is assigned to can delegate it.', 'delegate_not_assignee');
  }
  if (!DELEGABLE.has(visible.action.state)) {
    throw new ApiError('conflict', 'This action can no longer be delegated.', 'delegate_wrong_state');
  }
  return visible;
}

function matchesDelegation(child: Action, parent: Action, body: DelegateActionRequest): boolean {
  return (
    child.parentActionId === parent.actionId &&
    child.title === body.title &&
    child.assignee.assigneeId === body.assigneeId &&
    child.dueDate === body.dueDate
  );
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

/**
 * Assignees from the directory, each re-checked against ADR 0011 §6: every
 * scope the assignee holds must lie inside the caller's own scope, using the
 * same resolver as reads. Never upward, never sideways. A directory row that
 * fails the check is a source defect, so the request fails closed rather than
 * quietly dropping it.
 */
async function loadAssignees(
  deps: ModuleDeps,
  membership: MembershipClaims,
  target: { assignmentId: string; entity: CreateActionRequest['entity'] },
): Promise<PermittedAssignee[]> {
  const rows = await deps.assignees.permitted(membership, target);
  const assignees = parseRows(PermittedAssigneeSchema, rows, 'assignee_row_failed_contract');
  for (const assignee of assignees) {
    for (const scope of assignee.scopes) {
      if (!(await deps.scope.resolver.contains(membership, scope))) {
        throw new ApiError('internal', 'An internal error occurred.', 'assignee_scope_not_contained');
      }
    }
  }
  return assignees;
}

/** The assignee must come from the directory for this evidence (PRD FR-06, ADR 0011 §6). */
async function verifyAssignee(deps: ModuleDeps, membership: MembershipClaims, body: CreateActionRequest): Promise<void> {
  const assignees = await loadAssignees(deps, membership, { assignmentId: body.assignmentId, entity: body.entity });
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
