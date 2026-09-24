import type {
  ComponentMeasure,
  DataLimitation,
  DataQuality,
  Exception,
  MeasureValue,
  Observation,
  OnTrackItem,
  Period,
  ScopeEntity,
  Target,
} from "@orbit/contracts";
import { FRAMEWORK_MANIFEST, getAssignment } from "@orbit/kpi-framework";

/*
 * DEVELOPER PREVIEW FIXTURE — not Maruti's generated dataset.
 *
 * A small, deterministic stand-in so the Regional COO workspace can be clicked
 * through before `data/snapshots` exists. It follows the PRD §8.2 discipline
 * rather than inventing a shortcut: facility facts are generated first,
 * every KPI value is derived from its own numerator and denominator, and
 * region values are rolled up from summed numerators and denominators — never
 * averaged percentages. Missing stays missing, a zero denominator is not
 * applicable, and unreported components are disclosed rather than filled.
 *
 * Entity ids reuse the placeholder ids in `services/api/test/helpers` so the
 * frontend and backend fixtures describe the same fictional shape. The
 * contract carries no display name for an entity, so none is invented here.
 * Replace this module with snapshot fixtures once Maruti's generator lands.
 */

export const PREVIEW_DISCLOSURE =
  "Fictional demonstration company. All figures and targets are illustrative; not validated clinical or financial guidance.";
export const ORGANIZATION_ID = "30000000-0000-4000-8000-000000000001";
export const DEFINITION_VERSION = FRAMEWORK_MANIFEST.definitionVersion;
export const DATASET_CHECKSUM = "fixture-preview-regional-coo-v1";
export const AS_OF = "2026-09-02T06:00:00Z";

export const GROUP: ScopeEntity = { grain: "group", entityId: "fixture-group" };
export const REGION_NORTH: ScopeEntity = { grain: "region", entityId: "fixture-region-a" };
export const REGION_SOUTH: ScopeEntity = { grain: "region", entityId: "fixture-region-b" };

interface FacilityProfile {
  entity: ScopeEntity;
  region: string;
  /** Relative size used to scale generated facts; not a bed count or a real figure. */
  size: number;
  hostsCoe: boolean;
}

export const FACILITIES: readonly FacilityProfile[] = [
  { entity: { grain: "facility", entityId: "fixture-facility-a1" }, region: REGION_NORTH.entityId, size: 12, hostsCoe: true },
  { entity: { grain: "facility", entityId: "fixture-facility-a2" }, region: REGION_NORTH.entityId, size: 9, hostsCoe: false },
  { entity: { grain: "facility", entityId: "fixture-facility-a3" }, region: REGION_NORTH.entityId, size: 6, hostsCoe: false },
  { entity: { grain: "facility", entityId: "fixture-facility-b1" }, region: REGION_SOUTH.entityId, size: 11, hostsCoe: true },
  { entity: { grain: "facility", entityId: "fixture-facility-b2" }, region: REGION_SOUTH.entityId, size: 10, hostsCoe: false },
  { entity: { grain: "facility", entityId: "fixture-facility-b3" }, region: REGION_SOUTH.entityId, size: 5, hostsCoe: false },
];

export const REGIONS: readonly ScopeEntity[] = [REGION_NORTH, REGION_SOUTH];

function monthPeriod(year: number, monthIndex: number): Period {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    cadence: "month",
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/** Twelve complete months ending at the manifest's last complete month (2026-08). */
export const PERIODS: readonly Period[] = Array.from({ length: 12 }, (_, index) =>
  monthPeriod(2025, 8 + index),
);
const LATEST = PERIODS.length - 1;
export const CURRENT_PERIOD: Period = PERIODS[LATEST] ?? monthPeriod(2026, 7);

/** Capacity scenario onset: May 2026, as in the fictional-company manifest. */
const CAPACITY_ONSET = 8;
/** First-pass claim decline begins in June 2026 at one facility. */
const CLAIMS_ONSET = 9;

export const ASSIGNMENTS = {
  revenue: "regional-coo:regional-net-revenue-vs-approved-budget",
  ebitda: "regional-coo:regional-ebitda-vs-approved-budget",
  capacity: "regional-coo:hospital-and-clinic-capacity-utilisation",
  referral: "regional-coo:patient-volume-and-referral-conversion",
  collections: "regional-coo:collections-and-dso-vs-plan",
  claims: "regional-coo:claim-clean-rate-and-denial-value",
  experience: "regional-coo:patient-experience-and-capa-closure",
  engagement: "regional-coo:engagement-and-critical-role-retention",
  growth: "regional-coo:new-service-coe-and-corporate-revenue-vs-plan",
} as const;

export const CHAIRMAN_ASSIGNMENTS = {
  revenue: "chairman:group-net-revenue-vs-approved-budget",
  ebitda: "chairman:group-ebitda-vs-approved-budget",
  cash: "chairman:operating-cash-flow-and-working-capital-vs-plan",
  quality: "chairman:group-clinical-quality-and-safety-index",
  experience: "chairman:group-patient-experience-index",
  growth: "chairman:coe-corporate-and-expansion-milestones",
  governance: "chairman:critical-governance-legal-and-audit-actions-closed",
} as const;

/** Exact integer hash in [-1, 1): reproducible on every engine, unlike Math.sin. */
function jitter(seed: number, month: number) {
  return (((seed * 9301 + month * 49297 + 12345) % 233280) / 233280) * 2 - 1;
}

function daysIn(period: Period) {
  return Number(period.end.slice(8, 10));
}

interface ComponentSpec {
  componentId: string;
  label: string;
  unit: string;
}

interface Facts {
  numerator: number | null;
  denominator: number | null;
  reported: Record<string, number | null>;
}

interface ObservationSpec {
  assignmentId: string;
  family: string;
  unit: string;
  numerator: ComponentSpec;
  denominator: ComponentSpec;
  reported: readonly (ComponentSpec & { additive: boolean })[];
  target: "not_configured" | "budget";
  limitations: readonly string[];
}

interface FamilySpec extends ObservationSpec {
  /** Sourced from the management-accounts close, so it inherits that source's late state. */
  fromManagementAccounts: boolean;
  appliesTo(facility: FacilityProfile): boolean;
  facts(facility: FacilityProfile, index: number, month: number): Facts;
}

const LATE_CLOSE =
  "The management-accounts close for August 2026 is late and unreconciled, so the value is not reported.";

function budgetFor(facility: FacilityProfile, month: number) {
  return Math.round(facility.size * 100 * (1 + 0.005 * month));
}

function isLateClose(facility: FacilityProfile, month: number) {
  return facility.region === REGION_NORTH.entityId && month === LATEST;
}

const everyFacility = () => true;

const FAMILY_SPECS: readonly FamilySpec[] = [
  {
    assignmentId: ASSIGNMENTS.revenue,
    family: "Net revenue",
    unit: "% of approved budget",
    numerator: { componentId: "net_revenue", label: "Net revenue", unit: "USD thousands" },
    denominator: { componentId: "approved_budget", label: "Approved budget", unit: "USD thousands" },
    reported: [],
    target: "budget",
    fromManagementAccounts: true,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      if (isLateClose(facility, month)) return { numerator: null, denominator: null, reported: {} };
      const budget = budgetFor(facility, month);
      return {
        numerator: Math.round(budget * (1 + 0.03 * jitter(index * 5 + 2, month))),
        denominator: budget,
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.ebitda,
    family: "EBITDA",
    unit: "% of approved budget",
    numerator: { componentId: "ebitda", label: "EBITDA", unit: "USD thousands" },
    denominator: { componentId: "approved_ebitda_budget", label: "Approved EBITDA budget", unit: "USD thousands" },
    reported: [],
    target: "budget",
    fromManagementAccounts: true,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      if (isLateClose(facility, month)) return { numerator: null, denominator: null, reported: {} };
      const budget = budgetFor(facility, month);
      const revenue = budget * (1 + 0.03 * jitter(index * 5 + 2, month));
      return {
        numerator: Math.round(revenue * (0.17 + 0.015 * jitter(index * 7 + 3, month))),
        denominator: Math.round(budget * 0.175),
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.capacity,
    family: "Capacity utilisation",
    unit: "% of available staffed bed days",
    numerator: { componentId: "occupied_bed_days", label: "Occupied staffed bed days", unit: "bed days" },
    denominator: { componentId: "available_bed_days", label: "Available staffed bed days", unit: "bed days" },
    reported: [],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const period = PERIODS[month] ?? CURRENT_PERIOD;
      const planned = facility.size * 10 * daysIn(period);
      const constrained = index === 0 && month >= CAPACITY_ONSET;
      const available = Math.round(planned * (constrained ? 0.86 : 1));
      const occupancy = (index === 0 ? 0.81 : 0.76) + 0.03 * jitter(index * 3 + 1, month);
      return {
        numerator: Math.min(available, Math.round(planned * occupancy)),
        denominator: available,
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.referral,
    family: "Referral conversion",
    unit: "% of eligible referrals",
    numerator: { componentId: "referrals_completed", label: "Eligible referrals completing the intended next service", unit: "referrals" },
    denominator: { componentId: "eligible_referrals", label: "Eligible referrals", unit: "referrals" },
    reported: [
      { componentId: "patient_volume", label: "Patient volume", unit: "patients", additive: true },
      { componentId: "planned_patient_volume", label: "Planned patient volume", unit: "patients", additive: true },
    ],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const eligible = Math.round(facility.size * 22 * (1 + 0.05 * jitter(index * 11 + 4, month)));
      return {
        numerator: Math.round(eligible * (0.62 + 0.05 * jitter(index * 13 + 5, month))),
        denominator: eligible,
        reported: {
          patient_volume: Math.round(facility.size * 65 * (1 + 0.04 * jitter(index * 17 + 6, month))),
          planned_patient_volume: Math.round(facility.size * 65 * (1 + 0.003 * month)),
        },
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.collections,
    family: "Collections",
    unit: "% of collections plan",
    numerator: { componentId: "cash_collections", label: "Cash collections", unit: "USD thousands" },
    denominator: { componentId: "collections_plan", label: "Collections plan", unit: "USD thousands" },
    reported: [{ componentId: "dso", label: "DSO", unit: "days", additive: false }],
    target: "budget",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const plan = Math.round(budgetFor(facility, month) * 0.94);
      return {
        numerator: Math.round(plan * (0.985 + 0.02 * jitter(index * 19 + 7, month))),
        denominator: plan,
        reported: { dso: null },
      };
    },
    limitations: ["DSO is not reported: the group-approved DSO calculation is not configured in this fixture."],
  },
  {
    assignmentId: ASSIGNMENTS.claims,
    family: "First-pass claim acceptance",
    unit: "% of submitted claims",
    numerator: { componentId: "claims_accepted_first_pass", label: "Claims accepted on first pass", unit: "claims" },
    denominator: { componentId: "claims_submitted", label: "Claims submitted", unit: "claims" },
    reported: [],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const submitted = Math.round(facility.size * 40 * (1 + 0.05 * jitter(index * 23 + 8, month)));
      const decline = index === 2 && month >= CLAIMS_ONSET ? 0.04 * (month - CLAIMS_ONSET + 1) : 0;
      return {
        numerator: Math.round(submitted * (0.91 + 0.015 * jitter(index * 29 + 9, month) - decline)),
        denominator: submitted,
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.claims,
    family: "Denied or rejected claim value",
    unit: "% of submitted claim value",
    numerator: { componentId: "denied_claim_value", label: "Rejected or denied claim value", unit: "USD thousands" },
    denominator: { componentId: "submitted_claim_value", label: "Submitted claim value", unit: "USD thousands" },
    reported: [],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const submitted = Math.round(budgetFor(facility, month) * 0.7);
      const rise = index === 2 && month >= CLAIMS_ONSET ? 0.02 * (month - CLAIMS_ONSET + 1) : 0;
      return {
        numerator: Math.round(submitted * (0.05 + 0.008 * jitter(index * 31 + 10, month) + rise)),
        denominator: submitted,
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.experience,
    family: "Patient experience",
    unit: "% of corrective actions closed by due date",
    numerator: { componentId: "capa_closed_on_time", label: "Corrective actions closed by due date", unit: "actions" },
    denominator: { componentId: "capa_due", label: "Corrective actions due", unit: "actions" },
    reported: [{ componentId: "experience_score", label: "Patient-experience score", unit: "score", additive: false }],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const due = index === 2 && month === 4 ? 0 : Math.round(2 + facility.size * 0.5 * (1 + jitter(index * 37 + 11, month)));
      return {
        numerator: Math.min(due, Math.round(due * (0.86 + 0.1 * jitter(index * 41 + 12, month)))),
        denominator: due,
        reported: { experience_score: null },
      };
    },
    limitations: ["The patient-experience score is not reported: no approved survey instrument is configured."],
  },
  {
    assignmentId: ASSIGNMENTS.engagement,
    family: "Engagement",
    unit: "% of critical-role staff retained",
    numerator: { componentId: "critical_roles_retained", label: "Critical-role staff retained", unit: "staff" },
    denominator: { componentId: "critical_roles_at_start", label: "Critical-role staff at period start", unit: "staff" },
    reported: [{ componentId: "engagement_score", label: "Engagement score", unit: "score", additive: false }],
    target: "not_configured",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const atStart = Math.round(facility.size * 3.5);
      const leavers = Math.max(0, Math.round(0.8 + 0.8 * jitter(index * 43 + 13, month)));
      return {
        numerator: atStart - leavers,
        denominator: atStart,
        reported: { engagement_score: null },
      };
    },
    limitations: ["Engagement survey results are periodic; no monthly engagement score is reported."],
  },
  {
    assignmentId: ASSIGNMENTS.growth,
    family: "New business revenue",
    unit: "% of plan",
    numerator: { componentId: "new_service_revenue", label: "New service and corporate revenue", unit: "USD thousands" },
    denominator: { componentId: "new_service_plan", label: "New service and corporate revenue plan", unit: "USD thousands" },
    reported: [],
    target: "budget",
    fromManagementAccounts: false,
    appliesTo: everyFacility,
    facts(facility, index, month) {
      const plan = Math.round(facility.size * 9 * (1 + 0.01 * month));
      return {
        numerator: Math.round(plan * (1 + 0.08 * jitter(index * 47 + 14, month))),
        denominator: plan,
        reported: {},
      };
    },
    limitations: [],
  },
  {
    assignmentId: ASSIGNMENTS.growth,
    family: "COE contribution",
    unit: "% of plan",
    numerator: { componentId: "coe_programme_revenue", label: "COE programme revenue", unit: "USD thousands" },
    denominator: { componentId: "coe_programme_plan", label: "COE programme revenue plan", unit: "USD thousands" },
    reported: [],
    target: "budget",
    fromManagementAccounts: false,
    appliesTo: (facility) => facility.hostsCoe,
    facts(_facility, index, month) {
      const plan = Math.round(160 * (1 + 0.01 * month));
      return {
        numerator: Math.round(plan * (1 + 0.1 * jitter(index * 53 + 15, month))),
        denominator: plan,
        reported: {},
      };
    },
    limitations: ["COE revenue is a segment that overlaps hospital totals; it is never added to the region a second time."],
  },
];

interface GroupFamilySpec extends ObservationSpec {
  facts(month: number): Facts;
}

function groupPlan(month: number) {
  return Math.round(6_600 * (1 + 0.006 * month));
}

const GROUP_FAMILY_SPECS: readonly GroupFamilySpec[] = [
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.revenue,
    family: "Net revenue",
    unit: "% of approved budget",
    numerator: { componentId: "group_net_revenue", label: "Group net revenue", unit: "USD thousands" },
    denominator: { componentId: "group_approved_budget", label: "Group approved budget", unit: "USD thousands" },
    reported: [],
    target: "budget",
    limitations: [],
    facts(month) {
      const budget = groupPlan(month);
      return {
        numerator: Math.round(budget * (1.01 + 0.018 * jitter(71, month))),
        denominator: budget,
        reported: {},
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.ebitda,
    family: "EBITDA",
    unit: "% of approved budget",
    numerator: { componentId: "group_ebitda", label: "Group EBITDA", unit: "USD thousands" },
    denominator: { componentId: "group_ebitda_budget", label: "Group EBITDA budget", unit: "USD thousands" },
    reported: [],
    target: "budget",
    limitations: [],
    facts(month) {
      const budget = Math.round(groupPlan(month) * 0.175);
      return {
        numerator: Math.round(budget * (0.985 + 0.02 * jitter(73, month))),
        denominator: budget,
        reported: {},
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.cash,
    family: "Operating cash flow",
    unit: "% of cash plan",
    numerator: { componentId: "operating_cash_flow", label: "Operating cash flow", unit: "USD thousands" },
    denominator: { componentId: "cash_flow_plan", label: "Cash-flow plan", unit: "USD thousands" },
    reported: [
      { componentId: "working_capital_days", label: "Working-capital days", unit: "days", additive: false },
    ],
    target: "budget",
    limitations: ["Working-capital days are shown as context only; they are not added into the cash-flow ratio."],
    facts(month) {
      const plan = Math.round(groupPlan(month) * 0.12);
      const pressure = month >= 9 ? 0.045 : 0;
      return {
        numerator: Math.round(plan * (0.99 - pressure + 0.015 * jitter(79, month))),
        denominator: plan,
        reported: { working_capital_days: Math.round(46 + 3 * jitter(83, month) + (month >= 9 ? 6 : 0)) },
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.quality,
    family: "Clinical quality scorecard",
    unit: "% of approved quality points",
    numerator: { componentId: "quality_points_met", label: "Quality points met", unit: "points" },
    denominator: { componentId: "quality_points_available", label: "Quality points available", unit: "points" },
    reported: [],
    target: "not_configured",
    limitations: ["Composite points are illustrative and do not replace clinical governance review."],
    facts(month) {
      const available = 100;
      return {
        numerator: Math.round(available * (0.91 + 0.015 * jitter(89, month))),
        denominator: available,
        reported: {},
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.experience,
    family: "Patient experience",
    unit: "% of response-adjusted plan",
    numerator: { componentId: "experience_points_met", label: "Patient-experience points met", unit: "points" },
    denominator: { componentId: "experience_points_available", label: "Patient-experience points available", unit: "points" },
    reported: [
      { componentId: "survey_response_rate", label: "Survey response rate", unit: "%", additive: false },
    ],
    target: "not_configured",
    limitations: ["Survey response-rate context is reported separately from the composite score."],
    facts(month) {
      return {
        numerator: Math.round(88 + 2 * jitter(97, month)),
        denominator: 100,
        reported: { survey_response_rate: Math.round(37 + 4 * jitter(101, month)) },
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.growth,
    family: "COE contribution",
    unit: "% of milestone plan",
    numerator: { componentId: "growth_milestones_on_track", label: "Growth milestones on track", unit: "milestones" },
    denominator: { componentId: "growth_milestones_due", label: "Growth milestones due", unit: "milestones" },
    reported: [
      { componentId: "contract_utilisation", label: "Contract utilisation", unit: "%", additive: false },
    ],
    target: "budget",
    limitations: ["Milestone completion and contract utilisation are related but not interchangeable."],
    facts(month) {
      const due = 12;
      return {
        numerator: Math.round(10 + (month >= 8 ? 1 : 0) + jitter(103, month)),
        denominator: due,
        reported: { contract_utilisation: Math.round(68 + 6 * jitter(107, month)) },
      };
    },
  },
  {
    assignmentId: CHAIRMAN_ASSIGNMENTS.governance,
    family: "Legal and compliance closure",
    unit: "% of critical actions due",
    numerator: { componentId: "critical_actions_closed", label: "Critical governance, legal and audit actions closed", unit: "actions" },
    denominator: { componentId: "critical_actions_due", label: "Critical actions due", unit: "actions" },
    reported: [],
    target: "not_configured",
    limitations: ["Critical actions are governance workflow items in this fixture, not legal advice."],
    facts(month) {
      const due = 14;
      const drag = month >= 10 ? 3 : 0;
      return {
        numerator: due - drag,
        denominator: due,
        reported: {},
      };
    },
  },
];

function ratio(numerator: number | null, denominator: number | null): MeasureValue {
  if (denominator === null) {
    return { status: "missing", reason: numerator === null ? "not_reported" : "missing_denominator" };
  }
  if (numerator === null) return { status: "missing", reason: "not_reported" };
  if (denominator === 0) return { status: "not_applicable", reason: "zero_denominator" };
  if (denominator < 0) return { status: "not_applicable", reason: "invalid_denominator" };
  return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 };
}

function amount(value: number | null): MeasureValue {
  return value === null ? { status: "missing", reason: "not_reported" } : { status: "available", value };
}

function targetFor(spec: Pick<ObservationSpec, "assignmentId" | "target">): Target {
  if (spec.target === "not_configured") return { state: "not_configured" };
  const assignment = getAssignment(spec.assignmentId);
  return {
    state: "configured",
    value: 100,
    direction: "higher_is_better",
    approval: "demo_parameter",
    basis: assignment?.targetBasis || "Approved plan",
  };
}

function qualityFor(spec: Pick<ObservationSpec, "limitations">, lateClose: boolean): DataQuality {
  return {
    state: "illustrative",
    reconciliation: lateClose ? "unreconciled" : "reconciled",
    freshness: lateClose ? "late" : "current",
    refreshedAt: AS_OF,
    limitations: [...(lateClose ? [LATE_CLOSE] : []), ...spec.limitations],
  };
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function observationId(spec: ObservationSpec, entity: ScopeEntity, period: Period) {
  return `obs:${slug(spec.family)}:${entity.entityId}:${period.start.slice(0, 7)}`;
}

function buildObservation(spec: ObservationSpec, entity: ScopeEntity, period: Period, facts: Facts, lateClose: boolean): Observation {
  const components: ComponentMeasure[] = [
    { ...spec.numerator, role: "numerator", value: amount(facts.numerator) },
    { ...spec.denominator, role: "denominator", value: amount(facts.denominator) },
    ...spec.reported.map(({ additive: _additive, ...component }) => ({
      ...component,
      role: "measure" as const,
      value: amount(facts.reported[component.componentId] ?? null),
    })),
  ];

  return {
    observationId: observationId(spec, entity, period),
    assignmentId: spec.assignmentId,
    definitionFamily: spec.family,
    definitionVersion: DEFINITION_VERSION,
    entity,
    period,
    unit: spec.unit,
    value: ratio(facts.numerator, facts.denominator),
    components,
    target: targetFor(spec),
    provenance: "illustrative",
    dataQuality: qualityFor(spec, lateClose),
  };
}

function sumOrNull(values: readonly (number | null)[]) {
  return values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function buildObservations(): Observation[] {
  const rows: Observation[] = [];

  for (const spec of FAMILY_SPECS) {
    PERIODS.forEach((period, month) => {
      const facilityFacts = FACILITIES.map((facility, index) => ({
        facility,
        facts: spec.appliesTo(facility) ? spec.facts(facility, index, month) : null,
      }));

      for (const { facility, facts } of facilityFacts) {
        if (facts) {
          rows.push(buildObservation(spec, facility.entity, period, facts, spec.fromManagementAccounts && isLateClose(facility, month)));
        }
      }

      for (const region of REGIONS) {
        const members = facilityFacts.filter(({ facility, facts }) => facility.region === region.entityId && facts);
        if (members.length === 0) continue;
        const facts = members.map((member) => member.facts).filter((value): value is Facts => value !== null);
        const reported: Record<string, number | null> = {};
        for (const component of spec.reported) {
          reported[component.componentId] = component.additive
            ? sumOrNull(facts.map((fact) => fact.reported[component.componentId] ?? null))
            : null;
        }
        const rolledUp: Facts = {
          numerator: sumOrNull(facts.map((fact) => fact.numerator)),
          denominator: sumOrNull(facts.map((fact) => fact.denominator)),
          reported,
        };
        const lateClose = spec.fromManagementAccounts && region.entityId === REGION_NORTH.entityId && month === LATEST;
        rows.push(buildObservation(spec, region, period, rolledUp, lateClose));
      }
    });
  }

  for (const spec of GROUP_FAMILY_SPECS) {
    PERIODS.forEach((period, month) => {
      rows.push(buildObservation(spec, GROUP, period, spec.facts(month), false));
    });
  }

  return rows;
}

export const OBSERVATIONS: readonly Observation[] = buildObservations();

export function findObservation(observationId: string) {
  return OBSERVATIONS.find((row) => row.observationId === observationId);
}

export function seriesFor(assignmentId: string, entity: ScopeEntity) {
  return OBSERVATIONS.filter(
    (row) =>
      row.assignmentId === assignmentId &&
      row.entity.grain === entity.grain &&
      row.entity.entityId === entity.entityId,
  );
}

function latestFor(assignmentId: string, family: string, entity: ScopeEntity, month = LATEST) {
  const period = PERIODS[month];
  return OBSERVATIONS.find(
    (row) =>
      row.assignmentId === assignmentId &&
      row.definitionFamily === family &&
      row.entity.entityId === entity.entityId &&
      row.period.start === period?.start,
  );
}

function valueOf(observation: Observation | undefined) {
  return observation?.value.status === "available" ? observation.value.value : null;
}

function requireObservation(observation: Observation | undefined, label: string): Observation {
  if (!observation) throw new Error(`Preview fixture is missing ${label}.`);
  return observation;
}

function evidenceOf(observations: readonly Observation[]) {
  return {
    observationIds: observations.map((row) => row.observationId),
    definitionVersion: DEFINITION_VERSION,
    datasetChecksum: DATASET_CHECKSUM,
  };
}

/** Exceptions are templated over the observed values above, so the narrative cannot drift from the numbers. */
function buildExceptions(region: ScopeEntity): Exception[] {
  const facility = FACILITIES.find((row) => row.region === region.entityId);
  if (!facility) return [];

  const capacityRecent = [CAPACITY_ONSET, CAPACITY_ONSET + 1, CAPACITY_ONSET + 2, LATEST].map((month) =>
    requireObservation(latestFor(ASSIGNMENTS.capacity, "Capacity utilisation", facility.entity, month), "capacity"),
  );
  const capacityBefore = requireObservation(
    latestFor(ASSIGNMENTS.capacity, "Capacity utilisation", facility.entity, CAPACITY_ONSET - 1),
    "pre-onset capacity",
  );
  const lowestRecent = Math.min(...capacityRecent.map((row) => valueOf(row) ?? Number.POSITIVE_INFINITY));
  const capacityThen = valueOf(capacityBefore);

  const revenueLatest = requireObservation(latestFor(ASSIGNMENTS.revenue, "Net revenue", region), "revenue");
  const claimsLatest = requireObservation(latestFor(ASSIGNMENTS.claims, "First-pass claim acceptance", region), "claims");
  const claimsBefore = requireObservation(
    latestFor(ASSIGNMENTS.claims, "First-pass claim acceptance", region, CLAIMS_ONSET - 1),
    "pre-onset claims",
  );

  const exceptions: Exception[] = [];

  // Each exception is raised only when the generated values actually show it.
  if (capacityThen !== null && Number.isFinite(lowestRecent) && lowestRecent - capacityThen >= 5) {
    exceptions.push({
      exceptionId: `exc:capacity:${facility.entity.entityId}`,
      assignmentId: ASSIGNMENTS.capacity,
      entity: facility.entity,
      period: CURRENT_PERIOD,
      priority: "act_now",
      category: "performance",
      comparisonBasis: "prior_period",
      detection: { kind: "seeded_scenario", scenarioLabel: "Sustained capacity constraint (preview fixture)" },
      whatChanged: `Utilisation has stayed at or above ${lowestRecent}% of available staffed bed days for four months, up from ${capacityThen}% before available bed days fell.`,
      whyItMatters:
        "Occupied bed days held while available staffed bed days fell, so the facility is operating near its available capacity. Review the component evidence and facility split before deciding on an operating action.",
      owner: { role: "hospital-dho" },
      actionState: "none",
      evidence: evidenceOf(capacityRecent),
      provenance: "illustrative",
      dataQuality: capacityRecent.at(-1)?.dataQuality ?? capacityBefore.dataQuality,
    });
  }

  if (revenueLatest.value.status !== "available") {
    exceptions.push({
      exceptionId: `exc:revenue:${region.entityId}`,
      assignmentId: ASSIGNMENTS.revenue,
      entity: region,
      period: CURRENT_PERIOD,
      priority: "monitor",
      category: "performance",
      comparisonBasis: "budget",
      detection: { kind: "seeded_scenario", scenarioLabel: "Late and unreconciled source feed (preview fixture)" },
      whatChanged:
        "The management-accounts close for August 2026 is late and unreconciled, so no revenue-to-budget comparison is presented for the period.",
      whyItMatters:
        "Treat this as a monitoring signal until the source is reconciled; July 2026 is the latest reconciled comparison.",
      owner: { role: "regional-coo" },
      actionState: "none",
      evidence: evidenceOf([revenueLatest]),
      provenance: "illustrative",
      dataQuality: revenueLatest.dataQuality,
    });
  }

  const claimsNow = valueOf(claimsLatest);
  const claimsThen = valueOf(claimsBefore);
  if (claimsNow !== null && claimsThen !== null && claimsThen - claimsNow >= 1) {
    exceptions.push({
      exceptionId: `exc:claims:${region.entityId}`,
      assignmentId: ASSIGNMENTS.claims,
      entity: region,
      period: CURRENT_PERIOD,
      priority: "monitor",
      category: "performance",
      comparisonBasis: "prior_period",
      detection: { kind: "seeded_scenario", scenarioLabel: "Claim-quality decline (preview fixture)" },
      whatChanged: `First-pass acceptance fell from ${claimsThen}% to ${claimsNow}% of submitted claims since May 2026.`,
      whyItMatters: "Review the facility split to see where the change sits before deciding whether a revenue-cycle action is needed.",
      owner: { role: "regional-coo" },
      actionState: "none",
      evidence: evidenceOf([claimsLatest]),
      provenance: "illustrative",
      dataQuality: claimsLatest.dataQuality,
    });
  }

  return exceptions;
}

function onTrack(region: ScopeEntity, assignmentId: string, family: string, summary: string): OnTrackItem {
  const observation = requireObservation(latestFor(assignmentId, family, region), family);
  return {
    assignmentId,
    entity: region,
    period: CURRENT_PERIOD,
    summary,
    evidence: evidenceOf([observation]),
    provenance: "illustrative",
    dataQuality: observation.dataQuality,
  };
}

function chairmanOnTrack(assignmentId: string, family: string, summary: string): OnTrackItem {
  const observation = requireObservation(latestFor(assignmentId, family, GROUP), family);
  return {
    assignmentId,
    entity: GROUP,
    period: CURRENT_PERIOD,
    summary,
    evidence: evidenceOf([observation]),
    provenance: "illustrative",
    dataQuality: observation.dataQuality,
  };
}

function buildChairmanExceptions(): Exception[] {
  const cash = requireObservation(latestFor(CHAIRMAN_ASSIGNMENTS.cash, "Operating cash flow", GROUP), "operating cash flow");
  const governance = requireObservation(
    latestFor(CHAIRMAN_ASSIGNMENTS.governance, "Legal and compliance closure", GROUP),
    "legal and compliance closure",
  );
  const exceptions: Exception[] = [];
  const cashValue = valueOf(cash);
  const governanceValue = valueOf(governance);

  if (governanceValue !== null && governanceValue < 85) {
    exceptions.push({
      exceptionId: "exc:chairman:governance-closure",
      assignmentId: CHAIRMAN_ASSIGNMENTS.governance,
      entity: GROUP,
      period: CURRENT_PERIOD,
      priority: "act_now",
      category: "compliance",
      comparisonBasis: "target",
      detection: { kind: "seeded_scenario", scenarioLabel: "Critical governance closure below plan (preview fixture)" },
      whatChanged: `Critical governance, legal and audit action closure is ${governanceValue}% for the group in the current period.`,
      whyItMatters:
        "This is a Board-level governance signal. Review the evidence before deciding whether a cross-functional action needs an accountable owner.",
      owner: { role: "legal-head" },
      actionState: "none",
      evidence: evidenceOf([governance]),
      provenance: "illustrative",
      dataQuality: governance.dataQuality,
    });
  }

  if (cashValue !== null && cashValue < 96) {
    exceptions.push({
      exceptionId: "exc:chairman:cash-flow",
      assignmentId: CHAIRMAN_ASSIGNMENTS.cash,
      entity: GROUP,
      period: CURRENT_PERIOD,
      priority: "monitor",
      category: "performance",
      comparisonBasis: "budget",
      detection: { kind: "seeded_scenario", scenarioLabel: "Working-capital pressure (preview fixture)" },
      whatChanged: `Operating cash flow is ${cashValue}% of the illustrative cash plan while working-capital days are elevated.`,
      whyItMatters:
        "This should stay visible for the Chairman because it links profitable growth to cash discipline, but it does not require inventing facility-level detail.",
      owner: { role: "group-cfo" },
      actionState: "none",
      evidence: evidenceOf([cash]),
      provenance: "illustrative",
      dataQuality: cash.dataQuality,
    });
  }

  return exceptions;
}

export interface RegionBrief {
  exceptions: Exception[];
  onTrack: OnTrackItem[];
  dataLimitations: DataLimitation[];
}

export function briefFor(region: ScopeEntity): RegionBrief {
  return {
    exceptions: buildExceptions(region),
    onTrack: [
      onTrack(region, ASSIGNMENTS.collections, "Collections", "Cash collections are reported against plan for the period; no exception was raised for this assignment."),
      onTrack(region, ASSIGNMENTS.experience, "Patient experience", "Corrective-action closure is reported for the period; no exception was raised for this assignment."),
      onTrack(region, ASSIGNMENTS.engagement, "Engagement", "Critical-role retention is reported for the period; no exception was raised for this assignment."),
    ],
    dataLimitations:
      region.entityId === REGION_NORTH.entityId
        ? [
            { assignmentId: ASSIGNMENTS.revenue, issue: "late", detail: LATE_CLOSE },
            { assignmentId: ASSIGNMENTS.ebitda, issue: "unreconciled", detail: LATE_CLOSE },
            { assignmentId: ASSIGNMENTS.collections, issue: "unavailable", detail: "DSO is not reported: the group-approved DSO calculation is not configured in this fixture." },
            { assignmentId: ASSIGNMENTS.experience, issue: "unavailable", detail: "The patient-experience score is not reported: no approved survey instrument is configured." },
          ]
        : [],
  };
}

export function chairmanBrief(): RegionBrief {
  return {
    exceptions: buildChairmanExceptions(),
    onTrack: [
      chairmanOnTrack(CHAIRMAN_ASSIGNMENTS.revenue, "Net revenue", "Group revenue is reported against the illustrative Board-approved plan."),
      chairmanOnTrack(CHAIRMAN_ASSIGNMENTS.ebitda, "EBITDA", "Group EBITDA is visible against the same definition version as revenue."),
      chairmanOnTrack(CHAIRMAN_ASSIGNMENTS.quality, "Clinical quality scorecard", "Clinical quality remains visible as a composite with limitations disclosed."),
      chairmanOnTrack(CHAIRMAN_ASSIGNMENTS.experience, "Patient experience", "Patient-experience context is available without patient-level data."),
      chairmanOnTrack(CHAIRMAN_ASSIGNMENTS.growth, "COE contribution", "Strategic growth milestones are tracked as Board-level commitments."),
    ],
    dataLimitations: [
      {
        assignmentId: CHAIRMAN_ASSIGNMENTS.cash,
        issue: "unavailable",
        detail: "Working-capital days are context only in this fixture and are not added into the cash-flow ratio.",
      },
      {
        assignmentId: CHAIRMAN_ASSIGNMENTS.quality,
        issue: "unavailable",
        detail: "The clinical-quality composite is illustrative and does not replace clinical governance review.",
      },
    ],
  };
}

export function facilitiesIn(region: ScopeEntity) {
  return FACILITIES.filter((row) => row.region === region.entityId).map((row) => row.entity);
}

export function regionOf(entity: ScopeEntity) {
  if (entity.grain === "region") return REGIONS.some((row) => row.entityId === entity.entityId) ? entity.entityId : null;
  if (entity.grain === "facility") return FACILITIES.find((row) => row.entity.entityId === entity.entityId)?.region ?? null;
  return null;
}
