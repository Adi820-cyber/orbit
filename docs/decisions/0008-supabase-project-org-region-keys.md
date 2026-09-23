# ADR 0008: Orbit Supabase project — organization, region, and key posture

- **Status:** Accepted for the org/region/project choices. **Two conditions from ADR 0001 are not yet met** — see §4. Do not treat this project as fully conformant until they are.
- **Owner:** Aditya (TEAM_ASSIGNMENTS.md §8.2 — dev + prod Supabase projects)
- **Date:** 2026-09-23
- **Related:** ADR 0001 (credential remediation), ADR 0002 (two transactions per request)

## 1. What exists

| | |
|---|---|
| Organization | `rddoqtmqkqdpkzvyjvqq` — "org for orbit" |
| Project | `orbit Project` — ref `sxpnsnfzkpkzhsxjugde` |
| Region | `ap-south-1` (Mumbai) |
| Status | `ACTIVE_HEALTHY` |
| Migration history | empty — `supabase migration list` returns no rows |
| Schema inventory | **not verified** — see §3 |

**A dedicated organization was the right call.** ADR 0001's second exposure was
made harder to resolve precisely because the affected project sat in one
person's organization while someone else was investigating it, leaving
rotation authority ambiguous. A single-purpose org with one clear owner
removes that. It also keeps Orbit out of an organization holding unrelated
projects, so a mistake here cannot reach anything else.

**This project is designated dev/preview**, not production. See §4.2.

## 2. Verified — asymmetric signing keys are in place

The public JWKS endpoint returns a live key:

```
GET https://sxpnsnfzkpkzhsxjugde.supabase.co/auth/v1/.well-known/jwks.json
→ { "keys": [ { "alg": "ES256", "kty": "EC", "crv": "P-256", "use": "sig", … } ] }
```

`ES256` on a P-256 curve — asymmetric, not the legacy HS256 shared secret. A
non-empty JWKS response is the documented test for this (ARCHITECTURE.md §6.1
notes that a legacy symmetric project returns an empty JWKS).

**This satisfies condition 1 of ADR 0001's amendment, and it is the condition
that matters most.** The old project is unrecoverable specifically because
legacy shared secrets can no longer be rotated. This project can be rotated
and revoked through the dashboard if a key is ever exposed. We are not
inheriting that trap.

Verified by reading a public endpoint. JWKS publishes only the public half of
the keypair, so nothing sensitive was accessed to confirm it.

## 3. What the two checks actually establish — and what they do not

Both checks below are weaker than they first look, so they are recorded with
their limits rather than as clean bills of health.

**Migration history is empty.** `supabase migration list` against the linked
project returns no rows. That reports **migration history only, not the database
catalog.** A project can carry manually created schemas or tables with no
migration rows at all, so this is not evidence the database is empty.

Why it matters: applying migrations to a project assumed empty but actually
populated is how you get a failed migration mid-run, or worse, a silent
collision with an existing object. **A real schema inventory — querying
`information_schema` / `pg_catalog` for non-system schemas and tables — has not
been run,** because it needs a database connection and the `orbit_app` password
is deliberately not yet set. Maruti should run it before the first `db push`,
now that she has access. The project is newly created, so empty is *likely*;
likely is not verified.

**The Data API rejects an unauthenticated request.** `GET /rest/v1/` with no key
returns **401 Unauthorized**.

That proves only that the gateway rejects a **missing** key. It says nothing
about the anonymous role, which is normally exercised *with* the publishable or
`anon` key — the case that actually matters for accidental table exposure. This
check was not run with a key, deliberately, to avoid handling key material after
the ADR 0001 incident.

So ARCHITECTURE.md §16's "Data API disabled or equivalently locked" is **open**,
and neither check above moves it. ADR 0009 discusses putting tables in a
non-exposed `orbit` schema, which raises the bar but is also not enforcement.
Closing this requires deployment configuration that explicitly excludes the
schema or disables the Data API, verified against the live project.

## 4. Not yet met — two open items

### 4.1 Legacy `anon` and `service_role` keys exist and should be disabled

The project's key list contains four entries (names and types only were
inspected; no key values were read or recorded):

| name | type |
|---|---|
| `anon` | legacy |
| `service_role` | legacy |
| `default` | publishable |
| `default` | secret |

**Orbit needs neither legacy key.** The browser authenticates with the
*publishable* key (`VITE_SUPABASE_PUBLISHABLE_KEY`), and the API does not use
a Supabase API key to reach data at all — it connects to Postgres directly as
`orbit_app` through the pooler (ARCHITECTURE.md §7.1). Nothing in the design
calls `anon` or `service_role`.

So they are pure attack surface, and not the harmless kind: **a leaked legacy
`service_role` key cannot be rotated**, bypasses RLS entirely, and is exactly
the failure this project was created to escape. Leaving them enabled keeps a
non-rotatable RLS bypass sitting on the new project for no benefit.

**Action (dashboard, Project Settings → API Keys): disable the legacy API
keys.** This closes condition 3 of ADR 0001's amendment. Do it before any
table exists, so there is never a window where a non-rotatable bypass key and
real rows coexist.

### 4.2 Only one project exists; production must be separate

ARCHITECTURE.md §11.1 requires a **separate** Supabase project for dev/preview
from production, "so seeds and experiments never touch the production
dataset." Since the data plan involves a deterministic generator plus
`data:reset` tooling, pointing that at a shared project is how a demo dataset
gets destroyed mid-demo.

One project is fine for now — this is dev. A second, production project is
required before any production deployment, in the same organization.

## 5. Region consequence worth planning around

Mumbai (`ap-south-1`) is a sensible choice for this team. One follow-through:
**pin the Vercel API function region to match** (Mumbai / `bom1`).

This is not a marginal optimisation here. ADR 0002 settled on **two
transactions per request** — a subject-scoped lookup, then a claims-scoped data
transaction — which means every request pays two round trips to Postgres. A
cross-region deployment would multiply an avoidable latency penalty by two on
every single request, and it would show up as the API feeling slow with no
obvious cause in the code.

Record the chosen Vercel region when the projects are created (ADR 0007 covers
the adjacent CORS/preview work).

## 6. Still required before this project holds data

- `orbit_app` least-privilege role created; API never connects as `postgres`,
  and never with a secret or service key (ARCHITECTURE.md §7.1).
- Separate restricted seeder role, distinct from `orbit_app`.
- `DATABASE_URL` uses the Supavisor **transaction-mode** pooler on port 6543
  with prepared statements off.
- Legacy keys disabled per §4.1.
- Credentials handled only through the environment variables documented in
  `.env.example`, and never displayed outside the Supabase dashboard — ADR 0001
  condition 5, which exists because it was already violated once.
