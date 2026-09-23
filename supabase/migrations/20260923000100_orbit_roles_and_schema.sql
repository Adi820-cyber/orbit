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
-- Why: Supabase's Data API (PostgREST) only exposes schemas it is configured
-- to expose — `public` by default. A table in `orbit` is therefore not
-- reachable over the Data API at all, regardless of grants or policies.
-- That turns ARCHITECTURE.md §16's "Data API disabled or equivalently locked"
-- from a setting somebody has to remember into a structural property.
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
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orbit_app') then
    create role orbit_app with
      login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$$;

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
-- The nullif is not optional: an unset GUC reads back as the empty string, and
-- ''::uuid raises rather than matching no rows — turning a deny into a 500.
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
