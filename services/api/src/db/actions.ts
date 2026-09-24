import { z } from 'zod';
import type { MembershipClaims, PageQuery } from '@orbit/contracts';
import { ApiError } from '../plugins/errors.ts';
import type { ActionStore, AuditDraft, NewAction, TransitionResult } from '../modules/ports.ts';
import type { Database, Tx } from './client.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres ActionStore (migration 20260924000700). Every statement runs under
 * the caller's membership claims, so RLS decides visibility; the SQL also
 * filters on the claims as defense in depth. Rows are aliased onto the
 * ActionSchema keys and the actions route parses them, so a drift fails closed.
 *
 * Each write commits the action, its action_events row, and its audit_events
 * row in one transaction (ARCHITECTURE.md §10).
 */

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** Columns aliased to ActionSchema. `assigneeId` is the opaque handle, never a membership id. */
export const ACTION_COLUMNS = `
  a.id::text as "actionId",
  a.state as "state",
  a.version as "version",
  a.title as "title",
  a.assignment_id as "assignmentId",
  jsonb_build_object('grain', a.entity_grain, 'entityId', a.entity_id::text) as "entity",
  a.evidence as "evidence",
  a.creator_role as "creatorRole",
  jsonb_build_object('assigneeId', a.assignee_handle::text, 'role', a.assignee_role) as "assignee",
  to_char(a.due_date, 'YYYY-MM-DD') as "dueDate",
  to_char(a.created_at at time zone 'UTC', ${ISO_UTC}) as "createdAt",
  to_char(a.updated_at at time zone 'UTC', ${ISO_UTC}) as "updatedAt"`;

export const FIND_BY_KEY_SQL = `
select ${ACTION_COLUMNS}
from orbit.actions a
where a.creator_membership_id = orbit.current_membership_id() and a.idempotency_key = $1::uuid`;

/**
 * Inserts only when the assignee handle is one orbit.permitted_assignees()
 * offers for this target (ADR 0011 §6), so the assignee rule is enforced in
 * the same statement that writes. A retried key inserts nothing.
 */
export const INSERT_ACTION_SQL = `
insert into orbit.actions (
  organization_id, creator_membership_id, creator_role,
  assignee_membership_id, assignee_handle, assignee_role,
  idempotency_key, title, assignment_id, entity_grain, entity_id, evidence, due_date
)
select orbit.current_org(), orbit.current_membership_id(), orbit.current_role_id(),
       pa.membership_id, pa.assignee_handle, pa.role_id,
       $1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7::date
from orbit.permitted_assignees($3, $4, $5::uuid) pa
where pa.assignee_handle = $8::uuid
on conflict (creator_membership_id, idempotency_key) do nothing
returning id`;

export const SELECT_ACTION_SQL = `
select ${ACTION_COLUMNS},
       case when a.creator_membership_id = orbit.current_membership_id() then 'creator' else 'assignee' end as "relation"
from orbit.actions a
where a.id = $1::uuid`;

export const LOCK_ACTION_SQL = `select a.state as "state", a.version as "version" from orbit.actions a where a.id = $1::uuid for update`;

export const UPDATE_ACTION_SQL = `
update orbit.actions
set state = $2, version = version + 1, updated_at = now()
where id = $1::uuid and version = $3
returning id`;

export const INSERT_EVENT_SQL = `
insert into orbit.action_events (action_id, organization_id, actor_membership_id, from_state, to_state, reason)
values ($1::uuid, orbit.current_org(), orbit.current_membership_id(), $2, $3, $4)`;

export const INSERT_AUDIT_SQL = `
insert into orbit.audit_events (organization_id, actor_membership_id, actor_role, kind, target_type, target_id, outcome, request_id)
values (orbit.current_org(), orbit.current_membership_id(), orbit.current_role_id(), $1, $2, $3, $4, $5)`;

export const LIST_ACTIONS_SQL = `
select ${ACTION_COLUMNS}, a.created_at as "sortAt"
from orbit.actions a
where orbit.current_membership_id() in (a.creator_membership_id, a.assignee_membership_id)
  and ($1::timestamptz is null or (a.created_at, a.id) < ($1::timestamptz, $2::uuid))
order by a.created_at desc, a.id desc
limit $3`;

const IdSchema = z.uuid();
const LockedSchema = z.strictObject({ state: z.string(), version: z.number().int() });

function auditParams(draft: AuditDraft, target: AuditDraft['target']) {
  return [draft.kind, target?.type ?? null, target?.id ?? null, draft.outcome, draft.requestId];
}

async function selectAction(tx: Tx, actionId: string) {
  const [row] = await tx.query(SELECT_ACTION_SQL, [actionId]);
  return row;
}

export function createDbActionStore(db: Database): ActionStore {
  return {
    create(membership: MembershipClaims, action: NewAction, audit: AuditDraft) {
      return withMembershipTx(db, membership, async (tx) => {
        const [existing] = await tx.query(FIND_BY_KEY_SQL, [action.idempotencyKey]);
        if (existing) {
          return { action: existing, replayed: true };
        }

        const inserted = await tx.query(INSERT_ACTION_SQL, [
          action.idempotencyKey,
          action.title,
          action.assignmentId,
          action.entity.grain,
          action.entity.entityId,
          JSON.stringify(action.evidence),
          action.dueDate,
          action.assigneeId,
        ]);
        const id = inserted[0]?.['id'];
        if (typeof id !== 'string') {
          // Either a concurrent retry won the unique key, or the assignee is not permitted.
          const [raced] = await tx.query(FIND_BY_KEY_SQL, [action.idempotencyKey]);
          if (raced) return { action: raced, replayed: true };
          throw new ApiError('invalid_request', 'The selected assignee cannot be assigned this action.', 'assignee_not_permitted_in_db');
        }

        await tx.query(INSERT_EVENT_SQL, [id, null, 'open', 'created']);
        // Targets the action itself, so the audit select policy can match it (ADR 0011 §7).
        await tx.query(INSERT_AUDIT_SQL, auditParams(audit, { type: 'action', id }));
        const created = await selectAction(tx, id);
        if (!created) throw new ApiError('internal', 'An internal error occurred.', 'created_action_not_visible');
        const { relation: _relation, ...createdAction } = created;
        return { action: createdAction, replayed: false };
      });
    },

    async get(membership, actionId) {
      if (!IdSchema.safeParse(actionId).success) return null;
      return withMembershipTx(db, membership, async (tx) => {
        const row = await selectAction(tx, actionId);
        if (!row) return null;
        const { relation, ...action } = row;
        if (relation !== 'creator' && relation !== 'assignee') return null;
        return { action, relation };
      });
    },

    async transition(membership, change, audit): Promise<TransitionResult> {
      if (!IdSchema.safeParse(change.actionId).success) return { status: 'not_found' };
      return withMembershipTx(db, membership, async (tx) => {
        const [lockedRow] = await tx.query(LOCK_ACTION_SQL, [change.actionId]);
        if (!lockedRow) return { status: 'not_found' };
        const locked = LockedSchema.parse(lockedRow);
        if (locked.version !== change.expectedVersion) return { status: 'stale' };

        const updated = await tx.query(UPDATE_ACTION_SQL, [change.actionId, change.toState, change.expectedVersion]);
        if (updated.length !== 1) return { status: 'stale' };

        await tx.query(INSERT_EVENT_SQL, [change.actionId, locked.state, change.toState, change.reason]);
        await tx.query(INSERT_AUDIT_SQL, auditParams(audit, audit.target));
        const row = await selectAction(tx, change.actionId);
        if (!row) return { status: 'not_found' };
        const { relation: _relation, ...action } = row;
        return { status: 'ok', action };
      });
    },

    async list(membership, page: PageQuery) {
      const after = decodeCursor(page.cursor);
      return withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(LIST_ACTIONS_SQL, [after?.at ?? null, after?.id ?? null, page.limit + 1]);
        const pageRows = rows.slice(0, page.limit);
        const last = pageRows.at(-1);
        return {
          items: pageRows.map(({ sortAt: _sortAt, ...action }) => action),
          nextCursor: rows.length > page.limit && last ? encodeCursor(last['sortAt'], last['actionId']) : null,
        };
      });
    },
  };
}
