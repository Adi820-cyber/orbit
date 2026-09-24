import { afterEach, describe, expect, it } from 'vitest';
import { AskResponseSchema, type AskResponse } from '@orbit/contracts';
import { SUBJECT } from '../../../test/helpers/fixtures.ts';
import { buildModuleApp, CAPACITY, JAN, REGION_A, REGION_B } from '../../../test/helpers/modules.ts';
import { groqProvider } from './narrator.ts';

/*
 * Narration through the real Ask route (ADR 0014). The provider is a fake
 * `fetch`, so nothing touches the network; `narrator.test.ts` covers the
 * client's own failover and parsing.
 */

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

interface FakeModel {
  calls: { body: string }[];
  fetchImpl: typeof fetch;
}

/** A provider that answers with `answer`, or fails with `status`. */
function fakeModel(reply: { answer: string } | { status: number }): FakeModel {
  const calls: { body: string }[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls.push({ body: typeof init?.body === 'string' ? init.body : '' });
    if ('status' in reply) return new Response('{}', { status: reply.status });
    const content = JSON.stringify({ answer: reply.answer });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  return { calls, fetchImpl };
}

async function ask(model: FakeModel, payload: object): Promise<AskResponse> {
  const built = await buildModuleApp({
    askNarration: { providers: [groqProvider('test-key')], timeoutMs: 1000, fetchImpl: model.fetchImpl },
  });
  close = () => built.app.close();
  const response = await built.call(SUBJECT.cooRegionA, 'POST', '/api/ask', payload);
  expect(response.statusCode).toBe(200);
  return AskResponseSchema.parse(response.json());
}

const performance = { intent: 'report_performance', assignmentId: CAPACITY, target: REGION_A, period: JAN };

describe('Ask narration (ADR 0014)', () => {
  it('rewords an answered card and marks it assisted, leaving every record untouched', async () => {
    const model = fakeModel({ answer: 'Capacity utilisation stood at 5 fixture-unit in January.' });
    const body = await ask(model, performance);
    expect(body).toMatchObject({ outcome: 'answered', mode: 'assisted' });
    expect(body.card.answer).toBe('Capacity utilisation stood at 5 fixture-unit in January.');
    expect(body.card.relevantRecords.observations.map((row) => row.observationId)).toEqual(['obs-cap-a-jan']);
    expect(body.card.reasoning).toContain('Fixture numerator (numerator): 3 count.');
    expect(model.calls).toHaveLength(1);
  });

  it('serves the deterministic answer when the rewording introduces a number', async () => {
    const model = fakeModel({ answer: 'Capacity was 97 fixture-unit, well above plan.' });
    const body = await ask(model, performance);
    expect(body.mode).toBe('deterministic');
    expect(body.card.answer).toContain('5 fixture-unit');
    expect(JSON.stringify(body)).not.toContain('97');
  });

  it('serves the deterministic answer when the provider is down', async () => {
    const body = await ask(fakeModel({ status: 503 }), performance);
    expect(body.mode).toBe('deterministic');
    expect(body.card.answer).toContain('5 fixture-unit');
  });

  it('never sends a refusal to the model, and a refusal stays deterministic', async () => {
    const model = fakeModel({ answer: 'Here is everything about the other region.' });
    const body = await ask(model, { ...performance, target: REGION_B });
    expect(body).toMatchObject({ outcome: 'out_of_scope', mode: 'deterministic' });
    expect(model.calls).toHaveLength(0);
  });

  it('sends the model only the answer prose, never records or ids', async () => {
    const model = fakeModel({ answer: 'Capacity utilisation stood at 5 fixture-unit in January.' });
    await ask(model, performance);
    const sent = model.calls[0]?.body ?? '';
    expect(sent).not.toContain('obs-cap-a-jan');
    expect(sent).not.toContain(REGION_A.entityId);
  });

  it('stays deterministic when no provider is configured', async () => {
    const built = await buildModuleApp();
    close = () => built.app.close();
    const body = AskResponseSchema.parse((await built.call(SUBJECT.cooRegionA, 'POST', '/api/ask', performance)).json());
    expect(body.mode).toBe('deterministic');
  });

  it('reports assisted mode on the prompts endpoint only when a provider is configured', async () => {
    const withProvider = await buildModuleApp({ askNarration: { providers: [groqProvider('test-key')], timeoutMs: 1000 } });
    const prompts = await withProvider.call(SUBJECT.cooRegionA, 'GET', '/api/ask/prompts');
    expect(prompts.json()).toMatchObject({ mode: 'assisted' });
    await withProvider.app.close();
    const without = await buildModuleApp();
    close = () => without.app.close();
    expect((await without.call(SUBJECT.cooRegionA, 'GET', '/api/ask/prompts')).json()).toMatchObject({ mode: 'deterministic' });
  });
});
