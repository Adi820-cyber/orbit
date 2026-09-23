import { z } from 'zod';
import { RoleIdSchema } from './roles.ts';

/** Data grains an entitlement or scope can refer to (ARCH §8.2). */
export const GrainSchema = z.enum(['group', 'region', 'facility', 'coe', 'segment']);
export type Grain = z.infer<typeof GrainSchema>;

/**
 * One organizational entity a membership is scoped to.
 *
 * TODO(ghansham): `entityId` should become `z.uuid()`. Agreed with Aditya.
 * RLS policies compare this directly against primary keys
 * (`orbit.regions.id`, `orbit.facilities.id`, `orbit.coes.id`, and the
 * organization's own id for `group` grain), and
 * `orbit.org_membership_scopes.entity_id` is a generated `uuid` column — so a
 * free string here permits values the database cannot store.
 *
 * NOT changed yet, deliberately. Tightening it fails 69 tests in
 * `services/api`, because the fixtures use readable ids
 * (`fixture-region-a`, `fixture-facility-a1`) and `HIERARCHY` is keyed on
 * them. Reworking those to UUIDs is real work in Ghansham's path, so it is his
 * to sequence rather than mine to impose. Raised with the exact failure list.
 */
export const ScopeEntitySchema = z.strictObject({
  grain: GrainSchema,
  entityId: z.string().min(1),
});
export type ScopeEntity = z.infer<typeof ScopeEntitySchema>;

/**
 * The verified claims the API derives from a membership record.
 * This exact object is what the API hands to Postgres as the
 * `orbit.membership` setting for RLS (ARCH §8.3).
 *
 * DRAFT for Gate 1: reviewed by Aditya (claims) and Maruti (RLS policies).
 */
export const MembershipClaimsSchema = z.strictObject({
  membershipId: z.uuid(),
  subject: z.uuid(),
  organizationId: z.uuid(),
  role: RoleIdSchema,
  scopes: z.array(ScopeEntitySchema).min(1),
});
export type MembershipClaims = z.infer<typeof MembershipClaimsSchema>;

/** A membership row as loaded from the trusted membership store. */
export const MembershipSchema = MembershipClaimsSchema.extend({
  status: z.enum(['active', 'inactive']),
});
export type Membership = z.infer<typeof MembershipSchema>;
