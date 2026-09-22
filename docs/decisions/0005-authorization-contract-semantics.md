# ADR 0005: Entitlement matrix scope and the wire shape of a scope refusal

- **Status:** Accepted — these are Aditya's calls to make (ARCHITECTURE.md §8.2, §17.2, §17.4). Recorded so the contracts in PR #5 can be frozen.
- **Owner:** Aditya
- **Reviewers:** Ghansham (implements both in `services/api`), Maruti (entitlements are seeded data she generates)
- **Date:** 2026-09-23
- **Unblocks:** the contracts freeze in PR #5, and the `entitlements` table shape in Maruti's migrations.

## 1. Entitlement matrix scope: global per framework version

**Decision: the entitlement matrix is global, keyed per role and per
framework version. It is not per organization. The `entitlements` table
gets no `organization_id` column.**

This confirms Ghansham's proposal. Organization isolation comes from
`organizationId` in the verified membership claims and from RLS on the data
tables — not from owning a separate copy of the matrix.

Why:

- ARCHITECTURE.md §8.2 already describes the matrix as a reviewed table
  answering questions **per role** — "which of the 109 assignments it sees,
  at which grains, which breakdowns, which evidence fields, which actions,
  and audit access." That is a property of the KPI framework and the role
  definition, not of a tenant.
- One table is reviewable. Per-organization copies would be N tables that
  can silently drift, and the matrix is the thing we most need to be able
  to audit by reading. §8.2 requires it be "seeded data with tests, not code
  scattered in handlers"; per-org duplication works against that.
- The two concerns are genuinely separate. "May a Regional COO see
  denial-value at facility grain?" is a framework question. "Which facility
  rows may *this* Regional COO see?" is a claims-and-RLS question. Mixing
  them into one table would mean an authorization bug in either concern
  looks the same.

**Keyed per framework version, not just per role.** The matrix rows carry the
framework/definition version (Maruti's generated manifest already emits
`definitionVersion`, currently `"v1"`). A future workbook revision that
changes what a role is entitled to must land as a new version rather than
mutating existing rows, so an entitlement change is visible as a version
bump instead of an invisible data edit.

Consequences:

- `entitlements` columns: role, assignment id, grains, breakdowns,
  framework version — plus the evidence/action/audit fields from §8.2 once I
  sign off the matrix content. No organization column.
- Ghansham's `EntitlementSchema` in PR #5 is therefore correct as keyed on
  `role`. It will need the version field added.
- If a future client ever needs per-organization entitlement overrides, that
  is a new decision and a new ADR. It is not a gap to be filled in by
  whoever first wants it.

## 2. Scope refusals: 403 on data routes, an answer outcome in Ask

**Decision: both, and they are not inconsistent.**

| Surface | Transport | Shape |
|---|---|---|
| Data routes (brief, inbox, kpi, actions, audit) | HTTP **403** | `ErrorEnvelope` with code `out_of_scope` |
| Ask | HTTP **200** | A normal answer whose outcome is `out_of_scope`, rendered as an Evidence Card |

Confirming Ghansham's reading. The reason they differ is not pragmatism, it
is a product requirement:

- On data routes, a scope refusal is a failed request. ARCHITECTURE.md §6.1
  requires the scope plugin to "answer `out_of_scope` plainly rather than
  silently narrowing" — 403 with the typed code does that. Returning 200
  with a partial result is the exact failure mode RULES.md bans.
- In Ask, a refusal **is** the answer. PRD FR-05 requires every answer to
  render an Evidence Card carrying scope, period, and limitations. A refusal
  that arrives as an HTTP error cannot render that card, so the user learns
  "something failed" instead of "you asked outside your scope, here is what
  your scope is." Transporting it as an error would destroy the disclosure
  the requirement exists to guarantee.

Guards on the Ask case, so 200 is not abused:

- The outcome field is explicit and typed. A refusal must not be
  representable as, or mistakable for, a successful data answer.
- A refusal carries no entitlement-protected values — not in the answer, not
  in "relevant records," not in reasoning text.
- `out_of_scope` stays distinct from `forbidden`, as Ghansham already has it
  in `errors.ts`. `forbidden` means the caller is not a valid member for this
  operation; `out_of_scope` means a valid member asked outside their
  entitlement. Collapsing them would lose the distinction the PRD's
  governed-refusal acceptance criterion tests for.

### Why this is 403 and not 404, when ADR 0002 deliberately hides membership state

These look contradictory and are not, so the reasoning is recorded here.

ADR 0002 collapses "no membership," "inactive," and "ambiguous" into a bare
`forbidden`, because account state is sensitive — telling an unauthorized
caller that a subject exists and was once active discloses something they
have not earned.

A scope refusal is different. The KPI framework is not secret from the
people inside it: all 14 roles share one published definition set, and a
Regional COO already knows group-level metrics exist. Hiding existence with
a 404 would buy no confidentiality and would cost the user the ability to
understand their own scope, which PRD FR-05 and the explainability criterion
both require. So: be explicit about scope, be opaque about accounts.

## Open, not decided here

- **Matrix content.** This ADR fixes the matrix's *shape and scope*. The
  109-row content still needs my sign-off per §17.2, drafted with Maruti and
  Ghansham. ADR 0004's bundled-assignment mapping is an input to it.
- Evidence fields, action permissions, and audit access columns (§8.2)
  remain unspecified until that content review. Ghansham was right to leave
  them out of `EntitlementSchema` rather than guess.
