import { z } from 'zod';
import type { AssigneeDirectory } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres AssigneeDirectory (ADR 0011 §6). orbit.permitted_assignees() applies
 * the rules (same organization, not the caller, every scope inside the
 * caller's, covering the action's entity); this selects only the columns
 * PermittedAssigneeSchema allows, so the membership id never leaves the
 * database here. The actions route still re-checks containment.
 */

export const PERMITTED_ASSIGNEES_SQL = `
select pa.assignee_handle::text as "assigneeId", pa.role_id as "role", pa.scopes as "scopes"
from orbit.permitted_assignees($1, $2, $3::uuid) pa
order by pa.role_id, pa.assignee_handle`;

const EntityIdSchema = z.uuid();

export function createDbAssigneeDirectory(db: Database): AssigneeDirectory {
  return {
    async permitted(membership, target) {
      // A non-uuid id names nothing in the database; no candidates rather than a cast error.
      if (!EntityIdSchema.safeParse(target.entity.entityId).success) return [];
      return withMembershipTx(db, membership, (tx) =>
        tx.query(PERMITTED_ASSIGNEES_SQL, [target.assignmentId, target.entity.grain, target.entity.entityId]),
      );
    },
  };
}
