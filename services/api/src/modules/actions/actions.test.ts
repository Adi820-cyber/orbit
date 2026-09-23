import { afterEach, describe, expect, it } from 'vitest';
import {
  ActionListResponseSchema,
  ActionResponseSchema,
  AuditListResponseSchema,
  ErrorEnvelopeSchema,
  PermittedAssigneesResponseSchema,
} from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import {
  buildModuleApp,
  CAPACITY,
  CHECKSUM,
  DHO_ASSIGNEE_ID,
  DHO_SUBJECT,
  FACILITY_A1,
  REGION_A,
  REGION_B,
  REVENUE,
} from '../../../test/helpers/modules.ts';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const built = await buildModuleApp();
  close = () => built.app.close();
  return built;
}

const createBody = {
  idempotencyKey: '30000000-0000-4000-8000-000000000001',
  title: 'Review the capacity exception',
  assignmentId: CAPACITY,
  entity: FACILITY_A1,
  evidence: { observationIds: ['obs-cap-a1-jan'], definitionVersion: 'v1', datasetChecksum: CHECKSUM },
  assigneeId: DHO_ASSIGNEE_ID,
  dueDate: '2026-02-15',
};

function errorCode(body: string) {
  return ErrorEnvelopeSchema.parse(JSON.parse(body)).error.code;
}

describe('GET /api/actions/assignees', () => {
  it('lists permitted assignees for in-scope evidence', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', `/api/actions/assignees?assignmentId=${encodeURIComponent(CAPACITY)}&grain=facility&entityId=fixture-facility-a1`);
    expect(PermittedAssigneesResponseSchema.parse(response.json()).assignees.map((row) => row.assigneeId)).toEqual([DHO_ASSIGNEE_ID]);
  });

  it('refuses the other region', async () => {
    const { call } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'GET', `/api/actions/assignees?assignmentId=${encodeURIComponent(CAPACITY)}&grain=region&entityId=fixture-region-b`);
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/actions', () => {
  it('creates an open action at version 1 and writes exactly one audit event', async () => {
    const { call, fixture } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody);
    expect(response.statusCode).toBe(201);
    const { action, replayed } = ActionResponseSchema.parse(response.json());
    expect(replayed).toBe(false);
    expect(action).toMatchObject({ state: 'open', version: 1, creatorRole: 'regional-coo', assignee: { role: 'hospital-dho' } });
    expect(fixture.auditEvents.map((event) => event.kind)).toEqual(['action_created']);
  });

  it('returns the original action for a retried create instead of a duplicate', async () => {
    const { call, fixture } = await setup();
    const first = ActionResponseSchema.parse((await call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody)).json());
    const retry = await call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody);
    expect(retry.statusCode).toBe(200);
    expect(ActionResponseSchema.parse(retry.json())).toEqual({ action: first.action, replayed: true });
    expect(fixture.actions).toHaveLength(1);
    expect(fixture.auditEvents).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a different action', async () => {
    const { call } = await setup();
    await call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody);
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/actions', { ...createBody, title: 'Something else' });
    expect(response.statusCode).toBe(409);
  });

  it.each([
    ['an out-of-scope entity', { entity: REGION_B }, 403, 'out_of_scope'],
    ['evidence from an older dataset', { evidence: { ...createBody.evidence, datasetChecksum: 'old' } }, 409, 'conflict'],
    ['unknown evidence', { evidence: { ...createBody.evidence, observationIds: ['nope'] } }, 400, 'invalid_request'],
    ['evidence from another assignment', { assignmentId: REVENUE, entity: REGION_A }, 400, 'invalid_request'],
    ['an assignment the role holds at a grain it does not', { assignmentId: REVENUE }, 403, 'out_of_scope'],
    ['evidence from another region', { evidence: { ...createBody.evidence, observationIds: ['obs-cap-b-jan'] } }, 403, 'out_of_scope'],
    ['an assignee who may not see the evidence', { assigneeId: 'someone-else' }, 400, 'invalid_request'],
    ['a missing idempotency key', { idempotencyKey: undefined }, 400, 'invalid_request'],
  ])('refuses %s and records nothing', async (_label, change, status, code) => {
    const { call, fixture } = await setup();
    const response = await call(SUBJECT.cooRegionA, 'POST', '/api/actions', { ...createBody, ...change });
    expect(response.statusCode).toBe(status);
    expect(errorCode(response.body)).toBe(code);
    expect(fixture.actions).toHaveLength(0);
    expect(fixture.auditEvents.filter((event) => event.kind === 'action_created')).toHaveLength(0);
  });
});

describe('POST /api/actions/:actionId/transitions', () => {
  async function created() {
    const built = await setup();
    const { action } = ActionResponseSchema.parse((await built.call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody)).json());
    const transition = (subject: string, payload: object) =>
      built.call(subject, 'POST', `/api/actions/${action.actionId}/transitions`, payload);
    return { ...built, action, transition };
  }

  it('lets the assignee acknowledge, bumping the version and auditing once', async () => {
    const { transition, fixture } = await created();
    const response = await transition(DHO_SUBJECT, { toState: 'acknowledged', expectedVersion: 1, reason: 'Seen' });
    expect(response.statusCode).toBe(200);
    expect(ActionResponseSchema.parse(response.json()).action).toMatchObject({ state: 'acknowledged', version: 2 });
    expect(fixture.auditEvents.map((event) => [event.kind, event.outcome])).toEqual([
      ['action_created', 'open'],
      ['action_transitioned', 'acknowledged'],
    ]);
  });

  it('rejects a stale version', async () => {
    const { transition } = await created();
    await transition(DHO_SUBJECT, { toState: 'acknowledged', expectedVersion: 1, reason: 'Seen' });
    const response = await transition(DHO_SUBJECT, { toState: 'in_progress', expectedVersion: 1, reason: 'Working' });
    expect(response.statusCode).toBe(409);
  });

  it('lets exactly one of two concurrent updates win', async () => {
    const { transition, fixture } = await created();
    const results = await Promise.all([
      transition(DHO_SUBJECT, { toState: 'acknowledged', expectedVersion: 1, reason: 'A' }),
      transition(DHO_SUBJECT, { toState: 'acknowledged', expectedVersion: 1, reason: 'B' }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(fixture.auditEvents.filter((event) => event.kind === 'action_transitioned')).toHaveLength(1);
  });

  it('rejects a transition the policy does not allow from the current state', async () => {
    const { transition } = await created();
    const response = await transition(DHO_SUBJECT, { toState: 'completed', expectedVersion: 1, reason: 'Done' });
    expect(response.statusCode).toBe(409);
  });

  it('forbids a transition reserved for the other party', async () => {
    const { transition } = await created();
    const response = await transition(SUBJECT.cooRegionA, { toState: 'acknowledged', expectedVersion: 1, reason: 'Seen' });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('forbidden');
  });

  it('hides the action from someone who is neither creator nor assignee', async () => {
    const { transition, call, action } = await created();
    expect((await transition(SUBJECT.cooRegionB, { toState: 'cancelled', expectedVersion: 1, reason: 'x' })).statusCode).toBe(404);
    expect((await call(SUBJECT.cooRegionB, 'GET', `/api/actions/${action.actionId}`)).statusCode).toBe(404);
  });

  it('lists the action for its creator and assignee only', async () => {
    const { call } = await created();
    const count = async (subject: string) =>
      ActionListResponseSchema.parse((await call(subject, 'GET', '/api/actions')).json()).items.length;
    expect(await count(SUBJECT.cooRegionA)).toBe(1);
    expect(await count(DHO_SUBJECT)).toBe(1);
    expect(await count(SUBJECT.cooRegionB)).toBe(0);
  });
});

describe('GET /api/audit', () => {
  it('is readable by a role the audit policy grants', async () => {
    const { call } = await setup();
    await call(SUBJECT.cooRegionA, 'POST', '/api/actions', createBody);
    const body = AuditListResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/audit')).json());
    expect(body.items.map((event) => event.kind)).toEqual(['action_created']);
  });

  it('is refused as out_of_scope for a role without audit access, and the denial is audited', async () => {
    const { call, fixture } = await setup();
    const response = await call(DHO_SUBJECT, 'GET', '/api/audit');
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.body)).toBe('out_of_scope');
    expect(fixture.auditEvents.map((event) => [event.kind, event.actorRole, event.target?.id])).toEqual([
      ['access_denied', 'hospital-dho', '/api/audit'],
    ]);
  });

  it('does not let an anonymous caller write audit rows', async () => {
    const { app, fixture } = await setup();
    await app.inject({ method: 'GET', url: '/api/audit' });
    expect(fixture.auditEvents).toHaveLength(0);
  });
});
