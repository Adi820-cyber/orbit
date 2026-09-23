# ADR 0011: Entitlement matrix — derivation rules for grains and breakdowns

> Renumbered from 0010. Ayas's frontend-dependency record took 0010 first, in
> PR #18; mine landed later in PR #20 and I had not checked for a collision
> before numbering it. Two ADRs sharing a number makes every cross-reference
> ambiguous, so the later one moved.

- **Status:** Proposed. Needs Maruti (seeds and enforces it) and Ghansham (consumes it in the scope plugin). This is the content sign-off ARCHITECTURE.md §8.2 and §17 item 2 assign to me, and ADR 0005 left open.
- **Owner:** Aditya
- **Date:** 2026-09-23
- **Unblocks:** every data route. `pendingModuleDeps()` currently throws `unavailable` for `entitlement_store`, so the API is locked shut until this exists.

## Why this is rules rather than 109 rows

The role→assignment mapping is **already decided** — it is the workbook's Role
KPI Matrix, generated into `packages/kpi-framework` as 109 rows and guarded by
invariant tests. Nothing here re-decides which KPIs a role holds.

What the workbook does **not** state is the authorization dimension §8.2 asks
for: at which *grain* a role sees its assignments, which *breakdowns* it may
open, and what it may do with the evidence. That is what this ADR supplies.

Writing 109 hand-assigned rows would invite exactly the failure RULES.md warns
about — realistic-looking values with no traceable source. So the decision is a
small set of rules, each derived from a workbook field, applied mechanically to
produce the rows. Anyone can re-derive the output and check it.

## 1. Base grain, derived from `level` and `deployment`

Both fields are workbook-generated on `RoleDefinition`. The mapping is:

| `deployment` / `level` pattern | Base grain | Roles |
|---|---|---|
| `1 group role` + any `Group *` level | `group` | chairman, clinical-director, corporate-revenue-lead, group-cfo, procurement-head, hr-head, legal-head, analytics-head |
| `2 roles; 3 hospitals each` (Regional management) | `region` | regional-coo |
| `6 roles; one per hospital` (Hospital *) | `facility` | hospital-dho, people-executive, bd-lead, billing-lead |
| `As approved by COE plan` (Clinical growth) | `coe` | coe-lead |

That accounts for all 14 roles and all 109 assignments. The derivation is
mechanical: no role's grain is a judgement call, it follows from how the
workbook says the role is deployed.

**One addition that is a judgement, and is flagged as such:**
`clinical-director` gets `coe` **in addition to** `group`, because its
`primaryFocus` reads "Clinical governance, COEs, corporate clinical
propositions" — COEs are explicitly its remit. This is the only role where I
have added a grain not implied by `deployment` alone, and it is the one line in
this table most worth arguing with.

## 2. Breakdowns are granted only one level down, and only where the role manages that level

A breakdown lets a role decompose its own figure; it does not widen which
entities the role can see.

| Role | Breakdowns | Why |
|---|---|---|
| regional-coo | `facility` | Deployment is "3 hospitals each" — comparing its own hospitals is the job. PRD §4 item 3 requires an explicit facility-breakdown grant for exactly this. |
| chairman, group-cfo | `region` | Group-level P&L and governance are meaningless without regional decomposition. |
| clinical-director | `coe`, `facility` | Clinical governance spans both. |
| coe-lead | `facility` | A COE runs across hospitals; its own contribution decomposes by site. |
| hospital-dho, people-executive, bd-lead, billing-lead | none | Already at the leaf grain. Nothing below a facility exists in the org model. |
| corporate-revenue-lead, procurement-head, hr-head, legal-head, analytics-head | `region` | Group functions reporting by region. **Weakest row in this table** — see §5. |

**No upward breakdowns, ever.** A facility-scoped role never gets `region`, and
no role gets `group` as a breakdown unless `group` is already its base grain.
ARCHITECTURE.md §8.1 rules out hierarchy cascade, and Maruti's schema already
walks ancestry downward only, one step — this matches it deliberately.

## 3. Evidence, actions, and audit — conservative defaults

§8.2 requires these columns. They are set restrictively on purpose; widening
later is a reviewed change, and widening is far cheaper to argue for than
discovering a role saw something it should not have.

- **Evidence fields:** the observations and exceptions backing an assignment,
  within the role's own scope and grain. No patient or employee identity —
  the dataset intentionally contains none (ARCHITECTURE.md §3), so this is a
  property of the data, not a filter to be relaxed.
- **Action creation:** any role may create an action on an assignment it can
  see. It cannot create one on an assignment it cannot see, which falls out of
  the grain rules rather than needing its own check.
- **Action assignment:** a role may be assigned actions within its own scope.
  Cross-scope assignment (a Regional COO assigning to a Hospital DHO) is
  plausible and probably wanted, but it is **not derivable** and I am not
  inventing it. Open in §5.
- **Audit access:** a role reads audit entries **for its own actions only**.
  Broader audit visibility for Legal Head or Chairman is arguable, but it is a
  governance decision, not a derivation. Open in §5.

## 4. Versioning and the invariant

Rows carry the framework version, per ADR 0005 §1. Generated output must satisfy:

- exactly **109** `(role, assignment_id)` pairs for the active version, matching
  `FRAMEWORK_MANIFEST.assignmentCount`;
- every `role` in the 14-value enum, with per-role counts matching `kpiCount`
  (7/8/9 as applicable);
- unique on `(framework_version, role, assignment_id)` — the ADR 0005 invariant;
- **no row with grain `segment`** (see §5);
- no breakdown grain equal to or above its row's base grain.

These are assertable in `packages/data-gen` and should fail the build, not a
review. If the generated matrix stops matching the workbook, that is a bug.

## 5. Open — not decided here, and three of these block nothing else

1. **`segment` is excluded entirely.** No row may carry it. ADR 0005 records
   why: no segment entity exists, and if `segment` means a payer/insurer
   segment it is not an organizational grain at all, which would make
   `ScopeEntity` the wrong shape for it. Resolving that is mine and it must
   happen before any role legitimately needs payer-scoped data.
   **`corporate-revenue-lead` is the role most likely to need it**, which is
   also why its `region` breakdown in §2 is the weakest row here — a payer
   dimension may be what that role actually needs, not a geographic one.
2. **Cross-scope action assignment.** Needed before the actions surface is more
   than single-scope.
3. **Broader audit access for governance roles.** Needed before the audit
   surface ships.
4. **Per-assignment grain exceptions.** The rules above are per *role*. If a
   specific assignment needs a narrower grain than its role's default, that is a
   reviewed exception recorded here — not an edit to generated output.

## 6. What I am explicitly not claiming

No part of this has been applied or tested. No entitlement row exists yet, the
scope plugin has never evaluated a real matrix, and the pgTAP suite that would
prove RLS enforces it has never run. This is a reviewed proposal for content
that does not exist, and it should not be described as an authorization model
that works until Maruti's validation run and Ghansham's leak tests both report.
