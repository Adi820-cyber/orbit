import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { MembershipSchema, type MembershipClaims } from '@orbit/contracts';
import { ApiError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified membership claims. Set only by the auth hook; never from request data. */
    membership: MembershipClaims | null;
  }
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
export async function loadMembership(subject: string, source: MembershipSource): Promise<MembershipClaims> {
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
  const { status: _status, ...claims } = membership;
  return claims;
}

/** Call once on the root instance, before any route is registered. */
export function decorateMembership(app: FastifyInstance): void {
  app.decorateRequest('membership', null);
}

/**
 * Adds the auth + membership hook to an encapsulated route scope. Every route
 * registered in that scope requires a verified token and one active membership.
 */
export function requireAuth(scope: FastifyInstance, options: AuthOptions): void {
  scope.addHook('onRequest', async (request) => {
    const subject = await verifyAccessToken(request.headers.authorization, options);
    request.membership = await loadMembership(subject, options.memberships);
  });
}

/** Read the verified membership inside a protected handler. */
export function membershipOf(request: FastifyRequest): MembershipClaims {
  if (!request.membership) {
    throw new ApiError('unauthenticated', UNAUTHENTICATED, 'route_not_behind_auth_hook');
  }
  return request.membership;
}
