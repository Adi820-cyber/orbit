-- ============================================================================
-- 20260924000900_brief_on_track.sql
--
-- "On track" items for the morning brief (PRD FR-02: useful reassurance, not a
-- wall of green cards). Rows are decided by the generator, which knows what
-- each KPI means (e.g. "at or above approved budget"), so the API never
-- applies a generic threshold. Shape follows OnTrackItemSchema.
--
-- AUTHORED BY: Ghansham, for Maruti's review. Additive only. Read-only for
-- orbit_app; rows come from the seed.
-- ============================================================================

create table orbit.brief_on_track (
  id              uuid primary key default gen_random_uuid(),
  item_key        text not null,
  organization_id uuid not null references orbit.organizations (id) on delete cascade,
  dataset_id      uuid not null references orbit.datasets (id) on delete cascade,
  assignment_id   text not null,
  entity_grain    text not null,
  entity_id       uuid not null,
  period_cadence  text not null,
  period_start    date not null,
  period_end      date not null,
  summary         text not null,
  evidence        jsonb not null,
  data_quality    jsonb not null,
  provenance      text not null default 'illustrative',
  constraint brief_on_track_grain_known check (entity_grain in ('group', 'region', 'facility', 'coe')),
  constraint brief_on_track_illustrative check (provenance = 'illustrative'),
  unique (dataset_id, item_key)
);

alter table orbit.brief_on_track enable row level security;
alter table orbit.brief_on_track force row level security;

create policy brief_on_track_select_in_scope
  on orbit.brief_on_track for select to orbit_app
  using (organization_id = orbit.current_org() and orbit.scope_within_caller(entity_grain, entity_id));

grant select on orbit.brief_on_track to orbit_app;
