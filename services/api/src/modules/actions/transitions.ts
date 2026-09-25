import type { ActionState } from '@orbit/contracts';
import type { ActionRelation, TransitionDecision, TransitionPolicy } from '../ports.ts';

/**
 * One allowed move: from `from` to `to`, by whoever holds `by` relative to the
 * action. Relations, not roles: any role that created or was assigned an
 * action gets the same lifecycle (ARCH §8.1, no role hierarchy).
 */
export interface TransitionRule {
  from: ActionState;
  to: ActionState;
  by: ActionRelation;
}

/**
 * PROPOSED v2 — not signed off. Drafted by Ghansham for Aditya (ARCH §17 item
 * 3); rationale is in services/api/TRANSITIONS.md.
 *
 * Derived from PRD FR-06 ("record acknowledgment, progress, completion, or
 * cancellation") plus the product owner's request for an approval step: the
 * assignee moves the work forward and submits it; the creator approves it,
 * sends it back, or withdraws it. `completed` / `cancelled` are terminal.
 */
export const PROPOSED_TRANSITIONS: readonly TransitionRule[] = [
  { from: 'open', to: 'acknowledged', by: 'assignee' },
  { from: 'acknowledged', to: 'in_progress', by: 'assignee' },
  { from: 'in_progress', to: 'submitted', by: 'assignee' },
  { from: 'submitted', to: 'completed', by: 'creator' },
  { from: 'submitted', to: 'in_progress', by: 'creator' },
  { from: 'open', to: 'cancelled', by: 'creator' },
  { from: 'acknowledged', to: 'cancelled', by: 'creator' },
  { from: 'in_progress', to: 'cancelled', by: 'creator' },
  { from: 'submitted', to: 'cancelled', by: 'creator' },
];

/**
 * A `TransitionPolicy` over a fixed matrix. A move that some relation may make
 * is `not_permitted` for the other relation; a move nobody may make is
 * `invalid_transition`. Duplicate or self-loop rules are rejected up front so a
 * typo cannot quietly widen the matrix.
 */
export function createMatrixTransitionPolicy(rules: readonly TransitionRule[]): TransitionPolicy {
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = `${rule.from}>${rule.to}>${rule.by}`;
    if (rule.from === rule.to || seen.has(key)) {
      throw new Error(`Invalid transition rule: ${key}`);
    }
    seen.add(key);
  }

  return {
    async moves({ relation, from }): Promise<ActionState[]> {
      return rules.filter((rule) => rule.from === from && rule.by === relation).map((rule) => rule.to);
    },
    async decide({ relation, from, to }): Promise<TransitionDecision> {
      const matching = rules.filter((rule) => rule.from === from && rule.to === to);
      if (matching.some((rule) => rule.by === relation)) {
        return 'allowed';
      }
      return matching.length > 0 ? 'not_permitted' : 'invalid_transition';
    },
  };
}
