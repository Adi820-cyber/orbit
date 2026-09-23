# Backend implementation plan (Ghansham)

**As of:** 23 September 2026, `main` at `456e6fa`.
**Scope:** `services/api` and the backend half of `packages/contracts`. For the team-wide plan, see [docs/orbit/IMPLEMENTATION_PLAN.md](../../docs/orbit/IMPLEMENTATION_PLAN.md).

The API and the frontend now agree route for route. The next milestone is the Regional COO demo running on real data rather than the preview fixture. Three things stand between here and there:

1. Your open branches merging (five stacked, plus one independent lint fix).
2. One authorization ruling from Aditya.
3. Maruti's fact tables.

## 1. Where things stand

### On `main`

| Area | Owner | State |
|---|---|---|
| API: auth, scope, the six modules, fail-closed wiring | Ghansham | Merged (#16) |
| Schema with RLS; entitlement matrix and org seed (109 rows, 6 facilities) | Maruti | Merged (#19, #24, #25, #28) |
| Regional COO workspace: brief, inbox, explorer, Ask, actions, audit | Ayas | Merged (#30), running on an in-browser fixture API |
| CI: typecheck, test, oxlint, gitleaks | Aditya | Merged (#21) |

### Your open branches (open the PRs in this order; each builds on the one before)

| # | Branch | What it adds | Reviewers |
|---|---|---|---|
| 1 | `ghansham/api-transition-matrix-draft` | Proposed action transition matrix and `TRANSITIONS.md` | Aditya (sign-off) |
| 2 | `ghansham/api-live-sources-flag` | Real SQL for memberships, entitlements, and scope checks, switched on by `ORBIT_LIVE_SOURCES` | Aditya, Maruti |
| 3 | `ghansham/api-adr-0011-assign-audit` | ADR 0011 §6 downward-only assignment, §7 audit filtered to own actions, `.env.example` fix | Aditya |
| 4 | `ghansham/contracts-uuid-entity-ids` | `segment` removed from the grains (ADR 0012); API and contracts test data moved to uuid entity ids | Ayas, Maruti, Aditya |
| 5 | `ghansham/api-entity-directory` | `GET /api/entities`: entity names for the UI (additive draft contract), `entities` live source | Ayas, Aditya |
| — | `ghansham/api-lint-fastify` (from `main`, independent) | Turns off the Express-only lint rule; Ask switches end in `unreachable()` | Aditya |

Checked on 23 Sep: branches 1–4 merge cleanly with `main`, and combined with `main` every workspace passes (API 210, web 45, data-gen 60, contracts 29, kpi-framework 29) with typecheck clean. Branch 5 adds 9 API tests (219 passing).

### Frontend compatibility (checked against `apps/web/src/lib/api.ts`)

- **Routes, methods, and contracts:** identical to the API for all 13 endpoints.
- **Behaviour:** the preview fixture copies your proposed transition matrix, and ADR 0011 §7 audit filtering.
- **Mismatch 1 (blocking): facility-level access for the COO.** The fixture grants the capacity KPI at `['region', 'facility']`. Maruti's real seed grants `['region']` with `facility` as a breakdown only. On real data, the demo's facility-level exception, KPI detail, and action are refused. See §3, item 1.
- **Mismatch 2: entity ids are readable strings in the fixture** (`fixture-facility-a1`), and the UI shows `entityId` as the entity's name. Real ids are uuids, so the UI will show uuids until the contracts carry a display name. **API side done:** branch 5 adds `GET /api/entities`; Ayas adopts it (§3).

## 2. What to do, in order

### Phase A — get the branches reviewed and merged (now)

- [ ] Open PRs 1 to 5, each based on the previous branch, so every PR shows only its own diff. Open the lint PR against `main`.
- [ ] In PR 2, state that the SQL has not yet run against a database.
- [ ] In PR 3, point Aditya at the `.env.example` change (his file).
- [ ] In PR 4, ask Ayas to confirm that dropping `segment` is fine for the UI. His tests pass either way.
- [ ] After each merge, merge `main` into the next branch before it is reviewed.

**Done when:** all of them are on `main` and CI is green.

### Phase B — verify the SQL against a real database (now; needs a local password)

A local PostgreSQL is running on this machine. Maruti's `supabase/validate-local.ps1` already applies the migrations to a throwaway database.

- [ ] Create `%APPDATA%\postgresql\pgpass.conf` with `localhost:5432:*:postgres:<password>`. Never commit it or paste it anywhere.
- [ ] Apply migrations 000100–000600 and `supabase/seed/0001_framework_and_org.sql` to a scratch database.
- [ ] Insert test-only memberships as the database superuser: COO North, COO South, Hospital DHO, Chairman, and one account in the second organization.
- [ ] Add a gated integration test (`ORBIT_TEST_DATABASE_URL`) that runs the membership, entitlement, and scope-check SQL as `orbit_app` and checks:
  - COO North sees North's facilities;
  - COO South does not;
  - the Chairman needs group scope;
  - the other organization sees nothing;
  - `orbit.membership` does not leak across pooled transactions (the 7 skipped tests).

**Done when:** the skipped tests run and pass locally, and the result is written into PR 2.

### Phase C — close the two frontend mismatches (after Aditya's ruling)

- [ ] **COO facility access:** implement whichever rule Aditya picks (§3, item 1):
  - (a) the matrix grants `facility` to the relevant COO assignments. Maruti changes the seed; no API change.
  - (b) a target at a granted breakdown grain is readable one entity at a time. Change `decideScope`, with allow and deny tests for every grain pair.
- [x] **Entity display names (API side):** `GET /api/entities` on branch 5 serves names from `regions`, `facilities`, and `coes` under RLS. Remaining: Ayas reviews the contract and uses it in place of raw ids.
- [ ] **uuid-only `entityId`:** once Ayas switches his fixture to uuids, tighten `ScopeEntitySchema.entityId` to `z.uuid()`. Already verified: only his two fixture test files fail today.

**Done when:** the preview fixture and the real API give the same answer for every step of the COO demo.

### Phase D — wire the five data modules to Maruti's fact tables (as each table lands)

Each port in `src/modules/ports.ts` gets a SQL implementation and a new name in `ORBIT_LIVE_SOURCES`, one at a time:

| Order | Port | Needs from Maruti | Unlocks |
|---|---|---|---|
| 1 | `dataset` | Dataset info: checksum, as-of time, current period | The brief's period; Ask prompts |
| 2 | `observations` | `kpi_observations` with components, target, and data quality | KPI explorer; Ask performance, comparison, and contributors |
| 3 | `exceptions` | Exceptions: labelled scenario or reviewed rule, priority, category, evidence | Brief and inbox |
| 4 | `actions` + `assignees` | `actions` and `action_events` (idempotency key, version, creator and assignee membership); assignee lookup excluding the caller | Record an action |
| 5 | `audit` | `audit_events`, INSERT-only, read filtered to own actions | Audit view; denial logging |

For each one: write the SQL under `withMembershipTx`, add fake-database tests like `src/db/sources.test.ts`, add a gated real-database test, then add the source name to `wireSources`.

The financial fact generator (#32, open) is the first input to `observations`. Review it for the column names the API will read.

**Done when:** `ORBIT_LIVE_SOURCES` lists every source in dev, and the COO demo runs end to end with the preview fixture switched off.

### Phase E — deploy and harden (with Aditya)

- [ ] Review ADR 0013 (one Vercel project, `/api/*` rewritten to Fastify). Your app is unchanged if the rewrite works; help Aditya prove it on a throwaway project. If it lands, CORS stays as defense in depth, but the exact-origin list may shrink to none.
- [ ] Performance: each source call opens its own connection today. Move to one transaction per request, measured against the PRD target (p95 under 2 s).
- [x] Lint: `oxc/no-async-endpoint-handlers` off for `services/api`, and the three `consistent-return` warnings fixed (branch `ghansham/api-lint-fastify`).

## 3. What others need to do

| # | Who | What | Blocks |
|---|---|---|---|
| 1 | **Aditya** | Rule on COO facility access: grant `facility` in the matrix, or allow one-entity reads at a breakdown grain. ADR 0011 §2 does not settle it | The real-data COO demo (Phase C) |
| 2 | **Aditya** | Sign off `TRANSITIONS.md` and its five design choices | `transitions` in `ORBIT_LIVE_SOURCES` |
| 3 | **Aditya + Maruti** | Provision demo accounts out of band (ADR 0013 §2) and seed their memberships | Anyone logging in against real data |
| 4 | **Maruti** | Fact tables in the order of Phase D, and their column names | Phase D |
| 5 | **Ayas** | Move the preview fixture to uuid entity ids; review `EntityDirectoryResponse` and show `label` instead of `entityId` | Tightening `entityId`; readable entity names |
| 6 | **Ayas** | Align the fixture's COO entitlements with whatever Aditya rules in item 1 | The preview behaving like production |

## 4. Ayas's role, and how the frontend connects

Ayas owns `apps/web` and `packages/ui-kit` (TEAM_ASSIGNMENTS §7): the shell, the four surfaces, the 14 role views, and the design tokens. The Regional COO workspace is built (#30). The other 13 role views and the per-role tests are next, and the UI has to build against the contracts, never around them. The backend does not edit his code; it hands him contracts and working endpoints.

**The frontend is already wired to the real API; nothing in `apps/web` needs to change to connect.** In a normal build it signs in with Supabase and calls the API over HTTP (`lib/api.ts`, `features/workspace/environment.ts`). The in-memory fixture API is loaded only by `/preview` in development builds. Connecting is configuration plus backend data:

| Where | Setting | Value | Owner |
|---|---|---|---|
| Web | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Orbit dev Supabase project (public by design) | Aditya |
| Web | `VITE_API_BASE_URL` | The API origin (`http://localhost:3000` locally); a relative `/api` if ADR 0013 lands | Aditya |
| API | `SUPABASE_URL` | The same project, so JWKS verification matches the tokens the web gets | Aditya |
| API | `ALLOWED_ORIGINS` | The exact web origin, e.g. `http://localhost:5173` | Aditya |
| API | `DATABASE_URL` | Pooler URL as `orbit_app` (secret) | Aditya |
| API | `ORBIT_LIVE_SOURCES` | `memberships,entitlements,scope,entities` once Phase B passes | Ghansham |
| Database | Demo accounts + memberships | Out of band (ADR 0013 §2) | Aditya + Maruti |

With only that in place, a signed-in COO gets its role, scope, KPI list, entity names, and assignee checks from real data. Brief, inbox, KPI detail, Ask answers, actions, and audit still answer `503 unavailable`, which the UI already renders as an unavailable state, until Maruti's fact tables land (Phase D).

The mismatches to close so the preview matches production:
1. COO facility access (§3, item 1): the preview grants `facility`, the real seed does not.
2. Readable ids in the preview versus uuids in production: switch the fixture to uuids and show `label` from `GET /api/entities`.

## 5. Not verified

- None of the SQL in `src/db/sources.ts` has run against a database (Phase B).
- The frontend was checked by reading `apps/web/src/lib/api.ts` and the preview fixture, and by running its tests. It has not been run against the real API.
- ADR 0013's rewrite has not been tried on Vercel.
