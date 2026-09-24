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
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, PERIODS } from "./dataset";
import { DHO_FACILITY } from "./dho-dataset";
import type { RegionBrief } from "./dataset";

/** Stable assignment ids imported from the workbook's People Executive rows. */
export const PEOPLE_ASSIGNMENTS = {
  fillRate: "people-executive:approved-position-fill-rate-and-time-to-fill",
  productivity: "people-executive:roster-adherence-and-labour-productivity",
  attrition: "people-executive:critical-role-attrition",
  engagement: "people-executive:engagement-score-and-action-closure",
  talent: "people-executive:performance-review-and-talent-matrix-completion",
  training: "people-executive:mandatory-training-and-credentialing-completion",
  compliance: "people-executive:hr-and-statutory-actions-closed-on-time",
  cost: "people-executive:manpower-cost-vs-plan",
} as const;

const PEOPLE_LIMITATION =
  "Illustrative workforce-governance fixture; values are not validated workforce, employment, or financial measures and contain no individual employee records.";

interface PeopleProfile {
  numerator: string;
  denominator: string;
  unit: string;
  base: number;
  drift: number;
  limitation?: string;
  reported?: { id: string; label: string; unit: string };
}

const PROFILES: Record<string, PeopleProfile> = {
  [PEOPLE_ASSIGNMENTS.fillRate]: { numerator: "Approved positions filled", denominator: "Approved positions", unit: "% of approved positions", base: 88, drift: 1 },
  [PEOPLE_ASSIGNMENTS.productivity]: { numerator: "Rostered staffing and productivity indicators met", denominator: "Rostered staffing and productivity indicators reviewed", unit: "% of reviewed indicators", base: 86, drift: 1 },
  [PEOPLE_ASSIGNMENTS.attrition]: { numerator: "Critical-role retention achieved", denominator: "Critical-role retention expected", unit: "% of retention plan", base: 91, drift: 1, limitation: "This aggregate does not expose individual employee records." },
  [PEOPLE_ASSIGNMENTS.engagement]: { numerator: "Engagement actions closed by due date", denominator: "Engagement actions due", unit: "% of actions due", base: 78, drift: 2, reported: { id: "response_rate", label: "Survey response rate", unit: "%" } },
  [PEOPLE_ASSIGNMENTS.talent]: { numerator: "Eligible reviews and talent assessments complete", denominator: "Eligible reviews and talent assessments due", unit: "% of eligible employees", base: 83, drift: 2 },
  [PEOPLE_ASSIGNMENTS.training]: { numerator: "Required learning and credentials current", denominator: "Required learning and credentials due", unit: "% of requirements", base: 94, drift: 1 },
  [PEOPLE_ASSIGNMENTS.compliance]: { numerator: "HR and statutory actions closed on time", denominator: "HR and statutory actions due", unit: "% of actions due", base: 93, drift: 1 },
  [PEOPLE_ASSIGNMENTS.cost]: { numerator: "Approved manpower cost used", denominator: "Approved manpower cost plan", unit: "% of plan", base: 96, drift: 1 },
};

function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }

function observation(assignmentId: string, family: string, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing People Executive fixture profile for ${assignmentId}.`);
  const trainingScenario = assignmentId === PEOPLE_ASSIGNMENTS.training && month >= PERIODS.length - 2 ? -15 : 0;
  const value = Math.max(0, Math.min(100, profile.base + familyIndex * 2 + profile.drift * ((month % 4) - 1) + trainingScenario));
  const denominator = 100;
  const numerator = Math.round((denominator * value) / 100);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(denominator) },
  ];
  if (profile.reported) components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(35 + (month % 5) * 2) });
  return {
    observationId: `obs:${slug(family)}:${DHO_FACILITY.entityId}:${period.start.slice(0, 7)}`,
    assignmentId,
    definitionFamily: family,
    definitionVersion: DEFINITION_VERSION,
    entity: DHO_FACILITY,
    period,
    unit: profile.unit,
    value: ratio(numerator, denominator),
    components,
    target: { state: "not_configured" },
    provenance: "illustrative",
    dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [PEOPLE_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] },
  };
}

const PEOPLE_OBSERVATIONS: Observation[] = Object.values(PEOPLE_ASSIGNMENTS).flatMap((assignmentId) =>
  getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.map((period, month) => observation(assignmentId, family.family, period, month, familyIndex))),
);

export { PEOPLE_OBSERVATIONS };

export function peopleFindObservation(observationId: string) { return PEOPLE_OBSERVATIONS.find((row) => row.observationId === observationId); }
export function peopleObservationFor(assignmentId: string, period = CURRENT_PERIOD) { return PEOPLE_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.period.start === period.start); }
export function peopleSeriesFor(assignmentId: string, entity: ScopeEntity) { return PEOPLE_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function peopleBreakdownRows(): Observation[] { return []; }

function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function peopleBrief(): RegionBrief {
  const current = peopleObservationFor(PEOPLE_ASSIGNMENTS.training);
  const prior = peopleObservationFor(PEOPLE_ASSIGNMENTS.training, PERIODS[PERIODS.length - 3]);
  const exceptions: Exception[] = [];
  const currentValue = valueOf(current);
  const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) {
    exceptions.push({
      exceptionId: "exc:people-executive:training-completion",
      assignmentId: PEOPLE_ASSIGNMENTS.training,
      entity: DHO_FACILITY,
      period: CURRENT_PERIOD,
      priority: "act_now",
      category: "compliance",
      comparisonBasis: "prior_period",
      detection: { kind: "seeded_scenario", scenarioLabel: "Mandatory training completion movement (preview fixture)" },
      whatChanged: `Required learning and credential completion moved from ${priorValue}% to ${currentValue}% between the compared periods.`,
      whyItMatters: "Review the aggregate capability evidence and accountable leaders before recording an internal follow-up.",
      owner: { role: "people-executive" },
      actionState: "none",
      evidence: evidenceOf([prior, current]),
      provenance: "illustrative",
      dataQuality: current.dataQuality,
    });
  }
  const onTrackAssignments = [PEOPLE_ASSIGNMENTS.fillRate, PEOPLE_ASSIGNMENTS.productivity, PEOPLE_ASSIGNMENTS.engagement, PEOPLE_ASSIGNMENTS.cost].map((assignmentId) => {
    const assignment = getAssignment(assignmentId);
    if (!assignment) throw new Error(`Missing People Executive assignment metadata for ${assignmentId}.`);
    return [assignmentId, assignment.kpi] as const;
  });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => {
    const row = peopleObservationFor(assignmentId);
    return row ? [{ assignmentId, entity: DHO_FACILITY, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : [];
  });
  const dataLimitations: DataLimitation[] = [
    { assignmentId: PEOPLE_ASSIGNMENTS.training, issue: "unavailable", detail: "No approved workforce capability threshold is configured in this preview; the aggregate is read-only and illustrative." },
    { assignmentId: PEOPLE_ASSIGNMENTS.engagement, issue: "unavailable", detail: "Survey response context is illustrative and does not represent a validated survey instrument." },
  ];
  return { exceptions, onTrack, dataLimitations };
}
