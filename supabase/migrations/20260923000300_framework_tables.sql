-- ============================================================================
-- 20260923000300_framework_tables.sql
--
-- The workbook framework as data: 14 roles, 29 definition families, 109
-- role-KPI assignments, their component decompositions, and the governance /
-- targeting rules.
--
-- AUTHOR: Maruti
-- SOURCE OF TRUTH: @orbit/kpi-framework, generated from
--   Africare_Group_KPI_Framework.xlsx. These tables are LOADED FROM that
--   package -- they are not a second, hand-maintained copy of the workbook.
--   The package's checksum is recorded per row-set so drift is detectable.
--
-- VERSIONED, NOT MUTATED. PRD §7.2 requires definitions, targets, directions,
-- weights and effective periods to be versioned. Every table here carries
-- `framework_version`, and rows are inserted for a new version rather than
-- updated in place, so an observation can always name the definition version
-- it was computed under.
--
-- Grants and RLS are in this file with the tables, per ARCH §7.2.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Framework version
--
-- One row per import of the workbook. `source_checksum` is the SHA-256 of the
-- workbook bytes, taken straight from FRAMEWORK_MANIFEST in
-- @orbit/kpi-framework, so a reviewer can tie any row back to an exact file.
-- ---------------------------------------------------------------------------
create table orbit.framework_versions (
  id                uuid primary key default gen_random_uuid(),
  version           text        not null unique,
  source_file_name  text        not null,
  source_checksum   text        not null,
  role_count        integer     not null,
  assignment_count  integer     not null,
  definition_count  integer     not null,
  is_current        boolean     not null default false,
  created_at        timestamptz not null default now(),

  constraint framework_versions_checksum_is_sha256
    check (source_checksum ~ '^[a-f0-9]{64}$'),
  constraint framework_versions_counts_positive
    check (role_count > 0 and assignment_count > 0 and definition_count > 0)
);

comment on table orbit.framework_versions is
  'One row per workbook import. Checksum ties rows to exact source bytes.';

-- Exactly one version may be current at a time.
--
-- Indexes the boolean column filtered to true rows, rather than the
-- `((true))` constant-expression idiom. Both express "at most one current
-- row", but a constant index expression is an unusual construct I could not
-- verify against a server, and this form is plainly valid.
create unique index framework_versions_single_current
  on orbit.framework_versions (is_current)
  where is_current;

-- ---------------------------------------------------------------------------
-- Canonical role slugs — VERSION-INDEPENDENT
--
-- Why this exists separately from `orbit.roles`:
--   `orbit.roles` is per framework version, because a future workbook revision
--   could restate a role's focus, cadence or KPI count. But a MEMBERSHIP must
--   not be tied to a framework version -- importing a new workbook would
--   otherwise invalidate every user's role, or force memberships to be
--   rewritten on every import.
--
--   So the slug set lives here, once, and both `orbit.roles` (versioned
--   detail) and `orbit.org_memberships` (in a later migration) reference it.
--   That gives memberships real referential integrity without a CHECK that
--   hardcodes 14 strings and silently drifts from the framework.
--
-- Seeded from ROLE_IDS in @orbit/kpi-framework, which has a test asserting the
-- set matches RoleIdSchema in @orbit/contracts.
-- ---------------------------------------------------------------------------
create table orbit.role_ids (
  role_id text primary key,

  constraint role_ids_slug_format check (role_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table orbit.role_ids is
  'The 14 canonical role slugs, independent of framework version. Memberships '
  'reference this, never the versioned orbit.roles table.';

-- ---------------------------------------------------------------------------
-- Roles (14) — versioned detail
-- ---------------------------------------------------------------------------
create table orbit.roles (
  id                   uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references orbit.framework_versions (id) on delete cascade,
  -- Stable slug. Matches RoleIdSchema in @orbit/contracts and
  -- RoleDefinition.id in @orbit/kpi-framework (asserted by a test there).
  role_id              text not null references orbit.role_ids (role_id),
  -- Canonical workbook name. PRD §4 forbids renaming roles, so this is stored
  -- verbatim and never derived from the slug.
  name                 text not null,
  level                text not null,
  reports_to           text not null,
  deployment           text not null,
  primary_focus        text not null,
  cadence              text not null,
  kpi_count            integer not null,

  constraint roles_kpi_count_positive check (kpi_count > 0),
  constraint roles_slug_format check (role_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  unique (framework_version_id, role_id)
);

comment on column orbit.roles.role_id is
  'Stable slug, e.g. regional-coo. The wire and storage identity for a role.';
comment on column orbit.roles.name is
  'Canonical workbook name, stored verbatim. Never renamed (PRD §4).';

-- ---------------------------------------------------------------------------
-- KPI definition families (29)
-- ---------------------------------------------------------------------------
create table orbit.kpi_definitions (
  id                            uuid primary key default gen_random_uuid(),
  framework_version_id          uuid not null references orbit.framework_versions (id) on delete cascade,
  family                        text not null,
  standard_definition           text not null,
  numerator_denominator_control text not null,
  target_steward                text not null,
  primary_source                text not null,
  notes                         text not null default '',
  source_row                    integer not null,

  unique (framework_version_id, family)
);

comment on table orbit.kpi_definitions is
  'The 29 definition families. Definitional reference, not observations.';

-- ---------------------------------------------------------------------------
-- Role-KPI assignments (109)
--
-- `assignment_id` is the stable `<roleId>:<kpi-slug>` identifier from
-- @orbit/kpi-framework. Entitlements key on it (EntitlementSchema.assignmentId
-- in @orbit/contracts), so it must not be derived from the workbook row
-- number -- inserting a row upstream would silently repoint every entitlement.
-- ---------------------------------------------------------------------------
create table orbit.role_kpi_assignments (
  id                   uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references orbit.framework_versions (id) on delete cascade,
  assignment_id        text not null,
  role_id              text not null,
  kpi                  text not null,
  key_deliverable      text not null,
  definition           text not null,
  -- Fraction in (0,1]. Weights for one role and version sum to 1; asserted by
  -- a pgTAP test rather than a constraint, because no single-row CHECK can
  -- express a cross-row sum.
  weight               numeric(6, 5) not null,
  target_basis         text not null,
  review               text not null,
  primary_data_source  text not null,
  key_collaborator     text not null default '',
  -- Traceability only. Deliberately NOT part of any identifier.
  source_row           integer not null,

  constraint assignments_weight_range check (weight > 0 and weight <= 1),
  constraint assignments_id_format
    check (assignment_id ~ '^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$'),
  unique (framework_version_id, assignment_id),
  foreign key (framework_version_id, role_id)
    references orbit.roles (framework_version_id, role_id) on delete cascade
);

comment on column orbit.role_kpi_assignments.assignment_id is
  'Stable <roleId>:<kpi-slug>. Entitlements reference this. Independent of '
  'workbook row order so upstream row inserts cannot repoint entitlements.';
comment on column orbit.role_kpi_assignments.source_row is
  'Workbook row for traceability only. Never an identifier.';

create index role_kpi_assignments_role_idx
  on orbit.role_kpi_assignments (framework_version_id, role_id);

-- ---------------------------------------------------------------------------
-- Assignment → definition family mapping
--
-- Most assignments map to one family; 8 of the 109 bundle two (ADR 0004,
-- PRD §3.1: "109 assignments are not necessarily 109 distinct underlying
-- metrics"). A join table is required -- a nullable column on the assignment
-- could not represent the bundled case without losing one of the families.
--
-- `component_position` preserves the order the assignment's own title presents the
-- measures in, so "claim clean rate and denial value" keeps acceptance before
-- denial rather than acquiring an arbitrary order.
-- ---------------------------------------------------------------------------
create table orbit.definition_components (
  id                   uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references orbit.framework_versions (id) on delete cascade,
  assignment_id        text not null,
  family               text not null,
  -- Named `component_position`, not `position`: POSITION is a SQL keyword and
  -- a Postgres function name. It is usable as a column name, but only with
  -- care in expressions, and there is no reason to spend that care here.
  component_position   smallint not null,
  -- Set when the workbook's wording could not be resolved to a family with
  -- confidence. RULES.md requires unresolved compound-metric decompositions to
  -- be flagged, never faked. Currently zero rows carry this; the column exists
  -- so a future workbook revision has somewhere honest to land.
  unresolved_reason    text,

  constraint definition_components_position_positive check (component_position >= 0),
  unique (framework_version_id, assignment_id, family),
  foreign key (framework_version_id, assignment_id)
    references orbit.role_kpi_assignments (framework_version_id, assignment_id) on delete cascade,
  foreign key (framework_version_id, family)
    references orbit.kpi_definitions (framework_version_id, family) on delete cascade
);

comment on table orbit.definition_components is
  'Decomposes bundled assignments into definition families. See ADR 0004.';

-- ---------------------------------------------------------------------------
-- Governance and targeting rules
-- ---------------------------------------------------------------------------
create table orbit.governance_rules (
  id                      uuid primary key default gen_random_uuid(),
  framework_version_id    uuid not null references orbit.framework_versions (id) on delete cascade,
  kpi_family_group        text not null,
  target_setting_approach text not null,
  target_owner            text not null,
  definition_owner        text not null,
  reporting_cadence       text not null,
  escalation_review       text not null,
  source_row              integer not null,

  unique (framework_version_id, kpi_family_group)
);

comment on table orbit.governance_rules is
  'Workbook targeting rules. Records how targets are set -- does NOT contain '
  'approved numeric targets. The workbook has none (PRD §3.1) and inventing '
  'them is forbidden (RULES.md).';

-- ---------------------------------------------------------------------------
-- Enterprise outcomes (8)
-- ---------------------------------------------------------------------------
create table orbit.enterprise_outcomes (
  id                          uuid primary key default gen_random_uuid(),
  framework_version_id        uuid not null references orbit.framework_versions (id) on delete cascade,
  outcome                     text not null,
  cmo_accountability          text not null,
  primary_contribution_owners text not null,
  target_basis                text not null,
  review                      text not null,
  data_source                 text not null,
  source_row                  integer not null,

  unique (framework_version_id, outcome)
);

-- ===========================================================================
-- Row level security
--
-- Enabled in the same migration as each table (ARCH §7.2 item 1), one policy
-- per operation (item 4), never `for all`, never USING(true).
--
-- READ MODEL, and why it is not uniform:
--
--   roles, kpi_definitions, governance_rules, enterprise_outcomes, and
--   framework_versions are DEFINITIONAL. They describe how measurement works
--   and contain no tenant data and no observations. Any caller holding valid
--   membership claims may read them -- the explorer has to render a KPI's
--   definition, unit, direction and target basis to be useful at all
--   (PRD FR-04).
--
--   role_kpi_assignments and definition_components are restricted to the
--   CALLER'S OWN ROLE. ARCH §8.1 is explicit that there is no hierarchy
--   cascade and that per-role KPI sets define visibility; the Chairman does
--   not inherit anyone's scope. Letting any role enumerate all 109 rows would
--   contradict that, and nothing in the product needs it: a dashboard renders
--   its own role's assignments.
--
--   This is deliberately the tighter of the two readings. If a future role --
--   Head of Analytics reviewing framework coverage, or an entitlement-matrix
--   admin surface -- genuinely needs cross-role visibility, that is an
--   entitlement to add with a reviewed policy, not a default to leave open.
--
-- No INSERT, UPDATE or DELETE policy exists on any table here. Framework data
-- is loaded by the seeder through the migration/owner path (ADR 0009 §2), and
-- orbit_app is granted SELECT only, so the application can never rewrite the
-- workbook at runtime.
-- ===========================================================================

alter table orbit.role_ids             enable row level security;
alter table orbit.framework_versions   enable row level security;
alter table orbit.roles                enable row level security;
alter table orbit.kpi_definitions      enable row level security;
alter table orbit.role_kpi_assignments enable row level security;
alter table orbit.definition_components enable row level security;
alter table orbit.governance_rules     enable row level security;
alter table orbit.enterprise_outcomes  enable row level security;

-- Defence in depth: if ownership is ever changed so that orbit_app owns a
-- table, FORCE keeps policies applying to the owner too. Without it,
-- nobypassrls on the role would be silently undone by ownership
-- (ADR 0009 §6 left this to my judgement -- taking it).
alter table orbit.role_ids             force row level security;
alter table orbit.framework_versions   force row level security;
alter table orbit.roles                force row level security;
alter table orbit.kpi_definitions      force row level security;
alter table orbit.role_kpi_assignments force row level security;
alter table orbit.definition_components force row level security;
alter table orbit.governance_rules     force row level security;
alter table orbit.enterprise_outcomes  force row level security;

-- --- definitional reference: any valid membership may read ------------------

create policy role_ids_select_with_claims
  on orbit.role_ids
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

create policy framework_versions_select_with_claims
  on orbit.framework_versions
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

create policy roles_select_with_claims
  on orbit.roles
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

create policy kpi_definitions_select_with_claims
  on orbit.kpi_definitions
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

create policy governance_rules_select_with_claims
  on orbit.governance_rules
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

create policy enterprise_outcomes_select_with_claims
  on orbit.enterprise_outcomes
  for select
  to orbit_app
  using (orbit.current_membership() is not null);

-- --- assignments: own role only, no cascade ---------------------------------

create policy role_kpi_assignments_select_own_role
  on orbit.role_kpi_assignments
  for select
  to orbit_app
  using (role_id = orbit.current_role_id());

create policy definition_components_select_own_role
  on orbit.definition_components
  for select
  to orbit_app
  using (
    exists (
      select 1
      from orbit.role_kpi_assignments a
      where a.framework_version_id = definition_components.framework_version_id
        and a.assignment_id        = definition_components.assignment_id
        and a.role_id              = orbit.current_role_id()
    )
  );

-- ===========================================================================
-- Grants
--
-- The bootstrap migration revoked default privileges, so nothing is implicit.
-- SELECT only: an RLS policy filters rows but grants no privilege, and a
-- privilege without a policy still yields nothing -- both are required
-- (ADR 0002 makes this point about org_memberships; it applies here too).
-- ===========================================================================

grant select on orbit.role_ids             to orbit_app;
grant select on orbit.framework_versions   to orbit_app;
grant select on orbit.roles                to orbit_app;
grant select on orbit.kpi_definitions      to orbit_app;
grant select on orbit.role_kpi_assignments to orbit_app;
grant select on orbit.definition_components to orbit_app;
grant select on orbit.governance_rules     to orbit_app;
grant select on orbit.enterprise_outcomes  to orbit_app;
