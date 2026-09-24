import type {
  ComponentMeasure,
  DataLimitation,
  Exception,
  MeasureValue,
  Observation,
  OnTrackItem,
  Period,
  ScopeEntity,
} from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import {
  AS_OF,
  CURRENT_PERIOD,
  DATASET_CHECKSUM,
  DEFINITION_VERSION,
  FACILITIES,
  PERIODS,
  type RegionBrief,
} from "./dataset";

/** Stable assignment ids imported from the workbook's Hospital DHO rows. */
export const DHO_ASSIGNMENTS = {
  revenue: "hospital-dho:hospital-net-revenue-vs-approved-budget",
  ebitda: "hospital-dho:hospital-ebitda-vs-approved-budget",
  capacity: "hospital-dho:capacity-utilisation-and-patient-throughput",
  referral: "hospital-dho:referral-conversion-and-new-service-revenue",
  experience: "hospital-dho:patient-experience-and-complaint-capa-closure",
  collections: "hospital-dho:collections-dso-and-unbilled-revenue",
  claims: "hospital-dho:claim-first-pass-acceptance-and-rejection-value",
  people: "hospital-dho:people-productivity-engagement-and-critical-attrition",
  readiness: "hospital-dho:facility-readiness-licensure-and-safety-actions",
} as const;

/** The preview's single provisioned hospital account. This is not a client facility name. */
export const DHO_FACILITY: ScopeEntity = FACILITIES[0]?.entity ?? { grain: "facility", entityId: "fixture-facility-a1" };

const DHO_LIMITATION =
  "Illustrative hospital-governance fixture; values are not validated operational, financial, workforce, or clinical measures.";

interface DhoProfile {
  numerator: string;
  denominator: string;
  unit: string;
  base: number;
  drift: number;
  limitation?: string;
  reported?: { id: string; label: string; unit: string };
}

const PROFILES: Record<string, DhoProfile> = {
  [DHO_ASSIGNMENTS.revenue]: {
    numerator: "Hospital net revenue recognised",
    denominator: "Approved hospital net revenue budget",
    unit: "% of approved budget",
    base: 93,
    drift: 2,
  },
  [DHO_ASSIGNMENTS.ebitda]: {
    numerator: "Hospital EBITDA delivered",
    denominator: "Approved hospital EBITDA budget",
    unit: "% of approved budget",
    base: 88,
    drift: 1,
  },
  [DHO_ASSIGNMENTS.capacity]: {
    numerator: "Capacity units used",
    denominator: "Staffed capacity units available",
    unit: "% of available capacity",
    base: 84,
    drift: 2,
  },
  [DHO_ASSIGNMENTS.referral]: {
    numerator: "Eligible referrals completing the intended service",
    denominator: "Eligible referrals",
    unit: "% of eligible referrals",
    base: 71,
    drift: 2,
  },
  [DHO_ASSIGNMENTS.experience]: {
    numerator: "Approved patient-experience points met",
    denominator: "Approved patient-experience points available",
    unit: "% of available points",
    base: 79,
    drift: 1,
    limitation: "Response context is illustrative and is not a validated survey result.",
    reported: { id: "response_rate", label: "Response rate", unit: "%" },
  },
  [DHO_ASSIGNMENTS.collections]: {
    numerator: "Hospital cash collections",
    denominator: "Approved hospital cash-collections plan",
    unit: "% of plan",
    base: 86,
    drift: 2,
  },
  [DHO_ASSIGNMENTS.claims]: {
    numerator: "First-pass accepted claims",
    denominator: "Submitted claims",
    unit: "% of submitted claims",
    base: 89,
    drift: 1,
  },
  [DHO_ASSIGNMENTS.people]: {
    numerator: "People productivity and engagement indicators met",
    denominator: "People productivity and engagement indicators reviewed",
    unit: "% of reviewed indicators",
    base: 81,
    drift: 1,
  },
  [DHO_ASSIGNMENTS.readiness]: {
    numerator: "Critical readiness, licensure, and safety actions closed",
    denominator: "Critical readiness, licensure, and safety actions due",
    unit: "% of actions due",
    base: 92,
    drift: 1,
    limitation: "The underlying action register is not connected in this preview.",
  },
};

function amount(value: number): MeasureValue {
  return { status: "available", value };
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function ratio(numerator: number, denominator: number): MeasureValue {
  return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 };
}

function valueFor(assignmentId: string, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Hospital DHO fixture profile for ${assignmentId}.`);
  const readinessScenario = assignmentId === DHO_ASSIGNMENTS.readiness && month >= PERIODS.length - 2 ? -17 : 0;
  const familyOffset = familyIndex * 2;
  const value = Math.max(0, Math.min(100, profile.base + familyOffset + profile.drift * ((month % 4) - 1) + readinessScenario));
  const denominator = 100;
  return {
    numerator: Math.round((denominator * value) / 100),
    denominator,
    reported: profile.reported ? Math.round(34 + (month % 5) * 2) : null,
  };
}

function observation(assignmentId: string, family: string, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Hospital DHO fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  if (profile.reported) {
    components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(facts.reported ?? 0) });
  }
  return {
    observationId: `obs:${slug(family)}:${DHO_FACILITY.entityId}:${period.start.slice(0, 7)}`,
    assignmentId,
    definitionFamily: family,
    definitionVersion: DEFINITION_VERSION,
    entity: DHO_FACILITY,
    period,
    unit: profile.unit,
    value: ratio(facts.numerator, facts.denominator),
    components,
    target: { state: "not_configured" },
    provenance: "illustrative",
    dataQuality: {
      state: "illustrative",
      reconciliation: "reconciled",
      freshness: "current",
      refreshedAt: AS_OF,
      limitations: [DHO_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])],
    },
  };
}

function buildObservations() {
  const rows: Observation[] = [];
  for (const assignmentId of Object.values(DHO_ASSIGNMENTS)) {
    getDefinitionFamiliesForAssignment(assignmentId).forEach((family, familyIndex) => {
      PERIODS.forEach((period, month) => rows.push(observation(assignmentId, family.family, period, month, familyIndex)));
    });
  }
  return rows;
}

export const DHO_OBSERVATIONS: readonly Observation[] = buildObservations();

export function dhoFindObservation(observationId: string) {
  return DHO_OBSERVATIONS.find((row) => row.observationId === observationId);
}

export function dhoObservationFor(assignmentId: string, period = CURRENT_PERIOD) {
  return DHO_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.period.start === period.start);
}

export function dhoSeriesFor(assignmentId: string, entity: ScopeEntity) {
  return DHO_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId);
}

export function dhoBreakdownRows(): Observation[] {
  return [];
}

function evidenceOf(observations: readonly Observation[]) {
  return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM };
}

function valueOf(row: Observation | undefined) {
  return row?.value.status === "available" ? row.value.value : null;
}

export function dhoBrief(): RegionBrief {
  const current = dhoObservationFor(DHO_ASSIGNMENTS.readiness);
  const prior = dhoObservationFor(DHO_ASSIGNMENTS.readiness, PERIODS[PERIODS.length - 3]);
  const exceptions: Exception[] = [];
  const currentValue = valueOf(current);
  const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) {
    exceptions.push({
      exceptionId: "exc:hospital-dho:readiness-closure",
      assignmentId: DHO_ASSIGNMENTS.readiness,
      entity: DHO_FACILITY,
      period: CURRENT_PERIOD,
      priority: "act_now",
      category: "compliance",
      comparisonBasis: "prior_period",
      detection: { kind: "seeded_scenario", scenarioLabel: "Facility readiness closure movement (preview fixture)" },
      whatChanged: `Critical readiness, licensure, and safety action closure moved from ${priorValue}% to ${currentValue}% between the compared periods.`,
      whyItMatters: "Review the approved facility action register and accountable owners before recording an internal follow-up.",
      owner: { role: "hospital-dho" },
      actionState: "none",
      evidence: evidenceOf([prior, current]),
      provenance: "illustrative",
      dataQuality: current.dataQuality,
    });
  }

  const onTrackAssignments = [DHO_ASSIGNMENTS.revenue, DHO_ASSIGNMENTS.capacity, DHO_ASSIGNMENTS.experience, DHO_ASSIGNMENTS.people].map((assignmentId) => {
    const assignment = getAssignment(assignmentId);
    if (!assignment) throw new Error(`Missing Hospital DHO assignment metadata for ${assignmentId}.`);
    return [assignmentId, assignment.kpi] as const;
  });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => {
    const row = dhoObservationFor(assignmentId);
    return row ? [{ assignmentId, entity: DHO_FACILITY, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : [];
  });

  const dataLimitations: DataLimitation[] = [
    { assignmentId: DHO_ASSIGNMENTS.readiness, issue: "unavailable", detail: "No approved facility readiness threshold is configured in this preview; the action register is illustrative and read-only." },
    { assignmentId: DHO_ASSIGNMENTS.experience, issue: "unavailable", detail: "Patient-experience response context is illustrative and does not represent a validated survey instrument." },
  ];
  return { exceptions, onTrack, dataLimitations };
}
