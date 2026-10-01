import { z } from 'zod';
import { ScopeEntitySchema } from './membership.ts';
import { OperatorRoleIdSchema, RoleIdSchema } from './roles.ts';

/** `GET /health` — the only unauthenticated endpoint. */
export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * `GET /api/me` — the verified role and scope, for display only (PRD FR-01).
 * The frontend must never send any of this back as an authorization input.
 */
export const MeResponseSchema = z.strictObject({
  role: RoleIdSchema,
  organizationId: z.uuid(),
  scopes: z.array(ScopeEntitySchema).min(1),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * `GET /api/me` for an ERP operator (ADR 0016): the verified operator role and
 * scope, for display and routing only. Never sent back as an authorization input.
 */
export const OperatorMeResponseSchema = z.strictObject({
  operatorRole: OperatorRoleIdSchema,
  organizationId: z.uuid(),
  scopes: z.array(ScopeEntitySchema).min(1),
});
export type OperatorMeResponse = z.infer<typeof OperatorMeResponseSchema>;

/**
 * Either `GET /api/me` shape. The client parses this once to decide which
 * workspace to open; the leader workspace then keeps the leader-only type.
 */
export const IdentityResponseSchema = z.union([MeResponseSchema, OperatorMeResponseSchema]);
export type IdentityResponse = z.infer<typeof IdentityResponseSchema>;
