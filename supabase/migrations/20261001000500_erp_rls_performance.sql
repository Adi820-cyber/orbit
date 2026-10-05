-- ============================================================================
-- 20261001000500_erp_rls_performance.sql
--
-- Same access rules, worked out once per query instead of once per row.
--
-- Found by testing with the reference datasets loaded (ADR 0020): with 31,000
-- patients and 121,000 services, a patient search took 3.5 s in the database
-- (up to 8.6 s through the API), counting services 5.2 s, and the hospital
-- summary 3 to 4 s. Row-level security runs before a query's own filters, and
-- every hospital-operations policy called orbit_erp.facility_visible(<column>)
-- for each row, re-reading the caller's claims each time. The patients policy
-- also checked visits per row through the visits policy.
--
-- What changes (meaning unchanged):
--   1. orbit_erp.visible_facility_ids() returns, once, the hospitals the
--      caller may work with: exactly the hospitals facility_visible() accepts.
--   2. orbit_erp.has_visit_at(patient, hospitals) answers "has this patient a
--      visit at one of these hospitals?" directly, so the patients policy no
--      longer queries visits through the visits policy. That also removes the
--      visits -> patients -> visits loop that made Postgres refuse a visits
--      policy holding a subquery ("infinite recursion detected in policy").
--   3. In every policy: facility_visible(<col>) becomes
--      <col> = any(<the hospitals, worked out once>); the visits check becomes
--      has_visit_at(...); and orbit.current_org(), orbit_erp.is_operator() and
--      orbit_erp.is_admin() are wrapped in (select ...), so Postgres evaluates
--      them once per statement, the pattern Supabase documents for fast
--      row-level security.
-- No table, grant or rule meaning changes. The block below rewrites the
-- policies that exist and then checks that none still uses the per-row forms.
-- ============================================================================

create function orbit_erp.visible_facility_ids()
  returns uuid[]
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  -- Exactly the hospitals orbit_erp.facility_visible() accepts, within the
  -- caller's own organization. Empty without operator claims.
  select coalesce(array_agg(f.id order by f.id), '{}')
  from orbit.facilities f
  where f.organization_id = orbit.current_org()
    and orbit_erp.facility_visible(f.id)
$$;

comment on function orbit_erp.visible_facility_ids() is
  'The hospitals the caller may work with, as one array, so policies test membership once per '
  'statement. Same answer as orbit_erp.facility_visible() for each hospital of the organization.';

create function orbit_erp.has_visit_at(p_patient_id uuid, p_facility_ids uuid[])
  returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog, public
as $$
  -- Called from the patients policy with the caller's own hospitals
  -- (visible_facility_ids()), so it answers only what the visits policy would
  -- have allowed: a visit of this patient at one of the caller's hospitals.
  select exists (
    select 1 from orbit_erp.encounters e
    where e.patient_id = p_patient_id and e.facility_id = any (p_facility_ids)
  )
$$;

comment on function orbit_erp.has_visit_at(uuid, uuid[]) is
  'Whether a patient has a visit at one of the given hospitals. Used by the patients policy with '
  'the caller''s own hospitals, so a patient seen at one of them stays visible there.';

revoke all on function orbit_erp.visible_facility_ids() from public;
revoke all on function orbit_erp.has_visit_at(uuid, uuid[]) from public;
grant execute on function orbit_erp.visible_facility_ids() to orbit_app;
grant execute on function orbit_erp.has_visit_at(uuid, uuid[]) to orbit_app;

create function pg_temp.fast_policy_text(p_text text)
  returns text
  language sql
  immutable
as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    p_text,
    'EXISTS \( SELECT 1\s+FROM orbit_erp\.encounters e\s+WHERE \(e\.patient_id = patients\.id\)\)',
    'orbit_erp.has_visit_at(patients.id, coalesce((SELECT orbit_erp.visible_facility_ids()), ARRAY[]::uuid[]))', 'g'),
    'orbit_erp\.facility_visible\(([a-z_.]+)\)',
    '(\1 = ANY (coalesce((SELECT orbit_erp.visible_facility_ids()), ARRAY[]::uuid[])))', 'g'),
    'orbit\.current_org\(\)', '(SELECT orbit.current_org())', 'g'),
    'orbit_erp\.is_operator\(\)', '(SELECT orbit_erp.is_operator())', 'g'),
    'orbit_erp\.is_admin\(\)', '(SELECT orbit_erp.is_admin())', 'g')
$$;

do $$
declare
  p record;
  v_sql text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'orbit_erp'
  loop
    v_sql := format('alter policy %I on orbit_erp.%I', p.policyname, p.tablename);
    if p.qual is not null then
      v_sql := v_sql || format(' using (%s)', pg_temp.fast_policy_text(p.qual));
    end if;
    if p.with_check is not null then
      v_sql := v_sql || format(' with check (%s)', pg_temp.fast_policy_text(p.with_check));
    end if;
    execute v_sql;
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'orbit_erp'
      and (coalesce(qual, '') ~ 'facility_visible\(|FROM orbit_erp\.encounters e'
        or coalesce(with_check, '') ~ 'facility_visible\(')
  ) then
    raise exception 'a hospital-operations policy still evaluates per row';
  end if;
end;
$$;
