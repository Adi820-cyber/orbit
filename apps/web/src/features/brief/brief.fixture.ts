import {
  BriefResponseSchema,
  KpiListResponseSchema,
  MeResponseSchema,
  type DataQuality,
  type Exception,
  type Grain,
  type KpiAssignmentSummary,
  type OnTrackItem,
  type ScopeEntity,
} from "@orbit/contracts";
import {
  getAssignment,
  type RoleKpiAssignment,
} from "@orbit/kpi-framework";
import type { BriefPagePayload } from "../../lib/api";

const CAPACITY_ASSIGNMENT =
  "regional-coo:hospital-and-clinic-capacity-utilisation";
const REVENUE_ASSIGNMENT =
  "regional-coo:regional-net-revenue-vs-approved-budget";
const EXPERIENCE_ASSIGNMENT =
  "regional-coo:patient-experience-and-capa-closure";

const CURRENT_PERIOD = {
  cadence: "month",
  start: "2026-01-01",
  end: "2026-01-31",
} as const;
const REGION_SCOPE: ScopeEntity = {
  grain: "region",
  entityId: "fixture-region-a",
};
const FACILITY_SCOPE: ScopeEntity = {
  grain: "facility",
  entityId: "fixture-facility-a1",
};
const DISCLOSURE =
  "Fictional demonstration company. All figures and targets are illustrative; not validated clinical or financial guidance.";

function assignmentById(assignmentId: string): RoleKpiAssignment {
  const assignment = getAssignment(assignmentId);

  if (!assignment) {
    throw new Error(`Missing generated fixture assignment: ${assignmentId}`);
  }

  return assignment;
}

function assignmentSummary(
  assignmentId: string,
  grains: Grain[],
  breakdowns: Grain[],
): KpiAssignmentSummary {
  const assignment = assignmentById(assignmentId);

  return {
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    kpi: assignment.kpi,
    keyDeliverable: assignment.keyDeliverable,
    weight: assignment.weight,
    definitionFamilies: [...assignment.definitionFamilies],
    unresolved: assignment.unresolvedReason !== null,
    targetBasis: assignment.targetBasis,
    review: assignment.review,
    primaryDataSource: assignment.primaryDataSource,
    grains,
    breakdowns,
  };
}

function quality(
  overrides: Partial<Pick<DataQuality, "freshness" | "reconciliation" | "limitations">> = {},
): DataQuality {
  return {
    state: "illustrative",
    reconciliation: "reconciled",
    freshness: "current",
    refreshedAt: "2026-02-02T06:00:00Z",
    limitations: [],
    ...overrides,
  };
}

function evidence(assignmentId: string) {
  return {
    observationIds: [`fixture-observation:${assignmentId}`],
    definitionVersion: "fixture-v1",
    datasetChecksum: "fixture-regional-coo-brief",
  };
}

const actNow: Exception = {
  exceptionId: "fixture-capacity-exception",
  assignmentId: CAPACITY_ASSIGNMENT,
  entity: FACILITY_SCOPE,
  period: CURRENT_PERIOD,
  priority: "act_now",
  category: "performance",
  comparisonBasis: "prior_period",
  detection: {
    kind: "seeded_scenario",
    scenarioLabel: "Illustrative capacity exception",
  },
  whatChanged:
    "The contract fixture flags a capacity exception in an authorized facility scope.",
  whyItMatters:
    "Review the component evidence before deciding whether the facility needs an operating action.",
  owner: { role: "hospital-dho" },
  actionState: "none",
  evidence: evidence(CAPACITY_ASSIGNMENT),
  provenance: "illustrative",
  dataQuality: quality(),
};

const monitor: Exception = {
  exceptionId: "fixture-revenue-monitor",
  assignmentId: REVENUE_ASSIGNMENT,
  entity: REGION_SCOPE,
  period: CURRENT_PERIOD,
  priority: "monitor",
  category: "performance",
  comparisonBasis: "budget",
  detection: {
    kind: "seeded_scenario",
    scenarioLabel: "Illustrative financial monitoring scenario",
  },
  whatChanged:
    "The financial source is late, so the brief cannot present a reconciled comparison.",
  whyItMatters:
    "Treat the item as a monitoring signal until the delayed source is reconciled.",
  owner: { role: "regional-coo" },
  actionState: "none",
  evidence: evidence(REVENUE_ASSIGNMENT),
  provenance: "illustrative",
  dataQuality: quality({
    freshness: "late",
    reconciliation: "unreconciled",
    limitations: ["The fixture source is late and unreconciled."],
  }),
};

const onTrack: OnTrackItem = {
  assignmentId: EXPERIENCE_ASSIGNMENT,
  entity: REGION_SCOPE,
  period: CURRENT_PERIOD,
  summary:
    "The fixture reports no exception requiring attention for this assignment.",
  evidence: evidence(EXPERIENCE_ASSIGNMENT),
  provenance: "illustrative",
  dataQuality: quality(),
};

export const regionalCooBriefFixture: BriefPagePayload = {
  membership: MeResponseSchema.parse({
    role: "regional-coo",
    organizationId: "30000000-0000-4000-8000-000000000001",
    scopes: [REGION_SCOPE],
  }),
  brief: BriefResponseSchema.parse({
    period: CURRENT_PERIOD,
    asOf: "2026-02-02T06:00:00Z",
    actNow: [actNow],
    monitor: [monitor],
    onTrack: [onTrack],
    dataLimitations: [
      {
        assignmentId: REVENUE_ASSIGNMENT,
        issue: "late",
        detail:
          "The illustrative financial source is late and has not been reconciled.",
      },
    ],
    disclosure: DISCLOSURE,
  }),
  kpis: KpiListResponseSchema.parse({
    frameworkVersion: "fixture-v1",
    assignments: [
      assignmentSummary(
        CAPACITY_ASSIGNMENT,
        ["region", "facility"],
        ["facility"],
      ),
      assignmentSummary(REVENUE_ASSIGNMENT, ["region"], []),
      assignmentSummary(EXPERIENCE_ASSIGNMENT, ["region"], []),
    ],
    disclosure: DISCLOSURE,
  }),
};
