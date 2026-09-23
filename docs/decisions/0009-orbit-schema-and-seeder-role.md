# ADR 0009: Dedicated `orbit` schema, and the unresolved seeder-role question

- **Status:** **Accepted** — 2026-09-23. §1 is applied and proven. §2 is **now decided**: the `bypassrls` route was tested and is impossible on hosted Supabase, which closes the question this ADR deliberately left open. See "§2 resolved" and "§3 resolved" below.
- **Author:** Aditya (security/credentials boundary)
- **Reviewers:** Maruti (owns `supabase/`), Ghansham (every query and test is affected by §1)
- **Date:** 2026-09-23
- **Implements:** `supabase/migrations/20260923000100_orbit_roles_and_schema.sql`
- **Related:** ADR 0008 (project posture), ADR 0002 (claims and two transactions)

## Boundary note

`supabase/migrations/` is Maruti's path (FILE_STRUCTURE.md §3). I authored the
bootstrap migration because it is entirely roles, grants and credential
posture — my boundary under ARCHITECTURE.md §7.1 — and because it blocks her.
It is a proposal in her directory, not a decision imposed on it. If she wants
to own the file and take this as a spec instead, that is fine and better.

## 1. Business tables live in an `orbit` schema, not `public`

**Proposed decision: create a dedicated `orbit` schema and put every Orbit
table in it.**

The Supabase Data API (PostgREST) only serves schemas listed in its
exposed-schema configuration, and `public` is the default. Putting tables in
`orbit` means they are outside that default, so the Data API does not reach
them as configured today.

**This is defence in depth, not enforcement — an earlier draft of this ADR
overstated it and the correction matters.** The exposed-schema list is
project-level configuration: someone can add `orbit` to it later, and this
migration neither reads nor sets that configuration. So the schema choice
raises the bar (a second deliberate action is now required to expose these
tables, and it happens somewhere reviewable) but it does not make exposure
impossible.

Consequently ARCHITECTURE.md §16's line, "Data API disabled or equivalently
locked," stays **open**. It is closed only when deployment configuration
explicitly excludes `orbit` from the exposed schemas, or disables the Data API
outright — and that must be verified against the live project, not inferred
from where the tables sit. ADR 0008 §3 already flagged that the 401 on
`/rest/v1/` proves only that the gateway rejects a missing key; the schema
choice does not upgrade that evidence.

It also matches the architecture's real shape. §3 states the browser never
talks to the database and the backend is the only path to business data. Under
that design nothing legitimately needs these tables published over PostgREST,
so leaving them in `public` would mean depending on RLS alone to protect a
surface we never meant to publish. RLS is supposed to be the *second* barrier,
not the only one.

**Costs, stated honestly:**

- Every migration, query and pgTAP test must schema-qualify. `orbit_app`'s
  `search_path` is pinned to `orbit, public` so application SQL stays readable,
  but migrations and tests running as `postgres` will need explicit
  qualification.
- Ghansham's `db/client.ts` and any raw SQL must target `orbit.*`. Cheap now,
  annoying later.
- Supabase Studio's table editor defaults to `public`; the team will need to
  switch schema in the UI.

**Why now:** no tables exist. This is the only moment the change is free. After
Maruti's table migrations land it becomes a rename across every file.

**If rejected:** then the Data API item from §16 must be closed some other
explicit way — restricting exposed schemas in project config, or per-table
revokes — and that needs recording. "It returns 401 today" is not a control.

## 2. Open question: the seeder role

TEAM_ASSIGNMENTS.md requires "a separate seeder role, restricted to specific
environments," and ARCHITECTURE.md §7.5 wants seeding separated from the API
path. I did **not** put a seeder role in the bootstrap migration, because the
obvious designs each have a problem I could not resolve without testing against
hosted Supabase, and guessing here would waste Maruti's time.

The difficulty: seeding has to write rows across every organization and role,
which is exactly what RLS exists to prevent. So the seeder needs some form of
RLS exemption, and the available routes are all imperfect:

- **`bypassrls` on a dedicated role.** Cleanest to reason about, but granting
  `bypassrls` requires superuser, and Supabase's `postgres` role is not a
  superuser. ~~**Unverified whether this is even possible on hosted Supabase** —
  this is the specific thing to test first.~~ **Tested: not possible.** See
  "§2 resolved" below.
- **Make the seeder own the tables.** Owners bypass their own tables' RLS by
  default. But then the seeder's credential is effectively an RLS bypass for
  the whole dataset, and it collides with the rule in the bootstrap migration
  that `orbit_app` must never own a table — we would just be moving the hazard.
- **Permissive seed policies naming the seeder role.** Keeps everything
  declarative and needs no elevated attribute. But it adds a second permissive
  policy to every table, and permissive policies OR together — the risk
  ARCHITECTURE.md flags as [S2] and the reason ADR 0002 chose two transactions.
  Every table would carry a policy whose only job is to be bypassable.
- **Seed through the migration/owner path.** Works today with no new role,
  because migrations run as `postgres`, which owns the tables and so bypasses
  their RLS. This is what `supabase db push` already does. It does not satisfy
  the letter of "a separate seeder role," but it satisfies the intent —
  seeding does not share a credential with the API.

**My recommendation, for Maruti to accept or reject:** ship the fourth option
first so she is unblocked, and treat the dedicated seeder role as a follow-up
once someone has verified what attributes hosted Supabase actually permits. A
seeder role that turns out to need a permissive policy on every table is worse
than no seeder role.

**Constraints that hold regardless of which option wins:**

- The seeder credential is never the same as `orbit_app`'s, and never reaches
  the deployed API's environment.
- `data:reset` stays a separate command from idempotent `data:seed`
  (ARCHITECTURE.md §7.5), and must refuse to run against production.
- The audit table grants no UPDATE or DELETE **to anyone**, seeder included
  (PRD FR-07). Append-only means append-only.

## 3. The migration is not applied

`20260923000100_orbit_roles_and_schema.sql` is written and committed, **not
pushed to the database.** Two things should happen first:

1. Maruti reviews it — it is her directory and her downstream work.
2. Legacy `anon`/`service_role` keys get disabled on the project (ADR 0008
   §4.1). This migration creates no tables, so applying it would not open the
   window ADR 0008 warned about, but there is no reason to race.

It also contains no password, by design. `orbit_app` is created with `login`
and no password, so it cannot authenticate until one is set out of band in the
SQL editor. It fails closed. The password then lives only in `DATABASE_URL`.

For the connection string: Supavisor authenticates with the role and project
ref joined by a dot, so the username is **`orbit_app.sxpnsnfzkpkzhsxjugde`**,
on the transaction-mode pooler at port 6543, with prepared statements off.

## §2 resolved — 2026-09-23 (Aditya, on Maruti's evidence)

**Decision: seed through the migration/owner path. The dedicated seeder role is
withdrawn, not deferred.**

This ADR left §2 open on purpose and named the thing to test first: whether
`bypassrls` can be granted at all on hosted Supabase. Maruti tested it while
applying the bootstrap migration. The answer is sharper than expected:

**`bypassrls` is neither grantable nor revocable on hosted Supabase.** Not
merely "cannot be granted" — it cannot be touched in either direction. My own
bootstrap migration proved the second half by failing:

```
alter role orbit_app with nosuperuser noreplication nobypassrls;
-- ERROR: permission denied to alter role (SQLSTATE 42501)
```

Postgres restricts `superuser`, `replication` and `bypassrls` to superusers
**symmetrically**, so a non-superuser cannot even assert the safe value. That
was fixed in PR #24 by altering only `login noinherit nocreatedb nocreaterole`
and letting an assertion block prove the remaining three are false.

### What this settles

Option 1 is not available, and the reason is a property of the platform rather
than a gap in our setup — so it will not become available later. That changes
the recommendation from "ship option 4 first, revisit" to a decision:

- **Option 1 (`bypassrls` role)** — impossible. Closed permanently.
- **Option 2 (seeder owns the tables)** — rejected. It relocates the hazard
  instead of removing it: the seeder credential becomes a standing RLS bypass
  over the whole dataset, and it collides with the bootstrap rule that
  `orbit_app` must never own a table.
- **Option 3 (permissive seed policies)** — rejected, and this is the one worth
  being explicit about. Permissive policies OR together, so every table would
  carry a policy whose only purpose is to be bypassable. That is the [S2] risk
  ARCHITECTURE.md flags and the exact hazard ADR 0002 split into two
  transactions to avoid. Adopting it for seeding convenience would undo that
  reasoning table by table.
- **Option 4 (migration/owner path)** — **adopted.** Migrations run as
  `postgres`, which owns the tables and therefore bypasses their RLS. No new
  role, no new policy, no new credential.

### Answering the requirement honestly

TEAM_ASSIGNMENTS.md asks for "a separate seeder role, restricted to specific
environments." Option 4 does not provide a separate *role*. It does provide the
property the requirement exists to protect: **seeding never shares a credential
with the API.** `orbit_app` is SELECT-only and cannot seed; seeding happens
through migrations under a credential the deployed API never holds.

Recording this as a deliberate divergence rather than a satisfied requirement.
If a reviewer disagrees, the remedy is a TEAM_ASSIGNMENTS.md amendment, not a
seeder role that needs a permissive policy on every table to function — that
would be worse than what it replaces.

### Constraints that still bind

Unchanged from §2 above, and none of them depended on which option won:

- The seeder credential never reaches the deployed API's environment. Now
  structural rather than procedural: `orbit_app` has SELECT only, so the API's
  credential *cannot* seed even if misused.
- `data:reset` stays separate from idempotent `data:seed`, and must refuse to
  run against production.
- The audit table grants no UPDATE or DELETE to anyone, seeder included
  (PRD FR-07).

### Verification status

- **Verified by execution:** the `ALTER ROLE` failure above — that was my own
  migration failing against the live project, in PR #24's history.
- **Reported by Maruti, not independently confirmed:** that `bypassrls` is also
  non-grantable. My Supabase account returns 403 on
  `supabase migration list --linked`, so I cannot re-run it. The conclusion does
  not rest on this alone — the revoke failure is sufficient to show the
  attribute is superuser-only in both directions.

## §3 resolved — the migration is applied

§3 above says the migration is written but not pushed. That is no longer true
and the section is retained only for history.

All six migrations (`20260923000100` through `20260923000600`) are applied to
project `sxpnsnfzkpkzhsxjugde`. Maruti reports 15 tables in the `orbit` schema
with RLS enabled and forced on every one, 15 policies and none using
`USING (true)`, `orbit_app` holding SELECT only with `rolsuper`,
`rolbypassrls` and `rolreplication` all false and zero role memberships, and
the pgTAP suite passing 26/26.

The precondition in §3 item 2 — disabling the legacy `anon`/`service_role`
keys — **is still not done** (ADR 0008 §4.1, ADR 0001). §3 argued applying the
roles migration would not open that window because it creates no tables. The
later migrations *do* create tables, so that argument no longer covers the
current state: there are now 15 tables in a project whose legacy keys are still
enabled. RLS is forced on all of them, which is the control that matters, but
the key posture is a real outstanding item and not a formality.

**Not verified by Aditya** — every count above is Maruti's report. I still lack
project access. This is the single largest unverified claim in the repository
and the reason getting Owner/Admin on `org for orbit` is the highest-priority
non-code task.
