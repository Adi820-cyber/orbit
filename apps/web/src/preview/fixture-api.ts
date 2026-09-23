import {
  ActionSchema,
  AskRequestSchema,
  AuditEventSchema,
  CreateActionRequestSchema,
  GrainSchema,
  KpiDetailQuerySchema,
  PageQuerySchema,
  TransitionActionRequestSchema,
  type Action,
  type ActionState,
  type AskRequest,
  type AskResponse,
  type AuditEvent,
  type AuditEventKind,
  type ErrorCode,
  type Exception,
  type GuidedPrompt,
  type KpiAssignmentSummary,
  type MeResponse,
  type MeasureValue,
  type Observation,
  type Period,
  type PermittedAssignee,
  type PolicyBasis,
  type ScopeEntity,
  type Target,
} from "@orbit/contracts";
import {
  getAssignment,
  getAssignmentsForRole,
  getDefinitionFamiliesForAssignment,
  type RoleKpiAssignment,
} from "@orbit/kpi-framework";
import type { ApiReply, ApiRequest, ApiTransport } from "../lib/api";
import { sorted } from "../lib/sorted";
import {
  AS_OF,
  ASSIGNMENTS,
  CURRENT_PERIOD,
  DATASET_CHECKSUM,
  DEFINITION_VERSION,
  OBSERVATIONS,
  ORGANIZATION_ID,
  PREVIEW_DISCLOSURE,
  REGION_NORTH,
  REGION_SOUTH,
  briefFor,
  facilitiesIn,
  findObservation,
  regionOf,
  seriesFor,
} from "./dataset";

/*
 * DEVELOPER PREVIEW ONLY. An in-memory stand-in for `services/api` so the
 * Regional COO workspace runs end to end before the database exists.
 *
 * This is not an authorization implementation — the Fastify API and RLS are
 * the boundary. It mirrors the rules the backend already has so the UI is
 * exercised against realistic refusals rather than a happy path:
 *   - scope: `plugins/scope.ts` (deny by default, explicit `out_of_scope`)
 *   - guided prompts and Ask templates: `modules/ask/{prompts,catalogue}.ts`
 *   - evidence and assignee re-verification: `modules/actions/routes.ts`
 *   - transitions: Ghansham's PROPOSED matrix (not yet signed off)
 * Preview entitlements follow ADR 0011 (proposed) plus the facility grain the
 * backend's own module fixture grants for capacity, which PRD §5.3 needs.
 */

export type PreviewPersona = "north" | "south";

export interface StateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FixtureApiOptions {
  persona?: PreviewPersona;
  storage?: StateStorage | null;
  now?: () => Date;
}

type Relation = "creator" | "assignee";

interface StoredAction {
  action: Action;
  relation: Relation;
  idempotencyKey: string | null;
}

interface PreviewState {
  version: 1;
  actions: StoredAction[];
  audit: AuditEvent[];
  counter: number;
}

class FixtureError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = {
      unauthenticated: 401,
      forbidden: 403,
      out_of_scope: 403,
      invalid_request: 400,
      not_found: 404,
      conflict: 409,
      unavailable: 503,
      internal: 500,
    }[code];
  }
}

const OUT_OF_SCOPE_MESSAGE = "The requested data is outside your authorized scope.";
const OUT_OF_SCOPE_ANSWER = "This question is outside your authorized scope, so no data was used to answer it.";
const CHANGED = "This action was changed by someone else. Reload it and try again.";
const PROMPTED_ASSIGNMENTS = 3;

export const ORDERING_BASIS =
  "Act-now before monitor; within each, safety, legal and compliance before performance; then the most recent period first.";

/** Ghansham's PROPOSED transition matrix (services/api TRANSITIONS.md), awaiting Aditya's sign-off. */
const PROPOSED_TRANSITIONS: readonly { from: ActionState; to: ActionState; by: Relation }[] = [
  { from: "open", to: "acknowledged", by: "assignee" },
  { from: "acknowledged", to: "in_progress", by: "assignee" },
  { from: "in_progress", to: "completed", by: "assignee" },
  { from: "open", to: "cancelled", by: "creator" },
  { from: "acknowledged", to: "cancelled", by: "creator" },
  { from: "in_progress", to: "cancelled", by: "creator" },
];

interface PreviewEntitlement {
  assignmentId: string;
  grains: ScopeEntity["grain"][];
  breakdowns: ScopeEntity["grain"][];
}

const ENTITLEMENTS: readonly PreviewEntitlement[] = getAssignmentsForRole("regional-coo").map((assignment) => ({
  assignmentId: assignment.assignmentId,
  grains: assignment.assignmentId === ASSIGNMENTS.capacity ? ["region", "facility"] : ["region"],
  breakdowns: ["facility"],
}));

const SEVERITY: Record<Exception["category"], number> = { safety: 0, legal: 1, compliance: 2, performance: 3 };

function sameEntity(a: ScopeEntity, b: ScopeEntity) {
  return a.grain === b.grain && a.entityId === b.entityId;
}

function samePeriod(a: Period, b: Period) {
  return a.cadence === b.cadence && a.start === b.start && a.end === b.end;
}

function periodText(period: Period) {
  return `${period.start} to ${period.end}`;
}

function formatValue(value: MeasureValue, unit: string) {
  switch (value.status) {
    case "available":
      return `${value.value} ${unit}`;
    case "missing":
      return value.reason === "missing_denominator" ? "unavailable (denominator missing)" : "not reported";
    case "not_applicable":
      return value.reason === "zero_denominator" ? "not applicable (zero denominator)" : "not applicable (invalid denominator)";
  }
}

function describeTarget(target: Target, unit: string) {
  const approval = (value: "demo_parameter" | "unapproved") =>
    value === "demo_parameter" ? "illustrative demo parameter" : "unapproved";
  switch (target.state) {
    case "not_configured":
      return "No target is configured for this measure.";
    case "configured":
      return `Target: ${target.value} ${unit}, ${target.direction.replaceAll("_", " ")} (${approval(target.approval)}; basis: ${target.basis}).`;
    case "configured_range":
      return `Target range: ${target.low} to ${target.high} ${unit} (${approval(target.approval)}; basis: ${target.basis}).`;
  }
}

function limitationsOf(observations: readonly Observation[]) {
  const notes = new Set<string>(["All figures are illustrative synthetic data."]);
  for (const observation of observations) {
    const quality = observation.dataQuality;
    if (quality.reconciliation === "unreconciled") notes.add(`${periodText(observation.period)}: source is unreconciled.`);
    if (quality.freshness !== "current") notes.add(`${periodText(observation.period)}: source is ${quality.freshness}.`);
    for (const limitation of quality.limitations) notes.add(limitation);
  }
  return [...notes];
}

function breakdownRows(assignmentId: string, parent: ScopeEntity, grain: ScopeEntity["grain"], period: Period) {
  if (parent.grain !== "region" || grain !== "facility") return [];
  const children = facilitiesIn(parent);
  return OBSERVATIONS.filter(
    (row) =>
      row.assignmentId === assignmentId &&
      row.period.start === period.start &&
      children.some((child) => sameEntity(child, row.entity)),
  );
}

/** Placeholder directory: Hospital DHOs of the facilities in scope. Cross-scope assignment is open (ADR 0011 §5.2). */
function permittedAssignees(assignmentId: string, entity: ScopeEntity): PermittedAssignee[] {
  if (!ENTITLEMENTS.some((row) => row.assignmentId === assignmentId)) return [];
  const facilities = entity.grain === "facility" ? [entity] : entity.grain === "region" ? facilitiesIn(entity) : [];
  return facilities.map((facility) => ({
    assigneeId: `fixture-assignee-dho-${facility.entityId}`,
    role: "hospital-dho",
    scopes: [facility],
  }));
}

function seedState(region: ScopeEntity): PreviewState {
  const revenue = OBSERVATIONS.find(
    (row) =>
      row.assignmentId === ASSIGNMENTS.revenue &&
      sameEntity(row.entity, region) &&
      row.period.start === CURRENT_PERIOD.start,
  );
  if (!revenue) throw new Error("Preview fixture is missing the seeded revenue observation.");

  const action: Action = {
    actionId: "act-seed-1",
    state: "open",
    version: 1,
    title: "Confirm when the August 2026 management-accounts close will be reconciled",
    assignmentId: ASSIGNMENTS.revenue,
    entity: region,
    evidence: {
      observationIds: [revenue.observationId],
      definitionVersion: DEFINITION_VERSION,
      datasetChecksum: DATASET_CHECKSUM,
    },
    creatorRole: "chairman",
    assignee: { assigneeId: `fixture-assignee-coo-${region.entityId}`, role: "regional-coo" },
    dueDate: "2026-09-15",
    createdAt: "2026-09-02T08:00:00Z",
    updatedAt: "2026-09-02T08:00:00Z",
  };

  return {
    version: 1,
    actions: [{ action, relation: "assignee", idempotencyKey: null }],
    audit: [
      {
        eventId: "evt-seed-1",
        occurredAt: action.createdAt,
        kind: "action_created",
        actorRole: "chairman",
        target: { type: "action", id: action.actionId },
        outcome: "open",
        requestId: "preview-seed",
      },
    ],
    counter: 1,
  };
}

function restoreAction(row: unknown): StoredAction {
  if (typeof row !== "object" || row === null || !("action" in row) || !("relation" in row)) {
    throw new Error("Stored preview action is malformed.");
  }
  const relation = row.relation === "creator" || row.relation === "assignee" ? row.relation : null;
  if (!relation) throw new Error("Stored preview relation is malformed.");
  const key = "idempotencyKey" in row && typeof row.idempotencyKey === "string" ? row.idempotencyKey : null;
  return { action: ActionSchema.parse(row.action), relation, idempotencyKey: key };
}

/** Browser storage is untrusted input: parse it, and fall back to the seed on any mismatch. */
function restoreState(raw: string | null): PreviewState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 1 ||
      !("actions" in value) ||
      !Array.isArray(value.actions) ||
      !("audit" in value) ||
      !Array.isArray(value.audit) ||
      !("counter" in value) ||
      typeof value.counter !== "number"
    ) {
      return null;
    }
    return {
      version: 1,
      actions: value.actions.map(restoreAction),
      audit: value.audit.map((row: unknown) => AuditEventSchema.parse(row)),
      counter: value.counter,
    };
  } catch {
    return null;
  }
}

function page<T>(items: readonly T[], query: URLSearchParams | undefined) {
  const parsed = PageQuerySchema.safeParse(Object.fromEntries(query ?? []));
  if (!parsed.success) throw new FixtureError("invalid_request", "The request is invalid.");
  const offset = parsed.data.cursor ? Number(parsed.data.cursor) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new FixtureError("invalid_request", "The request is invalid.");
  const slice = items.slice(offset, offset + parsed.data.limit);
  const next = offset + parsed.data.limit;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}

export function createFixtureApi(options: FixtureApiOptions = {}) {
  const persona = options.persona ?? "north";
  const region = persona === "north" ? REGION_NORTH : REGION_SOUTH;
  const storage = options.storage ?? null;
  const now = options.now ?? (() => new Date());
  const storageKey = `orbit-preview-state:${persona}:v1`;
  const membership: MeResponse = { role: "regional-coo", organizationId: ORGANIZATION_ID, scopes: [region] };

  let state = restoreState(storage?.getItem(storageKey) ?? null) ?? seedState(region);

  function save() {
    storage?.setItem(storageKey, JSON.stringify(state));
  }

  function nextRequestId() {
    state.counter += 1;
    return `preview-req-${state.counter}`;
  }

  function record(kind: AuditEventKind, target: AuditEvent["target"], outcome: string, requestId: string) {
    state.audit.push({
      eventId: `evt-${state.audit.length + 1}-${state.counter}`,
      occurredAt: now().toISOString(),
      kind,
      actorRole: membership.role,
      target,
      outcome,
      requestId,
    });
    save();
  }

  function contains(target: ScopeEntity) {
    return regionOf(target) === region.entityId;
  }

  function decide(assignmentId: string, target: ScopeEntity, breakdown?: ScopeEntity["grain"]) {
    const entitlement = ENTITLEMENTS.find((row) => row.assignmentId === assignmentId);
    if (!entitlement) return null;
    if (!entitlement.grains.includes(target.grain)) return null;
    if (breakdown !== undefined && !entitlement.breakdowns.includes(breakdown)) return null;
    if (!contains(target)) return null;
    return entitlement;
  }

  function assertInScope(assignmentId: string, target: ScopeEntity, breakdown?: ScopeEntity["grain"]) {
    const entitlement = decide(assignmentId, target, breakdown);
    if (!entitlement) throw new FixtureError("out_of_scope", OUT_OF_SCOPE_MESSAGE);
    return entitlement;
  }

  function framework(assignmentId: string): RoleKpiAssignment {
    const assignment = getAssignment(assignmentId);
    if (!assignment || assignment.roleId !== membership.role) {
      throw new FixtureError("internal", "An internal error occurred.");
    }
    return assignment;
  }

  function summary(entitlement: PreviewEntitlement): KpiAssignmentSummary {
    const assignment = framework(entitlement.assignmentId);
    return {
      assignmentId: assignment.assignmentId,
      roleId: assignment.roleId,
      kpi: assignment.kpi,
      keyDeliverable: assignment.keyDeliverable,
      weight: assignment.weight,
      definitionFamilies: [...assignment.definitionFamilies],
      unresolved: assignment.unresolvedReason !== null || assignment.definitionFamilies.length === 0,
      targetBasis: assignment.targetBasis,
      review: assignment.review,
      primaryDataSource: assignment.primaryDataSource,
      grains: [...entitlement.grains],
      breakdowns: [...entitlement.breakdowns],
    };
  }

  function actionStateFor(exception: Exception): Exception["actionState"] {
    const linked = sorted(
      state.actions.filter(
        ({ action }) => action.assignmentId === exception.assignmentId && sameEntity(action.entity, exception.entity),
      ),
      (a, b) => b.action.createdAt.localeCompare(a.action.createdAt),
    );
    return linked[0]?.action.state ?? "none";
  }

  function exceptions() {
    return sorted(
      briefFor(region).exceptions.map((exception) => ({ ...exception, actionState: actionStateFor(exception) })),
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === "act_now" ? -1 : 1) ||
        SEVERITY[a.category] - SEVERITY[b.category] ||
        b.period.start.localeCompare(a.period.start),
    );
  }

  function series(assignmentId: string, entity: ScopeEntity, from?: string, to?: string) {
    return sorted(
      seriesFor(assignmentId, entity).filter(
        (row) => (!from || row.period.start >= from) && (!to || row.period.end <= to),
      ),
      (a, b) => a.period.start.localeCompare(b.period.start) || a.definitionFamily.localeCompare(b.definitionFamily),
    );
  }

  function definitionPolicy(assignmentId: string): PolicyBasis[] {
    const assignment = framework(assignmentId);
    return [
      { kind: "kpi_definition", reference: assignment.assignmentId, text: assignment.definition },
      { kind: "target_basis", reference: assignment.assignmentId, text: assignment.targetBasis },
    ];
  }

  function emptyAnswer(
    outcome: Exclude<AskResponse["outcome"], "answered">,
    answer: string,
    period: Period | null,
    limitations: string[] = [],
  ): AskResponse {
    return {
      outcome,
      mode: "deterministic",
      card: {
        answer,
        definitionBasis: [],
        reasoning: [],
        scope: { role: membership.role, entities: membership.scopes },
        period,
        limitations,
        relevantRecords: { observations: [], exceptions: [] },
        nextAction: null,
      },
      disclosure: PREVIEW_DISCLOSURE,
    };
  }

  function answered(
    period: Period | null,
    card: {
      answer: string;
      definitionBasis: PolicyBasis[];
      reasoning: string[];
      limitations: string[];
      observations?: Observation[];
      exceptions?: Exception[];
      nextAction?: Extract<AskResponse, { outcome: "answered" }>["card"]["nextAction"];
    },
  ): AskResponse {
    return {
      outcome: "answered",
      mode: "deterministic",
      card: {
        answer: card.answer,
        definitionBasis: card.definitionBasis,
        reasoning: card.reasoning,
        scope: { role: membership.role, entities: membership.scopes },
        period,
        limitations: card.limitations,
        relevantRecords: { observations: card.observations ?? [], exceptions: card.exceptions ?? [] },
        nextAction: card.nextAction ?? null,
      },
      disclosure: PREVIEW_DISCLOSURE,
    };
  }

  function observationAt(assignmentId: string, entity: ScopeEntity, period: Period) {
    return series(assignmentId, entity, period.start, period.end).find((row) => samePeriod(row.period, period));
  }

  function answer(request: AskRequest): AskResponse {
    const period = "period" in request ? request.period : null;

    switch (request.intent) {
      case "explain_definition": {
        if (!ENTITLEMENTS.some((row) => row.assignmentId === request.assignmentId)) {
          return emptyAnswer("out_of_scope", OUT_OF_SCOPE_ANSWER, period);
        }
        const assignment = framework(request.assignmentId);
        const limitations = ["A target basis describes how a target is set; v1 targets are illustrative, not client-approved."];
        if (assignment.unresolvedReason !== null || assignment.definitionFamilies.length === 0) {
          limitations.push("The mapping from this KPI to its definition family is unresolved.");
        }
        return answered(period, {
          answer: `${assignment.kpi}: ${assignment.definition}`,
          definitionBasis: definitionPolicy(request.assignmentId),
          reasoning: [
            `From the KPI framework, version ${DEFINITION_VERSION}, source row ${assignment.sourceRow}.`,
            `Definition families: ${assignment.definitionFamilies.join("; ") || "none mapped"}.`,
            `Review cadence: ${assignment.review}. Primary data source: ${assignment.primaryDataSource}.`,
          ],
          limitations,
        });
      }
      case "report_performance": {
        if (!decide(request.assignmentId, request.target)) return emptyAnswer("out_of_scope", OUT_OF_SCOPE_ANSWER, period);
        const assignment = framework(request.assignmentId);
        const observation = observationAt(request.assignmentId, request.target, request.period);
        if (!observation) {
          return emptyAnswer("no_data", `No observation exists for ${assignment.kpi} in ${periodText(request.period)}.`, period);
        }
        if (observation.value.status !== "available") {
          return emptyAnswer(
            "no_data",
            `${assignment.kpi} for ${periodText(request.period)} is ${formatValue(observation.value, observation.unit)}.`,
            period,
            limitationsOf([observation]),
          );
        }
        return answered(period, {
          answer: `${assignment.kpi} for ${periodText(request.period)}: ${formatValue(observation.value, observation.unit)}. ${describeTarget(observation.target, observation.unit)}`,
          definitionBasis: definitionPolicy(request.assignmentId),
          reasoning: observation.components.map(
            (component) => `${component.label} (${component.role}): ${formatValue(component.value, component.unit)}.`,
          ),
          limitations: limitationsOf([observation]),
          observations: [observation],
          nextAction: {
            kind: "record_action",
            assignmentId: request.assignmentId,
            entity: request.target,
            evidence: {
              observationIds: [observation.observationId],
              definitionVersion: observation.definitionVersion,
              datasetChecksum: DATASET_CHECKSUM,
            },
          },
        });
      }
      case "compare_periods": {
        if (!decide(request.assignmentId, request.target)) return emptyAnswer("out_of_scope", OUT_OF_SCOPE_ANSWER, period);
        const assignment = framework(request.assignmentId);
        const first = observationAt(request.assignmentId, request.target, request.comparePeriod);
        const second = observationAt(request.assignmentId, request.target, request.period);
        if (!first || !second || first.value.status !== "available" || second.value.status !== "available") {
          return emptyAnswer("no_data", `${assignment.kpi} is not available for both periods, so they cannot be compared.`, period);
        }
        const mismatches: string[] = [];
        if (first.period.cadence !== second.period.cadence) mismatches.push("the periods have different cadences");
        if (first.definitionVersion !== second.definitionVersion) mismatches.push("the definition version changed between periods");
        if (first.unit !== second.unit) mismatches.push("the units differ");
        if (mismatches.length > 0) {
          return emptyAnswer("clarification_needed", `These periods are not comparable: ${mismatches.join("; ")}.`, period);
        }
        const change = Number((second.value.value - first.value.value).toPrecision(12));
        return answered(period, {
          answer: `${assignment.kpi}: ${formatValue(second.value, second.unit)} in ${periodText(second.period)} against ${formatValue(first.value, first.unit)} in ${periodText(first.period)}, a change of ${change} ${second.unit}.`,
          definitionBasis: definitionPolicy(request.assignmentId),
          reasoning: [
            `Both observations use definition version ${second.definitionVersion}, unit ${second.unit}, and ${second.period.cadence} cadence.`,
            "The change is the difference of the two observed values; it does not explain why the value moved.",
          ],
          limitations: limitationsOf([first, second]),
          observations: [first, second],
        });
      }
      case "explain_contributors": {
        if (!decide(request.assignmentId, request.target, request.breakdown)) {
          return emptyAnswer("out_of_scope", OUT_OF_SCOPE_ANSWER, period);
        }
        const assignment = framework(request.assignmentId);
        const children = breakdownRows(request.assignmentId, request.target, request.breakdown, request.period);
        if (children.length === 0) {
          return emptyAnswer(
            "no_data",
            `No ${request.breakdown}-level observations exist for ${assignment.kpi} in ${periodText(request.period)}.`,
            period,
          );
        }
        return answered(period, {
          answer: `${assignment.kpi} for ${periodText(request.period)} has ${children.length} ${request.breakdown}-level observations in your scope.`,
          definitionBasis: definitionPolicy(request.assignmentId),
          reasoning: [
            ...children.map((child) => `${child.entity.entityId}: ${formatValue(child.value, child.unit)}.`),
            `These are observed values by ${request.breakdown}; they show where the value sits, not why it changed.`,
          ],
          limitations: limitationsOf(children),
          observations: children,
        });
      }
      case "summarize_exceptions": {
        const items = exceptions();
        const actNow = items.filter((item) => item.priority === "act_now").length;
        const withAction = items.filter((item) => item.actionState !== "none").length;
        return answered(period, {
          answer: `${items.length} exceptions in your scope: ${actNow} to act on now and ${items.length - actNow} to monitor. ${withAction} already have a recorded action.`,
          definitionBasis: [],
          reasoning: [`Order: ${ORDERING_BASIS}`],
          limitations: ["Exceptions come from reviewed rules or labelled seeded scenarios in illustrative data."],
          exceptions: items,
        });
      }
    }
  }

  function guidedPrompts(): GuidedPrompt[] {
    const prompts: GuidedPrompt[] = [
      { promptId: "summarize_exceptions", label: "Summarize my open exceptions", request: { intent: "summarize_exceptions" } },
    ];
    const ranked = sorted(
      ENTITLEMENTS.map((entitlement, order) => ({ entitlement, order, assignment: framework(entitlement.assignmentId) })),
      (a, b) => b.assignment.weight - a.assignment.weight || a.order - b.order,
    ).slice(0, PROMPTED_ASSIGNMENTS);

    let breakdownOffered = false;
    for (const { entitlement, assignment } of ranked) {
      const target = membership.scopes.find((scope) => entitlement.grains.includes(scope.grain));
      if (target) {
        prompts.push({
          promptId: `report_performance:${assignment.assignmentId}`,
          label: `Report ${assignment.kpi} for my ${target.grain} this period`,
          request: { intent: "report_performance", assignmentId: assignment.assignmentId, target, period: CURRENT_PERIOD },
        });
        const breakdown = entitlement.breakdowns[0];
        if (!breakdownOffered && breakdown) {
          breakdownOffered = true;
          prompts.push({
            promptId: `explain_contributors:${assignment.assignmentId}`,
            label: `Break down ${assignment.kpi} by ${breakdown}`,
            request: { intent: "explain_contributors", assignmentId: assignment.assignmentId, target, period: CURRENT_PERIOD, breakdown },
          });
        }
      }
      prompts.push({
        promptId: `explain_definition:${assignment.assignmentId}`,
        label: `Explain how ${assignment.kpi} is defined`,
        request: { intent: "explain_definition", assignmentId: assignment.assignmentId },
      });
    }
    return prompts;
  }

  function stored(actionId: string) {
    const found = state.actions.find((row) => row.action.actionId === actionId);
    if (!found) throw new FixtureError("not_found", "The requested resource does not exist.");
    return found;
  }

  function createAction(body: unknown, requestId: string): ApiReply {
    const parsed = CreateActionRequestSchema.safeParse(body);
    if (!parsed.success) throw new FixtureError("invalid_request", "The request is invalid.");
    const input = parsed.data;

    assertInScope(input.assignmentId, input.entity);

    if (input.evidence.datasetChecksum !== DATASET_CHECKSUM) {
      throw new FixtureError("conflict", "The evidence is from an older dataset. Reload it and try again.");
    }
    const ids = [...new Set(input.evidence.observationIds)];
    for (const id of ids) {
      const observation = findObservation(id);
      if (!observation) throw new FixtureError("invalid_request", "The request is invalid.");
      if (observation.assignmentId !== input.assignmentId || observation.definitionVersion !== input.evidence.definitionVersion) {
        throw new FixtureError("invalid_request", "The request is invalid.");
      }
      if (!decide(input.assignmentId, observation.entity)) throw new FixtureError("out_of_scope", OUT_OF_SCOPE_MESSAGE);
    }
    const assignee = permittedAssignees(input.assignmentId, input.entity).find((row) => row.assigneeId === input.assigneeId);
    if (!assignee) {
      throw new FixtureError("invalid_request", "The selected assignee cannot be assigned this action.");
    }

    const existing = state.actions.find((row) => row.relation === "creator" && row.idempotencyKey === input.idempotencyKey);
    if (existing) {
      const same =
        existing.action.title === input.title &&
        existing.action.assignmentId === input.assignmentId &&
        sameEntity(existing.action.entity, input.entity) &&
        existing.action.assignee.assigneeId === input.assigneeId &&
        existing.action.dueDate === input.dueDate;
      if (!same) throw new FixtureError("conflict", "This request was already used for a different action.");
      return { status: 200, body: { action: existing.action, replayed: true } };
    }

    const timestamp = now().toISOString();
    const action: Action = {
      actionId: `act-${state.actions.length + 1}-${state.counter}`,
      state: "open",
      version: 1,
      title: input.title,
      assignmentId: input.assignmentId,
      entity: input.entity,
      evidence: { ...input.evidence, observationIds: ids },
      creatorRole: membership.role,
      assignee: { assigneeId: assignee.assigneeId, role: assignee.role },
      dueDate: input.dueDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.actions.push({ action, relation: "creator", idempotencyKey: input.idempotencyKey });
    record("action_created", { type: "action", id: action.actionId }, "open", requestId);
    return { status: 201, body: { action, replayed: false } };
  }

  function transitionAction(actionId: string, body: unknown, requestId: string): ApiReply {
    const parsed = TransitionActionRequestSchema.safeParse(body);
    if (!parsed.success) throw new FixtureError("invalid_request", "The request is invalid.");
    const found = stored(actionId);

    if (found.action.version !== parsed.data.expectedVersion) throw new FixtureError("conflict", CHANGED);

    const matching = PROPOSED_TRANSITIONS.filter((rule) => rule.from === found.action.state && rule.to === parsed.data.toState);
    if (matching.length === 0) throw new FixtureError("conflict", "This action cannot move to that state.");
    if (!matching.some((rule) => rule.by === found.relation)) {
      throw new FixtureError("forbidden", "You are not permitted to make this change.");
    }

    found.action = {
      ...found.action,
      state: parsed.data.toState,
      version: found.action.version + 1,
      updatedAt: now().toISOString(),
    };
    record("action_transitioned", { type: "action", id: actionId }, parsed.data.toState, requestId);
    return { status: 200, body: { action: found.action, replayed: false } };
  }

  function route(request: ApiRequest, requestId: string): ApiReply {
    const { method, path } = request;
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    const [prefix, resource, id, sub] = segments;

    if (prefix !== "api") throw new FixtureError("not_found", "The requested resource does not exist.");

    if (method === "GET" && resource === "me" && !id) return { status: 200, body: membership };

    if (method === "GET" && resource === "brief" && !id) {
      const brief = briefFor(region);
      const items = exceptions();
      return {
        status: 200,
        body: {
          period: CURRENT_PERIOD,
          asOf: AS_OF,
          actNow: items.filter((item) => item.priority === "act_now"),
          monitor: items.filter((item) => item.priority === "monitor"),
          onTrack: brief.onTrack,
          dataLimitations: brief.dataLimitations,
          disclosure: PREVIEW_DISCLOSURE,
        },
      };
    }

    if (method === "GET" && resource === "inbox" && !id) {
      const result = page(exceptions(), request.query);
      return { status: 200, body: { ...result, orderingBasis: ORDERING_BASIS, disclosure: PREVIEW_DISCLOSURE } };
    }

    if (method === "GET" && resource === "kpi" && !id) {
      return {
        status: 200,
        body: { frameworkVersion: DEFINITION_VERSION, assignments: ENTITLEMENTS.map(summary), disclosure: PREVIEW_DISCLOSURE },
      };
    }

    if (method === "GET" && resource === "kpi" && id && !sub) {
      const query = KpiDetailQuerySchema.safeParse(Object.fromEntries(request.query ?? []));
      if (!query.success) throw new FixtureError("invalid_request", "The request is invalid.");
      const target = { grain: query.data.grain, entityId: query.data.entityId };
      const entitlement = assertInScope(id, target, query.data.breakdown);
      const rows = series(id, target, query.data.from, query.data.to);
      const latest = rows.at(-1);
      const breakdown =
        query.data.breakdown && latest
          ? { grain: query.data.breakdown, observations: breakdownRows(id, target, query.data.breakdown, latest.period) }
          : null;
      record("evidence_viewed", { type: "assignment", id }, "served", requestId);
      return {
        status: 200,
        body: {
          assignment: summary(entitlement),
          definitions: getDefinitionFamiliesForAssignment(id).map((family) => ({
            family: family.family,
            standardDefinition: family.standardDefinition,
            numeratorDenominatorControl: family.numeratorDenominatorControl,
          })),
          scope: target,
          series: rows,
          breakdown,
          disclosure: PREVIEW_DISCLOSURE,
        },
      };
    }

    if (method === "GET" && resource === "ask" && id === "prompts") {
      return { status: 200, body: { mode: "deterministic", prompts: guidedPrompts(), disclosure: PREVIEW_DISCLOSURE } };
    }

    if (method === "POST" && resource === "ask" && !id) {
      const parsed = AskRequestSchema.safeParse(request.body);
      const response = parsed.success
        ? answer(parsed.data)
        : emptyAnswer("clarification_needed", "Choose one of the guided questions, or supply every detail the question needs.", null);
      record("ask_answered", { type: "ask", id: parsed.success ? parsed.data.intent : "unrecognized" }, response.outcome, requestId);
      return { status: 200, body: response };
    }

    if (resource === "actions") {
      if (method === "GET" && !id) {
        const items = sorted(
          state.actions.map((row) => row.action),
          (a, b) => b.createdAt.localeCompare(a.createdAt),
        );
        return { status: 200, body: page(items, request.query) };
      }
      if (method === "GET" && id === "assignees" && !sub) {
        const query = Object.fromEntries(request.query ?? []);
        const grain = GrainSchema.safeParse(query.grain);
        if (!grain.success || !query.assignmentId || !query.entityId) {
          throw new FixtureError("invalid_request", "The request is invalid.");
        }
        const entity = { grain: grain.data, entityId: query.entityId };
        assertInScope(query.assignmentId, entity);
        return { status: 200, body: { assignees: permittedAssignees(query.assignmentId, entity) } };
      }
      if (method === "GET" && id && !sub) return { status: 200, body: { action: stored(id).action, replayed: false } };
      if (method === "POST" && !id) return createAction(request.body, requestId);
      if (method === "POST" && id && sub === "transitions") return transitionAction(id, request.body, requestId);
    }

    if (method === "GET" && resource === "audit" && !id) {
      const items = sorted(
        state.audit,
        (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.eventId.localeCompare(a.eventId),
      );
      return { status: 200, body: page(items, request.query) };
    }

    throw new FixtureError("not_found", "The requested resource does not exist.");
  }

  async function handle(request: ApiRequest): Promise<ApiReply> {
    const requestId = nextRequestId();
    try {
      const reply = route(request, requestId);
      save();
      return reply;
    } catch (error: unknown) {
      if (!(error instanceof FixtureError)) throw error;
      if (error.code === "out_of_scope" || error.code === "forbidden") {
        record("access_denied", { type: "route", id: request.path }, error.code, requestId);
      }
      return { status: error.status, body: { error: { code: error.code, message: error.message, requestId } } };
    }
  }

  function reset() {
    storage?.removeItem(storageKey);
    state = seedState(region);
  }

  const transport: ApiTransport = handle;

  return { handle, reset, transport, persona };
}

export type FixtureApi = ReturnType<typeof createFixtureApi>;
