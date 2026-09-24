-- ============================================================================
-- 20260924000800_kpi_data.sql
--
-- The derived KPI data the brief, inbox, explorer and Ask read: the current
-- dataset, KPI observations, exceptions, and data limitations (PRD FR-02..05,
-- §8; ARCHITECTURE.md §7.1 "Derived").
--
-- AUTHORED BY: Ghansham, at the product owner's request, for Maruti's review
-- (supabase/ is her path). Additive only.
--
-- Read-only for the API: rows are written by the environment-restricted seed
-- (ARCHITECTURE.md §7.5), never by orbit_app. Shapes follow @orbit/contracts:
-- nested parts (value, components, target, data quality, detection, evidence)
-- are stored as jsonb already in contract form, and the API parses every row.
--
-- Depends on orbit.scope_within_caller() from 20260924000700.
-- ============================================================================

create table orbit.datasets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references orbit.organizations (id) on delete cascade,
  checksum              text not null,
  definition_version    text not null,
  as_of                 timestamptz not null,
  current_period_cadence text not null,
  current_period_start  date not null,
  current_period_end    date not null,
  is_current            boolean not null default false,
  created_at            timestamptz not null default now(),
  constraint datasets_cadence_known check (current_period_cadence in ('month', 'quarter', 'year')),
  constraint datasets_period_ordered check (current_period_start <= current_period_end),
  unique (organization_id, checksum)
);

-- At most one current dataset per organization.
create unique index datasets_one_current on orbit.datasets (organization_id) where is_current;

create table orbit.kpi_observations (
  id                 uuid primary key default gen_random_uuid(),
  observation_key    text not null,
  organization_id    uuid not null references orbit.organizations (id) on delete cascade,
  dataset_id         uuid not null references orbit.datasets (id) on delete cascade,
  assignment_id      text not null,
  definition_family  text not null,
  definition_version text not null,
  entity_grain       text not null,
  entity_id          uuid not null,
  period_cadence     text not null,
  period_start       date not null,
  period_end         date not null,
  unit               text not null,
  value              jsonb not null,
  components         jsonb not null default '[]',
  target             jsonb not null,
  data_quality       jsonb not null,
  -- PRD §8.4: synthetic data is illustrative, and nothing else may be stored here.
  provenance         text not null default 'illustrative',
  constraint kpi_observations_grain_known check (entity_grain in ('group', 'region', 'facility', 'coe')),
  constraint kpi_observations_cadence_known check (period_cadence in ('month', 'quarter', 'year')),
  constraint kpi_observations_period_ordered check (period_start <= period_end),
  constraint kpi_observations_illustrative check (provenance = 'illustrative'),
  unique (dataset_id, observation_key)
);

create index kpi_observations_series_idx
  on orbit.kpi_observations (assignment_id, entity_grain, entity_id, period_start);
create index kpi_observations_key_idx on orbit.kpi_observations (observation_key);

create table orbit.exceptions (
  id               uuid primary key default gen_random_uuid(),
  exception_key    text not null,
  organization_id  uuid not null references orbit.organizations (id) on delete cascade,
  dataset_id       uuid not null references orbit.datasets (id) on delete cascade,
  assignment_id    text not null,
  entity_grain     text not null,
  entity_id        uuid not null,
  period_cadence   text not null,
  period_start     date not null,
  period_end       date not null,
  priority         text not null,
  category         text not null,
  comparison_basis text not null,
  detection        jsonb not null,
  what_changed     text not null,
  why_it_matters   text not null,
  owner_role       text not null references orbit.role_ids (role_id),
  evidence         jsonb not null,
  data_quality     jsonb not null,
  provenance       text not null default 'illustrative',
  constraint exceptions_priority_known check (priority in ('act_now', 'monitor')),
  constraint exceptions_category_known check (category in ('performance', 'safety', 'legal', 'compliance')),
  constraint exceptions_basis_known check (comparison_basis in ('prior_period', 'budget', 'target', 'none')),
  -- PRD FR-03: a reviewed rule or a labelled seeded scenario, nothing else.
  constraint exceptions_detection_known check (detection ->> 'kind' in ('reviewed_rule', 'seeded_scenario')),
  constraint exceptions_grain_known check (entity_grain in ('group', 'region', 'facility', 'coe')),
  constraint exceptions_illustrative check (provenance = 'illustrative'),
  unique (dataset_id, exception_key)
);

create table orbit.data_limitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orbit.organizations (id) on delete cascade,
  dataset_id      uuid not null references orbit.datasets (id) on delete cascade,
  assignment_id   text,
  issue           text not null,
  detail          text not null,
  constraint data_limitations_issue_known check (issue in ('late', 'stale', 'unreconciled', 'unavailable'))
);

-- ---------------------------------------------------------------------------
-- RLS: the caller's organization AND an entity inside the caller's scope, so
-- RLS is a real second barrier behind the API's entitlement check
-- (ARCHITECTURE.md §6.3). The API still checks the entitlement for the
-- assignment; RLS does not duplicate the matrix.
-- ---------------------------------------------------------------------------
alter table orbit.datasets         enable row level security;
alter table orbit.kpi_observations enable row level security;
alter table orbit.exceptions       enable row level security;
alter table orbit.data_limitations enable row level security;
alter table orbit.datasets         force row level security;
alter table orbit.kpi_observations force row level security;
alter table orbit.exceptions       force row level security;
alter table orbit.data_limitations force row level security;

create policy datasets_select_own_org
  on orbit.datasets for select to orbit_app
  using (organization_id = orbit.current_org());

create policy kpi_observations_select_in_scope
  on orbit.kpi_observations for select to orbit_app
  using (organization_id = orbit.current_org() and orbit.scope_within_caller(entity_grain, entity_id));

create policy exceptions_select_in_scope
  on orbit.exceptions for select to orbit_app
  using (organization_id = orbit.current_org() and orbit.scope_within_caller(entity_grain, entity_id));

-- A limitation about an assignment is shown only to roles entitled to it; the
-- entitlements subquery is itself limited to the caller's role by RLS.
create policy data_limitations_select_entitled
  on orbit.data_limitations for select to orbit_app
  using (
    organization_id = orbit.current_org()
    and (
      assignment_id is null
      or exists (select 1 from orbit.entitlements e where e.assignment_id = data_limitations.assignment_id)
    )
  );

grant select on orbit.datasets, orbit.kpi_observations, orbit.exceptions, orbit.data_limitations to orbit_app;
-- No insert/update/delete for orbit_app: this data comes from the seed only.
