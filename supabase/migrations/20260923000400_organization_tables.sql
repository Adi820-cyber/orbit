-- ============================================================================
-- 20260923000400_organization_tables.sql
--
-- The fictional group's structure: organizations, regions, facilities, COEs.
--
-- AUTHOR: Maruti
-- SOURCE OF TRUTH: COMPANY_MANIFEST in @orbit/data-gen. Two regions and six
--   facilities (three per region) are workbook-derived; the COE structure is a
--   configuration choice, not a client fact (PRD §4 item 8).
--
-- UNLIKE THE FRAMEWORK TABLES, THIS IS TENANT DATA. Names, sites and
-- structure are scoped to the caller's organization and, below group grain,
-- to the entities their membership actually lists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organizations
--
-- `kind` separates the demo tenant from the isolation-test tenant. It is
-- descriptive only -- isolation is enforced by policy on organization_id, not
-- by this column. A test tenant is not "less protected"; it is a different
-- tenant, which is the whole point of the fixture.
-- ---------------------------------------------------------------------------
create table orbit.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  kind        text not null,
  -- Reporting currency and fiscal convention travel with the tenant so a
  -- money surface can state its unit without consulting application config.
  currency    text not null,
  fiscal_year_start_month smallint not null,
  timezone    text not null,
  created_at  timestamptz not null default now(),

  constraint organizations_kind_known check (kind in ('demo', 'test-fixture')),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint organizations_fiscal_month_valid
    check (fiscal_year_start_month between 1 and 12)
);

comment on table orbit.organizations is
  'Tenants. The demo group plus a separate test-fixture tenant used to prove '
  'cross-organization isolation (PRD §8.1).';

-- ---------------------------------------------------------------------------
-- Regions
-- ---------------------------------------------------------------------------
create table orbit.regions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations (id) on delete cascade,
  slug            text not null,
  name            text not null,
  short_name      text not null,

  constraint regions_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  unique (organization_id, slug)
);

-- ---------------------------------------------------------------------------
-- Facilities
--
-- `staffed_beds` is a capacity ANCHOR, not an observation. Capacity
-- utilisation is derived from staffed bed days built on this number, with an
-- explicit numerator and denominator, because the workbook requires the
-- capacity unit to be stated and forbids combining unlike units.
--
-- `revenue_weight` distributes group financial anchors across facilities.
-- Weights sum to 1 per organization -- asserted by pgTAP, since a cross-row
-- sum cannot be expressed as a single-row CHECK.
-- ---------------------------------------------------------------------------
create table orbit.facilities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations (id) on delete cascade,
  region_id       uuid not null references orbit.regions (id) on delete cascade,
  slug            text not null,
  name            text not null,
  staffed_beds    integer not null,
  revenue_weight  numeric(6, 5) not null,

  constraint facilities_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint facilities_staffed_beds_positive check (staffed_beds > 0),
  constraint facilities_revenue_weight_range
    check (revenue_weight > 0 and revenue_weight <= 1),
  unique (organization_id, slug)
);

comment on column orbit.facilities.staffed_beds is
  'Capacity anchor the generator derives staffed bed days from. Illustrative; '
  'not an observation and not a real bed count.';

create index facilities_region_idx on orbit.facilities (region_id);

-- ---------------------------------------------------------------------------
-- Centres of excellence
--
-- A COE reports at region or group grain. Both kinds exist deliberately so
-- cross-grain entitlement cases are testable (manifest comment explains why).
--
-- The CHECK pairs grain with region_id so a group-scoped COE cannot carry a
-- region and a region-scoped one cannot omit it. Without it, a COE could claim
-- group grain while pointing at one region, and a policy would have to guess.
--
-- COE output OVERLAPS facility totals -- it is a segment view of activity
-- already counted at its host facility. PRD §8.2 is explicit that segments must
-- never be added to the group a second time. That is a generator invariant;
-- recorded here because this is where the overlap originates.
-- ---------------------------------------------------------------------------
create table orbit.coes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references orbit.organizations (id) on delete cascade,
  host_facility_id  uuid not null references orbit.facilities (id) on delete cascade,
  slug              text not null,
  name              text not null,
  reporting_grain   text not null,
  region_id         uuid references orbit.regions (id) on delete cascade,

  constraint coes_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint coes_grain_known check (reporting_grain in ('region', 'group')),
  constraint coes_region_matches_grain check (
    (reporting_grain = 'region' and region_id is not null)
    or
    (reporting_grain = 'group' and region_id is null)
  ),
  unique (organization_id, slug)
);

comment on constraint coes_region_matches_grain on orbit.coes is
  'A region-scoped COE must name its region; a group-scoped one must not carry '
  'one. Prevents a COE whose grain and region disagree.';

create index coes_host_facility_idx on orbit.coes (host_facility_id);

-- ===========================================================================
-- Row level security
--
-- SCOPE MODEL. Two conditions, both required on every table:
--
--   1. Tenant:  organization_id = orbit.current_org()
--      This is the isolation boundary. Claims carry exactly one organization
--      (ADR 0002: one organization per user in this release), and it comes
--      from the membership record -- never from a request parameter.
--
--   2. Grain:   group scope sees the whole tenant; otherwise the membership
--      must explicitly list the entity, or an ancestor of it.
--
-- Ancestry is walked DOWNWARD only, and only one step at a time:
--   region scope  → that region's facilities, and COEs reporting to it
--   facility scope → COEs hosted at that facility
--
-- A facility-scoped membership never sees its region's other facilities.
-- ARCH §8.1 rules out a hierarchy cascade, and PRD §4 item 3 says comparing
-- facilities requires an explicit facility-breakdown grant -- so breadth comes
-- from listing entities in `scopes`, not from inferring upward.
--
-- Note on permissive policies: multiple permissive policies OR together
-- [ARCH S2]. Each table below has exactly ONE select policy, so there is
-- nothing to OR with. Anyone adding a second must re-read the combined effect
-- rather than assuming policies narrow.
--
-- No write policies. Structure is loaded by the seeder through the
-- migration/owner path (ADR 0009 §2); orbit_app gets SELECT only.
-- ===========================================================================

alter table orbit.organizations enable row level security;
alter table orbit.regions       enable row level security;
alter table orbit.facilities    enable row level security;
alter table orbit.coes          enable row level security;

alter table orbit.organizations force row level security;
alter table orbit.regions       force row level security;
alter table orbit.facilities    force row level security;
alter table orbit.coes          force row level security;

-- Own tenant only.
create policy organizations_select_own_tenant
  on orbit.organizations
  for select
  to orbit_app
  using (id = orbit.current_org());

-- Own tenant, and either group scope or this region explicitly listed.
create policy regions_select_in_scope
  on orbit.regions
  for select
  to orbit_app
  using (
    organization_id = orbit.current_org()
    and (
      orbit.has_group_scope()
      or orbit.is_scoped_to('region', id)
    )
  );

-- Own tenant, and group scope, or this facility listed, or its region listed.
create policy facilities_select_in_scope
  on orbit.facilities
  for select
  to orbit_app
  using (
    organization_id = orbit.current_org()
    and (
      orbit.has_group_scope()
      or orbit.is_scoped_to('facility', id)
      or orbit.is_scoped_to('region', region_id)
    )
  );

-- Own tenant, and group scope, or this COE listed, or its region listed, or
-- the facility hosting it listed.
create policy coes_select_in_scope
  on orbit.coes
  for select
  to orbit_app
  using (
    organization_id = orbit.current_org()
    and (
      orbit.has_group_scope()
      or orbit.is_scoped_to('coe', id)
      or orbit.is_scoped_to('region', region_id)
      or orbit.is_scoped_to('facility', host_facility_id)
    )
  );

-- ===========================================================================
-- Grants
-- ===========================================================================

grant select on orbit.organizations to orbit_app;
grant select on orbit.regions       to orbit_app;
grant select on orbit.facilities    to orbit_app;
grant select on orbit.coes          to orbit_app;
