# ADR 0006: API dependencies, linter, and Node floor

- **Status:** Accepted for the dependency approvals, the linter choice, and the Node floor. One item is explicitly **not** settled — see §4.
- **Owner:** Aditya (dependency and pinned-stack approval per RULES.md)
- **Author of the proposal being approved:** Ghansham (`services/api/DEPENDENCIES.md`, PR #7)
- **Date:** 2026-09-23
- **Unblocks:** merging PR #7. Supersedes `services/api/DEPENDENCIES.md` as the decision of record; that file stays as Ghansham's working notes.

## 1. Runtime dependencies — approved

All five were already named in ARCHITECTURE.md §3/§6, so this pins versions
and records the adopted surface rather than introducing anything new.

| Package | Version | Note |
|---|---|---|
| `fastify` | ^5.12.5 | Pinned backend framework (§3). |
| `jose` | ^6.2.12 | The pattern Supabase documents for non-supabase-js servers. |
| `postgres` (postgres.js) | ^3.4.9 | Named in §6.3. `prepare: false` is required for the transaction-mode pooler — not optional. |
| `zod` | ^4.6.5 | Pinned (§3). Must match `@orbit/contracts` exactly; a split Zod version across the boundary would produce two incompatible schema registries. |
| `@fastify/cors` | ^11.3.0 | Approved. Hand-rolling CORS on a security boundary to save one dependency is a bad trade, and this is the official plugin. |

Declining `fastify-plugin` in favour of Fastify's own encapsulated scopes is
the right call — one less dependency for behaviour the framework already has.

## 2. Development dependencies — approved

`typescript` ^7.0.2, `vitest` ^5.0.1, `@types/node` ^22.

TypeScript 7 is genuinely stable (native Go compiler, GA July 2026) and both
`@orbit/contracts` and `@orbit/kpi-framework` already typecheck clean on it —
verified locally, not assumed. Keep `@types/node` tracking the actual runtime
floor set in §3.

## 3. Linter: **oxlint**, with type-aware linting enabled

This was the open question, and researching it turned up a hard constraint
that decides it.

**ESLint + typescript-eslint is not available to us.** typescript-eslint
cannot be installed alongside TypeScript 7 at all — npm refuses with
`ERESOLVE` because its peer range stops below 6.1 — and the underlying reason
is that TypeScript 7 ships no stable programmatic compiler API. That API is
targeted for 7.1, which Microsoft has said is months out, and
typescript-eslint closed its TS 7 support request as not planned for now.
ESLint core is blocked behind the same thing. This is not a preference; the
install fails.

That leaves the Rust-based tools. **oxlint wins over Biome on the one axis
that matters here:**

- oxlint's type-aware linting runs through
  [`tsgolint`](https://github.com/oxc-project/tsgolint), which uses
  `typescript-go` and **explicitly targets TypeScript 7**. It covers 59 of the
  61 type-aware rules from typescript-eslint, including `no-floating-promises`
  and `no-misused-promises`.
  <https://oxc.rs/docs/guide/usage/linter/type-aware>
- Biome does not have equivalent TypeScript-go-based type awareness; its
  compatibility with the new compiler is the open complaint in its own issue
  tracker.

So oxlint is the only option that keeps type-aware rules *and* TypeScript 7.
Without type awareness this would have been a real loss, because the rules we
most need are exactly the type-aware ones:

- `no-floating-promises` / `no-misused-promises` — an unawaited transaction or
  an async function passed where a sync predicate is expected is a live bug
  class in a Fastify + postgres.js codebase, and it fails silently.
- rules that catch unsafe `any` flow and gratuitous `as` casts — these police
  the project's central invariant, that boundaries are *parsed* and never
  cast. ARCHITECTURE.md §4 bans `as KpiListResponse`; a lint rule enforces
  that continuously instead of relying on review catching it.

**Required configuration:** type-aware mode must be on. Plain oxlint would
skip precisely the rules justifying this choice. Enable it repo-wide and wire
`npm run lint` to it in every workspace, replacing the placeholder echoes.

**Not adopted: a formatter.** oxfmt exists and would pair naturally, but
Ghansham asked for a linter and formatting is a separate decision with its own
migration cost and churn risk. Worth doing later to stop diff noise across
four contributors; deliberately out of scope here rather than bundled in
unexamined.

**Revisit:** when TypeScript 7.1 lands with a stable API, typescript-eslint
becomes viable again. Re-evaluating is optional, not planned — oxlint covering
59/61 type-aware rules at Rust speed is not an obvious thing to migrate away
from.

## 4. Node floor: `>=22.18 <23` — approved, with one unverified consequence

Ghansham's reasoning checks out. Node's native TypeScript type stripping
ships in the **22.18** LTS release (and is on by default from 23.6), so
`npm run dev` without a dev runner genuinely requires ≥22.18. My own earlier
test run passed on 22.15 because `vitest` and `tsc --noEmit` do their own
transformation — that run did not exercise `npm run dev`, so it was not
evidence that 22.15 is sufficient.

Approved: `engines.node` becomes `>=22.18 <23`, replacing `22.x`.

Consequences:

- **This is still inside Vercel's supported `22.x`**, so it does not conflict
  with ARCHITECTURE.md §11.1. Whether Vercel honours a range expression
  rather than a bare major is **assumed, not verified** — I will confirm it on
  the Gate 0 hello-world deploy.
- **Everyone's local Node must move.** Maruti was on 20.19.0 and my machine is
  on 22.15.0; neither can run `npm run dev`. Both need ≥22.18.
- **Ownership:** I am changing the root `package.json` only, since the six
  workspace manifests belong to their owners (FILE_STRUCTURE.md). Each owner
  updates their own `engines` in their own PR. Until they do, the repo is
  briefly inconsistent — harmless as a warning, but it should not linger.

### Not settled: does Vercel build `.ts` workspace source?

Ghansham flagged this in his own notes and he is right to leave it open. The
API consumes `@orbit/contracts` as raw `.ts` (with `.ts` import extensions and
`main` pointing at `src/index.ts`), which works locally because Node strips
types and Vitest transforms. **Whether Vercel's Fastify builder resolves and
bundles a workspace dependency's TypeScript source is unverified.** It is the
kind of thing that works everywhere except the one environment that matters.

This is mine to verify on the Gate 0 deploy, and it is a genuine risk to the
current package layout: if Vercel will not consume `.ts` source, either
`@orbit/contracts` needs a build step producing `dist/` with declarations, or
the API needs a bundling step. Nobody should treat the current arrangement as
proven until a preview deploy succeeds. Recording it so that if it does break,
it is a known risk materialising rather than a surprise.
