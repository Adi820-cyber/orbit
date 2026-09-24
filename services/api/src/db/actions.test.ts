import { describe, expect, it } from 'vitest';
import { ActionSchema, AuditEventSchema, type MembershipClaims } from '@orbit/contracts';
import type { AuditDraft, NewAction } from '../modules/ports.ts';
import {
  createDbActionStore,
  FIND_BY_KEY_SQL,
  INSERT_ACTION_SQL,
  INSERT_AUDIT_SQL,
  INSERT_EVENT_SQL,
  LIST_ACTIONS_SQL,
  LOCK_ACTION_SQL,
  SELECT_ACTION_SQL,
  UPDATE_ACTION_SQL,
} from './actions.ts';
import { createDbAssigneeDirectory, PERMITTED_ASSIGNEES_SQL } from './assignees.ts';
import { createDbAuditStore, LIST_AUDIT_SQL } from './audit.ts';
import type { Database, SqlParam } from './client.ts';
import { encodeCursor } from './cursor.ts';
import { MEMBERSHIP_SETTING } from './rls.ts';

/* Placeholder uuids only. */
const ACTION_ID = '00000000-0000-4000-8000-00000000ac01';
const HANDLE = '00000000-0000-4000-8000-00000000ha01';
const claims: MembershipClaims = {
  membershipId: '00000000-0000-4000-8000-0000000000d1',
  subject: '00000000-0000-4000-8000-0000000000c1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  role: 'regional-coo',
  scopes: [{ grain: 'region', entityId: '00000000-0000-4000-8000-0000000000b1' }],
};

const actionRow = {
  actionId: ACTION_ID,
  state: 'open',
  version: 1,
  title: 'Review capacity',
  assignmentId: 'regional-coo:hospital-and-clinic-capacity-utilisation',
  entity: { grain: 'facility', entityId: '00000000-0000-4000-8000-0000000000f1' },
  evidence: { observationIds: ['obs-1'], definitionVersion: 'v1', datasetChecksum: 'c' },
  creatorRole: 'regional-coo',
  assignee: { assigneeId: HANDLE, role: 'hospital-dho' },
  dueDate: '2026-10-01',
  createdAt: '2026-09-24T06:00:00.000Z',
  updatedAt: '2026-09-24T06:00:00.000Z',
};

const newAction: NewAction = {
  idempotencyKey: '30000000-0000-4000-8000-000000000001',
  title: actionRow.title,
  assignmentId: actionRow.assignmentId,
  entity: actionRow.entity as NewAction['entity'],
  evidence: actionRow.evidence,
  assigneeId: HANDLE,
  dueDate: actionRow.dueDate,
};
const audit: AuditDraft = { kind: 'action_created', target: { type: 'assignment', id: 'x' }, outcome: 'open', requestId: 'req-1' };

type Answer = readonly Record<string, unknown>[];

/** Answers each statement from `script` by SQL text; records every call. */
function scriptedDb(script: (text: string, params: SqlParam[]) => Answer) {
  const calls: { text: string; params: SqlParam[] }[] = [];
  const db: Database = {
    async transaction(fn) {
      return fn({
        async query(text, params = []) {
          calls.push({ text, params });
          return text.startsWith('select set_config') ? [] : script(text, params);
        },
      });
    },
  };
  return { db, calls, texts: () => calls.map((call) => call.text) };
}

describe('ActionStore.create', () => {
  it('inserts, records the open event and the audit row targeting the action, in one transaction', async () => {
    const { db, calls, texts } = scriptedDb((text) =>
      text === FIND_BY_KEY_SQL ? [] : text === INSERT_ACTION_SQL ? [{ id: ACTION_ID }] : text === SELECT_ACTION_SQL ? [{ ...actionRow, relation: 'creator' }] : [],
    );
    const result = await createDbActionStore(db).create(claims, newAction, audit);
    expect(result.replayed).toBe(false);
    expect(ActionSchema.safeParse(result.action).success).toBe(true);
    expect(texts()).toEqual(['select set_config($1, $2, true)', FIND_BY_KEY_SQL, INSERT_ACTION_SQL, INSERT_EVENT_SQL, INSERT_AUDIT_SQL, SELECT_ACTION_SQL]);
    expect(calls[0]?.params[0]).toBe(MEMBERSHIP_SETTING);
    expect(calls.find((call) => call.text === INSERT_AUDIT_SQL)?.params).toEqual(['action_created', 'action', ACTION_ID, 'open', 'req-1']);
  });

  it('returns the original action for a retried idempotency key without writing', async () => {
    const { db, texts } = scriptedDb((text) => (text === FIND_BY_KEY_SQL ? [actionRow] : []));
    expect(await createDbActionStore(db).create(claims, newAction, audit)).toEqual({ action: actionRow, replayed: true });
    expect(texts()).not.toContain(INSERT_ACTION_SQL);
  });

  it('refuses when the database does not offer that assignee (ADR 0011 §6)', async () => {
    const { db, texts } = scriptedDb(() => []);
    await expect(createDbActionStore(db).create(claims, newAction, audit)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(texts()).not.toContain(INSERT_EVENT_SQL);
  });

  it('only inserts through orbit.permitted_assignees, with no self-assignment possible', () => {
    expect(INSERT_ACTION_SQL).toContain('from orbit.permitted_assignees($3, $4, $5::uuid) pa');
    expect(INSERT_ACTION_SQL).toContain('on conflict (creator_membership_id, idempotency_key) do nothing');
  });
});

describe('ActionStore.get and transition', () => {
  it('returns null for a non-uuid id without querying', async () => {
    const { db, calls } = scriptedDb(() => []);
    expect(await createDbActionStore(db).get(claims, 'not-a-uuid')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('splits the relation off the action row', async () => {
    const { db } = scriptedDb(() => [{ ...actionRow, relation: 'assignee' }]);
    expect(await createDbActionStore(db).get(claims, ACTION_ID)).toEqual({ action: actionRow, relation: 'assignee' });
  });

  it.each([
    ['not_found', [] as Answer],
    ['stale', [{ state: 'open', version: 2 }]],
  ])('answers %s without writing', async (status, locked) => {
    const { db, texts } = scriptedDb((text) => (text === LOCK_ACTION_SQL ? locked : []));
    const result = await createDbActionStore(db).transition(claims, { actionId: ACTION_ID, expectedVersion: 1, toState: 'acknowledged', reason: 'r' }, audit);
    expect(result).toEqual({ status });
    expect(texts()).not.toContain(UPDATE_ACTION_SQL);
  });

  it('locks, compares the version, then writes the event and audit rows', async () => {
    const { db, texts, calls } = scriptedDb((text) =>
      text === LOCK_ACTION_SQL ? [{ state: 'open', version: 1 }] : text === UPDATE_ACTION_SQL ? [{ id: ACTION_ID }] : text === SELECT_ACTION_SQL ? [{ ...actionRow, state: 'acknowledged', version: 2, relation: 'assignee' }] : [],
    );
    const result = await createDbActionStore(db).transition(
      claims,
      { actionId: ACTION_ID, expectedVersion: 1, toState: 'acknowledged', reason: 'seen' },
      { kind: 'action_transitioned', target: { type: 'action', id: ACTION_ID }, outcome: 'acknowledged', requestId: 'req-2' },
    );
    expect(result).toMatchObject({ status: 'ok', action: { state: 'acknowledged', version: 2 } });
    expect(texts().slice(1)).toEqual([LOCK_ACTION_SQL, UPDATE_ACTION_SQL, INSERT_EVENT_SQL, INSERT_AUDIT_SQL, SELECT_ACTION_SQL]);
    expect(calls.find((call) => call.text === INSERT_EVENT_SQL)?.params).toEqual([ACTION_ID, 'open', 'acknowledged', 'seen']);
  });
});

describe('ActionStore.list and AuditStore.list pagination', () => {
  it('fetches one extra row to know whether a next page exists', async () => {
    const rows = [1, 2, 3].map((n) => ({ ...actionRow, actionId: `00000000-0000-4000-8000-00000000ac0${n}`, sortAt: new Date(Date.UTC(2026, 8, 24, 6, 0, n)) }));
    const { db, calls } = scriptedDb(() => rows);
    const page = await createDbActionStore(db).list(claims, { limit: 2 });
    expect(calls[1]).toMatchObject({ text: LIST_ACTIONS_SQL, params: [null, null, 3] });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).not.toHaveProperty('sortAt');
    expect(page.nextCursor).toBe(encodeCursor(rows[1]?.sortAt, rows[1]?.actionId));
  });

  it('continues from a cursor, and rejects a malformed one', async () => {
    const cursor = encodeCursor('2026-09-24T06:00:00.000Z', ACTION_ID);
    const { db, calls } = scriptedDb(() => []);
    await createDbAuditStore(db).list(claims, { limit: 25, cursor });
    expect(calls[1]).toMatchObject({ text: LIST_AUDIT_SQL, params: ['2026-09-24T06:00:00.000Z', ACTION_ID, 26] });
    await expect(createDbAuditStore(db).list(claims, { limit: 25, cursor: 'garbage' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('shapes audit rows as AuditEvent', async () => {
    const row = { eventId: ACTION_ID, occurredAt: '2026-09-24T06:00:00.000Z', kind: 'action_created', actorRole: 'regional-coo', target: { type: 'action', id: ACTION_ID }, outcome: 'open', requestId: 'r', sortAt: new Date() };
    const { db } = scriptedDb(() => [row]);
    const [event] = (await createDbAuditStore(db).list(claims, { limit: 25 })).items;
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
  });
});

describe('AuditStore.record', () => {
  it('attributes the event from the claims in SQL, not from the draft', async () => {
    const { db, calls } = scriptedDb(() => []);
    await createDbAuditStore(db).record(claims, { kind: 'access_denied', target: { type: 'route', id: '/api/kpi' }, outcome: 'out_of_scope', requestId: 'r' });
    expect(calls[1]).toMatchObject({ text: INSERT_AUDIT_SQL, params: ['access_denied', 'route', '/api/kpi', 'out_of_scope', 'r'] });
    expect(INSERT_AUDIT_SQL).toContain('orbit.current_membership_id()');
  });
});

describe('AssigneeDirectory', () => {
  it('selects only handle, role and scopes from the permitted_assignees function', async () => {
    const { db, calls } = scriptedDb(() => []);
    await createDbAssigneeDirectory(db).permitted(claims, { assignmentId: 'a', entity: { grain: 'facility', entityId: actionRow.entity.entityId } });
    expect(calls[1]).toMatchObject({ text: PERMITTED_ASSIGNEES_SQL, params: ['a', 'facility', actionRow.entity.entityId] });
    expect(PERMITTED_ASSIGNEES_SQL).not.toContain('membership_id');
  });

  it('offers nobody for a non-uuid entity, without querying', async () => {
    const { db, calls } = scriptedDb(() => []);
    expect(await createDbAssigneeDirectory(db).permitted(claims, { assignmentId: 'a', entity: { grain: 'facility', entityId: 'x' } })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
