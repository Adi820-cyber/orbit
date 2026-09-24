import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, PERIODS, type RegionBrief } from "./dataset";
import { CLINICAL_COE } from "./clinical-dataset";

export const COE_ASSIGNMENTS = {
  revenue: "coe-lead:coe-net-revenue-vs-plan",
  margin: "coe-lead:coe-contribution-margin-or-ebitda-vs-plan",
  capacity: "coe-lead:coe-capacity-utilisation-and-case-volume",
  referral: "coe-lead:coe-referral-conversion",
  outcomes: "coe-lead:coe-outcomes-and-protocol-compliance",
  experience: "coe-lead:coe-patient-experience-score",
  milestones: "coe-lead:approved-coe-programme-milestones",
  capability: "coe-lead:coe-medical-team-capability-and-engagement",
} as const;

const COE_LIMITATION = "Illustrative COE-governance fixture; values are not validated financial, clinical, patient-experience, or workforce measures and contain no patient or staff records.";
interface CoeProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; reported?: { id: string; label: string; unit: string }; }
const PROFILES: Record<string, CoeProfile> = {
  [COE_ASSIGNMENTS.revenue]: { numerator: "COE net revenue delivered", denominator: "Approved COE net revenue plan", unit: "% of plan", base: 89, drift: 2 },
  [COE_ASSIGNMENTS.margin]: { numerator: "COE contribution delivered", denominator: "Approved COE contribution plan", unit: "% of plan", base: 84, drift: 1 },
  [COE_ASSIGNMENTS.capacity]: { numerator: "Approved COE capacity utilised", denominator: "Approved COE capacity available", unit: "% of available capacity", base: 82, drift: 2 },
  [COE_ASSIGNMENTS.referral]: { numerator: "Eligible referrals completing the intended COE service", denominator: "Eligible COE referrals", unit: "% of eligible referrals", base: 75, drift: 2 },
  [COE_ASSIGNMENTS.outcomes]: { numerator: "COE outcome and protocol indicators met", denominator: "COE outcome and protocol indicators reviewed", unit: "% of reviewed indicators", base: 88, drift: 1, limitation: "Risk-adjusted outcome components are not separately reported in this preview." },
  [COE_ASSIGNMENTS.experience]: { numerator: "COE patient-experience points met", denominator: "COE patient-experience points available", unit: "% of available points", base: 81, drift: 1, reported: { id: "response_rate", label: "Response rate", unit: "%" } },
  [COE_ASSIGNMENTS.milestones]: { numerator: "Approved COE milestones completed on time", denominator: "Approved COE milestones due", unit: "% of milestones due", base: 86, drift: 1 },
  [COE_ASSIGNMENTS.capability]: { numerator: "COE capability and engagement indicators met", denominator: "COE capability and engagement indicators reviewed", unit: "% of reviewed indicators", base: 90, drift: 1 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function observation(assignmentId: string, family: string, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId]; if (!profile) throw new Error(`Missing COE Lead fixture profile for ${assignmentId}.`);
  const milestoneScenario = assignmentId === COE_ASSIGNMENTS.milestones && month >= PERIODS.length - 2 ? -18 : 0;
  const denominator = 100; const value = Math.max(0, Math.min(100, profile.base + familyIndex * 2 + profile.drift * ((month % 4) - 1) + milestoneScenario)); const numerator = Math.round((denominator * value) / 100);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(denominator) },
  ];
  if (profile.reported) components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(36 + (month % 5) * 2) });
  return { observationId: `obs:${slug(family)}:${CLINICAL_COE.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity: CLINICAL_COE, period, unit: profile.unit, value: ratio(numerator, denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [COE_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}
export const COE_OBSERVATIONS: Observation[] = Object.values(COE_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.map((period, month) => observation(assignmentId, family.family, period, month, familyIndex))));
export function coeFindObservation(id: string) { return COE_OBSERVATIONS.find((row) => row.observationId === id); }
export function coeObservationFor(assignmentId: string, period = CURRENT_PERIOD) { return COE_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.period.start === period.start); }
export function coeSeriesFor(assignmentId: string, entity: ScopeEntity) { return COE_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function coeBreakdownRows(): Observation[] { return []; }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }
export function coeBrief(): RegionBrief {
  const current = coeObservationFor(COE_ASSIGNMENTS.milestones); const prior = coeObservationFor(COE_ASSIGNMENTS.milestones, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:coe-lead:programme-milestones", assignmentId: COE_ASSIGNMENTS.milestones, entity: CLINICAL_COE, period: CURRENT_PERIOD, priority: "act_now", category: "performance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "COE programme milestone movement (preview fixture)" }, whatChanged: `Approved COE milestone completion moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved COE roadmap and accountable collaborators before recording an internal follow-up.", owner: { role: "coe-lead" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [COE_ASSIGNMENTS.revenue, COE_ASSIGNMENTS.capacity, COE_ASSIGNMENTS.referral, COE_ASSIGNMENTS.capability].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing COE Lead assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = coeObservationFor(assignmentId); return row ? [{ assignmentId, entity: CLINICAL_COE, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: COE_ASSIGNMENTS.milestones, issue: "unavailable", detail: "No approved COE roadmap threshold is configured in this preview; milestone evidence is illustrative and read-only." }, { assignmentId: COE_ASSIGNMENTS.experience, issue: "unavailable", detail: "Response-rate context is illustrative and does not represent a validated patient-experience survey." }];
  return { exceptions, onTrack, dataLimitations };
}
