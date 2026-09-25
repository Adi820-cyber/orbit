import { describe, expect, it } from 'vitest';
import { ActionStateSchema, type ActionState } from '@orbit/contracts';
import type { ActionRelation } from '../ports.ts';
import { createMatrixTransitionPolicy, PROPOSED_TRANSITIONS } from './transitions.ts';

const policy = createMatrixTransitionPolicy(PROPOSED_TRANSITIONS);
const STATES = ActionStateSchema.options;
const RELATIONS: ActionRelation[] = ['creator', 'assignee'];

/** The proposed matrix written out as a table, so a reviewer can read every cell. */
const EXPECTED: Record<string, 'allowed' | 'not_permitted' | 'invalid_transition'> = {
  'open>acknowledged>assignee': 'allowed',
  'open>acknowledged>creator': 'not_permitted',
  'acknowledged>in_progress>assignee': 'allowed',
  'acknowledged>in_progress>creator': 'not_permitted',
  'in_progress>submitted>assignee': 'allowed',
  'in_progress>submitted>creator': 'not_permitted',
  'submitted>completed>creator': 'allowed',
  'submitted>completed>assignee': 'not_permitted',
  'submitted>in_progress>creator': 'allowed',
  'submitted>in_progress>assignee': 'not_permitted',
  'open>cancelled>creator': 'allowed',
  'open>cancelled>assignee': 'not_permitted',
  'acknowledged>cancelled>creator': 'allowed',
  'acknowledged>cancelled>assignee': 'not_permitted',
  'in_progress>cancelled>creator': 'allowed',
  'in_progress>cancelled>assignee': 'not_permitted',
  'submitted>cancelled>creator': 'allowed',
  'submitted>cancelled>assignee': 'not_permitted',
};

describe('proposed action transition matrix', () => {
  const cells = STATES.flatMap((from) => STATES.flatMap((to) => RELATIONS.map((by) => [from, to, by] as const)));

  it.each(cells)('%s -> %s by %s', async (from, to, relation) => {
    const decision = await policy.decide({ role: 'regional-coo', relation, from, to });
    expect(decision).toBe(EXPECTED[`${from}>${to}>${relation}`] ?? 'invalid_transition');
  });

  it.each(['completed', 'cancelled'] as ActionState[])('treats %s as terminal', async (from) => {
    for (const to of STATES) {
      for (const relation of RELATIONS) {
        expect(await policy.decide({ role: 'chairman', relation, from, to })).toBe('invalid_transition');
      }
    }
  });

  it('gives every role the same lifecycle (no role hierarchy)', async () => {
    const input = { relation: 'assignee', from: 'open', to: 'acknowledged' } as const;
    expect(await policy.decide({ ...input, role: 'chairman' })).toBe(await policy.decide({ ...input, role: 'hospital-dho' }));
  });

  it('lists exactly the moves each party may make, for the UI to offer', async () => {
    expect(await policy.moves({ role: 'hospital-dho', relation: 'assignee', from: 'in_progress' })).toEqual(['submitted']);
    expect(await policy.moves({ role: 'regional-coo', relation: 'creator', from: 'submitted' })).toEqual(['completed', 'in_progress', 'cancelled']);
    expect(await policy.moves({ role: 'regional-coo', relation: 'creator', from: 'completed' })).toEqual([]);
  });

  it('rejects a duplicate or self-loop rule instead of silently accepting it', () => {
    const [first] = PROPOSED_TRANSITIONS;
    if (!first) throw new Error('matrix is empty');
    expect(() => createMatrixTransitionPolicy([...PROPOSED_TRANSITIONS, first])).toThrow();
    expect(() => createMatrixTransitionPolicy([{ from: 'open', to: 'open', by: 'creator' }])).toThrow();
  });
});
