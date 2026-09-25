import {
  AskResponseSchema,
  EntityDirectoryEntrySchema,
  ExceptionSchema,
  ObservationSchema,
  PageQuerySchema,
  type AskOutcome,
  type AskRequest,
  type AskResponse,
  type Exception,
  type MeasureValue,
  type MembershipClaims,
  type Observation,
  type Period,
  type PolicyBasis,
  type Target,
} from '@orbit/contracts';
import { ApiError } from '../../plugins/errors.ts';
import { decideScope, entitlementsFor } from '../../plugins/scope.ts';
import { loadSeries } from '../kpi/routes.ts';
import { narrate, type NarrationOutcome } from './narrator.ts';
import type { ModuleDeps } from '../ports.ts';
import { assertRowsInScope, frameworkAssignment, loadDataset, parseRows } from '../shared.ts';

/*
 * The deterministic Ask catalogue (PRD FR-05, ARCH §9). Each intent is a fixed
 * query through the same scope and RLS path as the data routes. Answers are
 * templates over observed values only: no invented numbers, no external policy
 * citations, no confidence scores, and no causal claims.
 */

type AnsweredCard = Extract<AskResponse, { outcome: 'answered' }>['card'];

interface CardContext {
  membership: MembershipClaims;
  period: Period | null;
  disclosure: string;
}

function scopeOf(membership: MembershipClaims) {
  return { role: membership.role, entities: membership.scopes };
}

/** A non-answer: by contract it carries no records and no next action (ADR 0005 §2). */
export function emptyAnswer(
  outcome: Exclude<AskOutcome, 'answered'>,
  answer: string,
  context: CardContext,
  limitations: string[] = [],
): AskResponse {
  return AskResponseSchema.parse({
    outcome,
    mode: 'deterministic',
    card: {
      answer,
      definitionBasis: [],
      reasoning: [],
      scope: scopeOf(context.membership),
      period: context.period,
      limitations,
      relevantRecords: { observations: [], exceptions: [] },
      nextAction: null,
    },
    disclosure: context.disclosure,
  });
}

function answered(
  context: CardContext,
  card: {
    answer: string;
    definitionBasis: PolicyBasis[];
    reasoning: string[];
    limitations: string[];
    observations?: Observation[];
    exceptions?: Exception[];
    nextAction?: AnsweredCard['nextAction'];
  },
): AskResponse {
  return AskResponseSchema.parse({
    outcome: 'answered',
    mode: 'deterministic',
    card: {
      answer: card.answer,
      definitionBasis: card.definitionBasis,
      reasoning: card.reasoning,
      scope: scopeOf(context.membership),
      period: context.period,
      limitations: card.limitations,
      relevantRecords: { observations: card.observations ?? [], exceptions: card.exceptions ?? [] },
      nextAction: card.nextAction ?? null,
    },
    disclosure: context.disclosure,
  });
}

/** Makes a switch's exhaustiveness explicit: adding a union member without a case is a type error. */
function unreachable(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

const OUT_OF_SCOPE = 'This question is outside your authorized scope, so no data was used to answer it.';

export function formatValue(value: MeasureValue, unit: string): string {
  switch (value.status) {
    case 'available':
      return unit === 'percent' ? `${value.value}%` : `${value.value} ${unit}`;
    case 'missing':
      return value.reason === 'missing_denominator' ? 'unavailable (denominator missing)' : 'not reported';
    case 'not_applicable':
      return value.reason === 'zero_denominator' ? 'not applicable (zero denominator)' : 'not applicable (invalid denominator)';
  }
  return unreachable(value);
}

function describeTarget(target: Target, unit: string): string {
  const approval = (value: 'demo_parameter' | 'unapproved') =>
    value === 'demo_parameter' ? 'illustrative demo parameter' : 'unapproved';
  switch (target.state) {
    case 'not_configured':
      return 'No target is configured for this measure.';
    case 'configured':
      return `Target: ${target.value} ${unit}, ${target.direction.replaceAll('_', ' ')} (${approval(target.approval)}; basis: ${target.basis}).`;
    case 'configured_range':
      return `Target range: ${target.low} to ${target.high} ${unit} (${approval(target.approval)}; basis: ${target.basis}).`;
  }
  return unreachable(target);
}

function limitationsOf(observations: readonly Observation[]): string[] {
  const notes = new Set<string>(['All figures are illustrative synthetic data.']);
  for (const observation of observations) {
    const quality = observation.dataQuality;
    if (quality.reconciliation === 'unreconciled') notes.add(`${periodLabel(observation.period)}: source is unreconciled.`);
    if (quality.freshness !== 'current') notes.add(`${periodLabel(observation.period)}: source is ${quality.freshness}.`);
    for (const limitation of quality.limitations) notes.add(limitation);
  }
  return [...notes];
}

function componentLines(observation: Observation): string[] {
  return observation.components.map(
    (component) => `${component.label} (${component.role}): ${formatValue(component.value, component.unit)}.`,
  );
}

function samePeriod(a: Period, b: Period): boolean {
  return a.cadence === b.cadence && a.start === b.start && a.end === b.end;
}

const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "August 2026" for a whole calendar month; the explicit range otherwise. */
function periodLabel(period: Period): string {
  if (period.cadence === 'month' && period.start.endsWith('-01')) {
    return MONTH_NAME.format(new Date(`${period.start}T00:00:00Z`));
  }
  return `${period.start} to ${period.end}`;
}

/** A difference in the measure's own unit; for percentages that is percentage points. */
function changeText(change: number, unit: string): string {
  const signed = change > 0 ? `+${change}` : `${change}`;
  return unit === 'percent' ? `${signed} percentage points` : `${signed} ${unit}`;
}

/** Names from the caller's own entity directory, so answers never show raw ids. */
async function entityNames(deps: ModuleDeps, membership: MembershipClaims): Promise<Map<string, string>> {
  try {
    const entries = parseRows(EntityDirectoryEntrySchema, await deps.entities.visible(membership), 'entity_row_failed_contract');
    return new Map(entries.map((entry) => [`${entry.grain}:${entry.entityId}`, entry.label]));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unavailable') return new Map();
    throw error;
  }
}

/** Answers one typed Ask request for the caller. Never throws for scope; returns an `out_of_scope` answer. */
export async function answer(deps: ModuleDeps, membership: MembershipClaims, request: AskRequest): Promise<AskResponse> {
  const base: CardContext = { membership, period: 'period' in request ? request.period : null, disclosure: deps.disclosure };
  try {
    switch (request.intent) {
      case 'explain_definition':
        return await explainDefinition(deps, membership, request, base);
      case 'report_performance':
        return await reportPerformance(deps, membership, request, base);
      case 'compare_periods':
        return await comparePeriods(deps, membership, request, base);
      case 'explain_contributors':
        return await explainContributors(deps, membership, request, base);
      case 'summarize_exceptions':
        return await summarizeExceptions(deps, membership, base);
    }
    return unreachable(request);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unavailable') {
      return emptyAnswer('unavailable', 'The data needed for this answer is temporarily unavailable.', base);
    }
    throw error;
  }
}

function definitionPolicy(membership: MembershipClaims, assignmentId: string): PolicyBasis[] {
  const assignment = frameworkAssignment(membership, assignmentId);
  return [
    { kind: 'kpi_definition', reference: assignment.assignmentId, text: assignment.definition },
    { kind: 'target_basis', reference: assignment.assignmentId, text: assignment.targetBasis },
  ];
}

async function explainDefinition(
  deps: ModuleDeps,
  membership: MembershipClaims,
  request: Extract<AskRequest, { intent: 'explain_definition' }>,
  context: CardContext,
): Promise<AskResponse> {
  const entitlements = await entitlementsFor(membership, deps.scope);
  if (!entitlements.some((entitlement) => entitlement.assignmentId === request.assignmentId)) {
    return emptyAnswer('out_of_scope', OUT_OF_SCOPE, context);
  }
  const assignment = frameworkAssignment(membership, request.assignmentId);
  const limitations = ['A target basis describes how a target is set; v1 targets are illustrative, not client-approved.'];
  if (assignment.unresolvedReason !== null || assignment.definitionFamilies.length === 0) {
    limitations.push('The mapping from this KPI to its definition family is unresolved.');
  }
  return answered(context, {
    answer: `${assignment.kpi}: ${assignment.definition}`,
    definitionBasis: definitionPolicy(membership, request.assignmentId),
    reasoning: [
      `From the KPI framework, version ${deps.scope.frameworkVersion}, source row ${assignment.sourceRow}.`,
      `Definition families: ${assignment.definitionFamilies.join('; ') || 'none mapped'}.`,
      `Review cadence: ${assignment.review}. Primary data source: ${assignment.primaryDataSource}.`,
    ],
    limitations,
  });
}

async function scopedObservation(
  deps: ModuleDeps,
  membership: MembershipClaims,
  assignmentId: string,
  entity: Observation['entity'],
  period: Period,
): Promise<Observation | undefined> {
  const series = await loadSeries(deps, membership, { assignmentId, entity, from: period.start, to: period.end });
  return series.find((observation) => samePeriod(observation.period, period));
}

async function reportPerformance(
  deps: ModuleDeps,
  membership: MembershipClaims,
  request: Extract<AskRequest, { intent: 'report_performance' }>,
  context: CardContext,
): Promise<AskResponse> {
  const decision = await decideScope(membership, { assignmentId: request.assignmentId, target: request.target }, deps.scope);
  if (!decision.allowed) return emptyAnswer('out_of_scope', OUT_OF_SCOPE, context);

  const assignment = frameworkAssignment(membership, request.assignmentId);
  const observation = await scopedObservation(deps, membership, request.assignmentId, request.target, request.period);
  if (!observation) {
    return emptyAnswer('no_data', `No observation exists for ${assignment.kpi} in ${periodLabel(request.period)}.`, context);
  }
  if (observation.value.status !== 'available') {
    return emptyAnswer(
      'no_data',
      // Say why, in the headline: the source's own data-quality note (e.g. a late feed).
      `${assignment.kpi} for ${periodLabel(request.period)} is ${formatValue(observation.value, observation.unit)}.${
        observation.dataQuality.limitations[0] ? ` ${observation.dataQuality.limitations[0]}` : ''
      }`,
      context,
      limitationsOf([observation]),
    );
  }

  const dataset = await loadDataset(deps, membership);
  return answered(context, {
    answer: `${assignment.kpi} for ${periodLabel(request.period)}: ${formatValue(observation.value, observation.unit)}. ${describeTarget(observation.target, observation.unit)}`,
    definitionBasis: definitionPolicy(membership, request.assignmentId),
    reasoning: componentLines(observation),
    limitations: limitationsOf([observation]),
    observations: [observation],
    nextAction: {
      kind: 'record_action',
      assignmentId: request.assignmentId,
      entity: request.target,
      evidence: {
        observationIds: [observation.observationId],
        definitionVersion: observation.definitionVersion,
        datasetChecksum: dataset.datasetChecksum,
      },
    },
  });
}

async function comparePeriods(
  deps: ModuleDeps,
  membership: MembershipClaims,
  request: Extract<AskRequest, { intent: 'compare_periods' }>,
  context: CardContext,
): Promise<AskResponse> {
  const decision = await decideScope(membership, { assignmentId: request.assignmentId, target: request.target }, deps.scope);
  if (!decision.allowed) return emptyAnswer('out_of_scope', OUT_OF_SCOPE, context);

  const assignment = frameworkAssignment(membership, request.assignmentId);
  const [first, second] = await Promise.all([
    scopedObservation(deps, membership, request.assignmentId, request.target, request.comparePeriod),
    scopedObservation(deps, membership, request.assignmentId, request.target, request.period),
  ]);
  if (!first || !second || first.value.status !== 'available' || second.value.status !== 'available') {
    return emptyAnswer('no_data', `${assignment.kpi} is not available for both periods, so they cannot be compared.`, context);
  }

  const mismatches: string[] = [];
  if (first.period.cadence !== second.period.cadence) mismatches.push('the periods have different cadences');
  if (first.definitionVersion !== second.definitionVersion) mismatches.push('the definition version changed between periods');
  if (first.unit !== second.unit) mismatches.push('the units differ');
  if (mismatches.length > 0) {
    return emptyAnswer('clarification_needed', `These periods are not comparable: ${mismatches.join('; ')}.`, context);
  }

  // Strip binary floating-point noise without choosing a display precision.
  const change = Number((second.value.value - first.value.value).toPrecision(12));
  return answered(context, {
    answer: `${assignment.kpi}: ${formatValue(second.value, second.unit)} in ${periodLabel(second.period)} against ${formatValue(first.value, first.unit)} in ${periodLabel(first.period)}, a change of ${changeText(change, second.unit)}.`,
    definitionBasis: definitionPolicy(membership, request.assignmentId),
    reasoning: [
      `Both observations use definition version ${second.definitionVersion}, unit ${second.unit}, and ${second.period.cadence} cadence.`,
      'The change is the difference of the two observed values; it does not explain why the value moved.',
    ],
    limitations: limitationsOf([first, second]),
    observations: [first, second],
  });
}

async function explainContributors(
  deps: ModuleDeps,
  membership: MembershipClaims,
  request: Extract<AskRequest, { intent: 'explain_contributors' }>,
  context: CardContext,
): Promise<AskResponse> {
  const decision = await decideScope(
    membership,
    { assignmentId: request.assignmentId, target: request.target, breakdown: request.breakdown },
    deps.scope,
  );
  if (!decision.allowed) return emptyAnswer('out_of_scope', OUT_OF_SCOPE, context);

  const assignment = frameworkAssignment(membership, request.assignmentId);
  const rows = await deps.observations.breakdown(membership, {
    assignmentId: request.assignmentId,
    parent: request.target,
    grain: request.breakdown,
    period: request.period,
  });
  const children = parseRows(ObservationSchema, rows, 'observation_row_failed_contract');
  for (const child of children) {
    const inScope = await deps.scope.resolver.contains(membership, child.entity);
    if (child.assignmentId !== request.assignmentId || child.entity.grain !== request.breakdown || !inScope) {
      throw new ApiError('internal', 'An internal error occurred.', 'breakdown_row_outside_request');
    }
  }
  if (children.length === 0) {
    return emptyAnswer('no_data', `No ${request.breakdown}-level observations exist for ${assignment.kpi} in ${periodLabel(request.period)}.`, context);
  }

  const names = await entityNames(deps, membership);
  const nameOf = (entity: Observation['entity']) => names.get(`${entity.grain}:${entity.entityId}`) ?? `a ${entity.grain} in your scope`;
  const valueOf = (child: Observation) => (child.value.status === 'available' ? child.value.value : null);
  const ranked = children.filter((child) => valueOf(child) !== null);
  ranked.sort((a, b) => (valueOf(a) ?? 0) - (valueOf(b) ?? 0));
  const lowest = ranked[0];
  const highest = ranked.at(-1);
  const spread =
    lowest && highest && ranked.length > 1
      ? ` Lowest: ${nameOf(lowest.entity)} at ${formatValue(lowest.value, lowest.unit)}. Highest: ${nameOf(highest.entity)} at ${formatValue(highest.value, highest.unit)}.`
      : '';
  const missing = children.length - ranked.length;

  return answered(context, {
    answer: `${assignment.kpi} for ${periodLabel(request.period)} across ${children.length} ${request.breakdown === 'coe' ? 'COE' : request.breakdown}${children.length === 1 ? '' : 's'} in your scope.${spread}${missing > 0 ? ` ${missing} ${missing === 1 ? 'has' : 'have'} no value to compare.` : ''}`,
    definitionBasis: definitionPolicy(membership, request.assignmentId),
    reasoning: [
      ...children.map((child) => `${nameOf(child.entity)}: ${formatValue(child.value, child.unit)}.`),
      `These are observed values by ${request.breakdown}; they show where the value sits, not why it changed.`,
    ],
    limitations: limitationsOf(children),
    observations: children,
  });
}

async function summarizeExceptions(
  deps: ModuleDeps,
  membership: MembershipClaims,
  context: CardContext,
): Promise<AskResponse> {
  const rows = await deps.exceptions.inbox(membership, PageQuerySchema.parse({}));
  const exceptions = parseRows(ExceptionSchema, rows.items, 'exception_row_failed_contract');
  await assertRowsInScope(membership, exceptions, deps);

  const actNow = exceptions.filter((item) => item.priority === 'act_now').length;
  const withAction = exceptions.filter((item) => item.actionState !== 'none').length;
  const more = rows.nextCursor ? ' More exist; open the inbox to see all of them.' : '';
  return answered(context, {
    answer: `${exceptions.length} exceptions in your scope: ${actNow} to act on now and ${exceptions.length - actNow} to monitor. ${withAction} already have a recorded action.${more}`,
    definitionBasis: [],
    reasoning: [`Order: ${rows.orderingBasis}`],
    limitations: ['Exceptions come from reviewed rules or labelled seeded scenarios in illustrative data.'],
    exceptions,
  });
}

/**
 * The text whose numbers a narration may reuse: the answer plus every figure
 * the card renders. Anything numeric outside it makes the narrator discard the
 * rewording (ADR 0014 §1).
 */
export function narrationSource(response: AskResponse): string {
  const { card } = response;
  const parts = [card.answer, ...card.reasoning, ...card.limitations];
  if (card.period) parts.push(card.period.start, card.period.end);
  for (const observation of card.relevantRecords.observations) {
    parts.push(observation.period.start, observation.period.end);
    if (observation.value.status === 'available') parts.push(String(observation.value.value));
    for (const component of observation.components) {
      if (component.value.status === 'available') parts.push(String(component.value.value));
    }
    const { target } = observation;
    if (target.state === 'configured') parts.push(String(target.value));
    if (target.state === 'configured_range') parts.push(String(target.low), String(target.high));
  }
  // A visible separator, not whitespace: the narrator's number matcher treats
  // whitespace as part of a number, so joining with newlines could fuse two
  // figures into one token (e.g. `5` and `3` into `53`).
  return parts.join(' | ');
}

/**
 * Rewords an answered card's prose with the configured model, or leaves it
 * untouched. Only `answered` outcomes are eligible: refusals and no-data
 * replies are fixed templates and stay deterministic by contract. Numbers,
 * records, citations, scope and disclosure are never passed back from the
 * model, so only `card.answer` can change, and the mode says so.
 */
export async function narrateAnswer(
  deps: ModuleDeps,
  response: AskResponse,
): Promise<{ response: AskResponse; narration: NarrationOutcome | null }> {
  if (response.outcome !== 'answered' || deps.askNarration.providers.length === 0) {
    return { response, narration: null };
  }
  const narration = await narrate(
    response.card.answer,
    {
      providers: deps.askNarration.providers,
      timeoutMs: deps.askNarration.timeoutMs,
      ...(deps.askNarration.fetchImpl ? { fetchImpl: deps.askNarration.fetchImpl } : {}),
    },
    narrationSource(response),
  );
  if (narration.status !== 'narrated') {
    return { response, narration };
  }
  return {
    response: AskResponseSchema.parse({ ...response, mode: 'assisted', card: { ...response.card, answer: narration.answer } }),
    narration,
  };
}
