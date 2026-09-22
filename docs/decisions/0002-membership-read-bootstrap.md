# ADR 0002: How the API reads a membership row before RLS claims are set

- **Status:** Proposed — recommendation below is Aditya's, but this needs Ghansham (API pipeline) and Maruti (RLS policies) to agree before the `org_memberships` migration is written. Per TEAM_ASSIGNMENTS.md this is a three-person decision.
- **Owners:** Aditya (decides), Ghansham (API impact), Maruti (migration/RLS impact)
- **Date opened:** 2026-09-22
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

The API opens its transaction, `SET LOCAL`s only `orbit.subject` (the
JWT-verified user id), and `org_memberships` carries a `select` policy
that permits reading rows where the row's subject equals
`current_setting('orbit.subject', true)`. The API reads its own
membership row(s), builds the claims, then `SET LOCAL`s the full
`orbit.membership` object for the remainder of the transaction.

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

## Consequences if Option A is adopted

- `org_memberships` gets exactly two kinds of read access: the bootstrap
  self-read policy keyed on `orbit.subject`, and whatever the normal
  claims-based policies allow. Both need explicit pgTAP allow/deny tests.
- `orbit.subject` becomes a second reserved setting name alongside
  `orbit.membership`; both must be `SET LOCAL` (never session-scoped
  `SET`, which leaks across pooled connections — ARCHITECTURE.md §7.1).
- The API's auth plugin gains an ordered contract: verify JWT → set
  `orbit.subject` → read membership → set `orbit.membership` → run
  handler. Ghansham should encode that order in one place so it cannot be
  accidentally reordered, and test that a handler cannot run with
  `orbit.membership` unset.
- Maruti can write the `org_memberships` migration once this is agreed;
  it is currently blocked.

## Sign-off

- [ ] Aditya (security/claims)
- [ ] Ghansham (API pipeline shape is workable)
- [ ] Maruti (policy/migration shape is workable)

## Open questions

- Does a user ever hold more than one membership (multiple roles, or one
  role across several scopes)? `MembershipClaims` in
  `packages/contracts/src/membership.ts` currently models a single role
  with an array of scopes, which implies one active membership per user
  per organization. If multi-membership is possible, the bootstrap read
  returns several rows and the API needs a defined rule for which one
  applies — that rule must be explicit, not "first row wins."
- Related, and being tracked in the PR #5 review rather than here:
  whether the entitlement matrix is keyed per role or per role-at-scope.
