# ADR 0012: `segment` is not a scope grain — it is a breakdown dimension

- **Status:** Accepted for the finding and the decision. The follow-on contract and `ARCHITECTURE.md` changes need Ghansham (consumes `GrainSchema`) and Maruti (enforces it) before they land.
- **Owner:** Aditya
- **Date:** 2026-09-23
- **Resolves:** the open question in ADR 0005 and ADR 0011 §5 item 1, which blocked entitlement matrix content.

## The question

`GrainSchema` lists `segment` beside `group`, `region`, `facility` and `coe`
because ARCHITECTURE.md §8.2 names all five as grains. But no segment entity
exists, so Maruti's `org_membership_scopes` CHECK rejects the grain — correctly,
since storing it would mean recording an authorization claim nothing can verify.

ADR 0011 §5 flagged two possible readings — a payer/insurer segment, or an
organizational unit — and said getting it wrong in the first direction was the
expensive one. It is the first one.

## Evidence, all from committed data

I did not need the workbook. The generated framework settles it.

**1. The workbook uses "segment" as a verb, and the dimension it names is payer:**

- `governance-rules.ts`: "segment targets by material **payer** where needed"
- `kpi-definitions.ts`: "**Segment by payer** and rejection reason"
- `kpi-definitions.ts`: "Track by **payer and facility**"
- `role-kpi-assignments.ts`: "**segmented by risk category**"

The third line is the important one. Payer and facility appear as two
independent axes of the same figure. A thing you track *alongside* facility is
not a level *within* the facility hierarchy.

**2. Payer-related assignments are held by six roles at three different grains:**

| Role | Base grain | Payer-related assignment |
|---|---|---|
| billing-lead | facility | Claim first-pass acceptance rate; Payer reconciliation and documentation completeness; Rejected or denied claim value |
| hospital-dho | facility | Claim first-pass acceptance and rejection value |
| regional-coo | region | Claim clean rate and denial value |
| corporate-revenue-lead | group | Payer issue closure |
| legal-head | group | Commercial and payer dispute support turnaround |

This is conclusive. A scope grain sits at **one** level of the organization. Payer
appears simultaneously at facility, region and group. A dimension present at
every level of a hierarchy is orthogonal to that hierarchy.

**3. Entity tables exist for the real grains and not for this one.** Maruti's
migrations create `regions`, `facilities` and `coes`. There is no `payers` or
`segments` table, and the absence is not an oversight — the other four grains
needed tables because they are *places in the organization*. Payer is not.

## Decision

**`segment` is removed from the scope-grain concept. It is a breakdown
dimension, and ARCHITECTURE.md §8.2 conflated two different things.**

Grains answer *"which entities may this role see?"* — an authorization question.
Breakdown dimensions answer *"how may this number be decomposed?"* — a
presentation question about data the caller is **already** entitled to.

That distinction has a direct consequence worth stating plainly: **a payer
breakdown of a figure you are already entitled to see does not widen your
entitlement.** So payer does not belong in an entitlement's `grains` column at
all. Putting it there would imply an authorization decision where none exists,
and would invite someone to "grant" payer scope as though it controlled
visibility.

Consequences:

1. **Maruti's CHECK rejecting `segment` is permanently correct**, not a
   placeholder awaiting an entity table. It should stay after this ADR, and the
   comment should say "not a grain" rather than "until segments exist."
2. **`segment` comes out of `GrainSchema`** in `packages/contracts`. That is a
   contract change needing Ghansham's review; it is not a silent edit.
3. **ARCHITECTURE.md §8.2 needs correcting** to list four grains and describe
   breakdown dimensions separately. A reviewed spec stating something we now
   know to be a category error should not be left to mislead the next reader.
4. **ADR 0011's grain table is unaffected.** It assigns no role `segment`, and
   its §4 invariant already forbids a `segment` row. This ADR converts that
   invariant from provisional to permanent.
5. **ADR 0011's weakest row is now resolved.** The `region` breakdown for
   `corporate-revenue-lead` was flagged as possibly answering the wrong
   question. It answers the right one: `region` is a genuine organizational
   breakdown, and the payer dimension that role also needs is a separate concern
   that does not live in the entitlement matrix.

## Deliberately not decided here

**How breakdown dimensions get modelled.** Payer, rejection reason and risk
category are real and appear in the workbook's own definitions, so they will
need representation eventually — in the KPI definitions and the observation
model, not in scope or entitlements. That is a data-model decision for Maruti
and a payload decision for Ghansham, and it is not on the critical path: no
surface decomposes by payer yet.

What matters now is that it is **not an authorization concern**, so it stops
blocking matrix content.

## Why this was worth the detour

The cheap move was to leave `segment` in the enum, keep the CHECK, and let it sit
as a permanent "unresolved". That would have been wrong in a specific way: the
next person to need payer-level reporting would have reached for the grain that
was already there, added a `segments` table to make it work, and modelled a
payer dimension as an organizational unit. The CHECK would have been deleted as
an obstacle rather than respected as a boundary.
