import { z } from 'zod';
import { OperatorRoleIdSchema, RoleIdSchema } from './roles.ts';

/** Data grains an entitlement or scope can refer to (ARCH §8.2). */
/**
 * `segment` is not a grain: it is a payer/insurer breakdown dimension with no
 * place in the organizational hierarchy (ADR 0012).
 */
export const GrainSchema = z.enum(['group', 'region', 'facility', 'coe']);
export type Grain = z.infer<typeof GrainSchema>;

/**
 * One organizational entity a membership is scoped to.
 *
 * TODO(ghansham): `entityId` should become `z.uuid()`. Agreed with Aditya.
 * The API and contracts fixtures now use uuids, so tightening it no longer
 * breaks `services/api` or `packages/contracts` (checked: both pass with it
 * tightened). Still blocked on `apps/web` (Ayas): the brief fixture and e2e
 * test use readable ids, and the UI shows `entityId` as the entity's label
 * because no contract carries a display name yet.
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

/**
 * Verified claims for an ERP operator membership (ADR 0016). A separate
 * schema rather than an optional `role`, so leader code keeps a non-optional
 * workbook role and an operator can never reach a leader module by type.
 *
 * Also the `orbit.membership` setting for ERP transactions: RLS reads
 * `operatorRole`, and `orbit.current_role_id()` is null for an operator, so
 * every leader policy matches nothing.
 */
export const OperatorClaimsSchema = z.strictObject({
  membershipId: z.uuid(),
  subject: z.uuid(),
  organizationId: z.uuid(),
  operatorRole: OperatorRoleIdSchema,
  scopes: z.array(ScopeEntitySchema).min(1),
});
export type OperatorClaims = z.infer<typeof OperatorClaimsSchema>;

const MembershipStatusSchema = z.enum(['active', 'inactive']);

/**
 * A membership row as loaded from the trusted membership store: either a
 * leader (workbook role) or an operator (operator role), never both. The
 * store returns the other column as null.
 */
export const MembershipSchema = z.union([
  MembershipClaimsSchema.extend({
    status: MembershipStatusSchema,
    operatorRole: z.null().optional(),
  }),
  OperatorClaimsSchema.extend({
    status: MembershipStatusSchema,
    role: z.null().optional(),
  }),
]);
export type Membership = z.infer<typeof MembershipSchema>;
