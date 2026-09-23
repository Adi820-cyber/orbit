# ADR 0004: Bundled-KPI assignment → definition-family mapping

- **Status:** Proposed — needs Aditya's (and ideally Ghansham's) sign-off before being treated as final, per ARCHITECTURE.md §8.2 ("Aditya owns this matrix; Maruti and Ghansham review it").
- **Owners:** Maruti (author), Aditya (reviewer), Ghansham (reviewer — consumes this via `packages/kpi-framework`)
- **Date opened:** 2026-09-23
- **Date resolved:** _(fill in when Accepted)_

## Context

PRD §3.1 states plainly: "109 assignments are not necessarily 109
distinct underlying metrics... several assignments bundle multiple
measures." Importing the workbook (`scripts/import-workbook.ts`) confirmed
this directly: 61 of 109 Role KPI Matrix rows did not match a KPI
Definitions family by exact name, because their titles bundle two
measures (e.g. "Claim clean rate and denial value") or use materially
different wording than the definitions sheet.

Per RULES.md ("Generate synthetic facts first... unresolved compound-metric
decompositions are flagged `unresolved`, never faked") and
AGENTS.md ("If a requirement... is missing, stop and label the
uncertainty"), these could not be silently guessed. Each of the 61 was
manually reviewed against the workbook's own definition/formula text and
the 29 KPI Definitions families, and mapped explicitly.

## Decision

`scripts/import-workbook.ts` contains a reviewed mapping table
(`ASSIGNMENT_TO_FAMILIES`) covering all 61 non-exact-match assignments.
53 map to exactly one family (wording differs from the family name but
the measure is the same, e.g. "Group net revenue vs approved budget" →
"Net revenue"). 8 map to two families because the assignment's own title
names two distinct measures:

| Assignment KPI (source row) | Definition families |
|---|---|
| COE, corporate and expansion milestones (11) | COE contribution + Contract utilisation |
| Clinical propositions converted to revenue (19) | New business revenue + Qualified pipeline |
| Claim clean rate and denial value (26) | First-pass claim acceptance + Denied or rejected claim value |
| New service, COE and corporate revenue vs plan (29) | New business revenue + COE contribution |
| Claim first-pass acceptance and rejection value (36) | First-pass claim acceptance + Denied or rejected claim value |
| Lead-to-revenue conversion (49) | New business revenue + Qualified pipeline |
| Active referrer network and referral revenue (50) | Referral conversion + New business revenue |
| New-service and COE lead conversion (51) | Qualified pipeline + COE contribution |

Result after import: **0 unresolved assignments** out of 109 (verified by
`src/__tests__/framework.test.ts`, which fails the build if any future
re-import produces an unresolved row).

## Alternatives considered

- **Leave bundled assignments as a single opaque KPI with no family
  link.** Rejected — breaks `packages/data-gen`'s ability to derive the
  assignment's observed value from underlying facts, since each bundled
  measure needs its own numerator/denominator per PRD §7.7.
- **Invent a new 30th "combined" definition family for each bundle.**
  Rejected — the workbook is explicit that there are 29 families; adding
  a 30th to sidestep the mapping problem would misrepresent the source
  and break the invariant test guarding the 29-family count.
- **Fuzzy string-matching only (no manual table).** Tried first; matched
  only 48/109 correctly and produced false positives (e.g. matching
  unrelated KPIs that happened to share a common word). Rejected in favor
  of an explicit, reviewable table.

## Impact

- Consumed by `packages/data-gen` (Phase 4, not yet built): each
  assignment's `definitionFamilies` array tells the generator which
  KPI Definitions rows to derive numerator/denominator facts from.
- Consumed by `services/api`'s future `kpi` module and by the entitlement
  matrix (ARCHITECTURE.md §8.2) that Aditya owns.
- No RLS, auth, or contract-schema impact by itself — this is data-shape
  only, inside `@orbit/kpi-framework`.

## Bundled-assignment weight: atomic — decided 2026-09-23 (Aditya)

**A bundled assignment's weight stays atomic. It is NOT split across its
component definition families.**

Two reasons, both worth keeping rather than re-deriving:

1. The workbook assigns weight to the *assignment row*, not to definition
   families. Any split would be a distribution Orbit invented rather than one
   the source specifies — the same class of error as hardcoding a
   realistic-looking value, which `RULES.md` bans outright.
2. No scoring formula is authorized yet (PRD §7: "Workbook weights do not
   authorize a scoring formula"). Splitting the weight would invent the
   distribution *and* imply a formula in one move.

So for the 8 multi-family assignments, the single `weight` value belongs to the
assignment as a whole, and `definitionFamilies` describes what it decomposes
into for *evidence* purposes — not for apportioning score.

Revisit only if a scoring formula is ever approved, and write the rationale
down at that point.

## Sign-off

- [x] Aditya (matrix owner per ARCHITECTURE.md §8.2) — 2026-09-23, on PR #13.
      Approved the mapping and answered the weight question above.
- [ ] Ghansham (consumes this shape in `services/api`'s `kpi` module)
- [x] Maruti (author)

## Open questions

- ~~Should a bundled assignment's weight be split across its component
  families?~~ **Resolved above: atomic.** Original framing retained for
  context: RULES.md §7
  ("Keep weights at 100%... Workbook weights do not authorize a scoring
  formula") suggests no scoring formula exists yet, so this may not need
  an answer before Gate 1 — flagging so it isn't silently decided later
  by whoever writes the scoring code.
