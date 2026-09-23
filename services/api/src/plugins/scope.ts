import {
  EntitlementSchema,
  type Entitlement,
  type Grain,
  type MembershipClaims,
  type ScopeEntity,
} from '@orbit/contracts';
import { ApiError } from './errors.ts';

/**
 * Reads entitlement rows for the membership's role from the reviewed matrix
 * (seeded data, not code). Takes the whole membership because the database
 * implementation runs under its claims: RLS on `orbit.entitlements` reads the
 * role from `orbit.membership`.
 */
export interface EntitlementSource {
  forMembership(membership: MembershipClaims): Promise<readonly unknown[]>;
}

/**
 * Answers whether `target` lies inside one of the membership's scope entities,
 * using the organization hierarchy (e.g. facility → region). It must return
 * false for entities in another organization.
 */
export interface ScopeResolver {
  contains(membership: MembershipClaims, target: ScopeEntity): Promise<boolean>;
}

export interface ScopeDeps {
  entitlements: EntitlementSource;
  resolver: ScopeResolver;
  /**
   * The kpi-framework `definitionVersion` the API serves. Entitlement rows for
   * any other version are ignored, so a matrix change lands as a version bump
   * rather than a silent edit (ADR 0005 §1).
   */
  frameworkVersion: string;
}

export interface ScopeRequest {
  assignmentId: string;
  target: ScopeEntity;
  breakdown?: Grain;
}

export type DenialReason =
  | 'no_entitlement'
  | 'grain_not_granted'
  | 'breakdown_not_granted'
  | 'entity_out_of_scope';

export type ScopeDecision =
  | { allowed: true; entitlement: Entitlement }
  | { allowed: false; reason: DenialReason };

/**
 * Deny by default. Allowed only when the role holds an entitlement for the
 * assignment, at the requested grain and breakdown, for an entity inside the
 * membership's scope. No role inherits another role's scope.
 */
/**
 * Every entitlement the membership's role holds for the served framework
 * version, parsed against contracts. Fails closed on a malformed row or on two
 * rows for one assignment, rather than choosing one or merging them.
 */
export async function entitlementsFor(membership: MembershipClaims, deps: ScopeDeps): Promise<Entitlement[]> {
  const rows = await deps.entitlements.forMembership(membership);
  const entitlements = rows.map((row) => {
    const result = EntitlementSchema.safeParse(row);
    if (!result.success) {
      throw new ApiError('internal', 'An internal error occurred.', 'entitlement_row_failed_contract');
    }
    return result.data;
  });

  const current = entitlements.filter(
    (entitlement) => entitlement.role === membership.role && entitlement.frameworkVersion === deps.frameworkVersion,
  );
  const seen = new Set<string>();
  for (const entitlement of current) {
    if (seen.has(entitlement.assignmentId)) {
      // Never union duplicate rows into a wider grant.
      throw new ApiError('internal', 'An internal error occurred.', 'duplicate_entitlement_rows');
    }
    seen.add(entitlement.assignmentId);
  }
  return current;
}

export async function decideScope(
  membership: MembershipClaims,
  request: ScopeRequest,
  deps: ScopeDeps,
): Promise<ScopeDecision> {
  const entitlements = await entitlementsFor(membership, deps);
  const entitlement = entitlements.find((row) => row.assignmentId === request.assignmentId);
  if (!entitlement) {
    return { allowed: false, reason: 'no_entitlement' };
  }
  if (!entitlement.grains.includes(request.target.grain)) {
    return { allowed: false, reason: 'grain_not_granted' };
  }
  if (request.breakdown !== undefined && !entitlement.breakdowns.includes(request.breakdown)) {
    return { allowed: false, reason: 'breakdown_not_granted' };
  }
  if (!(await deps.resolver.contains(membership, request.target))) {
    return { allowed: false, reason: 'entity_out_of_scope' };
  }
  return { allowed: true, entitlement };
}

/** Throws an explicit `out_of_scope` error instead of silently narrowing the result. */
export async function assertInScope(
  membership: MembershipClaims,
  request: ScopeRequest,
  deps: ScopeDeps,
): Promise<Entitlement> {
  const decision = await decideScope(membership, request, deps);
  if (!decision.allowed) {
    throw new ApiError('out_of_scope', 'The requested data is outside your authorized scope.', decision.reason);
  }
  return decision.entitlement;
}
