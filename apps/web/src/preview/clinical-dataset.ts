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
import { getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import {
  AS_OF,
  CURRENT_PERIOD,
  DATASET_CHECKSUM,
  DEFINITION_VERSION,
  FACILITIES,
  GROUP,
  PERIODS,
  type RegionBrief,
} from "./dataset";

/** Stable assignment ids imported from the workbook's Role KPI Matrix. */
export const CLINICAL_ASSIGNMENTS = {
  quality: "clinical-director:clinical-quality-scorecard",
  safety: "clinical-director:serious-adverse-event-rate-and-review-closure",
  protocol: "clinical-director:protocol-compliance-and-critical-audit-closure",
  experience: "clinical-director:clinical-patient-experience-score",
  credentialing: "clinical-director:medical-credentialing-and-capability-completion",
  coe: "clinical-director:coe-revenue-and-contribution-vs-plan",
  propositions: "clinical-director:clinical-propositions-converted-to-revenue",
  referral: "clinical-director:priority-care-referral-conversion",
} as const;

export const CLINICAL_COE: ScopeEntity = { grain: "coe", entityId: "fixture-coe-clinical" };

const CLINICAL_LIMITATION =
  "Illustrative clinical-governance fixture; values are not validated clinical measures or care thresholds.";

interface ClinicalProfile {
  numerator: string;
  denominator: string;
  unit: string;
  base: number;
  drift: number;
  limitation?: string;
  reported?: { id: string; label: string; unit: string };
}

const PROFILES: Record<string, ClinicalProfile> = {
  [CLINICAL_ASSIGNMENTS.quality]: {
    numerator: "Quality indicators meeting the approved review criteria",
    denominator: "Quality indicators reviewed",
    unit: "% of reviewed indicators",
    base: 87,
    drift: 1,
  },
  [CLINICAL_ASSIGNMENTS.safety]: {
    numerator: "Required safety reviews closed",
    denominator: "Required safety reviews due",
    unit: "% of required reviews",
    base: 91,
    drift: 2,
    limitation: "The adverse-event component is not separately reported in this preview.",
  },
  [CLINICAL_ASSIGNMENTS.protocol]: {
    numerator: "Protocol checks meeting the approved criteria",
    denominator: "Protocol checks completed",
    unit: "% of completed checks",
    base: 89,
    drift: 1,
  },
  [CLINICAL_ASSIGNMENTS.experience]: {
    numerator: "Clinical-care experience points met",
    denominator: "Clinical-care experience points available",
    unit: "% of available points",
    base: 82,
    drift: 1,
    limitation: "Response-rate context is illustrative and not a validated survey result.",
    reported: { id: "response_rate", label: "Response rate", unit: "%" },
  },
  [CLINICAL_ASSIGNMENTS.credentialing]: {
    numerator: "Credential and competency requirements complete",
    denominator: "Credential and competency requirements due",
    unit: "% of requirements",
    base: 94,
    drift: 0,
  },
  [CLINICAL_ASSIGNMENTS.coe]: {
    numerator: "COE contribution delivered",
    denominator: "COE contribution plan",
    unit: "% of plan",
    base: 88,
    drift: 2,
  },
  [CLINICAL_ASSIGNMENTS.propositions]: {
    numerator: "Approved propositions converted",
    denominator: "Approved propositions reviewed",
    unit: "% of reviewed propositions",
    base: 73,
    drift: 3,
  },
  [CLINICAL_ASSIGNMENTS.referral]: {
    numerator: "Priority referrals completing the intended next service",
    denominator: "Eligible priority referrals",
    unit: "% of eligible referrals",
    base: 66,
    drift: 2,
  },
};

function amount(value: number): MeasureValue {
  return { status: "available", value };
}

function valueFor(assignmentId: string, month: number, entity: ScopeEntity, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Clinical Director fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.grain === "coe" ? -2 : (entity.entityId.charCodeAt(entity.entityId.length - 1) % 5) - 2;
  const safetyScenario = assignmentId === CLINICAL_ASSIGNMENTS.safety && month >= PERIODS.length - 2 ? -14 : 0;
  const familyOffset = familyIndex * 2;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyOffset + profile.drift * ((month % 4) - 1) + safetyScenario));
  const denominator = entity.grain === "group" ? 100 : entity.grain === "coe" ? 60 : 20;
  return { numerator: Math.round((denominator * value) / 100), denominator, reported: profile.reported ? Math.round(32 + (month % 5) * 2) : null };
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function ratio(numerator: number, denominator: number): MeasureValue {
  return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 };
}

function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Clinical Director fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, month, entity, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  if (profile.reported) {
    components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(facts.reported ?? 0) });
  }
  return {
    observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`,
    assignmentId,
    definitionFamily: family,
    definitionVersion: DEFINITION_VERSION,
    entity,
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
      limitations: [CLINICAL_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])],
    },
  };
}

const CLINICAL_ENTITIES: readonly ScopeEntity[] = [
  GROUP,
  CLINICAL_COE,
  ...FACILITIES.map((facility) => facility.entity),
];

function buildClinicalObservations() {
  const rows: Observation[] = [];
  for (const assignmentId of Object.values(CLINICAL_ASSIGNMENTS)) {
    const families = getDefinitionFamiliesForAssignment(assignmentId);
    families.forEach((family, familyIndex) => {
      PERIODS.forEach((period, month) => {
        CLINICAL_ENTITIES.forEach((entity) => rows.push(observation(assignmentId, family.family, entity, period, month, familyIndex)));
      });
    });
  }
  return rows;
}

export const CLINICAL_OBSERVATIONS: readonly Observation[] = buildClinicalObservations();

export function clinicalFindObservation(observationId: string) {
  return CLINICAL_OBSERVATIONS.find((row) => row.observationId === observationId);
}

export function clinicalSeriesFor(assignmentId: string, entity: ScopeEntity) {
  return CLINICAL_OBSERVATIONS.filter(
    (row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId,
  );
}

export function clinicalBreakdownRows(assignmentId: string, parent: ScopeEntity, grain: ScopeEntity["grain"], period: Period) {
  return CLINICAL_OBSERVATIONS.filter(
    (row) =>
      row.assignmentId === assignmentId &&
      row.entity.grain === grain &&
      row.period.start === period.start &&
      (parent.grain === "group" || parent.grain === "coe"),
  );
}

function evidenceOf(observations: readonly Observation[]) {
  return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM };
}

function latest(assignmentId: string, entity: ScopeEntity, month = PERIODS.length - 1) {
  const period = PERIODS[month];
  return CLINICAL_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period?.start);
}

function valueOf(row: Observation | undefined) {
  return row?.value.status === "available" ? row.value.value : null;
}

export function clinicalBrief(): RegionBrief {
  const current = latest(CLINICAL_ASSIGNMENTS.safety, GROUP);
  const prior = latest(CLINICAL_ASSIGNMENTS.safety, GROUP, PERIODS.length - 3);
  const exceptions: Exception[] = [];
  const currentValue = valueOf(current);
  const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) {
    exceptions.push({
      exceptionId: "exc:clinical-director:safety-review-closure",
      assignmentId: CLINICAL_ASSIGNMENTS.safety,
      entity: GROUP,
      period: CURRENT_PERIOD,
      priority: "act_now",
      category: "safety",
      comparisonBasis: "prior_period",
      detection: { kind: "seeded_scenario", scenarioLabel: "Clinical governance review closure movement (preview fixture)" },
      whatChanged: `Required safety-review closure moved from ${priorValue}% to ${currentValue}% between the compared periods.`,
      whyItMatters: "Review the approved clinical-governance evidence and accountable owners before recording an internal follow-up.",
      owner: { role: "clinical-director" },
      actionState: "none",
      evidence: evidenceOf([prior, current]),
      provenance: "illustrative",
      dataQuality: current.dataQuality,
    });
  }

  const onTrackAssignments = [
    [CLINICAL_ASSIGNMENTS.quality, "Clinical quality scorecard"],
    [CLINICAL_ASSIGNMENTS.protocol, "Protocol compliance"],
    [CLINICAL_ASSIGNMENTS.credentialing, "Medical credentialing"],
    [CLINICAL_ASSIGNMENTS.coe, "COE contribution"],
  ] as const;
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => {
    const row = latest(assignmentId, GROUP);
    return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : [];
  });

  const dataLimitations: DataLimitation[] = [
    { assignmentId: CLINICAL_ASSIGNMENTS.quality, issue: "unavailable", detail: "No approved clinical threshold is configured in this preview; the scorecard is read-only and illustrative." },
    { assignmentId: CLINICAL_ASSIGNMENTS.experience, issue: "unavailable", detail: "Patient-experience response context is illustrative and does not represent a validated survey instrument." },
  ];
  return { exceptions, onTrack, dataLimitations };
}
