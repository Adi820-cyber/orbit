import type { AuditStore } from '../modules/ports.ts';
import { INSERT_AUDIT_SQL } from './actions.ts';
import type { Database } from './client.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres AuditStore (migration 20260924000700). Inserts are attributed from
 * the verified claims, never from the draft. Reads are filtered by the
 * audit_events select policy to events about actions the caller created or is
 * assigned (ADR 0011 §7); the audit route re-checks that every row is one.
 */

export const LIST_AUDIT_SQL = `
select
  e.id::text as "eventId",
  to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt",
  e.kind as "kind",
  e.actor_role as "actorRole",
  case when e.target_type is null then null
       else jsonb_build_object('type', e.target_type, 'id', e.target_id) end as "target",
  e.outcome as "outcome",
  e.request_id as "requestId",
  e.occurred_at as "sortAt"
from orbit.audit_events e
where ($1::timestamptz is null or (e.occurred_at, e.id) < ($1::timestamptz, $2::uuid))
order by e.occurred_at desc, e.id desc
limit $3`;

export function createDbAuditStore(db: Database): AuditStore {
  return {
    async record(membership, event) {
      await withMembershipTx(db, membership, (tx) =>
        tx.query(INSERT_AUDIT_SQL, [
          event.kind,
          event.target?.type ?? null,
          event.target?.id ?? null,
          event.outcome,
          event.requestId,
        ]),
      );
    },

    async list(membership, page) {
      const after = decodeCursor(page.cursor);
      return withMembershipTx(db, membership, async (tx) => {
        const rows = await tx.query(LIST_AUDIT_SQL, [after?.at ?? null, after?.id ?? null, page.limit + 1]);
        const pageRows = rows.slice(0, page.limit);
        const last = pageRows.at(-1);
        return {
          items: pageRows.map(({ sortAt: _sortAt, ...event }) => event),
          nextCursor: rows.length > page.limit && last ? encodeCursor(last['sortAt'], last['eventId']) : null,
        };
      });
    },
  };
}
