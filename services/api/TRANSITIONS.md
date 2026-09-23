# `@orbit/api` — proposed action transition matrix

**Status:** Proposed by Ghansham for Aditya's sign-off ([ARCHITECTURE §17](../../docs/orbit/ARCHITECTURE.md) item 3, [PRD FR-06](../../docs/orbit/PRD.md)). If accepted, Aditya may move it into `docs/decisions/` as an ADR.
**Code:** `PROPOSED_TRANSITIONS` in [`src/modules/actions/transitions.ts`](src/modules/actions/transitions.ts). Not wired into `app.ts`, so the deployed API keeps answering `unavailable` for transitions until this is accepted.

## The matrix

States come from `ActionStateSchema` in `@orbit/contracts`. "Creator" and "assignee" are relations to one action, not roles.

| From | To | Who | Why |
|---|---|---|---|
| `open` | `acknowledged` | Assignee | FR-06 "record acknowledgment": the owner confirms they have seen it |
| `acknowledged` | `in_progress` | Assignee | FR-06 "progress" |
| `in_progress` | `completed` | Assignee | FR-06 "completion": the person doing the work closes it |
| `open`, `acknowledged`, `in_progress` | `cancelled` | Creator | FR-06 "cancellation": whoever raised it can withdraw it |
| `completed`, `cancelled` | — | Nobody | Terminal |

Every other move is refused: `409 invalid_transition` when nobody may make it, `403 not_permitted` when only the other party may. Every accepted move needs a `reason`, bumps `version` by one, and commits with exactly one audit event (already enforced by the actions route and tested).

## Design choices to confirm

1. **Relations, not roles.** Any role gets the same lifecycle on actions it created or was assigned. This follows the no-hierarchy rule (ARCH §8.1): a Chairman does not get extra powers over someone else's action. `decide()` still receives the role, so a reviewed per-role exception can be added later without changing the port.
2. **No skipping acknowledgment.** `open → in_progress` and `open → completed` are refused, so every completed action has an explicit acknowledgment in its audit trail. Cost: one extra click for the assignee.
3. **Only the assignee completes; only the creator cancels.** Neither can overrule the other.
4. **No reopening.** `completed` and `cancelled` are terminal. A follow-up is a new action with its own evidence, which keeps each action's evidence snapshot fixed (FR-07).
5. **The creator is also the assignee.** If one person held both relations, the store could report only one, and they could then either complete or cancel, but not both. Nothing in the API prevents self-assignment yet. Proposed: the database `AssigneeDirectory` excludes the caller, making it impossible. Confirm.

## Not covered: needs its own decision

- **Cross-scope assignment** ([ADR 0011](../../docs/decisions/0011-entitlement-matrix-derivation-rules.md) §5.2). The PRD §5.3 vertical slice has a Regional COO assigning to a Hospital DHO, which ADR 0011 leaves open. **Until it is decided, the slice's action step cannot run**, whatever this matrix says.
- **Reassignment, due-date changes, and title edits.** Not state transitions, so they are not in this matrix. v1 has no endpoint for them.
- **Audit visibility of transitions.** Per ADR 0011 §3, each role reads audit entries for its own actions only. The audit store implementation must filter to those; the route's role-level `AuditAccessPolicy` gate should then allow every role. A follow-up once this and ADR 0011 are accepted.

## Acceptance test

`src/modules/actions/transitions.test.ts` checks every one of the 50 cells (5 × 5 states × 2 relations) against the table above, both terminal states, role independence, and that a duplicate or self-loop rule is rejected. Changing a cell means changing that test in the same review.

## Sign-off

- [ ] Aditya accepts the matrix, or marks the cells to change
- [ ] Design choices 1–5 confirmed or amended
- [ ] Then: wire `createMatrixTransitionPolicy(PROPOSED_TRANSITIONS)` through the `ORBIT_LIVE_SOURCES` flag (a separate PR)
