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
| `src/db/rls.ts` | `withMembershipTx`: transaction-local `set_config('orbit.membership', …, true)` | Unit-tested; leak test needs a database |
| `src/modules/*` | brief, inbox, kpi, ask, actions, audit | **Not started.** Blocked on Gate 1 contracts, schema, and entitlement matrix |

## Deliberately fail-closed

The membership, entitlement, and hierarchy tables do not exist yet (Maruti's schema). `src/app.ts` therefore wires a membership source that answers `503 unavailable` to every protected request, instead of guessing table names or serving fixtures. Swap in the SQL-backed sources once the schema and RLS land.
