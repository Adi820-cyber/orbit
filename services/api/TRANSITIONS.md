# `@orbit/api` — proposed action transition matrix (v2)

**Status:** Proposed by Ghansham for Aditya's sign-off ([ARCHITECTURE §17](../../docs/orbit/ARCHITECTURE.md) item 3, [PRD FR-06](../../docs/orbit/PRD.md)). If accepted, Aditya may move it into `docs/decisions/` as an ADR.
**Code:** `PROPOSED_TRANSITIONS` in [`src/modules/actions/transitions.ts`](src/modules/actions/transitions.ts), wired through `ORBIT_LIVE_SOURCES` (`transitions`). Migrations `20260925000100` (the `submitted` state, delegation, event roles) and `20260925000200` (entity label snapshot).

**Why v2.** The product owner reported that an action a Regional COO sent to a Hospital DHO could not be passed on or approved. v1 let the assignee close their own work with nobody approving it, gave the assignee no way to hand part of it to their team, and the page offered every state to everyone (most then refused). v2 adds an approval step and delegation, and the server now tells the page exactly which moves the viewer has.

## The matrix

States come from `ActionStateSchema` in `@orbit/contracts`. "Creator" and "assignee" are relations to one action, not roles.

| From | To | Who | Shown as | Why |
|---|---|---|---|---|
| `open` | `acknowledged` | Assignee | Acknowledge | FR-06 "record acknowledgment" |
| `acknowledged` | `in_progress` | Assignee | Start work | FR-06 "progress" |
| `in_progress` | `submitted` | Assignee | Submit for approval | The assignee finishes; the creator decides |
| `submitted` | `completed` | Creator | Approve | FR-06 "completion", approved by whoever raised it |
| `submitted` | `in_progress` | Creator | Send back | The creator returns it with what is still needed |
| `open`, `acknowledged`, `in_progress`, `submitted` | `cancelled` | Creator | Cancel action | FR-06 "cancellation" |
| `completed`, `cancelled` | — | Nobody | — | Terminal |

Every other move is refused: `409 invalid_transition` when nobody may make it, `403 not_permitted` when only the other party may. Every accepted move needs a note (`reason`), bumps `version` by one, and commits with exactly one audit event. `GET /api/actions/:id` returns `viewer.moves`, the history with each note, delegated sub-actions and the parent.

## Delegation

The assignee may hand part of the work to someone inside their own scope (`POST /api/actions/:id/delegations`), while the action is `open`, `acknowledged` or `in_progress`:

- The sub-action keeps the parent's assignment, entity and fixed evidence snapshot; its assignee comes from `orbit.permitted_assignees()` under the delegator's claims, so delegation only goes downward (ADR 0011 §6).
- The delegator is the sub-action's creator: they approve it when it is submitted.
- The parent cannot be submitted while delegated work is still open (`409 delegated_work_open`).
- Visibility is unchanged: the parent's creator does not gain access to the sub-action.

## Design choices to confirm

1. **Relations, not roles.** Any role gets the same lifecycle on actions it created or was assigned. This follows the no-hierarchy rule (ARCH §8.1): a Chairman does not get extra powers over someone else's action. `decide()` still receives the role, so a reviewed per-role exception can be added later without changing the port.
2. **No skipping acknowledgment.** `open → in_progress` and `open → completed` are refused, so every completed action has an explicit acknowledgment in its audit trail. Cost: one extra click for the assignee.
3. **Only the assignee completes; only the creator cancels.** Neither can overrule the other.
4. **No reopening.** `completed` and `cancelled` are terminal. A follow-up is a new action with its own evidence, which keeps each action's evidence snapshot fixed (FR-07).
5. **The creator is also the assignee.** If one person held both relations, the store could report only one, and they could then either complete or cancel, but not both. Nothing in the API prevents self-assignment yet. Proposed: the database `AssigneeDirectory` excludes the caller, making it impossible. Confirm.

## Not covered: needs its own decision

- **Cross-scope assignment** — decided in [ADR 0011](../../docs/decisions/0011-entitlement-matrix-derivation-rules.md) §6: an assignee's scope must lie inside the assigner's (downward only). Enforced separately from this matrix, when the assignee is chosen.
- **Reassignment, due-date changes, and title edits.** Not state transitions, so they are not in this matrix. v1 has no endpoint for them.
- **Audit visibility of transitions** — decided in ADR 0011 §7: each member reads the events for actions they created or are assigned, with no per-role flag.

## Acceptance test

`src/modules/actions/transitions.test.ts` checks every one of the 72 cells (6 × 6 states × 2 relations) against the table above, both terminal states, role independence, the moves offered to each party, and that a duplicate or self-loop rule is rejected. `actions.test.ts` covers approval, send-back, history, delegation and the open-delegation guard through the real routes. Changing a cell means changing that test in the same review.

## Sign-off

- [ ] Aditya accepts the matrix, or marks the cells to change
- [ ] Design choices 1–5 confirmed or amended
- [x] Wired through the `ORBIT_LIVE_SOURCES` flag (`transitions`)
- [ ] Aditya confirms the approval step and delegation rules above
