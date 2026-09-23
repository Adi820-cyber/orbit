-- ============================================================================
-- 20260923000100_orbit_roles_and_schema.sql
--
-- Bootstrap migration: the `orbit` schema and the least-privilege `orbit_app`
-- role the API connects as.
--
-- AUTHORED BY: Aditya (security/credentials boundary, ARCHITECTURE.md §7.1)
-- OWNER OF THIS DIRECTORY: Maruti (FILE_STRUCTURE.md §3)
--   → This file is a PROPOSAL for Maruti's review, not a unilateral change to
--     her path. Two decisions in it need her sign-off; see ADR 0009.
--
-- MUST RUN FIRST. Every later migration grants privileges to `orbit_app`, so
-- the role has to exist before any table does. The timestamp is deliberately
-- early for that reason.
--
-- NO PASSWORD IS SET HERE, AND NONE MAY BE ADDED.
--   A password in a migration is a committed credential (RULES.md).
--   The role is created with LOGIN but no password, so it cannot authenticate
--   until a password is set out of band — it fails closed, which is correct.
--   Set it once, manually, in the Supabase SQL editor:
--       alter role orbit_app with password '<generated>';
--   Then store it only in the DATABASE_URL env var (see .env.example).
--
-- Related: ADR 0008 (project/org/keys), ADR 0002 (claims + two transactions),
--          ARCHITECTURE.md §7.1 (connection posture), §7.2 (grant discipline).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Dedicated `orbit` schema  ← NEEDS SIGN-OFF (ADR 0009)
--
-- Business tables live in `orbit`, not `public`.
--
-- Why: the Supabase Data API (PostgREST) only serves schemas listed in its
-- exposed-schema configuration, and `public` is the default. Tables in `orbit`
-- sit outside that default, so the Data API does not reach them as configured
-- today.
--
-- This is defence in depth, NOT enforcement. The exposed-schema list is
-- project-level configuration, and this migration neither reads nor sets it, so
-- `orbit` can be added to it later. The schema choice raises the bar — exposing
-- these tables now takes a second deliberate action in a reviewable place — but
-- ARCHITECTURE.md §16's "Data API disabled or equivalently locked" stays OPEN
-- until deployment config explicitly excludes `orbit` or disables the Data API,
-- verified against the live project. Do not treat the schema name as the
-- control.
--
-- It also matches the architecture's actual shape: the browser never talks to
-- the database (§3), so nothing legitimately needs these tables exposed over
-- PostgREST. Leaving them in `public` would mean relying on RLS alone to
-- protect a surface we never intended to publish.
--
-- Cost: every later migration, query, and pgTAP test must schema-qualify, and
-- `orbit_app`'s search_path is pinned below so application SQL stays readable.
-- This is the cheapest moment to make this choice — no tables exist yet.
-- ---------------------------------------------------------------------------
create schema if not exists orbit;

comment on schema orbit is
  'Orbit business tables. Deliberately NOT exposed via the Supabase Data API; '
  'all access goes through services/api as orbit_app. See ADR 0009.';


-- ---------------------------------------------------------------------------
-- 2. The application role
--
-- Every negative flag is deliberate:
--   nosuperuser   — obvious.
--   nocreatedb /
--   nocreaterole  — the API has no business creating either.
--   noreplication — no logical replication slots.
--   nobypassrls   — THE critical one. RLS is the second barrier (ARCH §3);
--                   a role that can bypass it makes the barrier decorative.
--   noinherit     — the role gets no privileges implicitly via role
--                   membership. Anything it can do is granted explicitly
--                   below, so the privilege set is auditable by reading this
--                   file rather than by walking a role graph.
--   login         — it is a connection role.
--
-- `orbit_app` must never own a table. A table owner bypasses that table's RLS
-- unless FORCE ROW LEVEL SECURITY is set, so ownership would silently undo
-- nobypassrls. Migrations run as `postgres`, which owns the tables; keep it
-- that way.
-- ---------------------------------------------------------------------------
-- Create if absent, then ALTER unconditionally.
--
-- `if not exists` alone would be unsafe: a pre-existing `orbit_app` could
-- already carry superuser, bypassrls, createrole or inherit, and a create-only
-- guard would skip every attribute while this migration still claimed a
-- least-privilege posture. The ALTER runs on both paths, so the attributes are
-- asserted rather than assumed — existence is not treated as sufficient.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orbit_app') then
    create role orbit_app;
  end if;
end
$$;

alter role orbit_app with
  login
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

-- Remove any membership in privileged built-ins. `noinherit` only stops
-- *implicit* use of an inherited privilege; an explicit `set role` would still
-- work, so the membership must not exist at all.
do $$
declare r record;
begin
  for r in
    select g.rolname as grantor
    from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles u on u.oid = m.member
    where u.rolname = 'orbit_app'
      and g.rolname in ('anon','authenticated','service_role','postgres','supabase_admin')
  loop
    execute format('revoke %I from orbit_app', r.grantor);
  end loop;
end
$$;

-- Fail closed if the posture is not what this file claims. A silent mismatch
-- would make RLS decorative, so abort the migration rather than proceed.
--
-- Two separate assertions, because they prove different things:
do $$
declare bad text;
begin
  -- (a) Role-level attributes.
  select string_agg(attr, ', ') into bad from (
    select 'superuser'   as attr from pg_roles where rolname='orbit_app' and rolsuper
    union all select 'bypassrls'   from pg_roles where rolname='orbit_app' and rolbypassrls
    union all select 'createrole'  from pg_roles where rolname='orbit_app' and rolcreaterole
    union all select 'createdb'    from pg_roles where rolname='orbit_app' and rolcreatedb
    union all select 'replication' from pg_roles where rolname='orbit_app' and rolreplication
  ) s;
  if bad is not null then
    raise exception 'orbit_app has forbidden attributes: %', bad;
  end if;
end
$$;

-- (b) Membership. This is the assertion that actually matters, and the earlier
-- version of this file got it wrong.
--
-- `rolinherit` was previously asserted here as if it proved orbit_app inherits
-- nothing. It does not. From PostgreSQL 16, INHERIT is a property of each
-- individual GRANT, not of the role — so `alter role ... noinherit` sets only
-- the default for grants made *afterwards*, and `not rolinherit` says nothing
-- about grants that already exist. The attribute check was testing the weaker
-- property while reading like the strong one.
--
-- The real control is that orbit_app holds no role membership at all. Asserted
-- against pg_auth_members rather than inferred from an attribute, and asserted
-- for ANY grantor rather than the named list the revoke loop above clears —
-- so a membership nobody thought to revoke still fails the migration instead
-- of passing silently.
do $$
declare memberships text;
begin
  select string_agg(g.rolname, ', ' order by g.rolname)
    into memberships
  from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles u on u.oid = m.member
  where u.rolname = 'orbit_app';

  if memberships is not null then
    raise exception
      'orbit_app is a member of: %. A least-privilege application role must hold no role membership: noinherit does not prevent an explicit SET ROLE, and from PG16 inheritance is per-grant.',
      memberships;
  end if;
end
$$;

-- Note for anyone adding a grant later: `grant <role> to orbit_app` will make
-- the next run of this migration fail, by design. If a membership is ever
-- genuinely required, it needs a reviewed decision and an explicit allowlist
-- here — not a quiet relaxation of the assertion.
--
-- The converse direction is fine and deliberately not asserted: `postgres`
-- being a member of `orbit_app` (which pgTAP needs for `set role orbit_app`)
-- does not appear above, because that grant makes postgres a member of
-- orbit_app, not the reverse.

comment on role orbit_app is
  'Least-privilege role used by services/api. Never postgres, never '
  'service_role. Password set out of band; see this migration''s header.';

-- Pin search_path so application SQL does not depend on the caller's setting,
-- and so a mutable search_path cannot be used to shadow an orbit object with
-- an attacker-controlled one of the same name in another schema.
alter role orbit_app set search_path = orbit, public;

-- Keep a lid on how many pooled backends one role can hold. The API opens two
-- transactions per request (ADR 0002), so connection pressure is real. This is
-- a guardrail, not a tuning value — revisit with measurements, not guesses.
alter role orbit_app connection limit 60;


-- ---------------------------------------------------------------------------
-- 3. Schema access
--
-- `usage` lets the role resolve objects inside the schema. It grants nothing
-- on the objects themselves — those grants are per-table, in the migration
-- that creates each table (ARCHITECTURE.md §7.2, one policy per operation).
--
-- `create` is deliberately NOT granted: the API must not be able to add
-- objects to the schema it reads.
-- ---------------------------------------------------------------------------
grant usage on schema orbit to orbit_app;

revoke create on schema orbit from public;
revoke all on schema orbit from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Revoke the defaults that would otherwise auto-grant future tables
--
-- Supabase's docs are explicit that adding RLS policies does not remove
-- existing grants, and that a table in an exposed schema is readable by any
-- role holding a grant on it. So the defaults have to be revoked, not merely
-- policed.
--
-- `alter default privileges` applies to objects created LATER by the named
-- role. It is not retroactive — which is exactly why this migration runs
-- before any table exists.
-- ---------------------------------------------------------------------------
alter default privileges in schema orbit
  revoke all on tables from anon, authenticated;
alter default privileges in schema orbit
  revoke all on sequences from anon, authenticated;
alter default privileges in schema orbit
  revoke all on functions from anon, authenticated;

-- Nothing is granted to orbit_app by default either. Each table's migration
-- grants exactly the operations that table needs — and the audit table gets
-- INSERT plus controlled SELECT only, never UPDATE or DELETE, for anyone
-- (ARCHITECTURE.md §7.2, PRD FR-07).
alter default privileges in schema orbit
  revoke all on tables from orbit_app;


-- ---------------------------------------------------------------------------
-- 5. Reserved settings used by the request pipeline (ADR 0002)
--
-- `orbit.subject`    — set in the lookup transaction only.
-- `orbit.membership` — set in the data transaction only.
--
-- Both are namespaced custom GUCs written with set_config(name, value, true),
-- which is transaction-local. `SET LOCAL` is not used because it cannot take a
-- bound parameter, and session-scoped `SET` is banned outright: it leaks
-- across pooled connections in transaction mode (ARCHITECTURE.md §7.1).
--
-- No DDL is needed to reserve these — namespaced GUCs need no declaration.
-- They are documented here so the names have one authoritative definition,
-- and so policies can be reviewed against it.
--
-- Policies reading `orbit.subject` must use:
--     nullif(current_setting('orbit.subject', true), '')::uuid
--
-- Both parts matter, for different reasons:
--   * `missing_ok = true` (the second argument) makes an *unset* GUC return
--     NULL instead of raising `unrecognized configuration parameter`.
--   * `nullif(..., '')` handles the GUC being present but **empty**, which is
--     what a reset-to-empty leaves behind on a reused pooled connection.
--     `''::uuid` raises `invalid input syntax for type uuid`, turning what
--     should be a clean deny into a 500.
-- Neither guard covers the other case, so both are required.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 6. NOT IN THIS MIGRATION — deliberately
--
-- * The seeder role. Its design has an unresolved question that should not be
--   guessed at; see ADR 0009 §2. Seeding via the migration/owner path works
--   today because `postgres` owns the tables.
-- * Any table, policy, or grant. Those belong to the migration that creates
--   the table, so grants and RLS stay next to the thing they protect
--   (ARCHITECTURE.md §7.2).
-- * FORCE ROW LEVEL SECURITY on tables. Worth considering per table as
--   defence in depth against accidental ownership changes; Maruti's call.
-- ---------------------------------------------------------------------------
