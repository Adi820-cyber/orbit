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

**The rule keys on `deployment` alone.** `level` is deliberately not part of any
condition — see the correction note below for why.

| `deployment` value | Base grain | Roles |
|---|---|---|
| `1 group role` | `group` | chairman, clinical-director, corporate-revenue-lead, group-cfo, procurement-head, hr-head, legal-head, analytics-head |
| `2 roles; 3 hospitals each` | `region` | regional-coo |
| `6 roles; one per hospital` | `facility` | hospital-dho, people-executive, bd-lead, billing-lead |
| `As approved by COE plan` | `coe` | coe-lead |

Verified by executing the rule against the generated `ROLES` data, not by
reading the table: **14 of 14 roles matched, 109 of 109 assignments accounted
for, zero unmatched.**

### Correction: the original rule 1 excluded `corporate-revenue-lead`

The first version of this rule read `1 group role` **and** a `Group *` level.
That conjunction matches only **7** roles. `corporate-revenue-lead` has
`deployment: "1 group role"` but `level: "Commercial growth"`, so it fell
through and the generator would have emitted a role with no base grain — while
this ADR claimed to account for all 14.

Found by Maruti implementing it. My own cross-check missed it for an instructive
reason: **I verified the prose table against the framework, never that the rule
reproduced the table.** The table listed eight roles, the rule produced seven,
and the check validated the artifact that was right instead of the one that
shipped. A rule stated in prose and a table stated beside it are two artifacts,
and the one the generator implements is the rule.

`deployment` alone is also strictly better, not just a patch: no role outside
those eight carries `1 group role`, so the `level` test added no discrimination
at all — it only removed a role that belonged. Dropping it makes the rule
shorter and avoids a special case for `Commercial growth`.

Worth noting why that level differs: `corporate-revenue-lead` sits outside the
`Group *` naming in the workbook, which reads as a signal that it is a
commercial rather than a governance function. That is consistent with it being
the role most likely to need a payer dimension — which ADR 0012 has since
concluded is not a scope grain at all.

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
- **no row with grain `segment`** — now permanent, per ADR 0012;
- every breakdown grain is **strictly below the row's highest base grain**, in
  the partial order defined below.

### The grain order is a DAG, not a chain — corrected

The original wording, "no breakdown grain equal to or above its row's base
grain," is ambiguous for `clinical-director`, whose base grains are `group` and
`coe` while its breakdowns are `coe` and `facility`. Read literally, `coe` is
both, and the invariant fails on the one row this ADR flags as a judgement call.

Maruti asked which of two readings was intended. **The intended reading is
against the row's *highest* base grain**, so a clinical director decomposing a
group-level figure by COE is valid. That is the described use.

But the wording failed for a deeper reason than imprecision: **grains are not a
total order**, and "above" presumed they were. The actual relation is:

```
group ─→ region ─→ facility
  └────→ coe ────→ facility
```

`region` and `coe` are **incomparable** — a COE spans facilities rather than
sitting inside a region. So no comparison like "above" is well-defined between
them, and any invariant phrased as a single ordering will be wrong somewhere.

**The invariant, stated properly:** a breakdown grain is valid if it is
reachable by following at least one edge from the row's highest base grain in
the DAG above. Checked against every row:

| Role | Highest base | Breakdowns | Valid |
|---|---|---|---|
| chairman, group-cfo, and the group functions | `group` | `region` | yes |
| clinical-director | `group` | `coe`, `facility` | yes — both reachable from `group` |
| regional-coo | `region` | `facility` | yes |
| coe-lead | `coe` | `facility` | yes — COE contribution decomposes by site |
| hospital-dho, people-executive, bd-lead, billing-lead | `facility` | none | yes, nothing is below `facility` |

Implement it as reachability over that DAG, not as a numeric level comparison.
A level number would force `region` and `coe` onto the same rung and quietly
permit a `region` breakdown for `coe-lead`, which is a widening this ADR
forbids.

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
2. ~~Cross-scope action assignment.~~ **Decided — see §6.**
3. ~~Broader audit access for governance roles.~~ **Decided — see §7.**
4. **Per-assignment grain exceptions.** The rules above are per *role*. If a
   specific assignment needs a narrower grain than its role's default, that is a
   reviewed exception recorded here — not an edit to generated output.

## 6. Cross-scope action assignment — decided

**A role may assign an action to a role whose scope is contained within the
assigner's own scope. Never upward, never sideways.**

So a Regional COO may assign to a Hospital DHO of one of *its* hospitals —
which is the demo flow Ghansham needs. It may not assign to a DHO in the other
region, and a DHO may not assign upward to a Regional COO.

Why this shape: it introduces **no new concept**. "Is entity X inside my scope?"
is exactly the containment question the scope resolver already answers for reads.
Assignment reuses it rather than adding a second authorization notion that could
drift from the first.

Three constraints on the implementation:

- **The assignee is resolved server-side from verified claims**, never accepted
  from the request. A request naming an assignee is a request, not a permission.
- **Containment is checked at assignment time**, and the check is the same
  resolver used for reads. If the resolver says the assignee's scope is not
  inside the assigner's, the assignment is refused — not narrowed.
- **Assignment does not grant the assignee any new read access.** If a DHO is
  assigned an action about an assignment it cannot see, it sees the action and
  not the underlying figure. Entitlement is unchanged by assignment; conflating
  the two would make assignment a privilege-escalation path.

## 7. Audit access — confirmed, and it is not a per-role flag

**A role reads audit entries for actions it created or is assigned. Nothing
else. There is no per-role audit toggle in the matrix for v1.**

Ghansham noted his code currently switches audit reading on or off per role.
That should be removed rather than configured: the filter is by **actor and
assignee**, derived from verified claims, not by a matrix column.

The reason for the stricter choice: a governance-wide audit reader — Legal Head
or Chairman seeing every role's audit trail — is genuinely arguable and probably
wanted eventually. But it is a **governance decision about who may observe whom**,
and I am not making it as a side effect of a derivation ADR. Shipping the
narrow version first means the broad version arrives as a reviewed change with a
named rationale, rather than as a default nobody examined.

PRD FR-07's append-only requirement is unaffected by this and still holds: no
UPDATE or DELETE grant to anyone, including the seeder.

## 8. What I am explicitly not claiming

No part of this has been applied or tested. No entitlement row exists yet, the
scope plugin has never evaluated a real matrix, and the pgTAP suite that would
prove RLS enforces it has never run. This is a reviewed proposal for content
that does not exist, and it should not be described as an authorization model
that works until Maruti's validation run and Ghansham's leak tests both report.
