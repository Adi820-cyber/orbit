# `@orbit/api`

Fastify 5 backend (Vercel project 2). Owner: Ghansham. Spec: [ARCHITECTURE §6](../../docs/orbit/ARCHITECTURE.md), [TEAM_ASSIGNMENTS §6](../../docs/orbit/TEAM_ASSIGNMENTS.md).

## Commands (from the repo root)

```sh
npm run typecheck -w @orbit/api
npm run test -w @orbit/api
npm run dev -w @orbit/api        # needs Node >= 22.18 and services/api/.env (see .env.example)
```

`npm run lint` is a placeholder until a linter is chosen (see [DEPENDENCIES.md](DEPENDENCIES.md)).

To run the database integration tests, point them at a Postgres with the
migrations applied — the dev Supabase project, or a local throwaway:

```sh
ORBIT_TEST_DATABASE_URL=... [ORBIT_TEST_DATABASE_SSL=false] npm run test -w @orbit/api
```

Without that variable those tests are skipped. A skipped test means **not verified**.

| | Tests | Skipped |
|---|---|---|
| Without `ORBIT_TEST_DATABASE_URL` | 210 pass | **17** |
| Against the dev Supabase project | **227 pass** | 0 |

The 17 are two suites: transaction-claim isolation (`db/rls.test.ts`) and the
real SQL under forced RLS (`db/sources.test.ts`). Both are **read-only** — they
insert and update nothing — which is why pointing them at the shared dev project
cannot alter its state. Both raise the Vitest timeout to 30s, because a cold
connection through the Supavisor pooler in `ap-south-1` measured **3728ms** from
a developer machine while warm queries were 25-300ms. A timeout failing on
network latency reads as "claims leaked", which would be the wrong conclusion.

## What exists

| Path | Purpose | Status |
|---|---|---|
| `src/app.ts` | Vercel entrypoint; loads config, wires real JWKS and the configured sources, listens | Implemented |
| `src/wiring.ts` | Picks a real or fail-closed implementation for each source from `ORBIT_LIVE_SOURCES` | Implemented and tested |
| `src/db/sources.ts` | SQL for memberships, entitlements, and scope containment against migrations 000400–000500 | **Verified against the dev Supabase project** (2026-09-23): all 14 roles resolve, 109 entitlement rows total, cross-role reads denied by RLS alone |
| `src/build.ts` | App factory: errors, CORS, `/health`, protected `/api` scope, `GET /api/me` | Implemented |
| `src/config.ts` | Only reader of `process.env`; exact-origin CORS parsing | Implemented |
| `src/plugins/auth.ts` | Bearer → JWKS verify (ES256/RS256, iss, aud, exp, sub, role) → exactly one active membership | Implemented against a `MembershipSource` port |
| `src/plugins/scope.ts` | Deny-by-default entitlement check → `out_of_scope` | Implemented against `EntitlementSource` / `ScopeResolver` ports |
| `src/plugins/errors.ts` | Typed `ApiError` + contract error envelope; no internals leaked | Implemented |
| `src/db/client.ts` | postgres.js, `prepare: false`, one connection per transaction | **Connects to the dev Supabase project** as `orbit_app` over the `ap-south-1` pooler |
| `src/db/rls.ts` | `withMembershipTx` (`orbit.membership`) and `withSubjectTx` (`orbit.subject`, membership bootstrap, Option A): transaction-local `set_config(…, true)` | **Leak tests pass against a real database** — claims do not survive commit or rollback, and region A claims do not reach a region B transaction |
| `src/db/memberships.ts` | `createDbMembershipSource`: runs the membership query under `withSubjectTx` | Unit-tested; the SELECT lives in `src/db/sources.ts` |
| `src/modules/ports.ts` | The interfaces each module reads and writes through (observations, exceptions, dataset, actions, assignees, transition policy, audit) | Defined; SQL implementations wait for the schema |
| `src/modules/{brief,inbox,kpi,ask,actions,audit}` | The six modules, against the draft payload contracts | Implemented and tested against in-memory ports (`test/helpers/modules.ts`) |
| `src/modules/pending.ts` | Fail-closed ports for every source not switched on | Implemented; answers `503 unavailable` |
| `src/modules/actions/transitions.ts` | Proposed transition matrix as data ([TRANSITIONS.md](TRANSITIONS.md)) | Awaiting Aditya's sign-off |

## Routes

All `/api` routes require a verified token and exactly one active membership. Payloads are the `@orbit/contracts` schemas (draft until Gate 1).

| Route | Contract | Notes |
|---|---|---|
| `GET /health` | `HealthResponse` | Only unauthenticated route |
| `GET /api/me` | `MeResponse` or `OperatorMeResponse` | Role and scope, for display only. An ERP operator gets `operatorRole` instead of `role` (ADR 0016) |
| `GET /api/brief` | `BriefResponse` | Current period; Act now / Monitor / On track / Data limitations |
| `GET /api/inbox?cursor&limit` | `InboxResponse` | Source ordering, with its basis stated |
| `GET /api/kpi` | `KpiListResponse` | The role's entitled assignments for the served framework version |
| `GET /api/kpi/:assignmentId?grain&entityId&breakdown&from&to` | `KpiDetailResponse` | `403 out_of_scope` outside the entitlement |
| `GET /api/ask/prompts` | `AskPromptsResponse` | Deterministic mode, disclosed |
| `POST /api/ask` | `AskRequest` → `AskResponse` | Always `200` for a member; refusals are `out_of_scope` answers with no records (ADR 0005 §2) |
| `GET /api/actions?cursor&limit` | `ActionListResponse` | Actions the caller created or is assigned |
| `GET /api/actions/assignees?assignmentId&grain&entityId` | `PermittedAssigneesResponse` | Only people whose scope lies inside the caller's (ADR 0011 §6) |
| `GET /api/actions/:actionId` | `ActionResponse` | `404` when the caller is neither creator nor assignee |
| `POST /api/actions` | `CreateActionRequest` → `ActionResponse` | `201` new, `200` idempotent replay, `409` key reused or evidence from an older dataset |
| `POST /api/actions/:actionId/transitions` | `TransitionActionRequest` → `ActionResponse` | `409` stale version or invalid transition, `403` not permitted |
| `GET /api/entities` | `EntityDirectoryResponse` | Names of the regions, facilities, and COEs the caller can see, with parents (draft; for display) |
| `GET /api/audit?cursor&limit` | `AuditListResponse` | Events for actions the caller created or is assigned, nothing else (ADR 0011 §7) |

### Hospital operations (ERP) routes, ADR 0016

Served only to ERP operator accounts (`admin`: group scope; `hospital`: one facility). A leader account gets `403 forbidden` on every `/api/erp/*` route, and an operator gets `403 forbidden` on every leader route. A hospital account naming another facility gets `403 out_of_scope`; a record id it cannot see is `404`. Every response carries `provenance: "illustrative"` and the ERP disclosure. Writes and their `orbit_erp.audit_events` row commit together; reading a patient or a visit records a `viewed` event.

| Route | Who | Notes |
|---|---|---|
| `GET /api/erp/reference` | both | Facilities, departments, specialties, shift patterns, settings |
| `GET /api/erp/summary?facilityId&date` | both | Today at one facility: attendance, visits, services, pending decisions |
| `GET/POST /api/erp/staff`, `GET/PATCH /api/erp/staff/:staffId` | read both; write admin | Doctors are created through `/api/erp/doctors` |
| `GET/POST /api/erp/doctors`, `GET/PATCH /api/erp/doctors/:staffId` | read both; write admin | Credential status derived from expiry, suspension and the warning window |
| `POST /api/erp/doctors/:staffId/schedule`, `PATCH /api/erp/schedule-slots/:slotId` | admin | Slots are retired, never deleted |
| `GET /api/erp/attendance/board?facilityId&date` | both | Derived on read from roster, punches, approved corrections and settings |
| `POST /api/erp/attendance/punches` | both; back-dated `punchedAt` admin only | Idempotent: `201` new, `200` replay |
| `GET /api/erp/attendance/staff/:staffId?month` | both | One person's month; missing punches never count as zero |
| `GET/POST /api/erp/attendance/corrections` | both | Request a fix to in/out times |
| `POST /api/erp/attendance/corrections/:correctionId/decision` | admin, never the requester | Four-eyes rule, enforced by the database too |
| `GET/PUT /api/erp/rosters` | both; past dates admin only | One planned shift per person per day |
| `GET/POST /api/erp/services`, `PATCH /api/erp/services/:serviceId` | read both; write admin | The catalogue |
| `PUT /api/erp/facilities/:facilityId/services/:serviceId` | first offer admin; later switches both | Where each service is offered |
| `GET/POST /api/erp/patients`, `GET/PATCH /api/erp/patients/:patientId` | both | Search only (`q` ≥ 2 characters); possible duplicates answered with `409` |
| `GET/POST /api/erp/encounters`, `GET/PATCH /api/erp/encounters/:encounterId` | both | Visits: open, close, cancel, attending doctor |
| `POST /api/erp/encounters/:encounterId/services`, `PATCH /api/erp/service-deliveries/:deliveryId` | both | Services delivered; idempotent; database checks availability, performer, credential and visit window |
| `GET /api/erp/audit` | admin | Who viewed or changed which record; never the contents |

Authorization checks, in order: token → membership → entitlement for the served framework version → grain → breakdown → entity inside the membership scope. Rows returned by a source are re-checked; a row outside the request fails the whole request (`500`) instead of being dropped.

## Live sources (`ORBIT_LIVE_SOURCES`)

Every source is fail-closed (`503 unavailable`) unless `ORBIT_LIVE_SOURCES` names it, so switching one on is an environment change, not a build. An unknown name, or a database source without `DATABASE_URL`, stops the API at startup.

| Name | Real implementation | Switch on when |
|---|---|---|
| `memberships` | `orbit.org_memberships` + scopes, subject-only transaction (ADR 0002) | Migrations 000400–000500 are applied and accounts are provisioned |
| `entitlements` | `orbit.entitlements` joined to `framework_versions`, under membership claims | The ADR 0011 matrix is seeded |
| `scope` | RLS-visible `regions` / `facilities` / `coes` in the caller's organization; `group` needs an explicit group scope | Organization rows are seeded |
| `entities` | Names from `organizations` / `regions` / `facilities` / `coes`, under the same RLS | Organization rows are seeded (already true since #28) |
| `transitions` | `PROPOSED_TRANSITIONS` ([TRANSITIONS.md](TRANSITIONS.md)) | Aditya signs off the matrix |
| `ORBIT_SURFACE` (not a source) | `leader`, `erp` or `all` (default): which routes this deployment registers and which kind of account it accepts | Running leadership and hospital operations as separate deployments ([DEPLOYMENT.md](../../docs/orbit/DEPLOYMENT.md)) |
| `erp` | `orbit_erp` schema under operator claims (`db/erp.ts`, ADR 0016) | Migration 20261001000100 and seeds 0008–0010 are applied, and operator accounts are provisioned |

Example: `ORBIT_LIVE_SOURCES=memberships,entitlements,scope`. The observation, exception, dataset, action, assignee, and audit stores have no tables yet, so they have no live option and stay fail-closed.

**Verified 2026-09-23 against the dev Supabase project** (`sxpnsnfzkpkzhsxjugde`), as `orbit_app`, by `db/sources.test.ts`:

- Connected role is `orbit_app` with `rolsuper`, `rolbypassrls` and `rolreplication` all false — asserted in the test, because every RLS claim below is meaningless if it is not.
- 15 tables in `orbit`, RLS **enabled and forced** on all 15, 15 policies, **zero** using `USING(true)`.
- **Fail-closed:** with no claims set, `entitlements`, `organizations`, `org_memberships`, `regions` and `facilities` all return **0 rows**.
- `ENTITLEMENT_SQL` resolves for **all 14 roles**, summing to exactly **109** assignments, every row carrying the requested role.
- **Isolation by policy, not by `WHERE`:** with the `WHERE` clause removed so only RLS can filter, `regional-coo` sees exactly its own 9 rows and **0** of chairman's.
- A forged role and an empty scope list are both refused by `MembershipClaimsSchema` **before** any SQL runs.
- Non-uuid entity ids, `group` grain without an explicit group scope, and out-of-organization entities all resolve to "not contained" rather than raising.

**Still not verified:** the membership *positive* path. `org_memberships` has no rows, because `subject` must be a real Supabase Auth user id (see `data/snapshots/seed-manifest.json`). `findBySubject` is confirmed to return `[]` for an unknown subject; it has never returned an actual membership. Until demo accounts are provisioned, `/api/me` answers `403 no_membership` and no surface can render.

**Known cost:** every source call opens its own short transaction and connection (`createDatabase`), so a request that checks several rows opens several connections. Correct, but slow; a request-scoped transaction is the follow-up once a database is available to measure.

## Decisions this code assumes

- **Read-side audit failures are logged, not surfaced.** `evidence_viewed`, `ask_answered`, and `access_denied` writes that fail are logged at error level and the already-authorized response is still returned. Action writes are different: the store commits the action and its audit event in one transaction. Aditya to confirm.
- **Guided prompts cover the role's three highest-weighted assignments**, plus an exception summary. A UX choice for Ayas to review, not a scoring rule.
- **Assignees are opaque server-issued ids.** The mapping to memberships lives in the database implementation of `AssigneeDirectory`.
