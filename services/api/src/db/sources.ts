import { z } from 'zod';
import type { MembershipClaims, ScopeEntity } from '@orbit/contracts';
import type { EntitlementSource, ScopeResolver } from '../plugins/scope.ts';
import type { Database, Tx } from './client.ts';
import type { MembershipQuery } from './memberships.ts';
import { withMembershipTx } from './rls.ts';

/*
 * SQL for the sources Maruti's schema now provides (supabase/migrations
 * 20260923000400–000500). Every query runs under RLS as `orbit_app`, and also
 * filters explicitly on the verified subject / organization as defense in
 * depth. Column aliases map straight onto the `@orbit/contracts` keys, and the
 * callers parse every row, so a schema drift fails closed instead of leaking.
 *
 * Not yet run against a database: see the README "Live sources" section.
 */

/**
 * Every membership row for the subject, active or not, with scopes aggregated
 * into `[{ grain, entityId }]`. Runs in the subject-only bootstrap transaction
 * (ADR 0002, Option A); `org_memberships_select_own_subject` and
 * `org_membership_scopes_select_own_subject` read `orbit.subject`.
 */
export const MEMBERSHIP_SQL = `
select
  m.id::text              as "membershipId",
  m.subject::text         as "subject",
  m.organization_id::text as "organizationId",
  m.role_id               as "role",
  m.status                as "status",
  coalesce(
    jsonb_agg(
      jsonb_build_object('grain', s.grain, 'entityId', s.entity_id::text)
      order by s.grain, s.entity_id
    ) filter (where s.id is not null),
    '[]'::jsonb
  )                       as "scopes"
from orbit.org_memberships m
left join orbit.org_membership_scopes s on s.membership_id = m.id
where m.subject = $1::uuid
group by m.id`;

export const membershipQuery: MembershipQuery = (tx, subject) => tx.query(MEMBERSHIP_SQL, [subject]);

/**
 * The role's entitlement rows for every framework version; the scope plugin
 * keeps only the served version. `entitlements_select_own_role` reads the role
 * from the membership claims; the explicit `role_id = $1` is defense in depth.
 */
export const ENTITLEMENT_SQL = `
select
  e.role_id       as "role",
  v.version       as "frameworkVersion",
  e.assignment_id as "assignmentId",
  e.grains        as "grains",
  e.breakdowns    as "breakdowns"
from orbit.entitlements e
join orbit.framework_versions v on v.id = e.framework_version_id
where e.role_id = $1
order by e.assignment_id`;

export function createDbEntitlementSource(db: Database): EntitlementSource {
  return {
    forMembership: (membership) =>
      withMembershipTx(db, membership, (tx) => tx.query(ENTITLEMENT_SQL, [membership.role])),
  };
}

/**
 * Whether an entity is visible to the membership. The organization-table
 * policies already encode the hierarchy (a region scope sees its facilities;
 * group scope sees its own tenant only), so "visible under RLS, in the
 * caller's organization" is the containment test. `group` is the
 * organization itself and needs an explicit group scope. `segment` has no
 * table (ADR 0010 §5.1), so it is never contained.
 */
const CONTAINS_SQL: Record<Exclude<ScopeEntity['grain'], 'segment'>, string> = {
  group: 'select (orbit.has_group_scope() and $1::uuid = orbit.current_org() and $1::uuid = $2::uuid) as "contained"',
  region: 'select exists (select 1 from orbit.regions where id = $1::uuid and organization_id = $2::uuid) as "contained"',
  facility: 'select exists (select 1 from orbit.facilities where id = $1::uuid and organization_id = $2::uuid) as "contained"',
  coe: 'select exists (select 1 from orbit.coes where id = $1::uuid and organization_id = $2::uuid) as "contained"',
};

const ContainedRowSchema = z.strictObject({ contained: z.boolean() });
const EntityIdSchema = z.uuid();

async function contained(tx: Tx, sql: string, entityId: string, organizationId: string): Promise<boolean> {
  const rows = await tx.query(sql, [entityId, organizationId]);
  const [row] = rows;
  if (rows.length !== 1 || !row) {
    return false;
  }
  const parsed = ContainedRowSchema.safeParse(row);
  return parsed.success && parsed.data.contained;
}

export function createDbScopeResolver(db: Database): ScopeResolver {
  return {
    async contains(membership: MembershipClaims, target: ScopeEntity): Promise<boolean> {
      // A non-uuid id names nothing in the database; answer "not contained"
      // rather than letting the ::uuid cast raise.
      if (target.grain === 'segment' || !EntityIdSchema.safeParse(target.entityId).success) {
        return false;
      }
      const sql = CONTAINS_SQL[target.grain];
      return withMembershipTx(db, membership, (tx) => contained(tx, sql, target.entityId, membership.organizationId));
    },
  };
}
