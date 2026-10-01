-- ============================================================================
-- 20261001000100_orbit_erp_operations.sql
--
-- Hospital operations (ERP) module: patients and visits, doctors, staff with
-- rosters and in/out attendance, and the services each hospital provides.
-- Specification: docs/orbit/ERP_PLAN.md. Decision record: ADR 0016.
--
-- AUTHORED BY: Ghansham, at the product owner's request, for Maruti's review
-- (supabase/ is her path) and Aditya's (authorization, schema). Not applied to
-- any shared project by this change.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds OPERATOR memberships beside the 14 leader roles: a membership has
--      either a workbook role (`role_id`) or an operator role
--      (`operator_role`: 'admin' | 'hospital'), never both. The 14 workbook
--      roles are untouched (AGENTS.md invariant).
--   2. Keeps operators out of the leader workflow: permitted_assignees() only
--      ever returns leader memberships.
--   3. Creates the `orbit_erp` schema. Every table: RLS enabled AND forced in
--      this file, one policy per operation, no DELETE grant to anyone.
--
-- ACCESS MODEL (ADR 0016 §3)
--   admin    -- group scope. Reads and writes every ERP record in its own
--               organization, maintains the catalogue, staff and doctors, and
--               decides attendance corrections.
--   hospital -- facility scope. Registers patients and visits, records the
--               services delivered, rosters and punches staff, and requests
--               attendance corrections -- for its own facility only.
--   Leaders  -- no ERP access at all (operator_role is absent from their
--               claims, so every policy below matches nothing).
--
-- DATA RULES
--   Synthetic records only (RULES.md). There is no column for diagnoses,
--   clinical notes, prescriptions, contact details, or government ids, and the
--   free-text columns are length-limited labels, not clinical narrative.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Operator memberships
-- ---------------------------------------------------------------------------
alter table orbit.org_memberships alter column role_id drop not null;

alter table orbit.org_memberships add column operator_role text;

alter table orbit.org_memberships add constraint org_memberships_operator_role_known
  check (operator_role is null or operator_role in ('admin', 'hospital'));

-- Exactly one kind per membership. A leader has a workbook role; an operator
-- has an operator role. Holding both would let one login carry two
-- authorization models, which nothing downstream is written to arbitrate.
alter table orbit.org_memberships add constraint org_memberships_exactly_one_kind
  check ((role_id is null) <> (operator_role is null));

comment on column orbit.org_memberships.operator_role is
  'ERP operator role (admin | hospital). Null for leader memberships. Mirrors '
  'OperatorRoleIdSchema in @orbit/contracts. Never one of the 14 workbook roles.';

-- An admin works at group grain and a hospital operator at facility grain.
-- Enforced here so a mis-provisioned operator cannot exist.
create or replace function orbit.check_operator_scope()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  select m.operator_role into v_role from orbit.org_memberships m where m.id = new.membership_id;
  if v_role = 'admin' and new.grain <> 'group' then
    raise exception 'erp:admin_requires_group_scope' using errcode = 'P0001';
  end if;
  if v_role = 'hospital' and new.grain <> 'facility' then
    raise exception 'erp:hospital_requires_facility_scope' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger org_membership_scopes_operator_grain
  before insert or update on orbit.org_membership_scopes
  for each row execute function orbit.check_operator_scope();

revoke all on function orbit.check_operator_scope() from public;

-- Leader actions are never assigned to an operator. Identical to the
-- 20260924000700 definition except for `m.role_id is not null`.
create or replace function orbit.permitted_assignees(
  p_assignment_id text,
  p_grain         text,
  p_entity_id     uuid
)
  returns table (assignee_handle uuid, membership_id uuid, role_id text, scopes jsonb)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  with candidates as (
    select m.id, m.role_id
    from orbit.org_memberships m
    where m.organization_id = orbit.current_org()
      and m.status = 'active'
      and m.role_id is not null
      and m.id <> orbit.current_membership_id()
      and p_assignment_id is not null
  ),
  candidate_scopes as (
    select c.id as membership_id, s.grain, s.entity_id, s.region_id, s.facility_id
    from candidates c
    join orbit.org_membership_scopes s on s.membership_id = c.id
  ),
  eligible as (
    select c.id, c.role_id
    from candidates c
    where exists (select 1 from candidate_scopes cs where cs.membership_id = c.id)
      -- every scope inside the caller's scope
      and not exists (
        select 1 from candidate_scopes cs
        where cs.membership_id = c.id and not orbit.scope_within_caller(cs.grain, cs.entity_id)
      )
      -- at least one scope covers the action's entity, or lies under it
      and exists (
        select 1 from candidate_scopes cs
        where cs.membership_id = c.id
          and (
            (cs.grain = p_grain and cs.entity_id = p_entity_id)
            or cs.grain = 'group'
            or (p_grain = 'region' and cs.grain = 'facility'
                and exists (select 1 from orbit.facilities f where f.id = cs.facility_id and f.region_id = p_entity_id))
            or (p_grain = 'facility' and cs.grain = 'region'
                and exists (select 1 from orbit.facilities f where f.id = p_entity_id and f.region_id = cs.region_id))
          )
      )
  )
  select h.handle, e.id, e.role_id,
         (select jsonb_agg(jsonb_build_object('grain', cs.grain, 'entityId', cs.entity_id::text)
                           order by cs.grain, cs.entity_id)
            from candidate_scopes cs where cs.membership_id = e.id)
  from eligible e
  join orbit.membership_handles h on h.membership_id = e.id
  where orbit.current_org() is not null
$$;

-- So ERP rows can pin a facility to its organization with one composite FK.
alter table orbit.facilities add constraint facilities_id_org_unique unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- 2. Schema and privilege defaults
-- ---------------------------------------------------------------------------
create schema orbit_erp;

revoke all on schema orbit_erp from public;
revoke all on schema orbit_erp from anon, authenticated;
grant usage on schema orbit_erp to orbit_app;

alter default privileges in schema orbit_erp revoke all on tables from anon, authenticated, orbit_app;
alter default privileges in schema orbit_erp revoke all on sequences from anon, authenticated, orbit_app;
alter default privileges in schema orbit_erp revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Claim accessors for ERP policies
--
-- Plain `stable` functions over the verified claims (ADR 0002, ADR 0009).
-- None is security definer. Each returns false/null without operator claims,
-- so a leader or an unauthenticated transaction matches no ERP row.
-- ---------------------------------------------------------------------------
create function orbit_erp.operator_role()
  returns text
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select nullif(orbit.current_membership() ->> 'operatorRole', '')
$$;

create function orbit_erp.is_operator()
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select orbit_erp.operator_role() is not null and orbit.current_org() is not null
$$;

create function orbit_erp.is_admin()
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select orbit_erp.operator_role() = 'admin' and orbit.has_group_scope() and orbit.current_org() is not null
$$;

-- An admin sees every facility of its own organization (the policies also pin
-- organization_id); a hospital operator sees only the facility it is scoped to.
create function orbit_erp.facility_visible(p_facility_id uuid)
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select p_facility_id is not null
     and orbit_erp.is_operator()
     and (orbit_erp.is_admin() or orbit.is_scoped_to('facility', p_facility_id))
$$;

comment on function orbit_erp.facility_visible(uuid) is
  'True when the operator in the verified claims may work with this facility. '
  'Always combine with organization_id = orbit.current_org().';

-- ---------------------------------------------------------------------------
-- 4. Reference data (organization-wide)
-- ---------------------------------------------------------------------------
create table orbit_erp.departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  code            text not null,
  name            text not null,
  constraint departments_code_format check (code ~ '^[A-Z0-9-]{2,12}$'),
  constraint departments_name_length check (char_length(name) between 1 and 80),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table orbit_erp.specialties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  code            text not null,
  name            text not null,
  constraint specialties_code_format check (code ~ '^[A-Z0-9-]{2,12}$'),
  constraint specialties_name_length check (char_length(name) between 1 and 80),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table orbit_erp.shift_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  code             text not null,
  name             text not null,
  start_time       time not null,
  end_time         time not null,
  break_minutes    integer not null default 0,
  crosses_midnight boolean generated always as (end_time <= start_time) stored,
  constraint shift_templates_code_format check (code ~ '^[A-Z0-9-]{1,12}$'),
  constraint shift_templates_name_length check (char_length(name) between 1 and 60),
  constraint shift_templates_not_empty check (start_time <> end_time),
  constraint shift_templates_break_range check (break_minutes between 0 and 240),
  unique (organization_id, code),
  unique (id, organization_id)
);

comment on table orbit_erp.shift_templates is
  'Illustrative demo shift patterns. A shift whose end is not after its start '
  'crosses midnight and is attributed to its START date.';

-- One row per organization. Every threshold the attendance and credential
-- rules use lives here, versioned, instead of being hardcoded (ERP_PLAN D4).
-- The seeded values are illustrative demo configuration, not policy.
create table orbit_erp.erp_settings (
  organization_id             uuid primary key references orbit.organizations (id) on delete cascade,
  late_grace_minutes          integer not null,
  early_exit_grace_minutes    integer not null,
  punch_window_before_minutes integer not null,
  punch_window_after_minutes  integer not null,
  credential_warning_days     integer not null,
  version                     integer not null default 1,
  updated_at                  timestamptz not null default now(),
  constraint erp_settings_late_range check (late_grace_minutes between 0 and 120),
  constraint erp_settings_early_range check (early_exit_grace_minutes between 0 and 120),
  constraint erp_settings_before_range check (punch_window_before_minutes between 0 and 720),
  constraint erp_settings_after_range check (punch_window_after_minutes between 0 and 720),
  constraint erp_settings_warning_range check (credential_warning_days between 0 and 365),
  constraint erp_settings_version_positive check (version >= 1)
);

-- ---------------------------------------------------------------------------
-- 5. Staff, doctors, rosters
-- ---------------------------------------------------------------------------
create table orbit_erp.staff (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  facility_id       uuid not null,
  department_id     uuid not null,
  employee_code     text not null,
  display_name      text not null,
  staff_type        text not null,
  designation       text not null,
  employment_status text not null default 'active',
  joined_on         date not null,
  exited_on         date,
  is_critical_role  boolean not null default false,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (department_id, organization_id) references orbit_erp.departments (id, organization_id),
  constraint staff_type_known
    check (staff_type in ('doctor', 'nurse', 'technician', 'administrative', 'support')),
  constraint staff_status_known check (employment_status in ('active', 'on-leave', 'exited')),
  constraint staff_exit_consistent check ((employment_status = 'exited') = (exited_on is not null)),
  constraint staff_exit_after_join check (exited_on is null or exited_on >= joined_on),
  constraint staff_code_format check (employee_code ~ '^[A-Z0-9-]{3,20}$'),
  constraint staff_name_length check (char_length(display_name) between 1 and 120),
  constraint staff_designation_length check (char_length(designation) between 1 and 80),
  constraint staff_version_positive check (version >= 1),
  unique (organization_id, employee_code),
  unique (id, organization_id)
);

create index staff_facility_idx on orbit_erp.staff (facility_id, display_name);

comment on table orbit_erp.staff is
  'Synthetic workforce records. No salary, contact, bank, government-id or '
  'performance fields by design (ERP_PLAN §5.3.1).';

create table orbit_erp.doctor_profiles (
  staff_id              uuid primary key,
  organization_id       uuid not null default orbit.current_org(),
  specialty_id          uuid not null,
  registration_number   text not null,
  credential_expires_on date not null,
  credential_suspended  boolean not null default false,
  employment_type       text not null default 'employed',
  version               integer not null default 1,
  updated_at            timestamptz not null default now(),
  foreign key (staff_id, organization_id) references orbit_erp.staff (id, organization_id) on delete cascade,
  foreign key (specialty_id, organization_id) references orbit_erp.specialties (id, organization_id),
  constraint doctor_employment_type_known check (employment_type in ('employed', 'visiting', 'consultant')),
  constraint doctor_registration_format check (registration_number ~ '^DEMO-REG-[0-9]{4,8}$'),
  constraint doctor_version_positive check (version >= 1),
  unique (organization_id, registration_number)
);

comment on column orbit_erp.doctor_profiles.registration_number is
  'Synthetic, visibly fictional (DEMO-REG-...). Never a real registration number.';

create table orbit_erp.doctor_schedules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default orbit.current_org(),
  staff_id        uuid not null,
  facility_id     uuid not null,
  weekday         smallint not null,
  start_time      time not null,
  end_time        time not null,
  -- Slots are retired, never deleted (no DELETE grant anywhere in this schema).
  is_active       boolean not null default true,
  foreign key (staff_id, organization_id) references orbit_erp.staff (id, organization_id) on delete cascade,
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint doctor_schedules_weekday_iso check (weekday between 1 and 7),
  constraint doctor_schedules_ordered check (end_time > start_time)
);

create index doctor_schedules_staff_idx on orbit_erp.doctor_schedules (staff_id, weekday);

create table orbit_erp.roster_assignments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default orbit.current_org(),
  staff_id          uuid not null,
  facility_id       uuid not null,
  shift_template_id uuid not null,
  shift_date        date not null,
  status            text not null default 'planned',
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (staff_id, organization_id) references orbit_erp.staff (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (shift_template_id, organization_id) references orbit_erp.shift_templates (id, organization_id),
  constraint roster_status_known check (status in ('planned', 'cancelled')),
  constraint roster_version_positive check (version >= 1)
);

-- One planned shift per person per day. Keeps punch attribution unambiguous;
-- split shifts are out of scope for this release (ERP_PLAN §5.3.2).
create unique index roster_one_planned_per_day
  on orbit_erp.roster_assignments (staff_id, shift_date) where status = 'planned';
create index roster_facility_date_idx on orbit_erp.roster_assignments (facility_id, shift_date);

-- ---------------------------------------------------------------------------
-- 6. Attendance: append-only punches, reviewed corrections
-- ---------------------------------------------------------------------------
create table orbit_erp.attendance_punches (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null default orbit.current_org(),
  staff_id                  uuid not null,
  facility_id               uuid not null,
  direction                 text not null,
  punched_at                timestamptz not null default now(),
  source                    text not null,
  recorded_by_membership_id uuid default orbit.current_membership_id() references orbit.org_memberships (id),
  idempotency_key           uuid not null,
  created_at                timestamptz not null default now(),
  foreign key (staff_id, organization_id) references orbit_erp.staff (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint punches_direction_known check (direction in ('in', 'out')),
  constraint punches_source_known check (source in ('desk', 'admin-entry', 'seeded')),
  constraint punches_recorder_present check (source = 'seeded' or recorded_by_membership_id is not null),
  unique (organization_id, idempotency_key)
);

create index punches_staff_time_idx on orbit_erp.attendance_punches (staff_id, punched_at);
create index punches_facility_time_idx on orbit_erp.attendance_punches (facility_id, punched_at);

comment on table orbit_erp.attendance_punches is
  'Raw in/out events. INSERT and SELECT only: a mistake is fixed with an '
  'approved correction, never by editing or deleting a punch.';

create table orbit_erp.attendance_corrections (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null default orbit.current_org(),
  staff_id                   uuid not null,
  facility_id                uuid not null,
  shift_date                 date not null,
  proposed_in                timestamptz,
  proposed_out               timestamptz,
  reason                     text not null,
  state                      text not null default 'submitted',
  requested_by_membership_id uuid not null default orbit.current_membership_id() references orbit.org_memberships (id),
  decided_by_membership_id   uuid references orbit.org_memberships (id),
  decision_note              text,
  version                    integer not null default 1,
  created_at                 timestamptz not null default now(),
  decided_at                 timestamptz,
  foreign key (staff_id, organization_id) references orbit_erp.staff (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint corrections_state_known check (state in ('submitted', 'approved', 'rejected')),
  constraint corrections_something_proposed check (proposed_in is not null or proposed_out is not null),
  constraint corrections_ordered check (proposed_in is null or proposed_out is null or proposed_out > proposed_in),
  constraint corrections_reason_length check (char_length(reason) between 3 and 500),
  constraint corrections_note_length check (decision_note is null or char_length(decision_note) <= 500),
  constraint corrections_decision_consistent check (
    (state = 'submitted') = (decided_by_membership_id is null and decided_at is null)
  ),
  -- Four-eyes rule: nobody approves their own request.
  constraint corrections_not_self_decided check (decided_by_membership_id is distinct from requested_by_membership_id),
  constraint corrections_version_positive check (version >= 1)
);

create unique index corrections_one_pending
  on orbit_erp.attendance_corrections (staff_id, shift_date) where state = 'submitted';
create index corrections_facility_idx on orbit_erp.attendance_corrections (facility_id, state, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Services
-- ---------------------------------------------------------------------------
create table orbit_erp.services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  service_code    text not null,
  name            text not null,
  category        text not null,
  department_id   uuid not null,
  unit            text not null,
  is_active       boolean not null default true,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (department_id, organization_id) references orbit_erp.departments (id, organization_id),
  constraint services_code_format check (service_code ~ '^[A-Z0-9-]{3,16}$'),
  constraint services_name_length check (char_length(name) between 1 and 120),
  constraint services_category_known check (category in (
    'consultation', 'diagnostics-lab', 'diagnostics-imaging', 'procedure',
    'inpatient-stay', 'day-care', 'emergency', 'therapy'
  )),
  constraint services_unit_known check (unit in ('per-visit', 'per-test', 'per-day', 'per-procedure', 'per-session')),
  constraint services_version_positive check (version >= 1),
  unique (organization_id, service_code),
  unique (id, organization_id)
);

create table orbit_erp.facility_services (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default orbit.current_org(),
  facility_id         uuid not null,
  service_id          uuid not null,
  is_available        boolean not null default true,
  illustrative_tariff numeric(12, 2),
  version             integer not null default 1,
  updated_at          timestamptz not null default now(),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (service_id, organization_id) references orbit_erp.services (id, organization_id),
  constraint facility_services_tariff_nonnegative check (illustrative_tariff is null or illustrative_tariff >= 0),
  constraint facility_services_version_positive check (version >= 1),
  unique (facility_id, service_id)
);

comment on column orbit_erp.facility_services.illustrative_tariff is
  'Illustrative demo price in the organization currency. Not a real tariff.';

-- ---------------------------------------------------------------------------
-- 8. Patients, visits, services delivered
-- ---------------------------------------------------------------------------

-- Runtime registrations start above the seeded range, so a re-seed never
-- collides with a patient registered through the API.
create sequence orbit_erp.patient_mrn_seq start with 100001;

create table orbit_erp.patients (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  home_facility_id         uuid not null,
  mrn                      text not null default ('DEMO-MRN-' || lpad(nextval('orbit_erp.patient_mrn_seq')::text, 6, '0')),
  display_name             text not null,
  sex                      text not null,
  birth_year               integer not null,
  status                   text not null default 'active',
  created_by_membership_id uuid default orbit.current_membership_id() references orbit.org_memberships (id),
  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (home_facility_id, organization_id) references orbit.facilities (id, organization_id),
  constraint patients_mrn_format check (mrn ~ '^DEMO-MRN-[0-9]{6,9}$'),
  constraint patients_name_length check (char_length(display_name) between 1 and 120),
  constraint patients_sex_known check (sex in ('female', 'male', 'other', 'unknown')),
  constraint patients_birth_year_range check (birth_year between 1900 and 2100),
  constraint patients_status_known check (status in ('active', 'inactive', 'deceased')),
  constraint patients_version_positive check (version >= 1),
  unique (organization_id, mrn),
  unique (id, organization_id)
);

create index patients_name_idx on orbit_erp.patients (organization_id, lower(display_name));

comment on table orbit_erp.patients is
  'Synthetic patient registry. Minimal by design: no date of birth (year only), '
  'contact details, identifiers, insurance or clinical fields (ERP_PLAN §5.1).';

create table orbit_erp.encounters (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null default orbit.current_org(),
  patient_id               uuid not null,
  facility_id              uuid not null,
  department_id            uuid not null,
  attending_doctor_id      uuid,
  encounter_type           text not null,
  status                   text not null default 'open',
  started_at               timestamptz not null default now(),
  ended_at                 timestamptz,
  created_by_membership_id uuid default orbit.current_membership_id() references orbit.org_memberships (id),
  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (patient_id, organization_id) references orbit_erp.patients (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (department_id, organization_id) references orbit_erp.departments (id, organization_id),
  foreign key (attending_doctor_id, organization_id) references orbit_erp.staff (id, organization_id),
  constraint encounters_type_known check (encounter_type in ('outpatient', 'inpatient', 'emergency', 'day-care')),
  constraint encounters_status_known check (status in ('open', 'closed', 'cancelled')),
  constraint encounters_end_matches_status check ((status = 'open') = (ended_at is null)),
  constraint encounters_ordered check (ended_at is null or ended_at >= started_at),
  constraint encounters_version_positive check (version >= 1),
  unique (id, organization_id)
);

create unique index encounters_one_open_inpatient
  on orbit_erp.encounters (patient_id) where encounter_type = 'inpatient' and status = 'open';
create index encounters_facility_idx on orbit_erp.encounters (facility_id, status, started_at desc);
create index encounters_patient_idx on orbit_erp.encounters (patient_id, started_at desc);

create table orbit_erp.service_deliveries (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null default orbit.current_org(),
  encounter_id              uuid not null,
  facility_id               uuid not null,
  service_id                uuid not null,
  performed_by_staff_id     uuid not null,
  quantity                  integer not null default 1,
  performed_at              timestamptz not null default now(),
  status                    text not null default 'completed',
  idempotency_key           uuid not null,
  recorded_by_membership_id uuid default orbit.current_membership_id() references orbit.org_memberships (id),
  version                   integer not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  foreign key (encounter_id, organization_id) references orbit_erp.encounters (id, organization_id),
  foreign key (facility_id, organization_id) references orbit.facilities (id, organization_id),
  foreign key (service_id, organization_id) references orbit_erp.services (id, organization_id),
  foreign key (performed_by_staff_id, organization_id) references orbit_erp.staff (id, organization_id),
  constraint deliveries_quantity_range check (quantity between 1 and 100),
  constraint deliveries_status_known check (status in ('completed', 'cancelled')),
  constraint deliveries_version_positive check (version >= 1),
  unique (organization_id, idempotency_key)
);

create index deliveries_encounter_idx on orbit_erp.service_deliveries (encounter_id, performed_at);
create index deliveries_facility_idx on orbit_erp.service_deliveries (facility_id, performed_at desc);

-- ---------------------------------------------------------------------------
-- 9. ERP audit trail (append-only)
--
-- Separate from orbit.audit_events, whose actor_role is a workbook role by
-- foreign key and whose read policy serves the leader action trail. Keeping
-- the operator trail apart leaves that contract untouched.
-- ---------------------------------------------------------------------------
create table orbit_erp.audit_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default orbit.current_org() references orbit.organizations (id) on delete cascade,
  actor_membership_id uuid not null default orbit.current_membership_id() references orbit.org_memberships (id),
  actor_operator_role text not null default orbit_erp.operator_role(),
  action              text not null,
  target_type         text not null,
  target_id           uuid not null,
  request_id          text not null,
  occurred_at         timestamptz not null default now(),
  constraint erp_audit_action_known check (action in ('viewed', 'created', 'updated', 'punched', 'decided')),
  constraint erp_audit_target_known check (target_type in (
    'patient', 'encounter', 'service_delivery', 'staff', 'doctor', 'service',
    'facility_service', 'roster', 'punch', 'correction', 'settings'
  )),
  constraint erp_audit_role_known check (actor_operator_role in ('admin', 'hospital')),
  constraint erp_audit_request_length check (char_length(request_id) between 1 and 200)
);

create index erp_audit_time_idx on orbit_erp.audit_events (organization_id, occurred_at desc, id desc);

comment on table orbit_erp.audit_events is
  'Who viewed or changed which ERP record, and when. Never the record contents. '
  'INSERT and admin-gated SELECT only. Not a claim of immutability.';

-- ---------------------------------------------------------------------------
-- 10. Integrity triggers
--
-- Cross-row rules a CHECK cannot express. All run as the invoking role, so the
-- lookups below are themselves filtered by RLS: a hospital operator cannot,
-- for example, attach a doctor from another facility, because that doctor is
-- not visible and the lookup finds nothing. Errors use the `erp:` prefix the
-- API maps to a typed 409/400 (services/api/src/db/erp.ts).
-- ---------------------------------------------------------------------------
create function orbit_erp.credential_status(
  p_expires_on date, p_suspended boolean, p_on date, p_warning_days integer
)
  returns text
  language sql
  immutable
  set search_path = pg_catalog, public
as $$
  select case
    when p_suspended then 'suspended'
    when p_expires_on < p_on then 'expired'
    when p_expires_on < p_on + coalesce(p_warning_days, 0) then 'expiring'
    else 'active'
  end
$$;

-- A doctor may practise on a date unless their credential is suspended or
-- expired on it. Staff who are not doctors carry no credential here.
create function orbit_erp.may_practise(p_staff_id uuid, p_on date)
  returns boolean
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select coalesce(
    (select not d.credential_suspended and d.credential_expires_on >= p_on
       from orbit_erp.doctor_profiles d where d.staff_id = p_staff_id),
    true
  )
$$;

create function orbit_erp.check_staff()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.staff_type <> 'doctor' and old.staff_type = 'doctor'
     and exists (select 1 from orbit_erp.doctor_profiles d where d.staff_id = new.id) then
    raise exception 'erp:doctor_has_profile' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger staff_integrity before update on orbit_erp.staff
  for each row execute function orbit_erp.check_staff();

create function orbit_erp.check_doctor_profile()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from orbit_erp.staff s where s.id = new.staff_id and s.staff_type = 'doctor') then
    raise exception 'erp:staff_is_not_a_doctor' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger doctor_profiles_integrity before insert or update on orbit_erp.doctor_profiles
  for each row execute function orbit_erp.check_doctor_profile();

create function orbit_erp.check_doctor_schedule()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from orbit_erp.doctor_profiles d where d.staff_id = new.staff_id) then
    raise exception 'erp:staff_is_not_a_doctor' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from orbit_erp.doctor_schedules o
    where o.staff_id = new.staff_id and o.weekday = new.weekday and o.id <> new.id
      and o.is_active and new.is_active
      and o.start_time < new.end_time and new.start_time < o.end_time
  ) then
    raise exception 'erp:schedule_overlap' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger doctor_schedules_integrity before insert or update on orbit_erp.doctor_schedules
  for each row execute function orbit_erp.check_doctor_schedule();

-- Rosters, punches and corrections are for a person at their own facility,
-- who has joined and not left.
create function orbit_erp.check_staff_at_facility()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_staff orbit_erp.staff%rowtype;
  v_on    date;
begin
  select * into v_staff from orbit_erp.staff s where s.id = new.staff_id;
  if not found or v_staff.facility_id <> new.facility_id then
    raise exception 'erp:staff_not_at_facility' using errcode = 'P0001';
  end if;

  -- Field access is per branch: NEW only has the columns of its own table.
  if tg_table_name = 'attendance_punches' then
    v_on := (new.punched_at at time zone 'UTC')::date;
    if new.source <> 'seeded' then
      if new.punched_at > now() + interval '5 minutes' then
        raise exception 'erp:punch_in_future' using errcode = 'P0001';
      end if;
      if new.punched_at < now() - interval '31 days' then
        raise exception 'erp:punch_too_old' using errcode = 'P0001';
      end if;
    end if;
  else
    v_on := new.shift_date;
  end if;

  if v_on < v_staff.joined_on or (v_staff.exited_on is not null and v_on > v_staff.exited_on) then
    raise exception 'erp:staff_not_employed_on_date' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger roster_integrity before insert or update on orbit_erp.roster_assignments
  for each row execute function orbit_erp.check_staff_at_facility();
create trigger punches_integrity before insert on orbit_erp.attendance_punches
  for each row execute function orbit_erp.check_staff_at_facility();
create trigger corrections_integrity before insert on orbit_erp.attendance_corrections
  for each row execute function orbit_erp.check_staff_at_facility();

create function orbit_erp.check_encounter()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.attending_doctor_id is not null then
    if not exists (
      select 1 from orbit_erp.staff s
      join orbit_erp.doctor_profiles d on d.staff_id = s.id
      where s.id = new.attending_doctor_id and s.facility_id = new.facility_id and s.employment_status = 'active'
    ) then
      raise exception 'erp:doctor_not_at_facility' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' and not orbit_erp.may_practise(new.attending_doctor_id, (new.started_at at time zone 'UTC')::date) then
      raise exception 'erp:doctor_credential_invalid' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.ended_at is not null and exists (
    select 1 from orbit_erp.service_deliveries sd
    where sd.encounter_id = new.id and sd.status = 'completed' and sd.performed_at > new.ended_at
  ) then
    raise exception 'erp:services_after_close' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger encounters_integrity before insert or update on orbit_erp.encounters
  for each row execute function orbit_erp.check_encounter();

create function orbit_erp.check_service_delivery()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_enc orbit_erp.encounters%rowtype;
begin
  select * into v_enc from orbit_erp.encounters e where e.id = new.encounter_id;
  if not found or v_enc.facility_id <> new.facility_id then
    raise exception 'erp:encounter_not_at_facility' using errcode = 'P0001';
  end if;
  -- A closed visit still accepts a late-entered service inside its window (the
  -- window check below); a cancelled visit accepts none.
  if tg_op = 'INSERT' and v_enc.status = 'cancelled' then
    raise exception 'erp:encounter_cancelled' using errcode = 'P0001';
  end if;
  if new.performed_at < v_enc.started_at or (v_enc.ended_at is not null and new.performed_at > v_enc.ended_at) then
    raise exception 'erp:outside_encounter_window' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from orbit_erp.facility_services fs
    join orbit_erp.services s on s.id = fs.service_id
    where fs.facility_id = new.facility_id and fs.service_id = new.service_id
      and fs.is_available and s.is_active
  ) then
    raise exception 'erp:service_not_available' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from orbit_erp.staff s
    where s.id = new.performed_by_staff_id and s.facility_id = new.facility_id and s.employment_status = 'active'
  ) then
    raise exception 'erp:performer_not_at_facility' using errcode = 'P0001';
  end if;
  if not orbit_erp.may_practise(new.performed_by_staff_id, (new.performed_at at time zone 'UTC')::date) then
    raise exception 'erp:doctor_credential_invalid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger deliveries_integrity before insert on orbit_erp.service_deliveries
  for each row execute function orbit_erp.check_service_delivery();

-- ---------------------------------------------------------------------------
-- 11. Derived attendance (computed on read)
--
-- Daily attendance is DERIVED from roster, punches, approved corrections and
-- erp_settings every time it is read, so it can never disagree with them and
-- needs no write grant. Security invoker: RLS on every table it reads applies.
--
-- Rules (ERP_PLAN §5.3.3):
--  * A punch belongs to the rostered shift whose window (start - before, end +
--    after) contains it; when two windows overlap, to the nearest shift. An
--    overnight shift is attributed to its START date.
--  * Punches near no rostered shift count on their calendar date as
--    'unrostered' work; they never leak into a rostered day.
--  * Missing is never zero: worked_minutes is null unless there is both an in
--    and a later out.
--  * An approved correction replaces the punch-derived side(s) it proposes.
--  * Thresholds come from erp_settings only.
-- ---------------------------------------------------------------------------
create function orbit_erp.attendance_days(
  p_facility_id uuid,
  p_from        date,
  p_to          date,
  p_staff_id    uuid default null
)
  returns table (
    staff_id           uuid,
    shift_date         date,
    roster_id          uuid,
    shift_template_id  uuid,
    shift_start        timestamptz,
    shift_end          timestamptz,
    first_in           timestamptz,
    last_out           timestamptz,
    punch_count        integer,
    on_duty            boolean,
    worked_minutes     integer,
    late_minutes       integer,
    early_exit_minutes integer,
    status             text,
    corrected          boolean,
    correction_id      uuid
  )
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  with cfg as (
    select st.late_grace_minutes, st.early_exit_grace_minutes,
           make_interval(mins => st.punch_window_before_minutes) as before_w,
           make_interval(mins => st.punch_window_after_minutes) as after_w,
           o.timezone as tz
    from orbit_erp.erp_settings st
    join orbit.organizations o on o.id = st.organization_id
    where st.organization_id = orbit.current_org()
  ),
  shifts as (
    select r.id as roster_id, r.staff_id, r.shift_date, r.shift_template_id, t.break_minutes,
           ((r.shift_date + t.start_time) at time zone cfg.tz) as shift_start,
           ((r.shift_date + t.end_time
             + case when t.end_time <= t.start_time then interval '1 day' else interval '0' end) at time zone cfg.tz) as shift_end
    from orbit_erp.roster_assignments r
    join orbit_erp.shift_templates t on t.id = r.shift_template_id
    cross join cfg
    where r.facility_id = p_facility_id
      and r.status = 'planned'
      and r.shift_date between p_from - 1 and p_to + 1
      and (p_staff_id is null or r.staff_id = p_staff_id)
  ),
  days as (
    select s.id as staff_id, d::date as shift_date, s.employment_status
    from orbit_erp.staff s
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
    where s.facility_id = p_facility_id
      and (p_staff_id is null or s.id = p_staff_id)
      and s.joined_on <= d::date
      and (s.exited_on is null or s.exited_on >= d::date)
  ),
  punches as (
    select p.staff_id, p.direction, p.punched_at
    from orbit_erp.attendance_punches p
    cross join cfg
    where p.facility_id = p_facility_id
      and (p_staff_id is null or p.staff_id = p_staff_id)
      and p.punched_at >= ((p_from - 2)::timestamp at time zone cfg.tz)
      and p.punched_at <  ((p_to + 3)::timestamp at time zone cfg.tz)
  ),
  assigned as (
    select pu.staff_id, pu.direction, pu.punched_at,
           best.shift_date is not null as matched,
           coalesce(best.shift_date, (pu.punched_at at time zone cfg.tz)::date) as shift_date
    from punches pu
    cross join cfg
    left join lateral (
      select sh.shift_date
      from shifts sh
      where sh.staff_id = pu.staff_id
        and pu.punched_at between sh.shift_start - cfg.before_w and sh.shift_end + cfg.after_w
      order by greatest(sh.shift_start - pu.punched_at, pu.punched_at - sh.shift_end, interval '0'),
               -- tie: an in-punch opens the later shift, an out-punch closes the earlier one
               case when pu.direction = 'in' then sh.shift_start end desc nulls last,
               case when pu.direction = 'out' then sh.shift_start end asc nulls last
      limit 1
    ) best on true
  ),
  agg as (
    select a.staff_id, a.shift_date, a.matched,
           min(a.punched_at) filter (where a.direction = 'in')  as first_in,
           max(a.punched_at) filter (where a.direction = 'out') as last_out,
           count(*)::integer as punch_count,
           (array_agg(a.direction order by a.punched_at desc))[1] as last_direction
    from assigned a
    group by a.staff_id, a.shift_date, a.matched
  ),
  corr as (
    select distinct on (c.staff_id, c.shift_date)
           c.staff_id, c.shift_date, c.id, c.proposed_in, c.proposed_out
    from orbit_erp.attendance_corrections c
    where c.facility_id = p_facility_id
      and c.state = 'approved'
      and c.shift_date between p_from and p_to
      and (p_staff_id is null or c.staff_id = p_staff_id)
    order by c.staff_id, c.shift_date, c.decided_at desc
  ),
  joined as (
    select dy.staff_id, dy.shift_date, dy.employment_status,
           sh.roster_id, sh.shift_template_id, sh.shift_start, sh.shift_end, sh.break_minutes,
           coalesce(co.proposed_in, ag.first_in)   as first_in,
           coalesce(co.proposed_out, ag.last_out)  as last_out,
           coalesce(ag.punch_count, 0)             as punch_count,
           ag.last_direction,
           co.id                                   as correction_id,
           coalesce(sh.shift_end + cfg.after_w, ((dy.shift_date + 1)::timestamp at time zone cfg.tz)) as window_end,
           cfg.late_grace_minutes, cfg.early_exit_grace_minutes
    from days dy
    cross join cfg
    left join shifts sh on sh.staff_id = dy.staff_id and sh.shift_date = dy.shift_date
    left join agg ag on ag.staff_id = dy.staff_id and ag.shift_date = dy.shift_date
                    and ag.matched = (sh.roster_id is not null)
    left join corr co on co.staff_id = dy.staff_id and co.shift_date = dy.shift_date
  ),
  measured as (
    select j.*,
           (j.first_in is not null and j.last_out is not null and j.last_out > j.first_in) as complete,
           -- coalesce: with no punch at all, last_direction is null and so would the flag be.
           (j.correction_id is null and coalesce(j.last_direction = 'in', false) and now() < j.window_end) as on_duty_now,
           (j.roster_id is not null and j.first_in is not null
             and j.first_in > j.shift_start + make_interval(mins => j.late_grace_minutes)) as is_late,
           (j.roster_id is not null and j.last_out is not null
             and j.last_out < j.shift_end - make_interval(mins => j.early_exit_grace_minutes)) as is_early
    from joined j
  )
  select m.staff_id, m.shift_date, m.roster_id, m.shift_template_id, m.shift_start, m.shift_end,
         m.first_in, m.last_out, m.punch_count, m.on_duty_now,
         case when m.complete
              then greatest(0, (extract(epoch from (m.last_out - m.first_in)) / 60)::integer - coalesce(m.break_minutes, 0))
         end as worked_minutes,
         case when m.is_late then ceil(extract(epoch from (m.first_in - m.shift_start)) / 60)::integer end,
         case when m.is_early and m.complete then ceil(extract(epoch from (m.shift_end - m.last_out)) / 60)::integer end,
         case
           when m.employment_status = 'on-leave' and m.first_in is null and m.last_out is null then 'on-leave'
           when m.roster_id is null and m.first_in is null and m.last_out is null then 'off'
           when m.roster_id is null then 'unrostered'
           when m.first_in is null and m.last_out is null then
             case when now() < m.shift_start + make_interval(mins => m.late_grace_minutes) then 'scheduled' else 'absent' end
           when m.on_duty_now then case when m.is_late then 'late' else 'on-duty' end
           when not m.complete then 'missing-punch'
           when m.is_late then 'late'
           when m.is_early then 'early-exit'
           else 'present'
         end as status,
         m.correction_id is not null as corrected,
         m.correction_id
  from measured m
  order by m.shift_date, m.staff_id
$$;

comment on function orbit_erp.attendance_days(uuid, date, date, uuid) is
  'Daily attendance derived on read from roster, punches, approved corrections '
  'and erp_settings. Invoker rights: returns nothing the caller cannot see.';

-- ---------------------------------------------------------------------------
-- 12. RLS: enabled and forced on every table, one policy per operation
-- ---------------------------------------------------------------------------
alter table orbit_erp.departments            enable row level security;
alter table orbit_erp.specialties            enable row level security;
alter table orbit_erp.shift_templates        enable row level security;
alter table orbit_erp.erp_settings           enable row level security;
alter table orbit_erp.staff                  enable row level security;
alter table orbit_erp.doctor_profiles        enable row level security;
alter table orbit_erp.doctor_schedules       enable row level security;
alter table orbit_erp.roster_assignments     enable row level security;
alter table orbit_erp.attendance_punches     enable row level security;
alter table orbit_erp.attendance_corrections enable row level security;
alter table orbit_erp.services               enable row level security;
alter table orbit_erp.facility_services      enable row level security;
alter table orbit_erp.patients               enable row level security;
alter table orbit_erp.encounters             enable row level security;
alter table orbit_erp.service_deliveries     enable row level security;
alter table orbit_erp.audit_events           enable row level security;

alter table orbit_erp.departments            force row level security;
alter table orbit_erp.specialties            force row level security;
alter table orbit_erp.shift_templates        force row level security;
alter table orbit_erp.erp_settings           force row level security;
alter table orbit_erp.staff                  force row level security;
alter table orbit_erp.doctor_profiles        force row level security;
alter table orbit_erp.doctor_schedules       force row level security;
alter table orbit_erp.roster_assignments     force row level security;
alter table orbit_erp.attendance_punches     force row level security;
alter table orbit_erp.attendance_corrections force row level security;
alter table orbit_erp.services               force row level security;
alter table orbit_erp.facility_services      force row level security;
alter table orbit_erp.patients               force row level security;
alter table orbit_erp.encounters             force row level security;
alter table orbit_erp.service_deliveries     force row level security;
alter table orbit_erp.audit_events           force row level security;

-- Organization-wide reference data: any operator reads, admins maintain.
create policy departments_select on orbit_erp.departments for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_operator());
create policy departments_insert on orbit_erp.departments for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy departments_update on orbit_erp.departments for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

create policy specialties_select on orbit_erp.specialties for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_operator());
create policy specialties_insert on orbit_erp.specialties for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy specialties_update on orbit_erp.specialties for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

create policy shift_templates_select on orbit_erp.shift_templates for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_operator());
create policy shift_templates_insert on orbit_erp.shift_templates for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy shift_templates_update on orbit_erp.shift_templates for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

create policy erp_settings_select on orbit_erp.erp_settings for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_operator());
create policy erp_settings_update on orbit_erp.erp_settings for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

create policy services_select on orbit_erp.services for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_operator());
create policy services_insert on orbit_erp.services for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy services_update on orbit_erp.services for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

-- People: visible by facility; only admins create or edit records about people.
create policy staff_select on orbit_erp.staff for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy staff_insert on orbit_erp.staff for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy staff_update on orbit_erp.staff for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

-- The subquery is itself filtered by staff_select, so a profile is visible
-- exactly when its person is.
create policy doctor_profiles_select on orbit_erp.doctor_profiles for select to orbit_app
  using (organization_id = orbit.current_org()
         and exists (select 1 from orbit_erp.staff s where s.id = doctor_profiles.staff_id));
create policy doctor_profiles_insert on orbit_erp.doctor_profiles for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy doctor_profiles_update on orbit_erp.doctor_profiles for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

create policy doctor_schedules_select on orbit_erp.doctor_schedules for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy doctor_schedules_insert on orbit_erp.doctor_schedules for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy doctor_schedules_update on orbit_erp.doctor_schedules for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin())
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());

-- Rosters: both operator roles, for facilities they can see.
create policy roster_select on orbit_erp.roster_assignments for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy roster_insert on orbit_erp.roster_assignments for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy roster_update on orbit_erp.roster_assignments for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id))
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));

-- Punches: recorded as the caller, never as someone else. No update policy.
create policy punches_select on orbit_erp.attendance_punches for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy punches_insert on orbit_erp.attendance_punches for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and orbit_erp.facility_visible(facility_id)
    and recorded_by_membership_id = orbit.current_membership_id()
    and source in ('desk', 'admin-entry')
  );

-- Corrections: anyone at the facility may request; only an admin decides, and
-- the decision is recorded as the deciding admin.
create policy corrections_select on orbit_erp.attendance_corrections for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy corrections_insert on orbit_erp.attendance_corrections for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and orbit_erp.facility_visible(facility_id)
    and requested_by_membership_id = orbit.current_membership_id()
    and state = 'submitted'
  );
create policy corrections_update on orbit_erp.attendance_corrections for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin() and state = 'submitted')
  with check (
    organization_id = orbit.current_org()
    and orbit_erp.is_admin()
    and decided_by_membership_id = orbit.current_membership_id()
  );

-- Facility availability: admins add services to a facility; either role may
-- switch availability or the illustrative tariff for a facility it can see.
create policy facility_services_select on orbit_erp.facility_services for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy facility_services_insert on orbit_erp.facility_services for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.is_admin());
create policy facility_services_update on orbit_erp.facility_services for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id))
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));

-- Patients: visible when registered at, or visiting, a facility the caller can
-- see. The encounters subquery is filtered by encounters_select, which does not
-- reference patients, so the policies cannot recurse.
create policy patients_select on orbit_erp.patients for select to orbit_app
  using (
    organization_id = orbit.current_org()
    and orbit_erp.is_operator()
    and (
      orbit_erp.facility_visible(home_facility_id)
      or exists (select 1 from orbit_erp.encounters e where e.patient_id = patients.id)
    )
  );
create policy patients_insert on orbit_erp.patients for insert to orbit_app
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(home_facility_id));
create policy patients_update on orbit_erp.patients for update to orbit_app
  using (
    organization_id = orbit.current_org()
    and orbit_erp.is_operator()
    and (
      orbit_erp.facility_visible(home_facility_id)
      or exists (select 1 from orbit_erp.encounters e where e.patient_id = patients.id)
    )
  )
  with check (organization_id = orbit.current_org() and orbit_erp.is_operator());

create policy encounters_select on orbit_erp.encounters for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy encounters_insert on orbit_erp.encounters for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and orbit_erp.facility_visible(facility_id)
    -- the patient must already be visible to the caller
    and exists (select 1 from orbit_erp.patients p where p.id = encounters.patient_id)
  );
create policy encounters_update on orbit_erp.encounters for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id))
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));

create policy deliveries_select on orbit_erp.service_deliveries for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));
create policy deliveries_insert on orbit_erp.service_deliveries for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and orbit_erp.facility_visible(facility_id)
    and recorded_by_membership_id = orbit.current_membership_id()
  );
create policy deliveries_update on orbit_erp.service_deliveries for update to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id))
  with check (organization_id = orbit.current_org() and orbit_erp.facility_visible(facility_id));

-- Audit: everyone records their own events; only admins read the trail.
create policy erp_audit_insert on orbit_erp.audit_events for insert to orbit_app
  with check (
    organization_id = orbit.current_org()
    and actor_membership_id = orbit.current_membership_id()
    and actor_operator_role = orbit_erp.operator_role()
  );
create policy erp_audit_select on orbit_erp.audit_events for select to orbit_app
  using (organization_id = orbit.current_org() and orbit_erp.is_admin());

-- ---------------------------------------------------------------------------
-- 13. Grants: exactly the operations the API uses. No DELETE or TRUNCATE.
-- ---------------------------------------------------------------------------
grant select, insert, update on
  orbit_erp.departments, orbit_erp.specialties, orbit_erp.shift_templates,
  orbit_erp.staff, orbit_erp.doctor_profiles, orbit_erp.doctor_schedules,
  orbit_erp.roster_assignments, orbit_erp.attendance_corrections,
  orbit_erp.services, orbit_erp.facility_services,
  orbit_erp.patients, orbit_erp.encounters, orbit_erp.service_deliveries
  to orbit_app;
grant select, update on orbit_erp.erp_settings to orbit_app;
-- Append-only: punches and the audit trail.
grant select, insert on orbit_erp.attendance_punches, orbit_erp.audit_events to orbit_app;
grant usage on sequence orbit_erp.patient_mrn_seq to orbit_app;

revoke all on all functions in schema orbit_erp from public;
grant execute on all functions in schema orbit_erp to orbit_app;
