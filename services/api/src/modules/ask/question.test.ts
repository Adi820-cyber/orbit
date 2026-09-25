import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AskQuestionResponseSchema, type AskQuestionResponse } from '@orbit/contracts';
import { getAssignment } from '@orbit/kpi-framework';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp, CAPACITY, DHO_CAPACITY, FACILITY_A1, REGION_A, REGION_B } from '../../../test/helpers/modules.ts';
import { groqProvider } from './narrator.ts';

/*
 * Plain-language Ask through the real route. The fake model answers the
 * interpretation task with `choice`, and the narration task by echoing the
 * deterministic answer, so every figure is Orbit's own.
 */

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

type Choice = Record<string, string>;

/** The part of the provider request the fake needs, parsed rather than cast. */
const SentSchema = z.object({
  response_format: z.object({ json_schema: z.object({ name: z.string() }) }),
  messages: z.array(z.object({ content: z.string() })),
});

function fakeModel(choice: Choice) {
  const sent: { task: string; user: string }[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const request = SentSchema.parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
    const task = request.response_format.json_schema.name;
    const user = request.messages[1]?.content ?? '';
    sent.push({ task, user });
    const content = JSON.stringify(task === 'orbit_question' ? choice : { answer: user });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  return { sent, fetchImpl };
}

const pick = (overrides: Choice): Choice => ({
  intent: 'report_performance',
  assignmentId: CAPACITY,
  entityId: 'none',
  month: 'none',
  compareMonth: 'none',
  breakdown: 'none',
  ...overrides,
});

async function ask(question: string, model: ReturnType<typeof fakeModel> | null) {
  const built = await buildModuleApp(
    model ? { askNarration: { providers: [groqProvider('test-key')], timeoutMs: 1000, fetchImpl: model.fetchImpl } } : {},
  );
  close = () => built.app.close();
  const response = await built.call(SUBJECT.cooRegionA, 'POST', '/api/ask/question', { question });
  return { status: response.statusCode, body: response.statusCode === 200 ? AskQuestionResponseSchema.parse(response.json()) : null, built };
}

describe('POST /api/ask/question', () => {
  it('maps a plain question to a typed request and answers it from the catalogue', async () => {
    const model = fakeModel(pick({ entityId: REGION_A.entityId, month: '2026-01' }));
    const { body } = await ask('How did capacity utilisation look in the north in January?', model);
    if (!body) throw new Error('expected a 200 response');
    const result: AskQuestionResponse = body;
    expect(result.interpretedAs?.request).toMatchObject({ intent: 'report_performance', assignmentId: CAPACITY, target: REGION_A });
    expect(result.interpretedAs?.label).toContain(getAssignment(CAPACITY)?.kpi ?? '');
    expect(result.response).toMatchObject({ outcome: 'answered', mode: 'assisted' });
    expect(result.response.card.relevantRecords.observations.map((row) => row.observationId)).toEqual(['obs-cap-a-jan']);
  });

  it('defaults to the latest month and the caller own scope when the question names neither', async () => {
    const { body } = await ask('How is capacity doing?', fakeModel(pick({})));
    expect(body?.interpretedAs?.request).toMatchObject({ target: REGION_A, period: { start: '2026-01-01' } });
  });

  it.each([
    ["another role's KPI", pick({ assignmentId: DHO_CAPACITY })],
    ['another region', pick({ entityId: REGION_B.entityId })],
    ['an invented month', pick({ month: '2031-01' })],
  ])('never answers when the model picks %s: the reply fails the menu check', async (_label, choice) => {
    const { body } = await ask('Show me everything', fakeModel(choice));
    expect(body?.interpretedAs).toBeNull();
    expect(body?.response.outcome).toBe('unavailable');
    expect(body?.response.card.relevantRecords).toEqual({ observations: [], exceptions: [] });
  });

  it('breaks a KPI down from a parent above the breakdown level, whatever entity the model picked', async () => {
    const { body } = await ask('Which hospital is lowest on capacity?', fakeModel(pick({ intent: 'explain_contributors', entityId: FACILITY_A1.entityId, breakdown: 'facility' })));
    expect(body?.interpretedAs?.request).toMatchObject({ intent: 'explain_contributors', target: REGION_A, breakdown: 'facility' });
  });

  it('falls back to a clear keyword match when the model gives up, and says so', async () => {
    const { body } = await ask('What is our capacity utilisation looking like?', fakeModel(pick({ intent: 'unsupported' })));
    expect(body?.interpretedAs?.request).toMatchObject({ intent: 'report_performance', assignmentId: CAPACITY, target: REGION_A });
    expect(body?.interpretedAs?.label).toMatch(/^Closest match to your words: /);
  });

  it('asks for clarification when the question fits no question type', async () => {
    const { body } = await ask('Should I fire the hospital manager?', fakeModel(pick({ intent: 'unsupported' })));
    expect(body?.interpretedAs).toBeNull();
    expect(body?.response.outcome).toBe('clarification_needed');
  });

  it('says so plainly when no AI provider is configured', async () => {
    const { body } = await ask('How is capacity doing?', null);
    expect(body?.response.outcome).toBe('unavailable');
    expect(body?.response.card.answer).toContain('not configured');
  });

  it('sends the model the question and menu only, never a figure', async () => {
    const model = fakeModel(pick({}));
    await ask('How is capacity doing?', model);
    const interpretation = model.sent.find((call) => call.task === 'orbit_question')?.user ?? '';
    expect(interpretation).toContain('How is capacity doing?');
    expect(interpretation).toContain(REGION_A.entityId);
    expect(interpretation).not.toContain(REGION_B.entityId);
    expect(interpretation).not.toMatch(/fixture-unit|obs-cap/);
  });

  it('audits the mapped intent, never the question text', async () => {
    const { built } = await ask('My secret question about capacity', fakeModel(pick({})));
    const events = built.fixture.auditEvents.filter((event) => event.kind === 'ask_answered');
    expect(events.map((event) => event.target?.id)).toEqual(['question:report_performance']);
    expect(JSON.stringify(built.fixture.auditEvents)).not.toContain('secret question');
  });

  it('rejects an empty or oversized question as invalid input', async () => {
    expect((await ask('x', fakeModel(pick({})))).status).toBe(400);
  });
});
