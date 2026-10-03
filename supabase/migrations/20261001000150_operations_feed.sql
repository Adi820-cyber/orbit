-- ============================================================================
-- 20261001000150_operations_feed.sql
--
-- How Orbit's leadership workspace uses the hospital operations (ERP) data
-- (ADR 0018): two read-only functions that return AGGREGATES of what the ERP
-- holds, for the hospitals inside the caller's verified scope. Nothing here
-- returns a person, a patient or a visit: only counts.
--
-- AUTHORED BY: Ghansham, at the product owner's request, for Maruti's review
-- (supabase/ is her path) and Aditya's (authorization). Additive only: two
-- functions and their grants. No table, policy or grant on a table changes.
-- Numbered between 20261001000100 (the ERP schema) and 20261001000200 so a
-- migration already ordered after it still applies in order.
--
-- WHY SECURITY DEFINER, AND HOW IT IS BOUNDED
--   The orbit_erp tables are readable only by ERP operators (ADR 0016): a
--   leader's claims match no ERP row, by design. A leader still needs the
--   COUNTS, so these functions read as the owner and enforce the caller's scope
--   themselves, the same narrow pattern as orbit.permitted_assignees()
--   (ADR 0011 §6; ARCHITECTURE §7.2 forbids security-definer VIEWS, not a
--   bounded function). The bounds, all checked in ops_visible_facilities():
--     * claims must be present and belong to a LEADER (a workbook role); an
--       ERP operator, or no claims at all, gets nothing;
--     * only facilities of the caller's own organization;
--     * only facilities inside the caller's scope, using the same predicate as
--       every other scope check (orbit.scope_within_caller): group sees every
--       hospital, region its hospitals, facility its own, and a COE-only scope
--       sees none;
--     * output is counts and timestamps only. No name, code, id of a person,
--       patient or visit leaves the function.
--   Whether a ROLE may see the feed at all is decided by the API (an allow-list
--   in @orbit/contracts), which is the first gate; this is the second.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Which hospitals the caller may see aggregates for
-- ---------------------------------------------------------------------------
create function orbit_erp.ops_visible_facilities()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  select f.id
  from orbit.facilities f
  where orbit.current_org() is not null
    and orbit.current_role_id() is not null      -- a leader's claims carry a workbook role
    and orbit_erp.operator_role() is null        -- an operator uses the ERP itself
    and f.organization_id = orbit.current_org()
    and orbit.scope_within_caller('facility', f.id)
$$;

comment on function orbit_erp.ops_visible_facilities() is
  'Hospitals a LEADER may see operations aggregates for: own organization, '
  'inside the verified scope. Empty without leader claims. Not granted to '
  'orbit_app directly; used only by the ops_* functions.';

-- ---------------------------------------------------------------------------
-- Per hospital, per past day: how the rostered shifts went
--
-- Covers the `p_days` full days BEFORE today (in the organization's time
-- zone), so a day is only reported once it is over. Counts come from the same
-- derivation the ERP's attendance board uses (orbit_erp.attendance_days), so
-- Orbit and the ERP can never disagree.
--
--   rostered      shifts that have started: present + late + early_exit +
--                 missing_punch + absent + in_progress
--   in_progress   punched in and still on shift
--   present       a complete in/out pair, on time
--   late / early_exit  a complete pair, arrived late / left early
--   missing_punch an in without an out, or the reverse: never counted as zero
--   absent        rostered, never punched
--   on_leave      on leave (not part of `rostered`)
-- ---------------------------------------------------------------------------
create function orbit_erp.ops_daily(p_days integer default 14)
  returns table (
    facility_id   uuid,
    shift_date    date,
    rostered      integer,
    in_progress   integer,
    present       integer,
    late          integer,
    early_exit    integer,
    missing_punch integer,
    absent        integer,
    on_leave      integer
  )
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_facility uuid;
  v_today    date;
begin
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'erp:ops_range_invalid' using errcode = 'P0001';
  end if;

  select (now() at time zone o.timezone)::date into v_today
  from orbit.organizations o where o.id = orbit.current_org();
  if v_today is null then
    return;
  end if;

  for v_facility in select f from orbit_erp.ops_visible_facilities() as f loop
    return query
      select
        v_facility,
        a.shift_date,
        count(*) filter (where a.on_duty
                            or a.status in ('present', 'late', 'early-exit', 'missing-punch', 'absent'))::integer,
        count(*) filter (where a.on_duty)::integer,
        count(*) filter (where a.status = 'present' and not a.on_duty)::integer,
        count(*) filter (where a.status = 'late' and not a.on_duty)::integer,
        count(*) filter (where a.status = 'early-exit')::integer,
        count(*) filter (where a.status = 'missing-punch')::integer,
        count(*) filter (where a.status = 'absent')::integer,
        count(*) filter (where a.status = 'on-leave')::integer
      from orbit_erp.attendance_days(v_facility, v_today - p_days, v_today - 1) a
      group by a.shift_date
      order by a.shift_date;
  end loop;
end;
$$;

comment on function orbit_erp.ops_daily(integer) is
  'Per hospital and past day (excluding today): rostered shifts and how they '
  'went. Aggregates only, for the caller''s own hospitals; empty for a '
  'non-leader or without claims.';

-- ---------------------------------------------------------------------------
-- Per hospital, right now
-- ---------------------------------------------------------------------------
create function orbit_erp.ops_snapshot()
  returns table (
    facility_id           uuid,
    today                 date,
    as_of                 timestamptz,
    active_staff          integer,
    rostered_today        integer,
    on_duty_now           integer,
    late_today            integer,
    missing_punch_today   integer,
    absent_today          integer,
    doctors_total         integer,
    doctors_active        integer,
    doctors_expiring      integer,
    doctors_expired       integer,
    doctors_suspended     integer,
    open_visits           integer,
    open_inpatients       integer,
    visits_started_today  integer,
    visits_started_7d     integer,
    services_today        integer,
    services_7d           integer,
    pending_corrections   integer,
    last_activity_at      timestamptz
  )
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_facility uuid;
  v_timezone text;
  v_today    date;
  v_warning  integer;
begin
  select o.timezone into v_timezone from orbit.organizations o where o.id = orbit.current_org();
  if v_timezone is null then
    return;
  end if;
  v_today := (now() at time zone v_timezone)::date;
  select coalesce(
           (select st.credential_warning_days from orbit_erp.erp_settings st where st.organization_id = orbit.current_org()),
           0)
    into v_warning;

  for v_facility in select f from orbit_erp.ops_visible_facilities() as f loop
    return query
      with att as (
        select * from orbit_erp.attendance_days(v_facility, v_today, v_today)
      ),
      docs as (
        select orbit_erp.credential_status(d.credential_expires_on, d.credential_suspended, v_today, v_warning) as status
        from orbit_erp.doctor_profiles d
        join orbit_erp.staff s on s.id = d.staff_id
        where s.facility_id = v_facility and s.employment_status <> 'exited'
      ),
      activity as (
        select max(p.created_at) as at from orbit_erp.attendance_punches p where p.facility_id = v_facility
        union all select max(e.created_at) from orbit_erp.encounters e where e.facility_id = v_facility
        union all select max(sd.created_at) from orbit_erp.service_deliveries sd where sd.facility_id = v_facility
        union all select max(c.created_at) from orbit_erp.attendance_corrections c where c.facility_id = v_facility
      )
      select
        v_facility,
        v_today,
        now(),
        (select count(*) from orbit_erp.staff s where s.facility_id = v_facility and s.employment_status <> 'exited')::integer,
        (select count(*) from att where att.roster_id is not null)::integer,
        (select count(*) from att where att.on_duty)::integer,
        (select count(*) from att where att.status = 'late')::integer,
        (select count(*) from att where att.status = 'missing-punch')::integer,
        (select count(*) from att where att.status = 'absent')::integer,
        (select count(*) from docs)::integer,
        (select count(*) from docs where docs.status = 'active')::integer,
        (select count(*) from docs where docs.status = 'expiring')::integer,
        (select count(*) from docs where docs.status = 'expired')::integer,
        (select count(*) from docs where docs.status = 'suspended')::integer,
        (select count(*) from orbit_erp.encounters e where e.facility_id = v_facility and e.status = 'open')::integer,
        (select count(*) from orbit_erp.encounters e
           where e.facility_id = v_facility and e.status = 'open' and e.encounter_type = 'inpatient')::integer,
        (select count(*) from orbit_erp.encounters e
           where e.facility_id = v_facility and (e.started_at at time zone v_timezone)::date = v_today)::integer,
        (select count(*) from orbit_erp.encounters e
           where e.facility_id = v_facility and (e.started_at at time zone v_timezone)::date > v_today - 7)::integer,
        (select count(*) from orbit_erp.service_deliveries sd
           where sd.facility_id = v_facility and sd.status = 'completed'
             and (sd.performed_at at time zone v_timezone)::date = v_today)::integer,
        (select count(*) from orbit_erp.service_deliveries sd
           where sd.facility_id = v_facility and sd.status = 'completed'
             and (sd.performed_at at time zone v_timezone)::date > v_today - 7)::integer,
        (select count(*) from orbit_erp.attendance_corrections c
           where c.facility_id = v_facility and c.state = 'submitted')::integer,
        (select max(activity.at) from activity);
  end loop;
end;
$$;

comment on function orbit_erp.ops_snapshot() is
  'Per hospital, right now (staffing today, credentials, open visits, services, '
  'pending corrections, and when anything was last recorded). Aggregates only, '
  'for the caller''s own hospitals; empty for a non-leader or without claims.';

-- ---------------------------------------------------------------------------
-- Grants: only the application role may call the two entry points
-- ---------------------------------------------------------------------------
revoke all on function orbit_erp.ops_visible_facilities() from public;
revoke all on function orbit_erp.ops_daily(integer) from public;
revoke all on function orbit_erp.ops_snapshot() from public;
grant execute on function orbit_erp.ops_daily(integer) to orbit_app;
grant execute on function orbit_erp.ops_snapshot() to orbit_app;
