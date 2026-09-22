# ADR 0002: How the API reads a membership row before RLS claims are set

- **Status:** Proposed — Option A is agreed in substance by Aditya and Ghansham; pending Maruti's recorded sign-off and the open question on organization scope below.
- **Owners:** Aditya (decides), Ghansham (API impact), Maruti (migration/RLS impact)
- **Date opened:** 2026-09-22
- **Last revised:** 2026-09-23 — incorporates Ghansham's API sign-off conditions and three review findings against the original draft.
- **Date resolved:** _(fill in when all three have signed off)_
- **Blocks:** the `org_memberships` table migration, and therefore every downstream RLS policy that reads membership claims.

## Context

ARCHITECTURE.md §8.3 requires that every request set the verified
membership claims as `orbit.membership` in a per-transaction setting, and
that RLS policies evaluate against those claims. The role must come only
from a trusted DB record, never from the request (ARCHITECTURE.md §8,
RULES.md).

This creates a bootstrap problem: to build the `orbit.membership` claims,
the API must first read the caller's row from `org_memberships`. But if
`org_memberships` is itself protected by an RLS policy that reads
`orbit.membership`, that setting does not exist yet at the moment of the
read. The first read cannot authorize itself with the thing it is trying
to produce.

Something has to break the cycle. What must *not* happen is breaking it
by reading the table as a privileged role that bypasses RLS — that would
put a full-table-visible code path into the request pipeline, which is
the posture ARCHITECTURE.md §7.2 and RULES.md exist to prevent.

The only input the API can trust at that point is the verified JWT
subject (user id), which has been cryptographically validated via JWKS
before any database work happens.

## Options considered

### Option A — set `orbit.subject` first, narrow select policy on `org_memberships`

The API sets only `orbit.subject` (the JWT-verified user id) as a
transaction-local setting, and `org_memberships` carries a `select` policy
that permits reading rows where the row's subject equals
`current_setting('orbit.subject', true)`. The API reads its own
membership row(s), validates them (see the failure path below), builds
the claims, then sets `orbit.membership` for the data work.

**Two requirements, not one.** An RLS policy is a row *filter*, not a
table *privilege*. Because ARCHITECTURE.md §7.2 requires default
privileges to be revoked, the migration must contain both:

1. `grant select on org_memberships to orbit_app` — without this the
   bootstrap query fails before any policy is evaluated.
2. the subject-scoped `select` policy above.

Neither substitutes for the other. No write grants on this table.

- The bootstrap grant is expressed as a declarative RLS policy, visible
  by reading the migration file.
- Nothing in the pipeline runs with RLS bypassed.
- The blast radius if the policy is wrong is one table, and it is
  directly testable with pgTAP: "user X cannot see user Y's membership."
- Costs one extra `SET LOCAL` and one extra round trip in the request
  pipeline.

### Option B — a narrow `security definer` function returning only the caller's rows

A `security definer` function runs with elevated rights and returns only
the requesting user's membership rows, so no bootstrap policy on the
table is needed.

- Fewer moving parts in the request pipeline.
- But it introduces a privileged code path that bypasses RLS by design.
  Its safety depends entirely on the function body being correct, forever
  — including `search_path` pinning and every future edit to it.
- Reviewing authorization now means reading both migrations *and*
  function bodies, rather than policies alone.

## Recommendation (Aditya)

**Option A.**

Rationale: it keeps the entire authorization story in declarative RLS
that a reviewer can audit by reading migration files, and it avoids
adding a standing `security definer` bypass that the team would have to
guard for the life of the project. The cost is one `SET LOCAL` and one
round trip, which is cheap and does not interact badly with the Supavisor
transaction-mode pooler (transaction mode is what makes `SET LOCAL`
safe here — see ARCHITECTURE.md §7.1).

Option B is not unreasonable, and if Ghansham finds that Option A forces
an awkward or fragile shape in the Fastify pipeline, that is a legitimate
reason to revisit. This ADR should be updated with that finding rather
than quietly switching approaches.

## Two transactions, not one (revised 2026-09-23)

The original draft described a single transaction that carries
`orbit.subject` first and then adds `orbit.membership`. Ghansham
implemented **two separate transactions** instead, and that is now the
decision:

- the lookup transaction carries only `orbit.subject`;
- the data transaction carries only `orbit.membership`.

Rationale for accepting his change: Postgres permissive policies are
OR-ed together, which ARCHITECTURE.md itself flags as a standing risk
[S2]. With one transaction, the subject self-read policy would still be
live while handler queries run, so it could OR with the normal
claims-based policies and widen a handler's visibility. Two transactions
make that structurally impossible rather than merely unlikely.

The cost is a second pooled connection per request, since the db layer
opens one connection per transaction. That is acceptable, but it is a real
cost against the Vercel file-descriptor ceiling [V-limits], so it should
be revisited if connection pressure shows up under load. Recorded here so
the tradeoff is not rediscovered later.

## Failure path — required, not optional

The ordered pipeline must not be implemented as "read rows → build claims
→ proceed." Before `orbit.membership` is ever set, the API must resolve
the read to **exactly one active membership**, and otherwise refuse:

| Bootstrap result | Required behavior |
|---|---|
| no rows | deny — unauthenticated/forbidden, no claims set |
| rows exist but none active | deny — do not fall back to an inactive row |
| more than one active candidate | deny as ambiguous — never "first row wins" |
| exactly one active | build claims, proceed |

The lookup returns all of the subject's rows (not a pre-filtered active
set) so the API can tell "no membership" apart from "membership exists but
is inactive" and report accordingly rather than collapsing both into one
error.

**Open contract gap:** Ghansham's implementation refuses the ambiguous
case as `ambiguous_membership`, but `ErrorCodeSchema` in
`packages/contracts/src/errors.ts` (proposed in PR #5) does not contain
that code. Either the code is added to the enum or the case maps to an
existing one. This must be resolved in the contracts PR, not invented at
the call site.

## Consequences if Option A is adopted

- `org_memberships` gets exactly two kinds of read access: the bootstrap
  self-read policy keyed on `orbit.subject`, and whatever the normal
  claims-based policies allow. Both need explicit pgTAP allow/deny tests,
  plus the explicit `grant select` noted above.
- `orbit.subject` becomes a second reserved setting name alongside
  `orbit.membership`. Both must be **transaction-local**. Use
  `set_config(name, value, true)` rather than `SET LOCAL`: the behavior is
  identical, but `set_config` accepts a bound parameter while `SET LOCAL`
  requires string interpolation into SQL. Session-scoped `SET` is banned —
  it leaks across pooled connections (ARCHITECTURE.md §7.1).
- Comparison in the policy should be
  `subject = nullif(current_setting('orbit.subject', true), '')::uuid`.
  Without the `nullif`, an unset setting reads back as the empty string
  and the `::uuid` cast raises instead of simply matching no rows.
- If scopes live in a child table rather than on the membership row, that
  table needs the same subject-scoped self-read policy, or the bootstrap
  read cannot assemble complete claims.
- The API's auth pipeline gains an ordered contract: verify JWT → set
  `orbit.subject` → read membership → **validate per the table above** →
  set `orbit.membership` → run handler. That order lives in one place so
  it cannot be reordered accidentally, and a handler must be unable to run
  with `orbit.membership` unset. Ghansham has committed to a test for that
  when the first feature module lands.
- Maruti can write the `org_memberships` migration once this is agreed;
  it is currently blocked.

## Sign-off

- [x] Aditya (security/claims) — 2026-09-23
- [x] Ghansham (API pipeline shape is workable) — 2026-09-22, on PR #6,
      conditional on the two-transaction choice being recorded. It is, above.
- [ ] Maruti (policy/migration shape is workable) — reported as given, but
      **not yet recorded on PR #6.** Needs her comment or a commit so the
      sign-off exists in the repository rather than only in chat.

## Membership cardinality

Resolved in substance: **exactly one active membership per subject per
organization**, enforced at the database level rather than detected by the
API. Maruti's proposal is a unique partial index over
`(subject, organization_id) where status = 'active'`, which makes the
ambiguous case unrepresentable rather than something application code has
to notice. That is the better of the two approaches and is adopted.

The API still implements the refusal path above. A database constraint and
an application check are not redundant here: the constraint prevents the
bad state, the check prevents a silent wrong answer if the constraint is
ever dropped, mis-scoped, or not yet applied.

**Still open — organization scope.** A unique index on
`(subject, organization_id)` guarantees at most one active membership
*within* an organization. It does not resolve ambiguity for a subject with
active memberships in *several* organizations: the bootstrap read would
still return more than one active row, and the API would refuse. Whether
that is acceptable depends on a product answer nobody has given yet:

- If a user only ever belongs to one organization in this release, say so
  explicitly and the refusal path covers the rest.
- If multi-organization membership is real, the request needs to name the
  organization and the server must verify that choice against the
  subject's memberships. That is a contract change (an org parameter) and
  belongs in the contracts PR.

Do not let this be settled implicitly by whoever writes the first handler.

## Other open questions

- Whether the entitlement matrix is keyed per role or per role-at-scope —
  tracked in the PR #5 review, not here.

## Correction note

Three findings against the original draft of this ADR were valid and are
fixed above: the grant/policy conflation, the missing failure path, and a
reference to `packages/contracts/src/membership.ts` as though it already
existed. That file is **proposed in PR #5 and not yet merged to `main`** —
statements about what it "currently models" describe a proposed shape, not
shipped code.
