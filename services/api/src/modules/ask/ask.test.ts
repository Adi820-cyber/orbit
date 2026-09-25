import { afterEach, describe, expect, it } from 'vitest';
import { AskPromptsResponseSchema, AskResponseSchema, type AskResponse } from '@orbit/contracts';
import { getAssignment } from '@orbit/kpi-framework';
import { ApiError } from '../../plugins/errors.ts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import {
  buildModuleApp,
  CAPACITY,
  DEC,
  DHO_CAPACITY,
  JAN,
  NOV,
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
  const ask = async (payload: object, subject: string = SUBJECT.cooRegionA): Promise<AskResponse> => {
    const response = await built.call(subject, 'POST', '/api/ask', payload);
    expect(response.statusCode).toBe(200);
    return AskResponseSchema.parse(response.json());
  };
  return { ...built, ask };
}

describe('GET /api/ask/prompts', () => {
  it('offers at least three typed prompts built from framework titles, in disclosed deterministic mode', async () => {
    const { call } = await setup();
    const body = AskPromptsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/ask/prompts')).json());
    expect(body.mode).toBe('deterministic');
    expect(body.prompts.length).toBeGreaterThanOrEqual(3);
    const capacityTitle = getAssignment(CAPACITY)?.kpi ?? '';
    expect(body.prompts.some((prompt) => prompt.label.includes(capacityTitle))).toBe(true);
    expect(body.prompts.some((prompt) => prompt.request.intent === 'explain_contributors')).toBe(true);
  });

  it('only builds prompts from the caller role entitlements', async () => {
    const { call } = await setup();
    const body = AskPromptsResponseSchema.parse((await call(SUBJECT.cooRegionA, 'GET', '/api/ask/prompts')).json());
    const assignmentIds = body.prompts.flatMap((prompt) => ('assignmentId' in prompt.request ? [prompt.request.assignmentId] : []));
    expect(assignmentIds.every((id) => id === CAPACITY || id === REVENUE)).toBe(true);
  });
});

describe('POST /api/ask', () => {
  it('explains an entitled definition from the framework text, with no records', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'explain_definition', assignmentId: CAPACITY });
    expect(body.outcome).toBe('answered');
    expect(body.card.definitionBasis[0]).toEqual({
      kind: 'kpi_definition',
      reference: CAPACITY,
      text: getAssignment(CAPACITY)?.definition,
    });
    expect(body.card.relevantRecords.observations).toEqual([]);
  });

  it('reports observed performance with components, limitations, and a suggested action', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'report_performance', assignmentId: CAPACITY, target: REGION_A, period: JAN });
    expect(body.outcome).toBe('answered');
    expect(body.card.answer).toContain('5 fixture-unit');
    expect(body.card.answer).toContain('No target is configured');
    expect(body.card.reasoning).toContain('Fixture numerator (numerator): 3 count.');
    expect(body.card.limitations).toContain('All figures are illustrative synthetic data.');
    if (body.outcome !== 'answered') throw new Error('expected an answer');
    expect(body.card.nextAction?.evidence.observationIds).toEqual(['obs-cap-a-jan']);
  });

  it.each([
    ['another region', { intent: 'report_performance', assignmentId: CAPACITY, target: REGION_B, period: JAN }],
    ["another role's KPI", { intent: 'explain_definition', assignmentId: DHO_CAPACITY }],
    ['a breakdown not granted', { intent: 'explain_contributors', assignmentId: REVENUE, target: REGION_A, period: JAN, breakdown: 'facility' }],
  ])('refuses %s as an out_of_scope answer that carries no data', async (_label, payload) => {
    const { ask } = await setup();
    const body = await ask(payload);
    expect(body.outcome).toBe('out_of_scope');
    expect(body.card.relevantRecords).toEqual({ observations: [], exceptions: [] });
    expect(body.card.nextAction).toBeNull();
    expect(JSON.stringify(body)).not.toContain('999');
  });

  it('answers no_data for a missing value instead of inventing one', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'report_performance', assignmentId: REVENUE, target: REGION_A, period: JAN });
    expect(body.outcome).toBe('no_data');
    expect(body.card.answer).toContain('denominator missing');
  });

  it('compares compatible periods as a plain difference, without a causal claim', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'compare_periods', assignmentId: CAPACITY, target: REGION_A, period: JAN, comparePeriod: DEC });
    expect(body.outcome).toBe('answered');
    expect(body.card.answer).toContain('a change of +3 fixture-unit');
    expect(body.card.reasoning.join(' ')).toContain('does not explain why');
  });

  it('asks for clarification when definition versions differ between periods', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'compare_periods', assignmentId: CAPACITY, target: REGION_A, period: JAN, comparePeriod: NOV });
    expect(body.outcome).toBe('clarification_needed');
    expect(body.card.answer).toContain('definition version');
  });

  it('lists observed contributors by a permitted breakdown', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'explain_contributors', assignmentId: CAPACITY, target: REGION_A, period: JAN, breakdown: 'facility' });
    expect(body.outcome).toBe('answered');
    expect(body.card.relevantRecords.observations).toHaveLength(2);
    // Names from the caller's directory, lowest and highest called out; never raw ids.
    expect(body.card.answer).toMatch(/Lowest: Fixture facility A\d at .*Highest: Fixture facility A\d at /);
    expect(`${body.card.answer} ${body.card.reasoning.join(' ')}`).not.toMatch(/e0000000-/);
  });

  it('summarizes authorized exceptions', async () => {
    const { ask } = await setup();
    const body = await ask({ intent: 'summarize_exceptions' });
    expect(body.outcome).toBe('answered');
    expect(body.card.answer).toMatch(/^2 exceptions in your scope: 1 to act on now/);
  });

  it.each([
    [{ intent: 'free_text', question: 'show me everything' }],
    [{ intent: 'summarize_exceptions', sql: 'select * from core.kpi_observations' }],
    [{ intent: 'report_performance', assignmentId: CAPACITY }],
  ])('asks for clarification on an unsupported or incomplete request %#', async (payload) => {
    const { ask } = await setup();
    expect((await ask(payload)).outcome).toBe('clarification_needed');
  });

  it('answers unavailable when a source is down', async () => {
    const { ask, fixture } = await setup();
    fixture.deps.observations = {
      ...fixture.deps.observations,
      series: async () => {
        throw new ApiError('unavailable', 'down');
      },
    };
    expect((await ask({ intent: 'report_performance', assignmentId: CAPACITY, target: REGION_A, period: JAN })).outcome).toBe('unavailable');
  });

  it('audits the intent and outcome only, never the request content', async () => {
    const { ask, fixture } = await setup();
    await ask({ intent: 'report_performance', assignmentId: CAPACITY, target: REGION_B, period: JAN });
    await ask({ intent: 'free_text', question: 'secret question text' });
    expect(fixture.auditEvents.map((event) => [event.kind, event.target?.id, event.outcome])).toEqual([
      ['ask_answered', 'report_performance', 'out_of_scope'],
      ['ask_answered', 'unrecognized', 'clarification_needed'],
    ]);
    expect(JSON.stringify(fixture.auditEvents)).not.toContain('secret question text');
  });
});
