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
  type EntityDirectoryEntry,
  type MeResponse,
  type MeasureValue,
  type Observation,
  type Period,
  type PermittedAssignee,
  type PolicyBasis,
  type RoleId,
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
  CLINICAL_ASSIGNMENTS,
  CLINICAL_COE,
  clinicalBrief,
  clinicalBreakdownRows,
  clinicalFindObservation,
  clinicalSeriesFor,
} from "./clinical-dataset";
import {
  DHO_ASSIGNMENTS,
  DHO_FACILITY,
  dhoBrief,
  dhoBreakdownRows,
  dhoFindObservation,
  dhoObservationFor,
  dhoSeriesFor,
} from "./dho-dataset";
import {
  PEOPLE_ASSIGNMENTS,
  peopleBrief,
  peopleBreakdownRows,
  peopleFindObservation,
  peopleObservationFor,
  peopleSeriesFor,
} from "./people-dataset";
import {
  BD_ASSIGNMENTS,
  bdBrief,
  bdBreakdownRows,
  bdFindObservation,
  bdObservationFor,
  bdSeriesFor,
} from "./bd-dataset";
import {
  BILLING_ASSIGNMENTS,
  billingBrief,
  billingBreakdownRows,
  billingFindObservation,
  billingObservationFor,
  billingSeriesFor,
} from "./billing-dataset";
import {
  COE_ASSIGNMENTS,
  coeBrief,
  coeBreakdownRows,
  coeFindObservation,
  coeObservationFor,
  coeSeriesFor,
} from "./coe-dataset";
import {
  CORPORATE_ASSIGNMENTS,
  corporateBrief,
  corporateBreakdownRows,
  corporateFindObservation,
  corporateObservationFor,
  corporateSeriesFor,
} from "./corporate-revenue-dataset";
import {
  GROUP_CFO_ASSIGNMENTS,
  groupCfoBrief,
  groupCfoBreakdownRows,
  groupCfoFindObservation,
  groupCfoObservationFor,
  groupCfoSeriesFor,
} from "./group-cfo-dataset";
import {
  PROCUREMENT_ASSIGNMENTS,
  procurementBrief,
  procurementBreakdownRows,
  procurementFindObservation,
  procurementObservationFor,
  procurementSeriesFor,
} from "./procurement-dataset";
import {
  HR_ASSIGNMENTS,
  hrBrief,
  hrBreakdownRows,
  hrFindObservation,
  hrObservationFor,
  hrSeriesFor,
} from "./hr-dataset";
import {
  LEGAL_ASSIGNMENTS,
  legalBrief,
  legalBreakdownRows,
  legalFindObservation,
  legalObservationFor,
  legalSeriesFor,
} from "./legal-dataset";
import {
  ANALYTICS_ASSIGNMENTS,
  analyticsBrief,
  analyticsBreakdownRows,
  analyticsFindObservation,
  analyticsObservationFor,
  analyticsSeriesFor,
} from "./analytics-dataset";
import {
  AS_OF,
  ASSIGNMENTS,
  CHAIRMAN_ASSIGNMENTS,
  CURRENT_PERIOD,
  DATASET_CHECKSUM,
  DEFINITION_VERSION,
  GROUP,
  OBSERVATIONS,
  ORGANIZATION_ID,
  PREVIEW_DISCLOSURE,
  FACILITIES,
  REGION_NORTH,
  REGION_SOUTH,
  briefFor,
  chairmanBrief,
  facilitiesIn,
  findObservation,
  regionOf,
  REGIONS,
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
 *   - assignment: ADR 0011 §6, downward only, to scopes inside the caller's
 *   - audit: ADR 0011 §7, only events for the caller's own actions are listed;
 *     Ask outcomes, evidence views, and denials are recorded but never read
 * Preview entitlements follow ADR 0011 (proposed) plus the facility grain the
 * backend's own module fixture grants for capacity, which PRD §5.3 needs.
 */

export type PreviewPersona = "north" | "south" | "chairman" | "clinical-director" | "hospital-dho" | "people-executive" | "bd-lead" | "billing-lead" | "coe-lead" | "corporate-revenue-lead" | "group-cfo" | "procurement-head" | "hr-head" | "legal-head" | "analytics-head";

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

function entitlementsFor(role: RoleId): readonly PreviewEntitlement[] {
  return getAssignmentsForRole(role).map((assignment) => ({
    assignmentId: assignment.assignmentId,
    grains:
      role === "regional-coo"
        ? assignment.assignmentId === ASSIGNMENTS.capacity
          ? ["region", "facility"]
          : ["region"]
        : role === "clinical-director"
          ? ["group", "coe"]
          : role === "hospital-dho"
            ? ["facility"]
          : role === "people-executive"
              ? ["facility"]
            : role === "bd-lead"
              ? ["facility"]
            : role === "billing-lead"
              ? ["facility"]
            : role === "coe-lead"
              ? ["coe"]
            : role === "corporate-revenue-lead"
              ? ["group"]
            : role === "group-cfo"
              ? ["group"]
            : role === "procurement-head"
              ? ["group"]
            : role === "hr-head"
              ? ["group"]
            : role === "legal-head"
              ? ["group"]
            : role === "analytics-head"
              ? ["group"]
          : ["group"],
    breakdowns:
      role === "chairman"
        ? ["region"]
        : role === "clinical-director"
          ? ["coe", "facility"]
        : role === "hospital-dho"
          ? []
        : role === "people-executive"
          ? []
        : role === "bd-lead"
          ? []
        : role === "billing-lead"
          ? []
        : role === "coe-lead"
          ? []
        : role === "corporate-revenue-lead"
          ? ["region"]
        : role === "group-cfo"
          ? ["region"]
        : role === "procurement-head"
          ? ["region"]
        : role === "hr-head"
          ? ["region"]
        : role === "legal-head"
          ? ["region"]
        : role === "analytics-head"
          ? ["region"]
          : ["facility"],
  }));
}

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
  if (parent.grain === "group" && grain === "region") {
    return OBSERVATIONS.filter(
      (row) =>
        row.assignmentId === assignmentId &&
        row.period.start === period.start &&
        REGIONS.some((region) => region.entityId === row.entity.entityId),
    );
  }
  if (parent.grain !== "region" || grain !== "facility") return [];
  const children = facilitiesIn(parent);
  return OBSERVATIONS.filter(
    (row) =>
      row.assignmentId === assignmentId &&
      row.period.start === period.start &&
      children.some((child) => sameEntity(child, row.entity)),
  );
}

/** Placeholder directory for assignees inside the already scope-checked target — downward only, ADR 0011 §6. */
function permittedAssignees(entitlements: readonly PreviewEntitlement[], assignmentId: string, entity: ScopeEntity, callerRole?: RoleId): PermittedAssignee[] {
  if (!entitlements.some((row) => row.assignmentId === assignmentId)) return [];
  if (entity.grain === "group") {
    if (callerRole === "clinical-director") {
      return [
        { assigneeId: "fixture-assignee-chairman-group", role: "chairman", scopes: [entity] },
        { assigneeId: "fixture-assignee-coe-clinical", role: "coe-lead", scopes: [CLINICAL_COE] },
        ...REGIONS.map((region) => ({
          assigneeId: `fixture-assignee-coo-${region.entityId}`,
          role: "regional-coo" as const,
          scopes: [region],
        })),
      ];
    }
    return [
      { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo", scopes: [entity] },
      { assigneeId: "fixture-assignee-legal-group", role: "legal-head", scopes: [entity] },
      ...REGIONS.map((region) => ({
        assigneeId: `fixture-assignee-coo-${region.entityId}`,
        role: "regional-coo" as const,
        scopes: [region],
      })),
    ];
  }
  if (callerRole === "hospital-dho" && entity.grain === "facility") {
    return [
      { assigneeId: `fixture-assignee-coo-${entity.entityId}`, role: "regional-coo", scopes: [entity] },
      { assigneeId: `fixture-assignee-billing-${entity.entityId}`, role: "billing-lead", scopes: [entity] },
      { assigneeId: `fixture-assignee-people-${entity.entityId}`, role: "people-executive", scopes: [entity] },
      { assigneeId: `fixture-assignee-legal-${entity.entityId}`, role: "legal-head", scopes: [entity] },
    ];
  }
  if (callerRole === "people-executive" && entity.grain === "facility") {
    return [
      { assigneeId: `fixture-assignee-dho-${entity.entityId}`, role: "hospital-dho", scopes: [entity] },
      { assigneeId: `fixture-assignee-hr-${entity.entityId}`, role: "hr-head", scopes: [entity] },
    ];
  }
  if (callerRole === "bd-lead" && entity.grain === "facility") {
    return [
      { assigneeId: `fixture-assignee-dho-${entity.entityId}`, role: "hospital-dho", scopes: [entity] },
      { assigneeId: `fixture-assignee-billing-${entity.entityId}`, role: "billing-lead", scopes: [entity] },
    ];
  }
  if (callerRole === "billing-lead" && entity.grain === "facility") {
    return [
      { assigneeId: `fixture-assignee-dho-${entity.entityId}`, role: "hospital-dho", scopes: [entity] },
    ];
  }
  if (callerRole === "coe-lead" && entity.grain === "coe") {
    return [{ assigneeId: "fixture-assignee-clinical-group", role: "clinical-director", scopes: [GROUP] }];
  }
  const facilities = entity.grain === "facility" ? [entity] : entity.grain === "region" ? facilitiesIn(entity) : [];
  return facilities.map((facility) => ({
    assigneeId: `fixture-assignee-dho-${facility.entityId}`,
    role: "hospital-dho",
    scopes: [facility],
  }));
}

function seedState(role: RoleId, scope: ScopeEntity): PreviewState {
  const assignmentId = role === "chairman"
    ? CHAIRMAN_ASSIGNMENTS.cash
    : role === "clinical-director"
      ? CLINICAL_ASSIGNMENTS.safety
      : role === "hospital-dho"
        ? DHO_ASSIGNMENTS.readiness
        : role === "people-executive"
          ? PEOPLE_ASSIGNMENTS.training
        : role === "bd-lead"
          ? BD_ASSIGNMENTS.crm
        : role === "billing-lead"
          ? BILLING_ASSIGNMENTS.denied
        : role === "coe-lead"
          ? COE_ASSIGNMENTS.milestones
        : role === "corporate-revenue-lead"
          ? CORPORATE_ASSIGNMENTS.issues
        : role === "group-cfo"
          ? GROUP_CFO_ASSIGNMENTS.controls
        : role === "procurement-head"
          ? PROCUREMENT_ASSIGNMENTS.stockouts
        : role === "hr-head"
          ? HR_ASSIGNMENTS.staffing
        : role === "legal-head"
          ? LEGAL_ASSIGNMENTS.regulatory
        : role === "analytics-head"
          ? ANALYTICS_ASSIGNMENTS.quality
        : ASSIGNMENTS.revenue;
  const revenue = role === "clinical-director"
    ? clinicalFindObservation(`obs:serious-adverse-events:${scope.entityId}:${CURRENT_PERIOD.start.slice(0, 7)}`)
    : role === "hospital-dho"
      ? dhoObservationFor(DHO_ASSIGNMENTS.readiness)
      : role === "people-executive"
        ? peopleObservationFor(PEOPLE_ASSIGNMENTS.training)
      : role === "bd-lead"
        ? bdObservationFor(BD_ASSIGNMENTS.crm)
      : role === "billing-lead"
        ? billingObservationFor(BILLING_ASSIGNMENTS.denied)
      : role === "coe-lead"
        ? coeObservationFor(COE_ASSIGNMENTS.milestones)
      : role === "corporate-revenue-lead"
        ? corporateObservationFor(CORPORATE_ASSIGNMENTS.issues)
      : role === "group-cfo"
        ? groupCfoObservationFor(GROUP_CFO_ASSIGNMENTS.controls)
      : role === "procurement-head"
        ? procurementObservationFor(PROCUREMENT_ASSIGNMENTS.stockouts)
      : role === "hr-head"
        ? hrObservationFor(HR_ASSIGNMENTS.staffing)
      : role === "legal-head"
        ? legalObservationFor(LEGAL_ASSIGNMENTS.regulatory)
      : role === "analytics-head"
        ? analyticsObservationFor(ANALYTICS_ASSIGNMENTS.quality)
    : OBSERVATIONS.find(
        (row) =>
          row.assignmentId === assignmentId &&
          sameEntity(row.entity, scope) &&
          row.period.start === CURRENT_PERIOD.start,
      );
  if (!revenue) throw new Error("Preview fixture is missing the seeded action observation.");

  const action: Action = {
    actionId: "act-seed-1",
    state: "open",
    version: 1,
    title:
      role === "chairman"
        ? "Confirm the cash and working-capital review owner for September governance"
        : role === "clinical-director"
        ? "Review the clinical governance closure movement with accountable leads"
        : role === "hospital-dho"
          ? "Review the facility readiness closure movement with accountable leads"
          : role === "people-executive"
            ? "Review the mandatory training completion movement with accountable leaders"
          : role === "bd-lead"
            ? "Review the CRM completeness and forecast accuracy movement with accountable owners"
          : role === "billing-lead"
            ? "Review the rejected or denied claim value movement with accountable owners"
          : role === "coe-lead"
            ? "Review the COE programme milestone movement with accountable collaborators"
          : role === "corporate-revenue-lead"
            ? "Review the payer issue closure movement with accountable collaborators"
          : role === "group-cfo"
            ? "Review the financial control and leakage action closure movement with accountable collaborators"
          : role === "procurement-head"
            ? "Review the critical supply-continuity movement with accountable collaborators"
          : role === "hr-head"
            ? "Review the critical-role staffing movement with accountable collaborators"
          : role === "legal-head"
            ? "Review the regulatory-calendar compliance movement with accountable collaborators"
          : role === "analytics-head"
            ? "Review the KPI data-quality movement with accountable collaborators"
          : "Confirm when the August 2026 management-accounts close will be reconciled",
    assignmentId,
    entity: scope,
    evidence: {
      observationIds: [revenue.observationId],
      definitionVersion: DEFINITION_VERSION,
      datasetChecksum: DATASET_CHECKSUM,
    },
    creatorRole: role === "chairman" ? "chairman" : "chairman",
    assignee:
      role === "chairman"
        ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
        : role === "clinical-director"
          ? { assigneeId: "fixture-assignee-chairman-group", role: "chairman" }
          : role === "hospital-dho"
            ? { assigneeId: `fixture-assignee-coo-${scope.entityId}`, role: "regional-coo" }
          : role === "people-executive"
            ? { assigneeId: `fixture-assignee-dho-${scope.entityId}`, role: "hospital-dho" }
          : role === "bd-lead"
            ? { assigneeId: `fixture-assignee-dho-${scope.entityId}`, role: "hospital-dho" }
          : role === "billing-lead"
            ? { assigneeId: `fixture-assignee-dho-${scope.entityId}`, role: "hospital-dho" }
          : role === "coe-lead"
            ? { assigneeId: "fixture-assignee-clinical-group", role: "clinical-director" }
          : role === "corporate-revenue-lead"
            ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
          : role === "group-cfo"
            ? { assigneeId: "fixture-assignee-chairman-group", role: "chairman" }
          : role === "procurement-head"
            ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
          : role === "hr-head"
            ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
          : role === "legal-head"
            ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
          : role === "analytics-head"
            ? { assigneeId: "fixture-assignee-cfo-group", role: "group-cfo" }
          : { assigneeId: `fixture-assignee-coo-${scope.entityId}`, role: "regional-coo" },
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
  const role: RoleId = persona === "chairman"
    ? "chairman"
    : persona === "clinical-director"
      ? "clinical-director"
      : persona === "hospital-dho"
        ? "hospital-dho"
        : persona === "people-executive"
          ? "people-executive"
        : persona === "bd-lead"
          ? "bd-lead"
        : persona === "billing-lead"
          ? "billing-lead"
        : persona === "coe-lead"
          ? "coe-lead"
        : persona === "corporate-revenue-lead"
          ? "corporate-revenue-lead"
        : persona === "group-cfo"
          ? "group-cfo"
        : persona === "procurement-head"
          ? "procurement-head"
        : persona === "hr-head"
          ? "hr-head"
        : persona === "legal-head"
          ? "legal-head"
        : persona === "analytics-head"
          ? "analytics-head"
        : "regional-coo";
  const scope = persona === "chairman" || persona === "clinical-director" || persona === "corporate-revenue-lead" || persona === "group-cfo" || persona === "procurement-head" || persona === "hr-head" || persona === "legal-head" || persona === "analytics-head" ? GROUP : persona === "coe-lead" ? CLINICAL_COE : persona === "hospital-dho" || persona === "people-executive" || persona === "bd-lead" || persona === "billing-lead" ? DHO_FACILITY : persona === "north" ? REGION_NORTH : REGION_SOUTH;
  const storage = options.storage ?? null;
  const now = options.now ?? (() => new Date());
  const storageKey = `orbit-preview-state:${persona}:v1`;
  const membership: MeResponse = {
    role,
    organizationId: ORGANIZATION_ID,
    scopes: role === "clinical-director" ? [GROUP, CLINICAL_COE] : [scope],
  };
  const entitlements = entitlementsFor(role);

  let state = restoreState(storage?.getItem(storageKey) ?? null) ?? seedState(role, scope);

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
    if (role === "clinical-director") return target.entityId === GROUP.entityId || target.entityId === CLINICAL_COE.entityId;
    if (role === "hospital-dho") return sameEntity(target, DHO_FACILITY);
    if (role === "people-executive") return sameEntity(target, DHO_FACILITY);
    if (role === "bd-lead") return sameEntity(target, DHO_FACILITY);
    if (role === "billing-lead") return sameEntity(target, DHO_FACILITY);
    if (role === "coe-lead") return sameEntity(target, CLINICAL_COE);
    if (role === "corporate-revenue-lead") return sameEntity(target, GROUP);
    if (role === "group-cfo") return sameEntity(target, GROUP);
    if (role === "procurement-head") return sameEntity(target, GROUP);
    if (role === "hr-head") return sameEntity(target, GROUP);
    if (role === "legal-head") return sameEntity(target, GROUP);
    if (role === "analytics-head") return sameEntity(target, GROUP);
    if (scope.grain === "group") return sameEntity(target, scope);
    return regionOf(target) === scope.entityId;
  }

  /**
   * Mirrors `GET /api/entities`: every entity the caller can see, with a name.
   * Group scope sees the whole organization, as the real RLS policies do.
   * Labels are preview placeholders, not Maruti's fictional company names.
   */
  function visibleEntities(): EntityDirectoryEntry[] {
    const all: EntityDirectoryEntry[] = [
      { ...GROUP, label: "Preview group", parent: null },
      { ...REGION_NORTH, label: "Preview North region", parent: GROUP },
      { ...REGION_SOUTH, label: "Preview South region", parent: GROUP },
      ...FACILITIES.map((facility) => ({
        ...facility.entity,
        label: `Preview facility ${facility.entity.entityId.replace("fixture-facility-", "").toUpperCase()}`,
        parent: { grain: "region" as const, entityId: facility.region },
      })),
      { ...CLINICAL_COE, label: "Preview clinical COE", parent: GROUP },
    ];
    const groupScoped = membership.scopes.some((entry) => entry.grain === "group");
    return all.filter((entry) => groupScoped || contains({ grain: entry.grain, entityId: entry.entityId }));
  }

  function decide(assignmentId: string, target: ScopeEntity, breakdown?: ScopeEntity["grain"]) {
    const entitlement = entitlements.find((row) => row.assignmentId === assignmentId);
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
      (role === "chairman" ? chairmanBrief() : role === "clinical-director" ? clinicalBrief() : role === "hospital-dho" ? dhoBrief() : role === "people-executive" ? peopleBrief() : role === "bd-lead" ? bdBrief() : role === "billing-lead" ? billingBrief() : role === "coe-lead" ? coeBrief() : role === "corporate-revenue-lead" ? corporateBrief() : role === "group-cfo" ? groupCfoBrief() : role === "procurement-head" ? procurementBrief() : role === "hr-head" ? hrBrief() : role === "legal-head" ? legalBrief() : role === "analytics-head" ? analyticsBrief() : briefFor(scope)).exceptions.map((exception) => ({ ...exception, actionState: actionStateFor(exception) })),
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === "act_now" ? -1 : 1) ||
        SEVERITY[a.category] - SEVERITY[b.category] ||
        b.period.start.localeCompare(a.period.start),
    );
  }

  function series(assignmentId: string, entity: ScopeEntity, from?: string, to?: string) {
    return sorted(
      (role === "clinical-director" ? clinicalSeriesFor(assignmentId, entity) : role === "hospital-dho" ? dhoSeriesFor(assignmentId, entity) : role === "people-executive" ? peopleSeriesFor(assignmentId, entity) : role === "bd-lead" ? bdSeriesFor(assignmentId, entity) : role === "billing-lead" ? billingSeriesFor(assignmentId, entity) : role === "coe-lead" ? coeSeriesFor(assignmentId, entity) : role === "corporate-revenue-lead" ? corporateSeriesFor(assignmentId, entity) : role === "group-cfo" ? groupCfoSeriesFor(assignmentId, entity) : role === "procurement-head" ? procurementSeriesFor(assignmentId, entity) : role === "hr-head" ? hrSeriesFor(assignmentId, entity) : role === "legal-head" ? legalSeriesFor(assignmentId, entity) : role === "analytics-head" ? analyticsSeriesFor(assignmentId, entity) : seriesFor(assignmentId, entity)).filter(
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
        if (!entitlements.some((row) => row.assignmentId === request.assignmentId)) {
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
        const children = role === "clinical-director"
          ? clinicalBreakdownRows(request.assignmentId, request.target, request.breakdown, request.period)
          : role === "hospital-dho"
            ? dhoBreakdownRows()
          : role === "people-executive"
            ? peopleBreakdownRows()
          : role === "bd-lead"
            ? bdBreakdownRows()
          : role === "billing-lead"
            ? billingBreakdownRows()
          : role === "coe-lead"
            ? coeBreakdownRows()
          : role === "corporate-revenue-lead"
            ? corporateBreakdownRows(request.assignmentId, request.period)
          : role === "group-cfo"
            ? groupCfoBreakdownRows(request.assignmentId, request.period)
          : role === "procurement-head"
            ? procurementBreakdownRows(request.assignmentId, request.period)
          : role === "hr-head"
            ? hrBreakdownRows(request.assignmentId, request.period)
          : role === "legal-head"
            ? legalBreakdownRows(request.assignmentId, request.period)
          : role === "analytics-head"
            ? analyticsBreakdownRows(request.assignmentId, request.period)
          : breakdownRows(request.assignmentId, request.target, request.breakdown, request.period);
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
      entitlements.map((entitlement, order) => ({ entitlement, order, assignment: framework(entitlement.assignmentId) })),
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
      const observation = role === "clinical-director" ? clinicalFindObservation(id) : role === "hospital-dho" ? dhoFindObservation(id) : role === "people-executive" ? peopleFindObservation(id) : role === "bd-lead" ? bdFindObservation(id) : role === "billing-lead" ? billingFindObservation(id) : role === "coe-lead" ? coeFindObservation(id) : role === "corporate-revenue-lead" ? corporateFindObservation(id) : role === "group-cfo" ? groupCfoFindObservation(id) : role === "procurement-head" ? procurementFindObservation(id) : role === "hr-head" ? hrFindObservation(id) : role === "legal-head" ? legalFindObservation(id) : role === "analytics-head" ? analyticsFindObservation(id) : findObservation(id);
      if (!observation) throw new FixtureError("invalid_request", "The request is invalid.");
      if (observation.assignmentId !== input.assignmentId || observation.definitionVersion !== input.evidence.definitionVersion) {
        throw new FixtureError("invalid_request", "The request is invalid.");
      }
      if (!decide(input.assignmentId, observation.entity)) throw new FixtureError("out_of_scope", OUT_OF_SCOPE_MESSAGE);
    }
    const assignee = permittedAssignees(entitlements, input.assignmentId, input.entity, membership.role).find((row) => row.assigneeId === input.assigneeId);
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
      const brief = role === "chairman" ? chairmanBrief() : role === "clinical-director" ? clinicalBrief() : role === "hospital-dho" ? dhoBrief() : role === "people-executive" ? peopleBrief() : role === "bd-lead" ? bdBrief() : role === "billing-lead" ? billingBrief() : role === "coe-lead" ? coeBrief() : role === "corporate-revenue-lead" ? corporateBrief() : role === "group-cfo" ? groupCfoBrief() : role === "procurement-head" ? procurementBrief() : role === "hr-head" ? hrBrief() : role === "legal-head" ? legalBrief() : role === "analytics-head" ? analyticsBrief() : briefFor(scope);
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
        body: { frameworkVersion: DEFINITION_VERSION, assignments: entitlements.map(summary), disclosure: PREVIEW_DISCLOSURE },
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
          ? {
              grain: query.data.breakdown,
                observations: role === "clinical-director"
                  ? clinicalBreakdownRows(id, target, query.data.breakdown, latest.period)
                  : role === "hospital-dho"
                    ? dhoBreakdownRows()
                    : role === "people-executive"
                      ? peopleBreakdownRows()
                    : role === "bd-lead"
                      ? bdBreakdownRows()
                : role === "billing-lead"
                      ? billingBreakdownRows()
                    : role === "coe-lead"
                      ? coeBreakdownRows()
                    : role === "corporate-revenue-lead"
                      ? corporateBreakdownRows(id, latest.period)
                    : role === "group-cfo"
                      ? groupCfoBreakdownRows(id, latest.period)
                    : role === "procurement-head"
                      ? procurementBreakdownRows(id, latest.period)
                    : role === "hr-head"
                      ? hrBreakdownRows(id, latest.period)
                    : role === "legal-head"
                      ? legalBreakdownRows(id, latest.period)
                    : role === "analytics-head"
                      ? analyticsBreakdownRows(id, latest.period)
                    : breakdownRows(id, target, query.data.breakdown, latest.period),
            }
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

    if (method === "GET" && resource === "entities" && !id) return { status: 200, body: { entities: visibleEntities() } };

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
        return { status: 200, body: { assignees: permittedAssignees(entitlements, query.assignmentId, entity, membership.role) } };
      }
      if (method === "GET" && id && !sub) return { status: 200, body: { action: stored(id).action, replayed: false } };
      if (method === "POST" && !id) return createAction(request.body, requestId);
      if (method === "POST" && id && sub === "transitions") return transitionAction(id, request.body, requestId);
    }

    if (method === "GET" && resource === "audit" && !id) {
      // ADR 0011 §7: a member reads events for actions it created or is assigned, nothing else.
      const ownActions = new Set(state.actions.map((row) => row.action.actionId));
      const items = sorted(
        state.audit.filter(
          (event) =>
            (event.kind === "action_created" || event.kind === "action_transitioned") &&
            event.target?.type === "action" &&
            ownActions.has(event.target.id),
        ),
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
    state = seedState(role, scope);
  }

  const transport: ApiTransport = handle;

  return { handle, reset, transport, persona };
}

export type FixtureApi = ReturnType<typeof createFixtureApi>;
