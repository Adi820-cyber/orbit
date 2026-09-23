-- ============================================================================
-- 20260923000500_memberships_and_entitlements.sql
--
-- The trusted membership store and the entitlement matrix. This is the
-- authorization root: every scope decision downstream resolves to a row here.
--
-- AUTHOR: Maruti
-- IMPLEMENTS: ADR 0002 (membership bootstrap, two transactions, cardinality)
--             ADR 0005 (entitlement matrix is global per framework version)
-- DEPENDS ON: 000100 (orbit schema, orbit_app), 000200 (claims helpers),
--             000300 (role_ids), 000400 (organizations, regions, facilities, coes)
--
-- THE BOOTSTRAP PROBLEM, and how this file resolves it (ADR 0002 Option A):
--   To build `orbit.membership` claims, the API must first read the caller's
--   membership row. But if that table's policy reads `orbit.membership`, the
--   setting does not exist yet -- the first read cannot authorize itself with
--   the thing it is trying to produce.
--
--   Resolution: the lookup transaction sets ONLY `orbit.subject` (the
--   JWT-verified user id), and this table carries a self-read policy keyed on
--   that. Nothing in the pipeline runs with RLS bypassed, and the whole
--   authorization story stays in declarative policies a reviewer can audit by
--   reading this file. Option B (a `security definer` function) was rejected
--   because it would add a standing RLS bypass whose safety depends on a
--   function body staying correct forever.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Memberships
--
-- One row per (user, organization) assignment. `subject` is the Supabase Auth
-- user id from the verified JWT -- NOT a foreign key to auth.users, because
-- this schema must stay portable to AWS (ARCH: preserve the migration path)
-- and must not depend on a vendor-owned table's shape.
--
-- Scopes live in a child table, not a JSONB column, so a scope must point at
-- an entity that actually exists. See orbit.org_membership_scopes below.
-- ---------------------------------------------------------------------------
create table orbit.org_memberships (
  id              uuid primary key default gen_random_uuid(),
  subject         uuid not null,
  organization_id uuid not null references orbit.organizations (id) on delete cascade,
  -- Version-independent: a new workbook import must not invalidate a user's
  -- role. See the note on orbit.role_ids in migration 000300.
  role_id         text not null references orbit.role_ids (role_id),
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Matches MembershipSchema.status in @orbit/contracts.
  constraint org_memberships_status_known check (status in ('active', 'inactive'))
);

comment on table orbit.org_memberships is
  'The trusted membership store. Role and organization come from here and '
  'nowhere else -- never from a request field, URL, or model output (RULES.md).';

comment on column orbit.org_memberships.subject is
  'Supabase Auth user id from the verified JWT. Intentionally not an FK to '
  'auth.users, to keep this schema portable and independent of a vendor table.';

-- ---------------------------------------------------------------------------
-- Cardinality — exactly one active membership per subject
--
-- ADR 0002 decided: "One organization per user in this release. Exactly one
-- active membership per subject, full stop."
--
-- I am taking the STRICTER of the two indexes the ADR offered. The looser
-- `(subject, organization_id)` variant permits one active row per org, so a
-- subject active in two organizations would satisfy the index and still be
-- ambiguous -- leaving the decided rule enforced only by application code.
-- This index makes the decided rule unrepresentable instead.
--
-- The API still implements its refusal path. That is not redundancy: the
-- constraint prevents the bad state, the check prevents a silent wrong answer
-- if this index is ever dropped, mis-scoped, or not yet applied.
--
-- If multi-organization users are ever wanted, relaxing this to
-- `(subject, organization_id)` is a deliberate, reviewable migration -- and it
-- would also require a contract change so the request names the organization
-- and the server verifies that choice (ADR 0002). Not a handler tweak.
--
-- Partial, so inactive history is retained: a subject may keep any number of
-- inactive rows, which is what makes "membership exists but is inactive"
-- distinguishable from "no membership at all".
-- ---------------------------------------------------------------------------
create unique index org_memberships_one_active_per_subject
  on orbit.org_memberships (subject)
  where status = 'active';

create index org_memberships_subject_idx on orbit.org_memberships (subject);
create index org_memberships_organization_idx on orbit.org_memberships (organization_id);

-- ---------------------------------------------------------------------------
-- Membership scopes
--
-- Mirrors ScopeEntitySchema in @orbit/contracts: {grain, entityId}. A
-- membership always carries at least one scope (the contract's .min(1));
-- enforced by pgTAP, since a cross-row minimum is not a single-row CHECK.
--
-- POLYMORPHIC TARGET, ENFORCED PROPERLY:
--   A scope points at a region, facility, or COE depending on grain. Rather
--   than one untyped uuid column with no referential integrity, there is a
--   nullable FK per grain and a CHECK that exactly the right one is set. A
--   scope therefore cannot name an entity that does not exist, or name a
--   facility while claiming region grain.
--
--   `entity_id` is a generated column so claim-building reads one value
--   regardless of grain, and cannot disagree with the typed columns.
--
-- GRAIN 'group': all three FKs are null and entity_id falls back to
--   organization_id -- a group-scoped role is scoped to the whole tenant, not
--   to a separate entity.
--
-- GRAIN 'segment': present in the contract's GrainSchema but deliberately
--   REJECTED here. Corporate/payer segments have no table yet, so a segment
--   scope could not be validated or joined. Accepting one would mean storing an
--   unverifiable authorization claim. This fails closed until segments are
--   modelled; raised with Aditya and Ghansham as a known contract/schema gap.
-- ---------------------------------------------------------------------------
create table orbit.org_membership_scopes (
  id              uuid primary key default gen_random_uuid(),
  -- No simple FK on membership_id alone: the composite FK added below covers
  -- it and additionally pins organization_id to the parent, so a single
  -- constraint enforces both. Two overlapping FKs would be redundant noise.
  membership_id   uuid not null,
  -- Denormalized from the parent so the self-read policy and the generated
  -- entity_id do not need a join. Kept consistent by the composite FK below.
  organization_id uuid not null,
  grain           text not null,
  region_id       uuid references orbit.regions (id) on delete cascade,
  facility_id     uuid references orbit.facilities (id) on delete cascade,
  coe_id          uuid references orbit.coes (id) on delete cascade,

  entity_id uuid generated always as (
    coalesce(region_id, facility_id, coe_id, organization_id)
  ) stored,

  constraint scopes_grain_known
    check (grain in ('group', 'region', 'facility', 'coe')),

  -- Exactly one typed target per grain, and none for group.
  constraint scopes_target_matches_grain check (
    (grain = 'group'    and region_id is null     and facility_id is null and coe_id is null)
    or
    (grain = 'region'   and region_id is not null and facility_id is null and coe_id is null)
    or
    (grain = 'facility' and region_id is null     and facility_id is not null and coe_id is null)
    or
    (grain = 'coe'      and region_id is null     and facility_id is null and coe_id is not null)
  ),

  -- One scope row per (membership, grain, entity). Uses the generated column so
  -- the same entity cannot be listed twice at the same grain.
  unique (membership_id, grain, entity_id)
);

comment on table orbit.org_membership_scopes is
  'Entities a membership is scoped to. Typed FK per grain so a scope cannot '
  'name a nonexistent entity. Grain "segment" is rejected until segments exist.';

comment on column orbit.org_membership_scopes.entity_id is
  'Generated. The uuid the API puts in ScopeEntity.entityId. For group grain '
  'this is the organization id.';

-- Keeps the denormalized organization_id honest against the parent row.
alter table orbit.org_memberships
  add constraint org_memberships_id_org_unique unique (id, organization_id);

alter table orbit.org_membership_scopes
  add constraint scopes_membership_org_matches
  foreign key (membership_id, organization_id)
  references orbit.org_memberships (id, organization_id) on delete cascade;

create index org_membership_scopes_membership_idx
  on orbit.org_membership_scopes (membership_id);

-- ---------------------------------------------------------------------------
-- Entitlement matrix
--
-- ADR 0005: "the entitlement matrix is global, keyed per role and per
-- framework/definition version." So there is deliberately NO organization_id
-- here -- entitlements describe what a ROLE may see, not what a tenant owns.
-- Tenant isolation is enforced on the data tables, not by duplicating the
-- matrix per organization.
--
-- Shape mirrors EntitlementSchema in @orbit/contracts: role, assignmentId,
-- grains[], breakdowns[].
--
-- `grains` and `breakdowns` are arrays rather than a child table: they are
-- small fixed enums, this is reference data, and the arrays map 1:1 to the
-- contract. Element values are validated by CHECK so a typo cannot enter.
--
-- NOT MODELLED YET, deliberately: evidence fields, action permissions, and
-- audit access. ADR 0005 and the contract both leave these out until the
-- matrix review defines them. Adding speculative columns now would invite
-- code that reads them before anyone agreed what they mean.
-- ---------------------------------------------------------------------------
create table orbit.entitlements (
  id                   uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references orbit.framework_versions (id) on delete cascade,
  role_id              text not null references orbit.role_ids (role_id),
  assignment_id        text not null,
  -- Grains at which this role may read the assignment.
  grains               text[] not null,
  -- Grains this role may break the assignment down by. May be empty: an
  -- aggregate without a permitted breakdown is a real and intended state
  -- (PRD FR-04: "A group KPI may have an authorized aggregate without
  -- exposing its raw contributors").
  breakdowns           text[] not null default '{}',

  constraint entitlements_grains_not_empty check (cardinality(grains) > 0),
  constraint entitlements_grains_valid check (
    grains <@ array['group', 'region', 'facility', 'coe', 'segment']::text[]
  ),
  constraint entitlements_breakdowns_valid check (
    breakdowns <@ array['group', 'region', 'facility', 'coe', 'segment']::text[]
  ),

  unique (framework_version_id, role_id, assignment_id),
  foreign key (framework_version_id, assignment_id)
    references orbit.role_kpi_assignments (framework_version_id, assignment_id)
    on delete cascade
);

comment on table orbit.entitlements is
  'Global per framework version, keyed by role and assignment (ADR 0005). No '
  'organization column by design -- this says what a role may see, not what a '
  'tenant owns.';

create index entitlements_role_idx
  on orbit.entitlements (framework_version_id, role_id);

-- ===========================================================================
-- Row level security
-- ===========================================================================

alter table orbit.org_memberships       enable row level security;
alter table orbit.org_membership_scopes enable row level security;
alter table orbit.entitlements          enable row level security;

alter table orbit.org_memberships       force row level security;
alter table orbit.org_membership_scopes force row level security;
alter table orbit.entitlements          force row level security;

-- ---------------------------------------------------------------------------
-- Bootstrap self-read — the lookup transaction
--
-- Keyed on `orbit.subject`, which is the only thing the API can trust before
-- claims exist. `orbit.current_subject()` applies the required
-- `nullif(current_setting('orbit.subject', true), '')::uuid`: without the
-- nullif, an unset setting reads as the empty string and `''::uuid` RAISES,
-- turning a clean deny into a 500 (ADR 0002).
--
-- RETURNS ALL OF THE SUBJECT'S ROWS, INCLUDING INACTIVE ONES. This is
-- deliberate and was the correction Ghansham flagged. If this policy filtered
-- `status = 'active'`, then "no membership" and "membership exists but is
-- inactive" would be indistinguishable to the API, and its required failure
-- path could not tell them apart. Filtering here would hide the case the
-- pipeline exists to detect.
--
-- The API is what enforces exactly-one-active and refuses otherwise; all three
-- failure cases return 403 on the wire with the reason logged server-side
-- (ADR 0002), so no account state leaks to an unauthorized caller.
--
-- Note this policy never reads `orbit.membership`. In the data transaction
-- `orbit.subject` is unset, so `current_subject()` is null and this policy
-- matches nothing -- which is exactly why ADR 0002 chose two transactions.
-- With one transaction this policy would stay live alongside handler queries
-- and could OR with them, widening visibility [ARCH S2].
-- ---------------------------------------------------------------------------
create policy org_memberships_select_own_subject
  on orbit.org_memberships
  for select
  to orbit_app
  using (subject = orbit.current_subject());

-- Same rule for the child table, or the bootstrap read cannot assemble
-- complete claims (ADR 0002 consequences).
create policy org_membership_scopes_select_own_subject
  on orbit.org_membership_scopes
  for select
  to orbit_app
  using (
    exists (
      select 1
      from orbit.org_memberships m
      where m.id = org_membership_scopes.membership_id
        and m.subject = orbit.current_subject()
    )
  );

-- ---------------------------------------------------------------------------
-- Entitlements — own role only
--
-- The scope plugin asks "may membership X read assignment Y at grain Z?", so
-- the API only ever needs the caller's own role's rows. Restricting to the
-- caller's role keeps deny-by-default and matches ARCH §8.1's no-cascade rule:
-- a role must not be able to enumerate another role's entitlements.
--
-- Reads `orbit.membership`, so this resolves in the DATA transaction. It is
-- unreadable during bootstrap, which is correct -- entitlements are not needed
-- to build claims.
-- ---------------------------------------------------------------------------
create policy entitlements_select_own_role
  on orbit.entitlements
  for select
  to orbit_app
  using (role_id = orbit.current_role_id());

-- ===========================================================================
-- Grants
--
-- SELECT ONLY, on all three tables.
--
-- A policy is a row filter, not a privilege -- ADR 0002 makes the point that
-- both the grant and the policy are required and neither substitutes for the
-- other. Equally, the absence of a write grant is what makes writes impossible
-- here: memberships and entitlements are provisioned out of band (PRD FR-01,
-- "no end-user role or scope changes") and seeded through the migration/owner
-- path (ADR 0009 §2). The application must never be able to grant itself
-- scope, so there is no INSERT/UPDATE/DELETE grant and no write policy to
-- pair with one.
-- ===========================================================================

grant select on orbit.org_memberships       to orbit_app;
grant select on orbit.org_membership_scopes to orbit_app;
grant select on orbit.entitlements          to orbit_app;
