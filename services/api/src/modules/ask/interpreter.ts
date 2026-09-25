import { z } from 'zod';
import {
  AskRequestSchema,
  EntityDirectoryEntrySchema,
  type AskRequest,
  type Grain,
  type MembershipClaims,
  type Period,
  type ScopeEntity,
} from '@orbit/contracts';
import { getDefinitionFamiliesForAssignment } from '@orbit/kpi-framework';
import { ApiError } from '../../plugins/errors.ts';
import { entitlementsFor } from '../../plugins/scope.ts';
import type { ModuleDeps } from '../ports.ts';
import { frameworkAssignment, loadDataset, parseRows } from '../shared.ts';
import { completeJson, type DeclineReason } from './narrator.ts';

/*
 * Plain-language questions (ARCH §9's model adapter, ADR 0014 providers).
 *
 * The model's only job is to CHOOSE: one question type, and at most one of the
 * caller's own KPIs, entities and months, each from an enumerated menu built
 * for this caller. It never sees a figure, never writes SQL, and cannot name
 * anything outside the menu: the JSON Schema is enumerated and the reply is
 * parsed against the same enums. The chosen request is then re-authorized and
 * answered by the deterministic catalogue, exactly like a guided prompt.
 */

const INTENTS = ['explain_definition', 'report_performance', 'compare_periods', 'explain_contributors', 'summarize_exceptions'] as const;
const NONE = 'none';
const GRAINS: readonly Grain[] = ['group', 'region', 'facility', 'coe'];
const MONTHS_OFFERED = 24;

const INTENT_GUIDE = [
  'explain_definition: only when the user asks what a KPI means, how it is calculated, or what its target basis is.',
  'report_performance: how one KPI is doing for one entity in one month ("how is X", "are we on track", "are patients happy").',
  'compare_periods: how one KPI changed between two months ("better or worse", "up or down", "since July", "versus last month").',
  'explain_contributors: which sub-entities make up a KPI, or which one is best, worst, highest or lowest ("which hospital is worst on EBITDA", "break down by region").',
  'summarize_exceptions: what needs attention, open exceptions, problems or issues overall ("what needs my attention", "any safety issues").',
  'unsupported: anything else, including requests for other people, forecasts, advice, causes, or data not in the lists.',
];

const SYSTEM_PROMPT = [
  'You map a leader\'s question to exactly one Orbit question type. You never answer the question yourself.',
  'Choose every value only from the lists provided. Use "none" when a value is not needed or not stated.',
  'Match the KPI by what it measures, not only by its title: everyday words (for example "bed occupancy", "cash collected", "staff leaving") map to the KPI whose description covers them.',
  'If the question asks for anything the lists cannot express, choose intent "unsupported".',
  'Question types:',
  ...INTENT_GUIDE.map((line) => `- ${line}`),
  'When no month is stated, use "none" (the latest month is used). When no entity is stated, use "none".',
].join('\n');

interface Menu {
  assignments: { id: string; title: string; about: string; grains: readonly Grain[]; breakdowns: readonly Grain[] }[];
  entities: { entity: ScopeEntity; label: string }[];
  months: string[];
  current: Period;
}

export type Interpretation =
  | { status: 'interpreted'; request: AskRequest; label: string }
  | { status: 'unclear'; message: string }
  | { status: 'unavailable'; reason: DeclineReason; detail?: string | undefined };

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function periodOf(month: string): Period {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year ?? 0, mon ?? 1, 0)).getUTCDate();
  return { cadence: 'month', start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (mon ?? 1) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (mon ?? 1) - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function buildMenu(deps: ModuleDeps, membership: MembershipClaims): Promise<Menu> {
  const [entitlements, dataset] = await Promise.all([entitlementsFor(membership, deps.scope), loadDataset(deps, membership)]);
  const assignments = entitlements.map((entitlement) => ({
    id: entitlement.assignmentId,
    title: frameworkAssignment(membership, entitlement.assignmentId).kpi,
    about: aboutAssignment(entitlement.assignmentId),
    grains: entitlement.grains,
    breakdowns: entitlement.breakdowns,
  }));

  // Names make the menu usable ("North", "Avenhurst"); without the directory
  // the caller's own scopes are still offered, by grain.
  let entities: Menu['entities'];
  try {
    entities = parseRows(EntityDirectoryEntrySchema, await deps.entities.visible(membership), 'entity_row_failed_contract').map(
      (entry) => ({ entity: { grain: entry.grain, entityId: entry.entityId }, label: entry.label }),
    );
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'unavailable') throw error;
    entities = membership.scopes.map((scope) => ({ entity: scope, label: `my ${scope.grain}` }));
  }

  const latest = monthOf(dataset.currentPeriod.start);
  const months = [latest];
  while (months.length < MONTHS_OFFERED) months.push(previousMonth(months.at(-1) ?? latest));
  return { assignments, entities, months, current: dataset.currentPeriod };
}

/**
 * What a KPI measures, in the workbook's own words, so plain questions ("bed
 * occupancy", "cash we collected") can be matched to a KPI whose title uses
 * different words. Framework text only; never a figure.
 */
function aboutAssignment(assignmentId: string): string {
  return getDefinitionFamiliesForAssignment(assignmentId)
    .map((family) => `${family.family}: ${family.standardDefinition.split('. ')[0]?.replace(/\.$/, '') ?? ''}`)
    .join('; ');
}

/** How far up the organization a grain sits; a breakdown goes to a lower rank. */
function rankOf(grain: string): number {
  if (grain === 'group') return 3;
  return grain === 'region' || grain === 'coe' ? 2 : 1;
}

/** Everyday words mapped onto the stems the workbook uses. */
const SYNONYMS: Record<string, string> = {
  occupancy: 'capac', beds: 'capac', busy: 'capac',
  cash: 'colle', collected: 'colle', collect: 'colle',
  rejected: 'denie', rejection: 'denie', rejections: 'denie', denials: 'denie',
  happy: 'exper', satisfaction: 'exper', complaints: 'exper',
  leaving: 'attri', quitting: 'attri', resignations: 'attri',
  training: 'learn', credentials: 'crede',
  stock: 'inven', stockouts: 'inven',
  profit: 'ebitd', margin: 'ebitd',
  sales: 'reven', income: 'reven',
};

/** Words too common in KPI titles to tell one KPI from another. */
const STOP = new Set([
  'what', 'when', 'where', 'which', 'with', 'this', 'that', 'there', 'their', 'have', 'does', 'show', 'tell', 'about',
  'much', 'many', 'month', 'last', 'from', 'into', 'over', 'your', 'ours', 'hospital', 'hospitals', 'group',
  'regional', 'region', 'rate', 'plan', 'approved', 'budget', 'versus', 'against', 'value', 'score', 'total',
]);

function stemsOf(text: string): Set<string> {
  const stems = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if (word.length < 4 || STOP.has(word)) continue;
    stems.add(SYNONYMS[word] ?? word.slice(0, 5));
  }
  return stems;
}

/**
 * A deterministic fallback for when the model returns "unsupported": the KPI
 * sharing the most distinct terms with the question, if at least two match
 * and no other KPI ties. Chooses only from the caller's own menu.
 */
function keywordMatch(menu: Menu, question: string): Menu['assignments'][number] | null {
  const asked = stemsOf(question);
  const scored = menu.assignments
    .map((row) => {
      const known = stemsOf(`${row.title} ${row.about}`);
      return { row, score: [...asked].filter((stem) => known.has(stem)).length };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < 2 || (next && next.score === best.score)) return null;
  return best.row;
}

/** An enum's values with "none" first: a non-empty tuple by construction, so no cast is needed. */
function enumOf(values: readonly string[]): [string, ...string[]] {
  return [NONE, ...values];
}

function taskFor(menu: Menu, question: string) {
  const assignmentIds = menu.assignments.map((row) => row.id);
  const entityIds = menu.entities.map((row) => row.entity.entityId);
  const choice = z.strictObject({
    intent: z.enum([...INTENTS, 'unsupported']),
    assignmentId: z.enum(enumOf(assignmentIds)),
    entityId: z.enum(enumOf(entityIds)),
    month: z.enum(enumOf(menu.months)),
    compareMonth: z.enum(enumOf(menu.months)),
    breakdown: z.enum(enumOf(GRAINS)),
  });
  const stringEnum = (values: readonly string[]) => ({ type: 'string', enum: enumOf(values) });
  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'assignmentId', 'entityId', 'month', 'compareMonth', 'breakdown'],
    properties: {
      intent: { type: 'string', enum: [...INTENTS, 'unsupported'] },
      assignmentId: stringEnum(assignmentIds),
      entityId: stringEnum(entityIds),
      month: stringEnum(menu.months),
      compareMonth: stringEnum(menu.months),
      breakdown: stringEnum(GRAINS),
    },
  };
  const user = [
    `Question: ${question}`,
    '',
    'KPIs (assignmentId — title — what it measures):',
    ...menu.assignments.map((row) => `- ${row.id} — ${row.title} — ${row.about}`),
    '',
    'Entities (entityId — name, level):',
    ...menu.entities.map((row) => `- ${row.entity.entityId} — ${row.label}, ${row.entity.grain}`),
    '',
    'Months (month — name):',
    ...menu.months.map((month, index) => `- ${month} — ${monthLabel(month)}${index === 0 ? ' (latest)' : ''}`),
  ].join('\n');
  return { system: SYSTEM_PROMPT, user, schemaName: 'orbit_question', jsonSchema, parse: choice, temperature: 0 };
}

const UNCLEAR =
  'Orbit could not match that to a question about your own KPIs and scope. It may ask about something outside your authorized scope, or need a KPI and a month. Try rephrasing, or choose a guided question.';

/** Maps a plain-language question to a typed, not-yet-authorized AskRequest. */
export async function interpret(deps: ModuleDeps, membership: MembershipClaims, question: string): Promise<Interpretation> {
  if (deps.askNarration.providers.length === 0) {
    return { status: 'unavailable', reason: 'not_configured' };
  }
  const menu = await buildMenu(deps, membership);
  if (menu.assignments.length === 0) return { status: 'unclear', message: UNCLEAR };

  const outcome = await completeJson(taskFor(menu, question), {
    providers: deps.askNarration.providers,
    timeoutMs: deps.askNarration.timeoutMs,
    // A short grace: the question must be understood within a few seconds, or
    // the user is better served by the guided questions.
    graceMs: 1500,
    ...(deps.askNarration.fetchImpl ? { fetchImpl: deps.askNarration.fetchImpl } : {}),
  });
  if (outcome.status !== 'ok') {
    return { status: 'unavailable', reason: outcome.reason, detail: outcome.detail };
  }

  const pick = outcome.value;
  if (pick.intent === 'unsupported') {
    // The model gave up. A plain keyword match over the caller's own KPIs can
    // still find an obvious one ("claims rejected" -> the rejected-claims KPI).
    // It can only choose from the same menu, and says it was a closest match.
    const guess = keywordMatch(menu, question);
    if (!guess) return { status: 'unclear', message: UNCLEAR };
    const target = membership.scopes.find((scope) => guess.grains.includes(scope.grain));
    if (!target) return { status: 'unclear', message: UNCLEAR };
    const month = monthOf(menu.current.start);
    const targetLabel = menu.entities.find((row) => row.entity.entityId === target.entityId)?.label ?? `your ${target.grain}`;
    const parsedGuess = AskRequestSchema.safeParse({ intent: 'report_performance', assignmentId: guess.id, target, period: periodOf(month) });
    return parsedGuess.success
      ? { status: 'interpreted', request: parsedGuess.data, label: `Closest match to your words: ${guess.title} for ${targetLabel}, ${monthLabel(month)}` }
      : { status: 'unclear', message: UNCLEAR };
  }
  if (pick.intent === 'summarize_exceptions') {
    return { status: 'interpreted', request: { intent: 'summarize_exceptions' }, label: 'Summarize my open exceptions' };
  }

  const assignment = menu.assignments.find((row) => row.id === pick.assignmentId);
  if (!assignment) return { status: 'unclear', message: UNCLEAR };
  if (pick.intent === 'explain_definition') {
    return {
      status: 'interpreted',
      request: { intent: 'explain_definition', assignmentId: assignment.id },
      label: `Explain how ${assignment.title} is defined`,
    };
  }

  // Defaults the user would expect: their own entity at a granted grain, the latest month.
  const chosen = menu.entities.find((row) => row.entity.entityId === pick.entityId);
  const target =
    chosen?.entity ?? membership.scopes.find((scope) => assignment.grains.includes(scope.grain)) ?? membership.scopes[0];
  if (!target) return { status: 'unclear', message: UNCLEAR };
  const targetLabel = menu.entities.find((row) => row.entity.entityId === target.entityId)?.label ?? `your ${target.grain}`;
  const month = pick.month === NONE ? monthOf(menu.current.start) : pick.month;
  const period = periodOf(month);

  let request: unknown;
  let label: string;
  switch (pick.intent) {
    case 'report_performance':
      request = { intent: 'report_performance', assignmentId: assignment.id, target, period };
      label = `${assignment.title} for ${targetLabel}, ${monthLabel(month)}`;
      break;
    case 'compare_periods': {
      const compare = pick.compareMonth === NONE || pick.compareMonth === month ? previousMonth(month) : pick.compareMonth;
      request = { intent: 'compare_periods', assignmentId: assignment.id, target, period, comparePeriod: periodOf(compare) };
      label = `${assignment.title} for ${targetLabel}: ${monthLabel(month)} against ${monthLabel(compare)}`;
      break;
    }
    case 'explain_contributors': {
      const breakdown = pick.breakdown === NONE ? assignment.breakdowns[0] : pick.breakdown;
      if (!breakdown) return { status: 'unclear', message: 'That KPI has no breakdown you are permitted to see.' };
      // A breakdown needs a parent above the level it breaks into ("EBITDA by
      // region" is broken down from the group, not from one region). If the
      // model picked a parent at or below that level, use the caller's own scope.
      const parent =
        rankOf(target.grain) > rankOf(breakdown)
          ? target
          : membership.scopes.find((scope) => assignment.grains.includes(scope.grain) && rankOf(scope.grain) > rankOf(breakdown));
      if (!parent) return { status: 'unclear', message: 'That KPI has no breakdown you are permitted to see.' };
      const parentLabel = menu.entities.find((row) => row.entity.entityId === parent.entityId)?.label ?? `your ${parent.grain}`;
      request = { intent: 'explain_contributors', assignmentId: assignment.id, target: parent, period, breakdown };
      label = `${assignment.title} for ${parentLabel} by ${breakdown === 'coe' ? 'COE' : breakdown}, ${monthLabel(month)}`;
      break;
    }
  }
  const parsed = AskRequestSchema.safeParse(request);
  return parsed.success ? { status: 'interpreted', request: parsed.data, label } : { status: 'unclear', message: UNCLEAR };
}
