import { z } from 'zod';
import { ScopeEntitySchema } from './membership.ts';
import { RoleIdSchema } from './roles.ts';

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
