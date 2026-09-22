# `@orbit/api` — dependency decision record

**Status:** Proposed by Ghansham for Aditya's review (RULES.md "Dependency decision record"). If approved, Aditya may move this into `docs/decisions/` as an ADR.
**Checked:** 23 September 2026, against npm registry versions and the official docs linked below.

All runtime choices below are already named in [ARCHITECTURE §3 and §6](../../docs/orbit/ARCHITECTURE.md). This record pins versions and states the smallest adopted surface.

## Runtime

| Package | Version | Why | Surface used | Alternatives considered |
|---|---|---|---|---|
| `fastify` | ^5.12.5 | Pinned backend framework; zero-config on Vercel ([V1](https://vercel.com/docs/frameworks/backend/fastify)) | App, hooks, encapsulated route scopes, error/404 handlers, `inject` for tests | — (pinned) |
| `jose` | ^6.2.12 | Supabase-documented JWT verification for non-supabase-js servers ([S4](https://supabase.com/docs/guides/auth/jwts)) | `jwtVerify`, `createRemoteJWKSet`; tests use `createLocalJWKSet`, `SignJWT` | Calling `/auth/v1/user` per request (extra network hop; kept only as legacy-HS256 fallback, not implemented) |
| `postgres` (postgres.js) | ^3.4.9 | Thin driver, no ORM (ARCH §6.3); supports `prepare: false` for the transaction-mode pooler | `postgres()`, `begin`, `unsafe(text, params)` with bound params, `end` | `pg` (equally thin; postgres.js is named in ARCH) |
| `zod` | ^4.6.5 | Pinned validation library; also a dependency of `@orbit/contracts` | Env parsing and Supabase claim parsing | — (pinned) |
| `@fastify/cors` | ^11.3.0 | Official Fastify CORS plugin; hand-rolled CORS is easy to get wrong (ARCH §11.3) | Exact-origin array, methods, allowed headers, no credentials | Hand-written `onRequest` hook (rejected: security-sensitive, untested) |

No `fastify-plugin`: auth is applied through Fastify's own encapsulated scopes instead.

## Development only

| Package | Version | Why |
|---|---|---|
| `typescript` | ^7.0.2 | Strict typecheck (`tsc --noEmit`). Current `latest` tag. |
| `vitest` | ^5.0.1 | Pinned unit/contract test runner (ARCH §3). Requires Node ^22.12. |
| `@types/node` | ^22 | Matches the pinned Node 22 runtime. |

No dev runner (`tsx`, `ts-node`) is added. `npm run dev` uses Node's built-in TypeScript type stripping, which requires Node **22.18 or later** (stable, unflagged). Source therefore uses `.ts` import extensions and `erasableSyntaxOnly`.

## Open, needs a decision

1. **Linter.** No lint tool is chosen anywhere in the specs. `npm run lint` prints a notice instead of pretending to lint. Aditya to decide (repo-wide).
2. **Vercel build of workspace TypeScript.** `@orbit/contracts` is consumed as `.ts` source. Local Node and Vitest handle this. Whether Vercel's Fastify builder bundles it correctly is **unverified** until a preview deploy or `vercel dev` run.
3. **Node patch floor.** `engines` is `22.x`; type stripping needs ≥22.18. Consider `>=22.18 <23`.
