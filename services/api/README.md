# `@orbit/api`

Fastify 5 backend (Vercel project 2). Owner: Ghansham. Spec: [ARCHITECTURE §6](../../docs/orbit/ARCHITECTURE.md), [TEAM_ASSIGNMENTS §6](../../docs/orbit/TEAM_ASSIGNMENTS.md).

## Commands (from the repo root)

```sh
npm run typecheck -w @orbit/api
npm run test -w @orbit/api
npm run dev -w @orbit/api        # needs Node >= 22.18 and services/api/.env (see .env.example)
```

`npm run lint` is a placeholder until a linter is chosen (see [DEPENDENCIES.md](DEPENDENCIES.md)).

To run the RLS claim-leak integration tests, point them at a **disposable** Postgres (never production):

```sh
ORBIT_TEST_DATABASE_URL=... [ORBIT_TEST_DATABASE_SSL=false] npm run test -w @orbit/api
```

Without that variable those tests are skipped. A skipped test means **not verified**.

## What exists

| Path | Purpose | Status |
|---|---|---|
| `src/app.ts` | Vercel entrypoint; loads config, wires real JWKS, listens | Implemented |
| `src/build.ts` | App factory: errors, CORS, `/health`, protected `/api` scope, `GET /api/me` | Implemented |
| `src/config.ts` | Only reader of `process.env`; exact-origin CORS parsing | Implemented |
| `src/plugins/auth.ts` | Bearer → JWKS verify (ES256/RS256, iss, aud, exp, sub, role) → exactly one active membership | Implemented against a `MembershipSource` port |
| `src/plugins/scope.ts` | Deny-by-default entitlement check → `out_of_scope` | Implemented against `EntitlementSource` / `ScopeResolver` ports |
| `src/plugins/errors.ts` | Typed `ApiError` + contract error envelope; no internals leaked | Implemented |
| `src/db/client.ts` | postgres.js, `prepare: false`, one connection per transaction | Implemented; not yet run against a database |
| `src/db/rls.ts` | `withMembershipTx` (`orbit.membership`) and `withSubjectTx` (`orbit.subject`, membership bootstrap, Option A): transaction-local `set_config(…, true)` | Unit-tested; leak tests need a database |
| `src/db/memberships.ts` | `createDbMembershipSource`: runs the membership query under `withSubjectTx` | Unit-tested; the SELECT waits for Maruti's `org_memberships` migration |
| `src/modules/ports.ts` | The interfaces each module reads and writes through (observations, exceptions, dataset, actions, assignees, transition policy, audit, audit access) | Defined; SQL implementations wait for the schema |
| `src/modules/{brief,inbox,kpi,ask,actions,audit}` | The six modules, against the draft payload contracts | Implemented and tested against in-memory ports (`test/helpers/modules.ts`) |
| `src/modules/pending.ts` | Fail-closed ports wired by `app.ts` until real sources exist | Implemented; every module route answers `503 unavailable` |

## Routes

All `/api` routes require a verified token and exactly one active membership. Payloads are the `@orbit/contracts` schemas (draft until Gate 1).

| Route | Contract | Notes |
|---|---|---|
| `GET /health` | `HealthResponse` | Only unauthenticated route |
| `GET /api/me` | `MeResponse` | Role and scope, for display only |
| `GET /api/brief` | `BriefResponse` | Current period; Act now / Monitor / On track / Data limitations |
| `GET /api/inbox?cursor&limit` | `InboxResponse` | Source ordering, with its basis stated |
| `GET /api/kpi` | `KpiListResponse` | The role's entitled assignments for the served framework version |
| `GET /api/kpi/:assignmentId?grain&entityId&breakdown&from&to` | `KpiDetailResponse` | `403 out_of_scope` outside the entitlement |
| `GET /api/ask/prompts` | `AskPromptsResponse` | Deterministic mode, disclosed |
| `POST /api/ask` | `AskRequest` → `AskResponse` | Always `200` for a member; refusals are `out_of_scope` answers with no records (ADR 0005 §2) |
| `GET /api/actions?cursor&limit` | `ActionListResponse` | Actions the caller created or is assigned |
| `GET /api/actions/assignees?assignmentId&grain&entityId` | `PermittedAssigneesResponse` | |
| `GET /api/actions/:actionId` | `ActionResponse` | `404` when the caller is neither creator nor assignee |
| `POST /api/actions` | `CreateActionRequest` → `ActionResponse` | `201` new, `200` idempotent replay, `409` key reused or evidence from an older dataset |
| `POST /api/actions/:actionId/transitions` | `TransitionActionRequest` → `ActionResponse` | `409` stale version or invalid transition, `403` not permitted |
| `GET /api/audit?cursor&limit` | `AuditListResponse` | `403 out_of_scope` unless the audit-access policy grants the role |

Authorization checks, in order: token → membership → entitlement for the served framework version → grain → breakdown → entity inside the membership scope. Rows returned by a source are re-checked; a row outside the request fails the whole request (`500`) instead of being dropped.

## Deliberately fail-closed

The membership, entitlement, hierarchy, observation, exception, action, and audit tables do not exist yet (Maruti's schema), and the entitlement content, transition matrix, and audit access are open decisions (Aditya). `src/app.ts` therefore wires a membership source and `pendingModuleDeps()` that answer `503 unavailable`, instead of guessing table names or serving fixtures. Swap in SQL-backed ports once the schema, RLS, and decisions land.

## Decisions this code assumes

- **Read-side audit failures are logged, not surfaced.** `evidence_viewed`, `ask_answered`, and `access_denied` writes that fail are logged at error level and the already-authorized response is still returned. Action writes are different: the store commits the action and its audit event in one transaction. Aditya to confirm.
- **Guided prompts cover the role's three highest-weighted assignments**, plus an exception summary. A UX choice for Ayas to review, not a scoring rule.
- **Assignees are opaque server-issued ids.** The mapping to memberships lives in the database implementation of `AssigneeDirectory`.
