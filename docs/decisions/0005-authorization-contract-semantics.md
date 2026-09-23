# ADR 0005: Entitlement matrix scope and the wire shape of a scope refusal

- **Status:** Accepted — these are Aditya's calls to make (ARCHITECTURE.md §8.2, plus §17 items 2 and 4). Recorded so the contracts in PR #5 can be frozen.
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
framework/definition version. `packages/kpi-framework`'s generated manifest
emits `definitionVersion` (currently `"v1"`) — merged to `main` in PR #14, so
this is a field that exists rather than a proposed one. A future workbook
revision that changes what a role is entitled to must land as a new version
rather than mutating existing rows, so an entitlement change is visible as a
version bump instead of an invisible data edit.

### Version selection is part of this decision, not a later detail

Versioning the rows without defining which version is *authoritative* would
create an authorization hole: once v2 rows exist, a lookup keyed on
`(role, assignment_id)` alone matches both versions, and the request could be
authorized against stale or not-yet-active entitlements depending on row order.
Permissive-by-accident, and invisible in tests that only ever have one version
loaded.

So three rules, all required:

1. **Exactly one framework version is active at a time.** It is configuration,
   resolved once at startup — not inferred from the newest row, because "newest"
   silently activates whatever was most recently seeded.
2. **Every entitlement lookup filters on the active version.** A query that does
   not constrain the version is a bug, not a broad query. The scope plugin should
   take the version from one place so a handler cannot omit it.
3. **Uniqueness invariant:** `(framework_version, role, assignment_id)` is
   unique. That makes duplicate-row ambiguity within a version unrepresentable,
   the same way ADR 0002 handles membership cardinality — constrain at the
   database rather than detect in application code.

Loading a second version must not change behaviour until the active version is
deliberately switched. Worth a test that asserts exactly that: seed v2 alongside
v1, and confirm every authorization answer is unchanged.

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

**The Ask response schema is explicitly deferred, not decided here.** This ADR
fixes the *transport* choice (200 with an outcome, rather than an HTTP error). It
does **not** define the response union, the outcome field name, or the Evidence
Card payload, and PR #5's contracts contain only auth/session shapes and
`ErrorEnvelope` — no Ask response. Until that contract lands, two
implementations could return incompatible 200 refusal payloads and both believe
they were compliant.

So: no Ask handler may be built against an assumed shape. FR-05's six Evidence
Card sections (answer, relevant records, definition/policy basis, reasoning,
possible next action, scope/period/limitations) need a `packages/contracts` PR of
their own, reviewed by whoever owns the Ask surface and the frontend. That is a
prerequisite for Ask work, and it is a follow-up to this decision rather than
part of it.

Guards on the Ask case, so 200 is not abused — these constrain whatever schema
is eventually agreed:

- The outcome field must be explicit and typed. A refusal must not be
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
  109-row content still needs my sign-off per §17 item 2, drafted with Maruti and
  Ghansham. ADR 0004's bundled-assignment mapping is an input to it.
- Evidence fields, action permissions, and audit access columns (§8.2)
  remain unspecified until that content review. Ghansham was right to leave
  them out of `EntitlementSchema` rather than guess.
