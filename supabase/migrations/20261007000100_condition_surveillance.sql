-- ============================================================================
-- 20261007000100_condition_surveillance.sql
--
-- Outbreak watch (ADR 0023): a presenting condition on each visit, a surge
-- rule leaders are alerted by, and XGBoost forecasts of the next days.
--
--   1. conditions        a fixed list per organization (filled from the reference
--                        dataset's diseases by seed 0208, not here: source data
--                        stays out of Git). Admins maintain it.
--   2. encounters        gain an optional presenting_condition_id. Counts of it
--                        are the only clinical signal Orbit uses, and only ever
--                        as aggregates.
--   3. surveillance_settings  the surge rule, per organization. The product
--                        owner set 7 days, 50 patients, 5 hospitals (2026-10-07).
--   4. forecast_runs / condition_forecasts  what the daily XGBoost job stores:
--                        its accuracy against a naive baseline, and per
--                        hospital and condition the expected patients in the
--                        coming window, with group-level probabilities of
--                        crossing the rule.
--   5. Functions         condition_daily_counts() and store_forecast_run() for
--                        the forecast job; surveillance_feed() and
--                        surveillance_hospitals() for leaders, bounded like the
--                        operations feed (ADR 0018).
--
-- WHAT A LEADER SEES (ADR 0023 §4). Per condition: the GROUP totals (patients
-- and how many hospitals have any) and whether the rule fired, plus per-hospital
-- counts for hospitals inside the caller's own scope only. A hospital DHO
-- therefore learns that a group-wide surge exists and how large it is, never
-- which other hospitals or their counts. That is a deliberate, recorded
-- exception: a hospital must be told to prepare. No patient is ever named.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Conditions
-- ---------------------------------------------------------------------------
create table orbit_erp.conditions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  code            text not null,
  name            text not null,
  category        text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint conditions_code_format check (code ~ '^[A-Z0-9-]{2,24}$'),
  constraint conditions_name_length check (char_length(name) between 1 and 80),
  constraint conditions_category_length check (char_length(category) between 1 and 40),
  unique (organization_id, code),
  unique (organization_id, name),
  unique (id, organization_id)
);

comment on table orbit_erp.conditions is
  'The fixed list of presenting conditions a visit may record. Synthetic demonstration use only; '
  'not a diagnosis and not for clinical decisions.';

-- ---------------------------------------------------------------------------
-- 2. The visit records its presenting condition (optional)
-- ---------------------------------------------------------------------------
alter table orbit_erp.encounters add column presenting_condition_id uuid;
alter table orbit_erp.encounters
  add constraint encounters_condition_fk foreign key (presenting_condition_id, organization_id)
  references orbit_erp.conditions (id, organization_id);
create index encounters_condition_idx on orbit_erp.encounters (presenting_condition_id, started_at)
  where presenting_condition_id is not null;

comment on column orbit_erp.encounters.presenting_condition_id is
  'Optional presenting condition, from orbit_erp.conditions. Counted only as aggregates (ADR 0023).';

-- ---------------------------------------------------------------------------
-- 3. The surge rule
-- ---------------------------------------------------------------------------
create table orbit_erp.surveillance_settings (
  organization_id uuid primary key references orbit.organizations (id) on delete cascade,
  window_days     integer not null,
  min_patients    integer not null,
  min_hospitals   integer not null,
  updated_at      timestamptz not null default now(),
  constraint surveillance_window_range check (window_days between 1 and 28),
  constraint surveillance_patients_positive check (min_patients >= 1),
  constraint surveillance_hospitals_positive check (min_hospitals >= 1)
);

comment on table orbit_erp.surveillance_settings is
  'The outbreak-watch rule: alert when at least min_patients patients with one condition appear across '
  'at least min_hospitals hospitals within window_days days. Set by the product owner (ADR 0023).';

-- The product owner's rule (2026-10-07): 7 days, 50 patients, 5 hospitals.
insert into orbit_erp.surveillance_settings (organization_id, window_days, min_patients, min_hospitals)
select o.id, 7, 50, 5 from orbit.organizations o
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Forecasts (written by the daily XGBoost job, ADR 0023 §3)
-- ---------------------------------------------------------------------------
create table orbit_erp.forecast_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references orbit.organizations (id) on delete cascade,
  model             text not null,
  trained_at        timestamptz not null default now(),
  data_through      date not null,
  horizon_days      integer not null,
  training_rows     integer not null,
  -- Mean absolute error on held-out recent weeks: the model, and "next window = last window".
  model_mae         numeric(10, 3) not null,
  baseline_mae      numeric(10, 3) not null,
  notes             text not null,
  constraint forecast_runs_horizon_range check (horizon_days between 1 and 28),
  constraint forecast_runs_rows_positive check (training_rows >= 0),
  constraint forecast_runs_mae_nonnegative check (model_mae >= 0 and baseline_mae >= 0),
  constraint forecast_runs_model_length check (char_length(model) between 1 and 120),
  constraint forecast_runs_notes_length check (char_length(notes) between 1 and 1000)
);

create index forecast_runs_latest_idx on orbit_erp.forecast_runs (organization_id, trained_at desc);

create table orbit_erp.condition_forecasts (
  run_id            uuid not null references orbit_erp.forecast_runs (id) on delete cascade,
  organization_id   uuid not null,
  condition_id      uuid not null,
  -- null: the group-level row for the condition.
  facility_id       uuid,
  expected_patients numeric(10, 3) not null,
  -- Group rows only: probability the coming window crosses the rule's patient
  -- count, and that at least min_hospitals hospitals see any case.
  p_patients        numeric(6, 5),
  p_hospitals       numeric(6, 5),
  foreign key (condition_id, organization_id) references orbit_erp.conditions (id, organization_id) on delete cascade,
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint condition_forecasts_expected_nonnegative check (expected_patients >= 0),
  constraint condition_forecasts_probabilities check (
    (facility_id is null) = (p_patients is not null)
    and (facility_id is null) = (p_hospitals is not null)
    and (p_patients is null or p_patients between 0 and 1)
    and (p_hospitals is null or p_hospitals between 0 and 1)
  )
);

create unique index condition_forecasts_one_row on orbit_erp.condition_forecasts
  (run_id, condition_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- RLS: operators read conditions; only admins maintain them. Settings and
-- forecasts have no direct access at all: they are read and written only
-- through the bounded functions below.
-- ---------------------------------------------------------------------------
alter table orbit_erp.conditions enable row level security;
alter table orbit_erp.conditions force row level security;
alter table orbit_erp.surveillance_settings enable row level security;
alter table orbit_erp.surveillance_settings force row level security;
alter table orbit_erp.forecast_runs enable row level security;
alter table orbit_erp.forecast_runs force row level security;
alter table orbit_erp.condition_forecasts enable row level security;
alter table orbit_erp.condition_forecasts force row level security;

create policy conditions_select on orbit_erp.conditions for select to orbit_app
  using (organization_id = (select orbit.current_org()) and (select orbit_erp.is_operator()));
create policy conditions_insert on orbit_erp.conditions for insert to orbit_app
  with check (organization_id = (select orbit.current_org()) and (select orbit_erp.is_admin()));
create policy conditions_update on orbit_erp.conditions for update to orbit_app
  using (organization_id = (select orbit.current_org()) and (select orbit_erp.is_admin()))
  with check (organization_id = (select orbit.current_org()) and (select orbit_erp.is_admin()));

grant select, insert, update on orbit_erp.conditions to orbit_app;

-- A visit's condition must be one of the organization's active conditions.
create function orbit_erp.check_encounter_condition()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.presenting_condition_id is not null
     and new.presenting_condition_id is distinct from (case when tg_op = 'UPDATE' then old.presenting_condition_id end)
     and not exists (
       select 1 from orbit_erp.conditions c
       where c.id = new.presenting_condition_id and c.organization_id = new.organization_id and c.is_active
     ) then
    raise exception 'erp:condition_unknown' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger encounters_condition before insert or update on orbit_erp.encounters
  for each row execute function orbit_erp.check_encounter_condition();

-- ---------------------------------------------------------------------------
-- 5a. For the forecast job (no claims; runs as orbit_app from GitHub Actions)
-- ---------------------------------------------------------------------------

-- Daily patients per hospital and condition, for every organization. Counts
-- only. Takes no input that widens what it returns beyond counts.
create function orbit_erp.condition_daily_counts(p_from date)
  returns table (organization_id uuid, facility_id uuid, condition_id uuid, day date, patients integer)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select e.organization_id, e.facility_id, e.presenting_condition_id,
         (e.started_at at time zone o.timezone)::date as day,
         count(distinct e.patient_id)::integer
  from orbit_erp.encounters e
  join orbit.organizations o on o.id = e.organization_id
  where e.presenting_condition_id is not null
    and e.status <> 'cancelled'
    and (e.started_at at time zone o.timezone)::date >= p_from
  group by 1, 2, 3, 4
$$;

comment on function orbit_erp.condition_daily_counts(date) is
  'Daily distinct patients per organization, hospital and presenting condition from p_from on. Counts '
  'only; for the outbreak forecast job (ADR 0023).';

-- The rule and the facility and condition lists the job forecasts for.
create function orbit_erp.forecast_inputs()
  returns table (organization_id uuid, timezone text, window_days integer, min_patients integer, min_hospitals integer,
                 facility_ids uuid[], condition_ids uuid[])
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select o.id, o.timezone, s.window_days, s.min_patients, s.min_hospitals,
         array(select f.id from orbit.facilities f where f.organization_id = o.id order by f.id),
         array(select c.id from orbit_erp.conditions c where c.organization_id = o.id and c.is_active order by c.code)
  from orbit.organizations o
  join orbit_erp.surveillance_settings s on s.organization_id = o.id
  where exists (select 1 from orbit_erp.conditions c where c.organization_id = o.id)
$$;

-- Stores one run and its forecasts, all or nothing, and keeps the last 30 runs.
-- Rows for a facility or condition of another organization are refused.
create function orbit_erp.store_forecast_run(p_run jsonb)
  returns uuid
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_org uuid := (p_run ->> 'organizationId')::uuid;
  v_run uuid;
begin
  insert into orbit_erp.forecast_runs (organization_id, model, data_through, horizon_days, training_rows, model_mae, baseline_mae, notes)
  values (v_org, p_run ->> 'model', (p_run ->> 'dataThrough')::date, (p_run ->> 'horizonDays')::int,
          (p_run ->> 'trainingRows')::int, (p_run ->> 'modelMae')::numeric, (p_run ->> 'baselineMae')::numeric, p_run ->> 'notes')
  returning id into v_run;

  insert into orbit_erp.condition_forecasts (run_id, organization_id, condition_id, facility_id, expected_patients, p_patients, p_hospitals)
  select v_run, v_org, (r ->> 'conditionId')::uuid, nullif(r ->> 'facilityId', '')::uuid,
         (r ->> 'expectedPatients')::numeric, (r ->> 'pPatients')::numeric, (r ->> 'pHospitals')::numeric
  from jsonb_array_elements(p_run -> 'rows') r;

  -- The foreign keys carry the organization, so a row naming another
  -- organization's facility or condition has already failed above.
  delete from orbit_erp.forecast_runs fr
  where fr.organization_id = v_org
    and fr.id not in (select id from orbit_erp.forecast_runs where organization_id = v_org order by trained_at desc limit 30);
  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b. For leaders (bounded like the operations feed)
-- ---------------------------------------------------------------------------

-- Per active condition: the group-wide count over the rule's window, whether
-- the rule fired, the usual level (mean of the four windows before), and the
-- latest forecast. Group figures only; empty without a leader's claims.
create function orbit_erp.surveillance_feed()
  returns table (
    condition_id       uuid,
    code               text,
    name               text,
    category           text,
    window_days        integer,
    min_patients       integer,
    min_hospitals      integer,
    patients           integer,
    hospitals          integer,
    usual_patients     numeric,
    alert              boolean,
    expected_patients  numeric,
    p_patients         numeric,
    p_hospitals        numeric,
    forecast_at        timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_org   uuid := orbit.current_org();
  v_tz    text;
  v_today date;
  v_set   orbit_erp.surveillance_settings%rowtype;
  v_run   uuid;
  v_at    timestamptz;
begin
  -- A leader's claims only (the same test as ops_visible_facilities).
  if v_org is null or orbit.current_role_id() is null or orbit_erp.operator_role() is not null then
    return;
  end if;
  select o.timezone into v_tz from orbit.organizations o where o.id = v_org;
  select * into v_set from orbit_erp.surveillance_settings s where s.organization_id = v_org;
  if v_tz is null or v_set.organization_id is null then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;
  select fr.id, fr.trained_at into v_run, v_at from orbit_erp.forecast_runs fr
  where fr.organization_id = v_org order by fr.trained_at desc limit 1;

  return query
    with daily as (
      select e.presenting_condition_id as condition_id, e.facility_id, (e.started_at at time zone v_tz)::date as day, e.patient_id
      from orbit_erp.encounters e
      where e.organization_id = v_org and e.presenting_condition_id is not null and e.status <> 'cancelled'
        and e.started_at >= (v_today - 5 * v_set.window_days)::timestamp at time zone v_tz
    ),
    now_window as (
      select d.condition_id, count(distinct d.patient_id)::int as patients, count(distinct d.facility_id)::int as hospitals
      from daily d where d.day > v_today - v_set.window_days
      group by d.condition_id
    ),
    usual as (
      -- Four earlier windows, each counted the same way, averaged.
      select d.condition_id, count(distinct (d.patient_id, (v_today - d.day - 1) / v_set.window_days))::numeric / 4 as patients
      from daily d where d.day <= v_today - v_set.window_days and d.day > v_today - 5 * v_set.window_days
      group by d.condition_id
    )
    select c.id, c.code, c.name, c.category, v_set.window_days, v_set.min_patients, v_set.min_hospitals,
           coalesce(n.patients, 0), coalesce(n.hospitals, 0), round(coalesce(u.patients, 0), 1),
           coalesce(n.patients, 0) >= v_set.min_patients and coalesce(n.hospitals, 0) >= v_set.min_hospitals,
           cf.expected_patients, cf.p_patients, cf.p_hospitals, v_at
    from orbit_erp.conditions c
    left join now_window n on n.condition_id = c.id
    left join usual u on u.condition_id = c.id
    left join orbit_erp.condition_forecasts cf on cf.run_id = v_run and cf.condition_id = c.id and cf.facility_id is null
    where c.organization_id = v_org and c.is_active
    order by 11 desc, 8 desc, c.name;
end;
$$;

-- Per hospital INSIDE the caller's scope and condition: patients in the window
-- and the forecast for that hospital. Only conditions with a case or a forecast.
create function orbit_erp.surveillance_hospitals()
  returns table (facility_id uuid, condition_id uuid, patients integer, expected_patients numeric)
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_org   uuid := orbit.current_org();
  v_tz    text;
  v_today date;
  v_days  integer;
  v_run   uuid;
begin
  select o.timezone into v_tz from orbit.organizations o where o.id = v_org;
  select s.window_days into v_days from orbit_erp.surveillance_settings s where s.organization_id = v_org;
  if v_tz is null or v_days is null then
    return;
  end if;
  v_today := (now() at time zone v_tz)::date;
  select fr.id into v_run from orbit_erp.forecast_runs fr where fr.organization_id = v_org order by fr.trained_at desc limit 1;

  return query
    with f as (select v.f as id from orbit_erp.ops_visible_facilities() as v(f)),
    counts as (
      select e.facility_id, e.presenting_condition_id as condition_id, count(distinct e.patient_id)::int as patients
      from orbit_erp.encounters e join f on f.id = e.facility_id
      where e.presenting_condition_id is not null and e.status <> 'cancelled'
        and (e.started_at at time zone v_tz)::date > v_today - v_days
      group by 1, 2
    ),
    forecast as (
      select cf.facility_id, cf.condition_id, cf.expected_patients
      from orbit_erp.condition_forecasts cf join f on f.id = cf.facility_id
      where cf.run_id = v_run
    )
    select coalesce(c.facility_id, fc.facility_id), coalesce(c.condition_id, fc.condition_id),
           coalesce(c.patients, 0), fc.expected_patients
    from counts c full join forecast fc on fc.facility_id = c.facility_id and fc.condition_id = c.condition_id
    order by 1, 2;
end;
$$;

-- The latest forecast run's description and accuracy, for leaders.
create function orbit_erp.surveillance_forecast_run()
  returns table (model text, trained_at timestamptz, data_through date, horizon_days integer, training_rows integer,
                 model_mae numeric, baseline_mae numeric, notes text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select fr.model, fr.trained_at, fr.data_through, fr.horizon_days, fr.training_rows, fr.model_mae, fr.baseline_mae, fr.notes
  from orbit_erp.forecast_runs fr
  where fr.organization_id = orbit.current_org()
    and orbit.current_role_id() is not null
    and orbit_erp.operator_role() is null
  order by fr.trained_at desc
  limit 1
$$;

comment on function orbit_erp.surveillance_feed() is
  'Outbreak watch, group level: per condition the patients and hospitals in the rule window, the usual '
  'level, whether the rule fired, and the latest forecast. Aggregates only; a leader''s claims only.';
comment on function orbit_erp.surveillance_hospitals() is
  'Outbreak watch, per hospital inside the caller''s scope (ops_visible_facilities): patients in the rule '
  'window and the forecast. Aggregates only.';

revoke all on function orbit_erp.check_encounter_condition() from public;
revoke all on function orbit_erp.condition_daily_counts(date) from public;
revoke all on function orbit_erp.forecast_inputs() from public;
revoke all on function orbit_erp.store_forecast_run(jsonb) from public;
revoke all on function orbit_erp.surveillance_feed() from public;
revoke all on function orbit_erp.surveillance_hospitals() from public;
revoke all on function orbit_erp.surveillance_forecast_run() from public;
grant execute on function orbit_erp.condition_daily_counts(date) to orbit_app;
grant execute on function orbit_erp.forecast_inputs() to orbit_app;
grant execute on function orbit_erp.store_forecast_run(jsonb) to orbit_app;
grant execute on function orbit_erp.surveillance_feed() to orbit_app;
grant execute on function orbit_erp.surveillance_hospitals() to orbit_app;
grant execute on function orbit_erp.surveillance_forecast_run() to orbit_app;
