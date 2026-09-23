import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  KpiAssignmentSummarySchema,
  type DefinitionBasis,
  type Entitlement,
  type KpiAssignmentSummary,
  type MembershipClaims,
  type ScopeEntity,
} from '@orbit/contracts';
import { getAssignment, getDefinitionFamiliesForAssignment, type RoleKpiAssignment } from '@orbit/kpi-framework';
import { ApiError } from '../plugins/errors.ts';
import { decideScope } from '../plugins/scope.ts';
import { DatasetInfoSchema, type AuditDraft, type DatasetInfo, type ModuleDeps } from './ports.ts';

const INTERNAL = 'An internal error occurred.';

/** Parses client input; a mismatch is the caller's error. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError('invalid_request', 'The request is invalid.', 'input_failed_contract');
  }
  return result.data;
}

/** Parses a row from a data source; a mismatch is our defect, so fail closed. */
export function parseRow<S extends z.ZodType>(schema: S, row: unknown, reason: string): z.infer<S> {
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new ApiError('internal', INTERNAL, reason);
  }
  return result.data;
}

export function parseRows<S extends z.ZodType>(schema: S, rows: readonly unknown[], reason: string): z.infer<S>[] {
  return rows.map((row) => parseRow(schema, row, reason));
}

export async function loadDataset(deps: ModuleDeps, membership: MembershipClaims): Promise<DatasetInfo> {
  return parseRow(DatasetInfoSchema, await deps.dataset.current(membership), 'dataset_info_failed_contract');
}

export function sameEntity(a: ScopeEntity, b: ScopeEntity): boolean {
  return a.grain === b.grain && a.entityId === b.entityId;
}

/**
 * Defense in depth over RLS: every row a source returns must itself pass the
 * scope check. A row that does not is a source defect, so the whole request
 * fails closed — it is never silently dropped (RULES.md: no silent narrowing).
 */
export async function assertRowsInScope(
  membership: MembershipClaims,
  rows: readonly { assignmentId: string; entity: ScopeEntity }[],
  deps: ModuleDeps,
): Promise<void> {
  for (const row of rows) {
    const decision = await decideScope(membership, { assignmentId: row.assignmentId, target: row.entity }, deps.scope);
    if (!decision.allowed) {
      throw new ApiError('internal', INTERNAL, `source_returned_out_of_scope_row:${decision.reason}`);
    }
  }
}

/** The framework row behind an entitlement. An entitlement for an unknown or foreign assignment fails closed. */
export function frameworkAssignment(membership: MembershipClaims, assignmentId: string): RoleKpiAssignment {
  const assignment = getAssignment(assignmentId);
  if (!assignment || assignment.roleId !== membership.role) {
    throw new ApiError('internal', INTERNAL, 'entitlement_references_unknown_assignment');
  }
  return assignment;
}

export function assignmentSummary(membership: MembershipClaims, entitlement: Entitlement): KpiAssignmentSummary {
  const assignment = frameworkAssignment(membership, entitlement.assignmentId);
  return KpiAssignmentSummarySchema.parse({
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    kpi: assignment.kpi,
    keyDeliverable: assignment.keyDeliverable,
    weight: assignment.weight,
    definitionFamilies: [...assignment.definitionFamilies],
    unresolved: assignment.unresolvedReason !== null || assignment.definitionFamilies.length === 0,
    targetBasis: assignment.targetBasis,
    review: assignment.review,
    primaryDataSource: assignment.primaryDataSource,
    grains: entitlement.grains,
    breakdowns: entitlement.breakdowns,
  });
}

export function definitionBasis(assignmentId: string): DefinitionBasis[] {
  return getDefinitionFamiliesForAssignment(assignmentId).map((family) => ({
    family: family.family,
    standardDefinition: family.standardDefinition,
    numeratorDenominatorControl: family.numeratorDenominatorControl,
  }));
}

/**
 * Records a read-side audit event. The response has already been authorized,
 * so a failed audit write is logged loudly rather than turned into a
 * different answer. Writes that change state audit inside their own
 * transaction instead (see `ActionStore`).
 */
export async function auditRead(
  deps: ModuleDeps,
  request: FastifyRequest,
  membership: MembershipClaims,
  event: Omit<AuditDraft, 'requestId'>,
): Promise<void> {
  try {
    await deps.audit.record(membership, { ...event, requestId: request.id });
  } catch (error) {
    request.log.error({ err: error, kind: event.kind }, 'audit write failed');
  }
}
