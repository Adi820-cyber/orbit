import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KpiDetailQuerySchema,
  KpiDetailResponseSchema,
  KpiListResponseSchema,
  ObservationSchema,
  type MembershipClaims,
  type Observation,
} from '@orbit/contracts';
import { membershipOf } from '../../plugins/auth.ts';
import { ApiError } from '../../plugins/errors.ts';
import { assertInScope, entitlementsFor } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import {
  assignmentSummary,
  auditRead,
  definitionBasis,
  parseInput,
  parseRows,
  sameEntity,
} from '../shared.ts';

const ParamsSchema = z.strictObject({ assignmentId: z.string().min(1) });

/** KPI explorer (PRD FR-04). */
export function registerKpiRoutes(api: FastifyInstance, deps: ModuleDeps): void {
  api.get('/kpi', async (request) => {
    const membership = membershipOf(request);
    const entitlements = await entitlementsFor(membership, deps.scope);
    return KpiListResponseSchema.parse({
      frameworkVersion: deps.scope.frameworkVersion,
      assignments: entitlements.map((entitlement) => assignmentSummary(membership, entitlement)),
      disclosure: deps.disclosure,
    });
  });

  api.get('/kpi/:assignmentId', async (request) => {
    const membership = membershipOf(request);
    const { assignmentId } = parseInput(ParamsSchema, request.params);
    const query = parseInput(KpiDetailQuerySchema, request.query);
    const target = { grain: query.grain, entityId: query.entityId };

    const entitlement = await assertInScope(
      membership,
      { assignmentId, target, ...(query.breakdown ? { breakdown: query.breakdown } : {}) },
      deps.scope,
    );

    const series = await loadSeries(deps, membership, { assignmentId, entity: target, from: query.from, to: query.to });
    const latest = series.at(-1);

    let breakdown: { grain: NonNullable<typeof query.breakdown>; observations: Observation[] } | null = null;
    if (query.breakdown && latest) {
      const rows = await deps.observations.breakdown(membership, {
        assignmentId,
        parent: target,
        grain: query.breakdown,
        period: latest.period,
      });
      const observations = parseRows(ObservationSchema, rows, 'observation_row_failed_contract');
      for (const observation of observations) {
        const inScope = await deps.scope.resolver.contains(membership, observation.entity);
        if (observation.assignmentId !== assignmentId || observation.entity.grain !== query.breakdown || !inScope) {
          throw new ApiError('internal', 'An internal error occurred.', 'breakdown_row_outside_request');
        }
      }
      breakdown = { grain: query.breakdown, observations };
    }

    await auditRead(deps, request, membership, {
      kind: 'evidence_viewed',
      target: { type: 'assignment', id: assignmentId },
      outcome: 'served',
    });

    return KpiDetailResponseSchema.parse({
      assignment: assignmentSummary(membership, entitlement),
      definitions: definitionBasis(assignmentId),
      scope: target,
      series,
      breakdown,
      disclosure: deps.disclosure,
    });
  });
}

/** Loads and checks a series: every row must be the requested assignment and entity. */
export async function loadSeries(
  deps: ModuleDeps,
  membership: MembershipClaims,
  query: Parameters<ModuleDeps['observations']['series']>[1],
): Promise<Observation[]> {
  const rows = await deps.observations.series(membership, query);
  const series = parseRows(ObservationSchema, rows, 'observation_row_failed_contract');
  for (const observation of series) {
    if (observation.assignmentId !== query.assignmentId || !sameEntity(observation.entity, query.entity)) {
      throw new ApiError('internal', 'An internal error occurred.', 'series_row_outside_request');
    }
  }
  return series;
}
