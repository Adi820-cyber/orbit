-- ============================================================================
-- 001_membership_bootstrap_rls.sql
--
-- pgTAP allow/deny tests for the membership bootstrap path (ADR 0002) and the
-- organization scope policies (migration 000400).
--
-- Run with:  supabase test db --linked        (no Docker required)
--        or: supabase test db --local         (requires a container runtime)
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ WHY EVERY TEST DOES `set local role orbit_app`                           │
-- │                                                                          │
-- │ `supabase test db` runs as `postgres`, which OWNS these tables. A table   │
-- │ owner bypasses that table's RLS unless FORCE ROW LEVEL SECURITY is set.   │
-- │                                                                          │
-- │ So a deny-test written without switching role would SELECT the rows it    │
-- │ claims are hidden, return them, and still pass if it only asserted "no    │
-- │ error" -- or worse, fail confusingly. A test that cannot observe the       │
-- │ policy it is testing is worse than no test: it reports safety it never    │
-- │ checked.                                                                 │
-- │                                                                          │
-- │ The migrations DO set FORCE on every table, which closes the owner        │
-- │ bypass. These tests still switch role explicitly, because the policies    │
-- │ are written `to orbit_app` and must be exercised as the role the          │
-- │ application actually connects as. Belt and braces, deliberately.          │
-- │                                                                          │
-- │ Raised as a review note on ADR 0009 -- it was not covered there.          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

begin;

-- 7 constraint assertions + 9 bootstrap + 10 data-transaction scope.
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures, created as the owner before any role switch.
--
-- Two organizations to prove tenant isolation, and inside the demo tenant two
-- regions with one facility each, so a region-scoped membership can be shown
-- NOT to see the other region.
-- ---------------------------------------------------------------------------
set local role postgres;

-- `set local role orbit_app` below requires the executing role to hold
-- MEMBERSHIP in orbit_app with the SET option -- not merely to have created it.
--
-- Whether `postgres` gets that membership automatically when the bootstrap
-- migration runs `create role orbit_app` depends on `createrole_self_grant`,
-- which we do not control on hosted Supabase. If it does not, every policy test
-- below fails with `permission denied to set role "orbit_app"` -- and would
-- fail in a way that looks like a policy problem rather than a grant problem.
-- So the membership is granted explicitly.
--
-- Version-gated because PostgreSQL 16 made INHERIT and SET per-grant
-- properties: `WITH SET TRUE` is valid from 16 onward and a syntax error
-- before it. On 16+ SET already defaults to true, so this is belt-and-braces,
-- but being explicit documents the requirement rather than relying on a
-- default that changed once already.
--
-- Grants `postgres` no privilege it lacks -- it already owns these tables. The
-- whole file runs in a transaction that ROLLS BACK, so nothing persists and the
-- deployed posture is unchanged.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    execute 'grant orbit_app to postgres with set true';
  else
    execute 'grant orbit_app to postgres';
  end if;
end
$$;

insert into orbit.organizations (id, slug, name, kind, currency, fiscal_year_start_month, timezone)
values
  ('00000000-0000-0000-0000-0000000000a1', 'kestrion-test', 'Kestrion (test)', 'demo', 'USD', 1, 'UTC'),
  ('00000000-0000-0000-0000-0000000000a2', 'halveston-test', 'Halveston (test fixture)', 'test-fixture', 'USD', 1, 'UTC');

insert into orbit.regions (id, organization_id, slug, name, short_name)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'north', 'North', 'North'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'south', 'South', 'South');

insert into orbit.facilities (id, organization_id, region_id, slug, name, staffed_beds, revenue_weight)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000b1', 'avenhurst', 'Avenhurst', 420, 0.50000),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000b2', 'dunmarrow', 'Dunmarrow', 380, 0.50000);

insert into orbit.coes (id, organization_id, host_facility_id, slug, name, reporting_grain, region_id)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000c1', 'cardiac', 'Cardiac COE', 'region',
   '00000000-0000-0000-0000-0000000000b1');

-- Subjects: COO North (active), COO South (active), an inactive user, and a
-- user in the other tenant.
insert into orbit.org_memberships (id, subject, organization_id, role_id, status)
values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000a1', 'regional-coo', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000a1', 'regional-coo', 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f3',
   '00000000-0000-0000-0000-0000000000a1', 'hospital-dho', 'inactive'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000f4',
   '00000000-0000-0000-0000-0000000000a2', 'chairman', 'active');

insert into orbit.org_membership_scopes (membership_id, organization_id, grain, region_id)
values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
   'region', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1',
   'region', '00000000-0000-0000-0000-0000000000b2');

insert into orbit.org_membership_scopes (membership_id, organization_id, grain)
values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a2', 'group');

-- ===========================================================================
-- Constraint tests (run as owner — these test the schema, not the policies)
-- ===========================================================================

-- ADR 0002: exactly one active membership per subject, enforced in the DB.
select throws_ok(
  $$insert into orbit.org_memberships (subject, organization_id, role_id, status)
    values ('00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000a2', 'group-cfo', 'active')$$,
  '23505',
  null,
  'a second ACTIVE membership for the same subject is rejected, even in another organization'
);

-- Inactive history must remain possible, so "inactive" stays distinguishable
-- from "absent".
select lives_ok(
  $$insert into orbit.org_memberships (subject, organization_id, role_id, status)
    values ('00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000a2', 'group-cfo', 'inactive')$$,
  'additional INACTIVE memberships for the same subject are allowed'
);

-- Grain/target pairing.
select throws_ok(
  $$insert into orbit.org_membership_scopes (membership_id, organization_id, grain, facility_id)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a1', 'region',
            '00000000-0000-0000-0000-0000000000c1')$$,
  '23514',
  null,
  'a scope claiming region grain cannot point at a facility'
);

select throws_ok(
  $$insert into orbit.org_membership_scopes (membership_id, organization_id, grain, region_id)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a1', 'group',
            '00000000-0000-0000-0000-0000000000b1')$$,
  '23514',
  null,
  'a group-grain scope cannot carry a region'
);

-- 'segment' is in the contract enum but has no entity table, so it must be
-- rejected rather than stored as an unverifiable authorization claim.
select throws_ok(
  $$insert into orbit.org_membership_scopes (membership_id, organization_id, grain)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a1', 'segment')$$,
  '23514',
  null,
  'grain "segment" is rejected until segments are modelled'
);

-- The denormalized organization_id cannot disagree with the parent membership.
select throws_ok(
  $$insert into orbit.org_membership_scopes (membership_id, organization_id, grain)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a2', 'group')$$,
  '23503',
  null,
  'a scope cannot claim a different organization than its membership'
);

-- A COE cannot claim group grain while naming a region.
select throws_ok(
  $$insert into orbit.coes (organization_id, host_facility_id, slug, name, reporting_grain, region_id)
    values ('00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000c1', 'bad-coe', 'Bad', 'group',
            '00000000-0000-0000-0000-0000000000b1')$$,
  '23514',
  null,
  'a group-grain COE cannot carry a region'
);

-- ===========================================================================
-- Bootstrap self-read — the LOOKUP transaction
--
-- Only orbit.subject is set. orbit.membership is deliberately absent, exactly
-- as the API's first transaction behaves.
-- ===========================================================================

set local role orbit_app;
select set_config('orbit.subject', '00000000-0000-0000-0000-0000000000f1', true);
select set_config('orbit.membership', '', true);

select is(
  (select count(*)::int from orbit.org_memberships),
  1,
  'ALLOW: a subject reads exactly its own membership row during bootstrap'
);

select is(
  (select subject::text from orbit.org_memberships),
  '00000000-0000-0000-0000-0000000000f1',
  'ALLOW: the row returned is the caller''s own'
);

select is(
  (select count(*)::int from orbit.org_membership_scopes),
  1,
  'ALLOW: the subject reads its own scope rows, so claims can be assembled'
);

-- The central deny case: one subject must never see another's membership.
select set_config('orbit.subject', '00000000-0000-0000-0000-0000000000f2', true);

select is(
  (select count(*)::int from orbit.org_memberships
   where subject = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'DENY: a subject cannot read another subject''s membership row'
);

select is(
  (select count(*)::int from orbit.org_membership_scopes
   where membership_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'DENY: a subject cannot read another subject''s scope rows'
);

-- Inactive rows MUST be visible to their own subject. If this returned 0, the
-- API could not distinguish "inactive membership" from "no membership" and its
-- required failure path would collapse two different denials into one.
select set_config('orbit.subject', '00000000-0000-0000-0000-0000000000f3', true);

select is(
  (select count(*)::int from orbit.org_memberships),
  1,
  'ALLOW: an INACTIVE membership is still readable by its own subject, so the API can tell inactive from absent'
);

select is(
  (select status from orbit.org_memberships),
  'inactive',
  'ALLOW: the inactive row reports its real status rather than being filtered out'
);

-- Absent claims must yield nothing, not an error. Without the nullif in
-- current_subject(), ''::uuid would raise and turn a deny into a 500.
select set_config('orbit.subject', '', true);

select lives_ok(
  $$select count(*) from orbit.org_memberships$$,
  'an unset orbit.subject does not raise (the nullif in current_subject() holds)'
);

select is(
  (select count(*)::int from orbit.org_memberships),
  0,
  'DENY: an unset orbit.subject matches no membership rows'
);

-- ===========================================================================
-- Organization scope — the DATA transaction
--
-- Only orbit.membership is set. orbit.subject is absent, exactly as the API's
-- second transaction behaves. This also proves the two-transaction split does
-- what ADR 0002 intended: the bootstrap policy cannot OR with handler reads.
-- ===========================================================================

select set_config('orbit.subject', '', true);
select set_config(
  'orbit.membership',
  '{"membershipId":"00000000-0000-0000-0000-0000000000e1",
    "subject":"00000000-0000-0000-0000-0000000000f1",
    "organizationId":"00000000-0000-0000-0000-0000000000a1",
    "role":"regional-coo",
    "scopes":[{"grain":"region","entityId":"00000000-0000-0000-0000-0000000000b1"}]}',
  true
);

-- This is the structural payoff of two transactions.
select is(
  (select count(*)::int from orbit.org_memberships),
  0,
  'DENY: with only orbit.membership set, the bootstrap self-read policy matches nothing (two-transaction split holds)'
);

select is(
  (select count(*)::int from orbit.organizations),
  1,
  'ALLOW: the caller sees its own organization'
);

select is(
  (select count(*)::int from orbit.organizations
   where id = '00000000-0000-0000-0000-0000000000a2'),
  0,
  'DENY: cross-tenant read returns nothing'
);

-- Region grain: own region only, no upward inference to the whole tenant.
select is(
  (select count(*)::int from orbit.regions),
  1,
  'ALLOW: a region-scoped membership sees exactly its own region'
);

select is(
  (select count(*)::int from orbit.regions
   where id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'DENY: a region-scoped membership cannot see the other region'
);

-- Downward ancestry is permitted one step: region scope reaches its facilities.
select is(
  (select count(*)::int from orbit.facilities),
  1,
  'ALLOW: region scope reaches facilities inside that region'
);

select is(
  (select count(*)::int from orbit.facilities
   where id = '00000000-0000-0000-0000-0000000000c2'),
  0,
  'DENY: region scope does not reach a facility in the other region'
);

select is(
  (select count(*)::int from orbit.coes),
  1,
  'ALLOW: region scope reaches a COE reporting to that region'
);

-- Malformed claims must deny, not error or match broadly.
select set_config('orbit.membership', '', true);

select is(
  (select count(*)::int from orbit.organizations),
  0,
  'DENY: absent membership claims match no organization rows'
);

select is(
  (select count(*)::int from orbit.facilities),
  0,
  'DENY: absent membership claims match no facility rows'
);

-- Back to the owner before finishing. pgTAP keeps its plan and results in
-- temp objects created when plan() was called, which was before the role
-- switch -- so finish() should read them as the role that created them rather
-- than relying on orbit_app having access to another role's temp schema.
reset role;

select * from finish();

rollback;
