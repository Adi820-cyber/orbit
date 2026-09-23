import { describe, expect, it } from 'vitest';
import {
  ActionSchema,
  AskRequestSchema,
  AskResponseSchema,
  AuditEventSchema,
  BriefResponseSchema,
  CreateActionRequestSchema,
  DataQualitySchema,
  EntitlementSchema,
  ExceptionSchema,
  KpiDetailQuerySchema,
  MeasureValueSchema,
  ObservationSchema,
  PeriodSchema,
  TargetSchema,
  TransitionActionRequestSchema,
} from './index.ts';

/* Placeholder identifiers only; not generated entities or real KPI values. */
const period = { cadence: 'month', start: '2026-01-01', end: '2026-01-31' } as const;
const entity = { grain: 'facility', entityId: 'fixture-facility-a1' } as const;
const dataQuality = {
  state: 'illustrative',
  reconciliation: 'reconciled',
  freshness: 'current',
  refreshedAt: '2026-02-03T06:00:00Z',
  limitations: [],
} as const;
const evidence = { observationIds: ['obs-1'], definitionVersion: 'v1', datasetChecksum: 'fixture-checksum' };

const observation = {
  observationId: 'obs-1',
  assignmentId: 'fixture-assignment-1',
  definitionFamily: 'fixture-family',
  definitionVersion: 'v1',
  entity,
  period,
  unit: 'percent',
  value: { status: 'available', value: 1 },
  components: [
    { componentId: 'num', label: 'Numerator', role: 'numerator', unit: 'count', value: { status: 'available', value: 1 } },
    { componentId: 'den', label: 'Denominator', role: 'denominator', unit: 'count', value: { status: 'available', value: 1 } },
  ],
  target: { state: 'not_configured' },
  provenance: 'illustrative',
  dataQuality,
};

const exception = {
  exceptionId: 'exc-1',
  assignmentId: 'fixture-assignment-1',
  entity,
  period,
  priority: 'act_now',
  category: 'performance',
  comparisonBasis: 'prior_period',
  detection: { kind: 'seeded_scenario', scenarioLabel: 'fixture scenario' },
  whatChanged: 'x',
  whyItMatters: 'y',
  owner: { role: 'hospital-dho' },
  actionState: 'none',
  evidence,
  provenance: 'illustrative',
  dataQuality,
};

const card = {
  answer: 'x',
  definitionBasis: [],
  reasoning: [],
  scope: { role: 'regional-coo', entities: [{ grain: 'region', entityId: 'fixture-region-a' }] },
  period,
  limitations: [],
  relevantRecords: { observations: [], exceptions: [] },
  nextAction: null,
};

describe('provenance and data quality', () => {
  it('rejects any data-quality state other than illustrative', () => {
    expect(DataQualitySchema.safeParse(dataQuality).success).toBe(true);
    expect(DataQualitySchema.safeParse({ ...dataQuality, state: 'verified' }).success).toBe(false);
  });

  it('rejects an observation that claims non-illustrative provenance', () => {
    expect(ObservationSchema.safeParse(observation).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...observation, provenance: 'live' }).success).toBe(false);
  });
});

describe('values and targets', () => {
  it('keeps missing distinct from zero', () => {
    expect(MeasureValueSchema.parse({ status: 'missing', reason: 'not_reported' })).not.toHaveProperty('value');
    expect(MeasureValueSchema.safeParse({ status: 'missing', value: 0 }).success).toBe(false);
  });

  it('represents a zero denominator as not applicable, not as a number', () => {
    expect(MeasureValueSchema.safeParse({ status: 'not_applicable', reason: 'zero_denominator' }).success).toBe(true);
    expect(MeasureValueSchema.safeParse({ status: 'available', value: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('never accepts a client-approved target in v1', () => {
    const target = { state: 'configured', value: 1, direction: 'higher_is_better', basis: 'b' };
    expect(TargetSchema.safeParse({ ...target, approval: 'demo_parameter' }).success).toBe(true);
    expect(TargetSchema.safeParse({ ...target, approval: 'client_approved' }).success).toBe(false);
  });

  it('rejects an inverted target range and an inverted period', () => {
    const range = { state: 'configured_range', low: 2, high: 1, approval: 'unapproved', basis: 'b' };
    expect(TargetSchema.safeParse(range).success).toBe(false);
    expect(PeriodSchema.safeParse({ ...period, start: '2026-02-01' }).success).toBe(false);
  });
});

describe('entitlements', () => {
  it('requires the framework version (ADR 0005)', () => {
    const row = { role: 'regional-coo', assignmentId: 'a1', grains: ['region'], breakdowns: [] };
    expect(EntitlementSchema.safeParse(row).success).toBe(false);
    expect(EntitlementSchema.safeParse({ ...row, frameworkVersion: 'v1' }).success).toBe(true);
  });
});

describe('brief and inbox', () => {
  it('requires the disclosure', () => {
    const brief = { period, asOf: '2026-02-03T06:00:00Z', actNow: [exception], monitor: [], onTrack: [], dataLimitations: [] };
    expect(BriefResponseSchema.safeParse(brief).success).toBe(false);
    expect(BriefResponseSchema.safeParse({ ...brief, disclosure: 'Fictional demonstration company.' }).success).toBe(true);
  });

  it('only accepts reviewed-rule or labelled seeded-scenario detection', () => {
    expect(ExceptionSchema.safeParse({ ...exception, detection: { kind: 'threshold', below: 85 } }).success).toBe(false);
  });
});

describe('kpi query', () => {
  it('rejects unknown keys such as a client-supplied role', () => {
    expect(KpiDetailQuerySchema.safeParse({ grain: 'region', entityId: 'r', role: 'chairman' }).success).toBe(false);
  });
});

describe('ask', () => {
  it('has no free-text or SQL field', () => {
    expect(AskRequestSchema.safeParse({ intent: 'summarize_exceptions', sql: 'select 1' }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ intent: 'free_text', question: 'anything' }).success).toBe(false);
  });

  it('requires the parameters of each intent', () => {
    expect(AskRequestSchema.safeParse({ intent: 'compare_periods', assignmentId: 'a', target: entity, period }).success).toBe(false);
  });

  it('carries records only on an answered outcome', () => {
    const withRecords = { ...card, relevantRecords: { observations: [observation], exceptions: [] } };
    const answered = { outcome: 'answered', mode: 'deterministic', card: withRecords, disclosure: 'd' };
    expect(AskResponseSchema.safeParse(answered).success).toBe(true);
    expect(AskResponseSchema.safeParse({ ...answered, outcome: 'out_of_scope' }).success).toBe(false);
    expect(AskResponseSchema.safeParse({ ...answered, outcome: 'out_of_scope', card }).success).toBe(true);
  });

  it('never carries a confidence score', () => {
    const answered = { outcome: 'answered', mode: 'deterministic', card: { ...card, confidence: 100 }, disclosure: 'd' };
    expect(AskResponseSchema.safeParse(answered).success).toBe(false);
  });
});

describe('actions and audit', () => {
  const create = {
    idempotencyKey: '30000000-0000-4000-8000-000000000001',
    title: 'Review capacity',
    assignmentId: 'fixture-assignment-1',
    entity,
    evidence,
    assigneeId: 'fixture-assignee',
    dueDate: '2026-02-15',
  };

  it('requires an idempotency key to create', () => {
    expect(CreateActionRequestSchema.safeParse(create).success).toBe(true);
    const { idempotencyKey: _key, ...withoutKey } = create;
    expect(CreateActionRequestSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('requires an expected version and a reason to transition', () => {
    expect(TransitionActionRequestSchema.safeParse({ toState: 'acknowledged', expectedVersion: 1, reason: 'seen' }).success).toBe(true);
    expect(TransitionActionRequestSchema.safeParse({ toState: 'acknowledged', reason: 'seen' }).success).toBe(false);
    expect(TransitionActionRequestSchema.safeParse({ toState: 'acknowledged', expectedVersion: 1, reason: '  ' }).success).toBe(false);
  });

  it('keeps actions free of subject and membership ids', () => {
    const action = {
      actionId: 'act-1',
      state: 'open',
      version: 1,
      title: 't',
      assignmentId: 'fixture-assignment-1',
      entity,
      evidence,
      creatorRole: 'regional-coo',
      assignee: { assigneeId: 'fixture-assignee', role: 'hospital-dho' },
      dueDate: '2026-02-15',
      createdAt: '2026-02-03T06:00:00Z',
      updatedAt: '2026-02-03T06:00:00Z',
    };
    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(ActionSchema.safeParse({ ...action, creatorSubject: 'x' }).success).toBe(false);
  });

  it('keeps raw question text out of audit events', () => {
    const event = {
      eventId: 'e1',
      occurredAt: '2026-02-03T06:00:00Z',
      kind: 'ask_answered',
      actorRole: 'regional-coo',
      target: { type: 'ask', id: 'explain_definition' },
      outcome: 'answered',
      requestId: 'req-1',
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...event, question: 'raw text' }).success).toBe(false);
  });
});
