# ADR 0003: `packages/kpi-framework` import dependencies (`exceljs`, `pure-rand`)

- **Status:** **Accepted** — approved by Aditya on PR #13, 2026-09-23, with two
  corrections now applied. See "Corrections from review" below. Amended
  2026-09-23 with a `pure-rand` import-surface finding from PR #32 — see
  "Amendment" at the end.
- **Owners:** Maruti (author), Aditya (reviewer)
- **Date opened:** 2026-09-23
- **Date resolved:** _(fill in when Accepted)_

## Context

`packages/kpi-framework` must generate typed source from
`Africare_Group_KPI_Framework.xlsx` (14 roles, 109 assignments, 29
definition families — TEAM_ASSIGNMENTS.md §5). This requires:

1. Parsing a `.xlsx` workbook in Node — no existing repo code does this.
2. A deterministic, seedable pseudo-random generator for the future
   `packages/data-gen` synthetic-fact generator (PRD §8.4: "same seed →
   byte-identical snapshots"). `Math.random()` cannot be seeded per the
   ECMAScript spec, so it cannot satisfy this requirement at all.

## Decision

Adopt:

| Package | Version | Why | Surface used |
|---|---|---|---|
| `exceljs` | ^4.4.0 | MIT-licensed, actively maintained, promise-based API. SheetJS's `xlsx` package has had no public npm release since v0.18; community forks are the recommended path per current ecosystem guidance. | Read-only: `Workbook.xlsx.readFile`, `Worksheet.getRow/getCell`. Never used for writing/formatting. |
| `pure-rand` | ^8.4.2 | TypeScript-native, explicitly designed to be pure and reproducible (same seed → same sequence every call). Powers `fast-check`, a widely used property-testing library, indicating maturity. | Not yet used in `kpi-framework` itself; installed ahead of `packages/data-gen` (Phase 4 of the data-layer plan) so the same reviewed dependency covers both. |

## Alternatives considered

- **SheetJS `xlsx`** — rejected. No maintained public npm releases past
  v0.18; the current ecosystem guidance points to ExcelJS or its forks
  instead.
- **Hand-rolled xorshift/PRNG** — rejected. Re-implementing a tested
  primitive for no measurable benefit; `pure-rand` is already
  battle-tested via `fast-check`.
- **`Math.random()`** — rejected outright. Cannot be seeded; fails the
  reproducibility requirement in PRD §8.4 by construction.

## Impact

- **Bundle/runtime:** both packages are Node-only tooling dependencies of
  `@orbit/kpi-framework` (and later `@orbit/data-gen`) — never imported
  by `apps/web`, so there is no browser bundle-size impact.
- **Security:** `npm audit` reports one moderate-severity advisory in a
  transitive `uuid` version pulled in by `exceljs`. The suggested
  automatic fix (`npm audit fix --force`) downgrades `exceljs` to 3.4.0,
  a breaking change, so it was not applied automatically. Exposure is
  low in practice: `exceljs` is used read-only, locally/in CI, against a
  workbook the team controls — never against untrusted user input in a
  deployed service. Flagged here for Aditya's awareness rather than
  silently accepted.
- **Accessibility:** not applicable (build-time tooling only).
- **AWS portability:** neither package is cloud-specific; both run
  anywhere Node runs.

## Acceptance test

- `npm run import -- <path-to-xlsx>` in `packages/kpi-framework`
  regenerates `src/generated/*` and reports 14 roles / 109 assignments /
  29 definition families / 0 unresolved, matching the workbook exactly
  (verified by direct inspection prior to writing the importer).
- `npm run typecheck` and `npm run test` pass in `packages/kpi-framework`
  and at the repo root.
- Re-running the import against the same workbook file produces the same
  `sourceChecksum` in the generated manifest (byte-level reproducibility
  of the source hash, verified twice).

## Corrections from review (Aditya, PR #13, 2026-09-23)

Both were right and are applied.

**1. Both packages were in `dependencies`; they belong in `devDependencies`.**

`exceljs` is imported only by `scripts/import-workbook.ts`, which runs at
development time, and the generated `src/generated/*.ts` it produces is
committed. Nothing at runtime imports it. Left in `dependencies` it would be
installed into the deployed API and count against Vercel's 250 MB function
bundle limit (ARCH §11.4).

Verified after the move: `npm run import` still works, and the generated output
is unchanged.

**This also largely resolves the `uuid` advisory recorded above.** A
moderate-severity issue in a transitive dependency of a *dev* dependency never
reaches production. The original risk assessment was defensible, but the
correct fix made most of it moot rather than accepted — a better outcome than
documenting an accepted risk.

**2. `pure-rand` removed from `kpi-framework` entirely.**

It was declared here but imported nowhere — `kpi-framework` has no use for a
PRNG. It is declared in `packages/data-gen`, which is where the deterministic
generator actually needs it (PRD §8.4). A dependency should appear where it is
used, not where it was anticipated.

**3. `@types/node` was `^26.6.2` against a Node 22 runtime** — already corrected
to `^22.20.4` before this review landed. Aditya's reasoning is the sharper
version of why it mattered: 26.x typings describe APIs that do not exist in the
deployed runtime, so the failure surfaces at runtime rather than at typecheck.

## Consequences

- `exceljs` is a development-time dependency only. If anything at runtime ever
  needs to read a workbook, that is a new decision requiring its own record,
  not a quiet promotion back to `dependencies`.
- The `uuid` advisory is no longer a production concern. Still worth re-checking
  when `exceljs` ships a release that resolves it without the breaking
  downgrade to 3.4.0.
- `pure-rand` is recorded in `packages/data-gen`'s own dependency set.

## Amendment 2026-09-23: `pure-rand` 8.4.2 has no root export

Recorded by Aditya after Maruti hit this while building the fact generator
(PR #32). This ADR approved `pure-rand` on its published description and did
not check how it is actually imported, which cost real time downstream.

**`import { xoroshiro128plus } from "pure-rand"` does not work.** 8.4.2 publishes
no root entry point — only subpaths:

```ts
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
```

**And the distribution API mutates.** `uniformInt(rng, from, to)` returns a plain
number and advances `rng` in place — generator first, and *not* the pure
`[value, nextRng]` tuple that older versions returned. Getting either wrong
surfaces as `rng.next is not a function`, which points nowhere near the actual
cause.

Both were established by reading the shipped package and probing the API, not
inferred. They are now documented at the top of
`packages/data-gen/src/rng.ts`, which is the right place for whoever touches it
next; this amendment exists so the ADR that approved the dependency is not the
one artifact that still implies a root import.

**The process lesson, which is the reason this is written down.** The
research-before-coding rule in AGENTS.md says to search the official
documentation for *currently supported behavior*. For a dependency this ADR
approved on reputation — "powers `fast-check`, therefore mature" — maturity was
established and the import surface was not. Maturity and API shape are separate
questions. For the next dependency approval, a three-line import probe is part
of the evidence, not a step the first implementer discovers.

No change to the decision: `pure-rand` remains the right choice for PRD §8.4,
and the mutating API is the reason `rng.ts` wraps it in `streamFor` rather than
passing a shared generator around.
