-- ============================================================================
-- 20260923000200_claims_helpers.sql
--
-- Read-only accessors for the per-transaction claims the API sets, so every
-- RLS policy reads them one way instead of re-deriving the parsing.
--
-- AUTHOR: Maruti (owns supabase/ per FILE_STRUCTURE.md §3)
-- DEPENDS ON: 20260923000100_orbit_roles_and_schema.sql (orbit schema, orbit_app)
--   That migration is authored by Aditya and proposed in ADR 0009. This file
--   assumes it has been applied first. Reviewed and signed off; see ADR 0009.
--
-- NONE OF THESE ARE `security definer`.
--   ADR 0002 rejected Option B precisely to avoid a standing RLS-bypassing
--   code path. These are plain `stable` functions that read transaction-local
--   settings and nothing else — they read no table, so they cannot leak a row.
--   If anyone later needs to add `security definer` to a function in this
--   schema, that is an ADR, not an edit.
--
-- Claims shape comes from `MembershipClaimsSchema` in @orbit/contracts
-- (merged in #5):
--   { membershipId, subject, organizationId, role, scopes: [{grain, entityId}] }
--
-- Two reserved settings, both transaction-local (ADR 0002, ADR 0009 §5):
--   orbit.subject    — lookup transaction only
--   orbit.membership — data transaction only
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Raw setting readers
--
-- The `nullif(..., '')` is load-bearing and not defensive noise: an unset
-- custom GUC reads back as the empty string, and ''::uuid RAISES rather than
-- returning null. Without the nullif, a missing claim turns what should be a
-- clean "deny, no rows" into a 500 (ADR 0002, ADR 0009 §5).
-- ---------------------------------------------------------------------------

create or replace function orbit.current_subject()
  returns uuid
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(current_setting('orbit.subject', true), '')::uuid
$$;

comment on function orbit.current_subject() is
  'JWT-verified subject for the bootstrap lookup transaction only. Null when '
  'unset, so policies match no rows rather than erroring. See ADR 0002.';

create or replace function orbit.current_membership()
  returns jsonb
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(current_setting('orbit.membership', true), '')::jsonb
$$;

comment on function orbit.current_membership() is
  'Verified membership claims for the data transaction. Null when unset. '
  'Shape matches MembershipClaimsSchema in @orbit/contracts.';

-- ---------------------------------------------------------------------------
-- Derived accessors
--
-- Each returns null when claims are absent or the field is missing, so a
-- policy comparing against them yields no rows. Never a default, never a
-- fallback, never a wildcard.
-- ---------------------------------------------------------------------------

create or replace function orbit.current_org()
  returns uuid
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(orbit.current_membership() ->> 'organizationId', '')::uuid
$$;

comment on function orbit.current_org() is
  'Organization from verified claims. The organization is NEVER taken from a '
  'request parameter (RULES.md); it comes from the single membership record.';

create or replace function orbit.current_role_id()
  returns text
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(orbit.current_membership() ->> 'role', '')
$$;

comment on function orbit.current_role_id() is
  'Role slug from verified claims, matching RoleIdSchema in @orbit/contracts '
  'and RoleDefinition.id in @orbit/kpi-framework.';

create or replace function orbit.current_membership_id()
  returns uuid
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(orbit.current_membership() ->> 'membershipId', '')::uuid
$$;

comment on function orbit.current_membership_id() is
  'Membership row id from verified claims.';

-- ---------------------------------------------------------------------------
-- Scope predicates
--
-- `scopes` is a JSON array of {grain, entityId}. A membership always carries
-- at least one scope (ScopeEntitySchema ... .min(1) in contracts).
--
-- DECISION — entityId holds a UUID, not a slug.
--   Contracts type it as z.string().min(1), which permits either. UUID is
--   chosen because these values are compared against primary keys inside RLS
--   policies: a slug would force a per-row subquery to resolve it, and would
--   break every stored scope if a slug were ever renamed. Raised with
--   Ghansham to tighten the contract to z.uuid().
--
-- For grain 'group' the entityId is the organization's own id — a group-scoped
-- role is scoped to the whole tenant, not to a separate entity.
-- ---------------------------------------------------------------------------

create or replace function orbit.scope_entity_ids(p_grain text)
  returns setof uuid
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select (scope ->> 'entityId')::uuid
  from jsonb_array_elements(
         coalesce(orbit.current_membership() -> 'scopes', '[]'::jsonb)
       ) as scope
  where scope ->> 'grain' = p_grain
    and nullif(scope ->> 'entityId', '') is not null
$$;

comment on function orbit.scope_entity_ids(text) is
  'Entity ids the current membership is scoped to at one grain. Empty when '
  'claims are absent, so a policy using IN (...) matches no rows.';

create or replace function orbit.has_group_scope()
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select exists (select 1 from orbit.scope_entity_ids('group'))
$$;

comment on function orbit.has_group_scope() is
  'True when the membership is scoped at group grain. Group scope grants '
  'breadth within the caller''s own organization only -- never across tenants, '
  'and never an automatic cascade into another role''s KPI set (ARCH §8.1).';

create or replace function orbit.is_scoped_to(p_grain text, p_entity_id uuid)
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select p_entity_id is not null
     and exists (
           select 1
           from orbit.scope_entity_ids(p_grain) as scoped(id)
           where scoped.id = p_entity_id
         )
$$;

comment on function orbit.is_scoped_to(text, uuid) is
  'True when the membership explicitly lists this entity at this grain.';

-- ---------------------------------------------------------------------------
-- Function privileges
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. The bootstrap
-- migration's `alter default privileges ... revoke all on functions from anon,
-- authenticated` does not cover PUBLIC, so revoke it explicitly here and then
-- grant only to orbit_app. Without this, every role on the cluster could call
-- these — harmless today because they read only settings, but the grant
-- posture should not depend on the function bodies staying harmless.
-- ---------------------------------------------------------------------------

revoke execute on function
    orbit.current_subject(),
    orbit.current_membership(),
    orbit.current_org(),
    orbit.current_role_id(),
    orbit.current_membership_id(),
    orbit.scope_entity_ids(text),
    orbit.has_group_scope(),
    orbit.is_scoped_to(text, uuid)
  from public;

grant execute on function
    orbit.current_subject(),
    orbit.current_membership(),
    orbit.current_org(),
    orbit.current_role_id(),
    orbit.current_membership_id(),
    orbit.scope_entity_ids(text),
    orbit.has_group_scope(),
    orbit.is_scoped_to(text, uuid)
  to orbit_app;
