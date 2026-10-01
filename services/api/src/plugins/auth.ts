import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { MembershipSchema, type MembershipClaims, type OperatorClaims } from '@orbit/contracts';
import { ApiError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Verified LEADER membership claims. Set only by the auth hook; never from
     * request data. Null for an ERP operator, so every leader module refuses one.
     */
    membership: MembershipClaims | null;
    /** Verified ERP OPERATOR claims (ADR 0016). Null for a leader. */
    operator: OperatorClaims | null;
  }
}

/** Either kind of verified claims; exactly one is set per request. */
export type VerifiedClaims = MembershipClaims | OperatorClaims;

export function isOperatorClaims(claims: VerifiedClaims): claims is OperatorClaims {
  return 'operatorRole' in claims;
}

/**
 * Loads membership rows for a verified token subject from the trusted store.
 * Rows are returned unparsed; this module parses them against contracts.
 */
export interface MembershipSource {
  findBySubject(subject: string): Promise<readonly unknown[]>;
}

export interface AuthOptions {
  getKey: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  memberships: MembershipSource;
}

/** Supabase signs user tokens asymmetrically; HS256 and `none` are never accepted. */
const ALLOWED_ALGORITHMS = ['ES256', 'RS256'];

const SupabaseClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  is_anonymous: z.literal(false).optional(),
});

const UNAUTHENTICATED = 'Authentication is required.';
const FORBIDDEN = 'Your account does not have access to Orbit.';

export async function verifyAccessToken(
  authorization: string | undefined,
  options: Pick<AuthOptions, 'getKey' | 'issuer' | 'audience'>,
): Promise<string> {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '');
  const token = match?.[1];
  if (!token) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'missing_or_malformed_bearer');
  }

  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, options.getKey, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ALLOWED_ALGORITHMS,
      requiredClaims: ['sub', 'exp'],
    }));
  } catch (error) {
    // A JWKS timeout or network failure is our dependency being down, not a bad token.
    if (error instanceof joseErrors.JWKSTimeout || !(error instanceof joseErrors.JOSEError)) {
      throw new ApiError('unavailable', 'Authentication is temporarily unavailable.', 'jwks_unavailable');
    }
    throw new ApiError('unauthenticated', UNAUTHENTICATED, error.code);
  }

  const claims = SupabaseClaimsSchema.safeParse(payload);
  if (!claims.success) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'unexpected_token_claims');
  }
  return claims.data.sub;
}

/** Resolve the subject to exactly one active membership, or deny. */
export async function loadMembership(subject: string, source: MembershipSource): Promise<VerifiedClaims> {
  const rows = await source.findBySubject(subject);

  const parsed = rows.map((row) => MembershipSchema.safeParse(row));
  if (parsed.some((result) => !result.success)) {
    throw new ApiError('internal', 'An internal error occurred.', 'membership_row_failed_contract');
  }

  const active = parsed
    .flatMap((result) => (result.success ? [result.data] : []))
    .filter((membership) => membership.subject === subject && membership.status === 'active');

  if (active.length === 0) {
    throw new ApiError('forbidden', FORBIDDEN, rows.length === 0 ? 'no_membership' : 'no_active_membership');
  }
  if (active.length > 1) {
    throw new ApiError('forbidden', FORBIDDEN, 'ambiguous_membership');
  }

  const [membership] = active;
  if (!membership) {
    throw new ApiError('forbidden', FORBIDDEN, 'no_active_membership');
  }
  // Strip the row-only fields, keeping exactly one kind of claims (ADR 0016).
  if ('operatorRole' in membership && membership.operatorRole) {
    const { status: _status, role: _role, ...operator } = membership;
    return operator;
  }
  if ('role' in membership && membership.role) {
    const { status: _status, operatorRole: _operatorRole, ...leader } = membership;
    return leader;
  }
  throw new ApiError('internal', 'An internal error occurred.', 'membership_without_role');
}

/** Call once on the root instance, before any route is registered. */
export function decorateMembership(app: FastifyInstance): void {
  app.decorateRequest('membership', null);
  app.decorateRequest('operator', null);
}

/**
 * Adds the auth + membership hook to an encapsulated route scope. Every route
 * registered in that scope requires a verified token and one active membership.
 */
export function requireAuth(scope: FastifyInstance, options: AuthOptions): void {
  scope.addHook('onRequest', async (request) => {
    const subject = await verifyAccessToken(request.headers.authorization, options);
    const claims = await loadMembership(subject, options.memberships);
    if (isOperatorClaims(claims)) {
      request.operator = claims;
    } else {
      request.membership = claims;
    }
  });
}

/**
 * Read the verified LEADER membership inside a protected handler. An ERP
 * operator is refused here, so no leader module can serve one.
 */
export function membershipOf(request: FastifyRequest): MembershipClaims {
  if (request.operator) {
    throw new ApiError('forbidden', 'This area is for leadership accounts.', 'operator_on_leader_route');
  }
  if (!request.membership) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'route_not_behind_auth_hook');
  }
  return request.membership;
}

/** Read the verified ERP OPERATOR claims; a leader is refused (ADR 0016). */
export function operatorOf(request: FastifyRequest): OperatorClaims {
  if (request.membership) {
    throw new ApiError('forbidden', 'Hospital operations are for hospital and admin accounts.', 'leader_on_erp_route');
  }
  if (!request.operator) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'route_not_behind_auth_hook');
  }
  return request.operator;
}

/** Either kind of verified claims, for the few routes both may call (`GET /api/me`). */
export function claimsOf(request: FastifyRequest): VerifiedClaims {
  const claims = request.membership ?? request.operator;
  if (!claims) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'route_not_behind_auth_hook');
  }
  return claims;
}
