import type { FastifyInstance } from 'fastify';
import type {
  Action,
  ActionState,
  AuditEvent,
  Entitlement,
  Exception,
  Membership,
  MembershipClaims,
  Observation,
  Period,
  ScopeEntity,
} from '@orbit/contracts';
import { buildApp } from '../../src/build.ts';
import { ILLUSTRATIVE_DISCLOSURE, type ModuleDeps } from '../../src/modules/index.ts';
import type { ActionRelation, AuditDraft, NewAction, TransitionDecision } from '../../src/modules/ports.ts';
import { fixtureMemberships, fixtureResolver, MEMBERSHIPS, ORG_A } from './fixtures.ts';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from './tokens.ts';

/*
 * In-memory stand-ins for the module ports. Assignment ids are real
 * kpi-framework ids (the API joins on them); entities, values, scenarios, and
 * the transition policy are placeholders that exist only to exercise the API,
 * not proposals for Maruti's data or Aditya's matrix.
 */

export const CAPACITY = 'regional-coo:hospital-and-clinic-capacity-utilisation';
export const REVENUE = 'regional-coo:regional-net-revenue-vs-approved-budget';
export const DHO_CAPACITY = 'hospital-dho:capacity-utilisation-and-patient-throughput';

export const REGION_A: ScopeEntity = { grain: 'region', entityId: 'fixture-region-a' };
export const REGION_B: ScopeEntity = { grain: 'region', entityId: 'fixture-region-b' };
export const FACILITY_A1: ScopeEntity = { grain: 'facility', entityId: 'fixture-facility-a1' };
export const FACILITY_A2: ScopeEntity = { grain: 'facility', entityId: 'fixture-facility-a2' };

export const JAN: Period = { cadence: 'month', start: '2026-01-01', end: '2026-01-31' };
export const DEC: Period = { cadence: 'month', start: '2025-12-01', end: '2025-12-31' };
export const NOV: Period = { cadence: 'month', start: '2025-11-01', end: '2025-11-30' };
export const CHECKSUM = 'fixture-dataset-checksum';

export const DHO_SUBJECT = '10000000-0000-4000-8000-000000000006';
const DHO_MEMBERSHIP: Membership = {
  membershipId: '20000000-0000-4000-8000-000000000006',
  subject: DHO_SUBJECT,
  organizationId: ORG_A,
  role: 'hospital-dho',
  scopes: [FACILITY_A1],
  status: 'active',
};
export const DHO_ASSIGNEE_ID = 'fixture-assignee-dho-a1';

export const MODULE_ENTITLEMENTS: Entitlement[] = [
  { role: 'regional-coo', frameworkVersion: 'v1', assignmentId: CAPACITY, grains: ['region', 'facility'], breakdowns: ['facility'] },
  { role: 'regional-coo', frameworkVersion: 'v1', assignmentId: REVENUE, grains: ['region'], breakdowns: [] },
  { role: 'hospital-dho', frameworkVersion: 'v1', assignmentId: DHO_CAPACITY, grains: ['facility'], breakdowns: [] },
];

const quality = {
  state: 'illustrative',
  reconciliation: 'reconciled',
  freshness: 'current',
  refreshedAt: '2026-02-02T06:00:00Z',
  limitations: [],
} as const;

export function observation(
  id: string,
  assignmentId: string,
  entity: ScopeEntity,
  period: Period,
  value: number | null,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    observationId: id,
    assignmentId,
    definitionFamily: 'fixture-family',
    definitionVersion: 'v1',
    entity,
    period,
    unit: 'fixture-unit',
    value: value === null ? { status: 'missing', reason: 'missing_denominator' } : { status: 'available', value },
    components: [
      { componentId: 'num', label: 'Fixture numerator', role: 'numerator', unit: 'count', value: { status: 'available', value: 3 } },
      { componentId: 'den', label: 'Fixture denominator', role: 'denominator', unit: 'count', value: { status: 'available', value: 4 } },
    ],
    target: { state: 'not_configured' },
    provenance: 'illustrative',
    dataQuality: { ...quality, limitations: [] },
    ...overrides,
  };
}

export const OBSERVATIONS: Observation[] = [
  observation('obs-cap-a-nov', CAPACITY, REGION_A, NOV, 1, { definitionVersion: 'v0' }),
  observation('obs-cap-a-dec', CAPACITY, REGION_A, DEC, 2),
  observation('obs-cap-a-jan', CAPACITY, REGION_A, JAN, 5),
  observation('obs-cap-a1-jan', CAPACITY, FACILITY_A1, JAN, 7),
  observation('obs-cap-a2-jan', CAPACITY, FACILITY_A2, JAN, 3),
  observation('obs-cap-b-jan', CAPACITY, REGION_B, JAN, 999),
  observation('obs-rev-a-jan', REVENUE, REGION_A, JAN, null),
];

function exception(id: string, assignmentId: string, entity: ScopeEntity, priority: 'act_now' | 'monitor'): Exception {
  return {
    exceptionId: id,
    assignmentId,
    entity,
    period: JAN,
    priority,
    category: 'performance',
    comparisonBasis: 'prior_period',
    detection: { kind: 'seeded_scenario', scenarioLabel: 'fixture scenario' },
    whatChanged: 'Fixture change.',
    whyItMatters: 'Fixture reason.',
    owner: { role: 'hospital-dho' },
    actionState: 'none',
    evidence: { observationIds: ['obs-cap-a1-jan'], definitionVersion: 'v1', datasetChecksum: CHECKSUM },
    provenance: 'illustrative',
    dataQuality: { ...quality, limitations: [] },
  };
}

export const EXCEPTIONS: Exception[] = [
  exception('exc-cap-a1', CAPACITY, FACILITY_A1, 'act_now'),
  exception('exc-rev-a', REVENUE, REGION_A, 'monitor'),
];

/** Placeholder policy for tests only; the real matrix is Aditya's open decision. */
const TEST_TRANSITIONS: Record<ActionRelation, Partial<Record<ActionState, ActionState[]>>> = {
  assignee: { open: ['acknowledged'], acknowledged: ['in_progress'], in_progress: ['completed'] },
  creator: { open: ['cancelled'], acknowledged: ['cancelled'], in_progress: ['cancelled'] },
};

interface StoredAction {
  action: Action;
  creatorMembershipId: string;
  assigneeMembershipId: string;
  idempotencyKey: string;
}

export interface ModuleFixture {
  deps: ModuleDeps;
  auditEvents: AuditEvent[];
  actions: StoredAction[];
}

export function createModuleFixture(overrides: Partial<ModuleDeps> = {}): ModuleFixture {
  const auditEvents: AuditEvent[] = [];
  const actions: StoredAction[] = [];
  const assigneeMembership: Record<string, string> = { [DHO_ASSIGNEE_ID]: DHO_MEMBERSHIP.membershipId };
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 1, 3, 6, 0, clock++)).toISOString();

  const writeAudit = (membership: MembershipClaims, draft: AuditDraft) => {
    auditEvents.push({
      eventId: `evt-${auditEvents.length + 1}`,
      occurredAt: now(),
      kind: draft.kind,
      actorRole: membership.role,
      target: draft.target,
      outcome: draft.outcome,
      requestId: draft.requestId,
    });
  };

  const relationOf = (membership: MembershipClaims, stored: StoredAction): ActionRelation | null => {
    if (stored.creatorMembershipId === membership.membershipId) return 'creator';
    if (stored.assigneeMembershipId === membership.membershipId) return 'assignee';
    return null;
  };

  const inPeriod = (period: Period, from?: string, to?: string) =>
    (!from || period.start >= from) && (!to || period.end <= to);

  const deps: ModuleDeps = {
    disclosure: ILLUSTRATIVE_DISCLOSURE,
    scope: {
      frameworkVersion: 'v1',
      entitlements: { forMembership: async ({ role }) => MODULE_ENTITLEMENTS.filter((row) => row.role === role) },
      resolver: fixtureResolver,
    },
    dataset: {
      current: async () => ({ datasetChecksum: CHECKSUM, definitionVersion: 'v1', asOf: '2026-02-02T06:00:00Z', currentPeriod: JAN }),
    },
    observations: {
      series: async (_m, query) =>
        OBSERVATIONS.filter(
          (row) =>
            row.assignmentId === query.assignmentId &&
            row.entity.grain === query.entity.grain &&
            row.entity.entityId === query.entity.entityId &&
            inPeriod(row.period, query.from, query.to),
        ).sort((a, b) => a.period.start.localeCompare(b.period.start)),
      breakdown: async (_m, query) =>
        OBSERVATIONS.filter(
          (row) =>
            row.assignmentId === query.assignmentId &&
            row.entity.grain === query.grain &&
            row.period.start === query.period.start &&
            (query.parent.entityId === 'fixture-region-a' ? row.entity.entityId.startsWith('fixture-facility-a') : false),
        ),
      byIds: async (_m, ids) => OBSERVATIONS.filter((row) => ids.includes(row.observationId)),
    },
    exceptions: {
      brief: async () => ({
        exceptions: EXCEPTIONS,
        onTrack: [],
        dataLimitations: [{ assignmentId: REVENUE, issue: 'late', detail: 'Fixture source is late.' }],
      }),
      inbox: async () => ({ items: EXCEPTIONS, nextCursor: null, orderingBasis: 'Fixture order.' }),
    },
    actions: {
      async create(membership, input: NewAction, audit) {
        const existing = actions.find(
          (row) => row.creatorMembershipId === membership.membershipId && row.idempotencyKey === input.idempotencyKey,
        );
        if (existing) return { action: existing.action, replayed: true };
        const timestamp = now();
        const action: Action = {
          actionId: `act-${actions.length + 1}`,
          state: 'open',
          version: 1,
          title: input.title,
          assignmentId: input.assignmentId,
          entity: input.entity,
          evidence: input.evidence,
          creatorRole: membership.role,
          assignee: { assigneeId: input.assigneeId, role: 'hospital-dho' },
          dueDate: input.dueDate,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const assigneeMembershipId = assigneeMembership[input.assigneeId];
        if (!assigneeMembershipId) throw new Error('fixture assignee missing');
        actions.push({ action, creatorMembershipId: membership.membershipId, assigneeMembershipId, idempotencyKey: input.idempotencyKey });
        writeAudit(membership, { ...audit, target: { type: 'action', id: action.actionId } });
        return { action, replayed: false };
      },
      async get(membership, actionId) {
        const stored = actions.find((row) => row.action.actionId === actionId);
        const relation = stored ? relationOf(membership, stored) : null;
        return stored && relation ? { action: stored.action, relation } : null;
      },
      async transition(membership, change, audit) {
        const stored = actions.find((row) => row.action.actionId === change.actionId);
        if (!stored || !relationOf(membership, stored)) return { status: 'not_found' };
        if (stored.action.version !== change.expectedVersion) return { status: 'stale' };
        stored.action = { ...stored.action, state: change.toState, version: stored.action.version + 1, updatedAt: now() };
        writeAudit(membership, audit);
        return { status: 'ok', action: stored.action };
      },
      async list(membership) {
        return { items: actions.filter((row) => relationOf(membership, row)).map((row) => row.action), nextCursor: null };
      },
    },
    assignees: {
      permitted: async (_m, target) =>
        target.assignmentId === CAPACITY && ['fixture-region-a', 'fixture-facility-a1'].includes(target.entity.entityId)
          ? [{ assigneeId: DHO_ASSIGNEE_ID, role: 'hospital-dho', scopes: [FACILITY_A1] }]
          : [],
    },
    transitions: {
      decide: async ({ relation, from, to }): Promise<TransitionDecision> => {
        const allowedForRelation = TEST_TRANSITIONS[relation][from] ?? [];
        if (allowedForRelation.includes(to)) return 'allowed';
        const other: ActionRelation = relation === 'creator' ? 'assignee' : 'creator';
        return (TEST_TRANSITIONS[other][from] ?? []).includes(to) ? 'not_permitted' : 'invalid_transition';
      },
    },
    audit: {
      record: async (membership, draft) => writeAudit(membership, draft),
      list: async () => ({ items: [...auditEvents], nextCursor: null }),
    },
    auditAccess: { mayRead: async (role) => role === 'regional-coo' },
    ...overrides,
  };
  return { deps, auditEvents, actions };
}

/** Builds the full app over a module fixture, with a local token issuer. */
export async function buildModuleApp(overrides: Partial<ModuleDeps> = {}) {
  const issuer = await createTestIssuer();
  const fixture = createModuleFixture(overrides);
  const app: FastifyInstance = await buildApp({
    allowedOrigins: [],
    modules: fixture.deps,
    auth: {
      getKey: issuer.getKey,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      memberships: fixtureMemberships([...MEMBERSHIPS, DHO_MEMBERSHIP]),
    },
  });

  async function call(subject: string, method: 'GET' | 'POST', url: string, payload?: object) {
    const token = await issuer.sign(subject);
    return app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  }
  return { app, fixture, call, issuer };
}
