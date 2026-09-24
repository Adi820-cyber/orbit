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

**Workspace:** `@orbit/kpi-framework` (`*`, this repo) supplies assignment titles, definitions, and the served `definitionVersion`. The API imports only its `src/index.ts`; that package's `exceljs` and `pure-rand` dependencies are used by its import script, not by the API. On Vercel the workspace packages are bundled into the function (see `rolldown` below); npm dependencies stay external and are traced.

## Development only

| Package | Version | Why |
|---|---|---|
| `typescript` | ^7.0.2 | Strict typecheck (`tsc --noEmit`). Current `latest` tag. |
| `vitest` | ^5.0.1 | Pinned unit/contract test runner (ARCH §3). Requires Node ^22.12. |
| `@types/node` | ^22 | Matches the pinned Node 22 runtime. |
| `rolldown` | 1.2.9 | Vercel build only (`scripts/bundle-vercel.mjs`): bundles `src/app.ts` with the workspace packages, which ship TypeScript source Vercel does not transpile under `node_modules`. Same version Vite already brings in, so the lockfile gains no new package. Alternatives: publishing compiled `dist/` from each workspace package (larger change touching web and tests), `esbuild` (a new package). |

**Scope:** these dev tools (and `zod` above) are also what `packages/contracts` uses (#5); this record covers both workspaces.

**Why TypeScript 7 and Vitest 5 rather than the previous majors.** ARCH §3 requires strict TypeScript and Vitest but pins no major.
- **TypeScript 7:** the `latest` npm tag, i.e. the current stable release (the native compiler); it was the only stable line when this was set up. Verified in this repo: `tsc` 7.0.2 checks every workspace file and fails on a deliberate type error. The compatibility risk is editor/tooling plugins that still expect the JS compiler API. Nothing here uses them: no ts-plugin, bundler, or type-aware lint yet. **Fallback:** `typescript@^5.8` (the first 5.x with `erasableSyntaxOnly`, which the tsconfigs use). Not yet tested here.
- **Vitest 5:** the current release; its Node engine range (`^22.12 || ^24 || >=26`) covers the pinned Node 22. It runs the suites unchanged on Node 22.15 (Aditya, #5) and Node 26 (local). **Fallback:** Vitest 4. Not yet tested here.
- Either fallback is a one-line `package.json` change. Revisit if the linter chosen later needs the JS compiler API.

No dev runner (`tsx`, `ts-node`) is added. `npm run dev` uses Node's built-in TypeScript type stripping, which requires Node **22.18 or later** (stable, unflagged). Source therefore uses `.ts` import extensions and `erasableSyntaxOnly`.

## Open, needs a decision

1. **Linter.** No lint tool is chosen anywhere in the specs. `npm run lint` prints a notice instead of pretending to lint. Aditya to decide (repo-wide).
2. **Vercel build of workspace TypeScript.** `@orbit/contracts` is consumed as `.ts` source. Local Node and Vitest handle this. Whether Vercel's Fastify builder bundles it correctly is **unverified** until a preview deploy or `vercel dev` run.
3. **Node patch floor.** `engines` is `22.x`; type stripping needs ≥22.18. Consider `>=22.18 <23`.
