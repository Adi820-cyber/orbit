import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const HR_ASSIGNMENTS = {
  workforce: "hr-head:group-workforce-cost-and-productivity-vs-plan",
  staffing: "hr-head:critical-role-staffing-and-time-to-hire",
  attrition: "hr-head:group-and-critical-role-attrition",
  engagement: "hr-head:group-engagement-score-and-action-closure",
  capability: "hr-head:mandatory-learning-capability-and-succession-coverage",
  performance: "hr-head:performance-management-and-talent-review-completion",
  compliance: "hr-head:employment-compliance-and-grievance-closure",
} as const;

const HR_LIMITATION = "Illustrative HR-governance fixture; values are not validated workforce, engagement, employment, or capability measures and contain no employee or staff records.";
interface HrProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; }
const PROFILES: Record<string, HrProfile> = {
  [HR_ASSIGNMENTS.workforce]: { numerator: "Workforce cost and productivity indicators within plan", denominator: "Workforce cost and productivity indicators reviewed", unit: "% of reviewed indicators", base: 84, drift: 1 },
  [HR_ASSIGNMENTS.staffing]: { numerator: "Critical roles filled to approved plan", denominator: "Approved critical roles", unit: "% of approved roles", base: 78, drift: 2, limitation: "Time-to-hire and role-level vacancy detail are not connected in this preview." },
  [HR_ASSIGNMENTS.attrition]: { numerator: "Retention-plan indicators within approved context", denominator: "Retention-plan indicators reviewed", unit: "% of reviewed indicators", base: 82, drift: 2 },
  [HR_ASSIGNMENTS.engagement]: { numerator: "Engagement and action-closure indicators met", denominator: "Engagement and action-closure indicators reviewed", unit: "% of reviewed indicators", base: 86, drift: 1, limitation: "Survey responses and workforce identities are not present in this preview." },
  [HR_ASSIGNMENTS.capability]: { numerator: "Learning, capability and succession indicators met", denominator: "Learning, capability and succession indicators reviewed", unit: "% of reviewed indicators", base: 89, drift: 1 },
  [HR_ASSIGNMENTS.performance]: { numerator: "Performance and talent-review indicators completed", denominator: "Eligible performance and talent-review indicators", unit: "% of eligible indicators", base: 85, drift: 1 },
  [HR_ASSIGNMENTS.compliance]: { numerator: "Employment compliance and grievance actions closed", denominator: "Employment compliance and grievance actions due", unit: "% of actions due", base: 91, drift: 1 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing HR Head fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const staffingScenario = assignmentId === HR_ASSIGNMENTS.staffing && month >= PERIODS.length - 2 ? -17 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + staffingScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing HR Head fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [HR_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const HR_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const HR_OBSERVATIONS: readonly Observation[] = Object.values(HR_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => HR_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function hrFindObservation(id: string) { return HR_OBSERVATIONS.find((row) => row.observationId === id); }
export function hrObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return HR_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function hrSeriesFor(assignmentId: string, entity: ScopeEntity) { return HR_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function hrBreakdownRows(assignmentId: string, period: Period) { return HR_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function hrBrief(): RegionBrief {
  const current = hrObservationFor(HR_ASSIGNMENTS.staffing); const prior = hrObservationFor(HR_ASSIGNMENTS.staffing, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:hr-head:critical-role-staffing", assignmentId: HR_ASSIGNMENTS.staffing, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "performance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Critical-role staffing movement (preview fixture)" }, whatChanged: `Critical-role staffing moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved workforce evidence and accountable collaborators before recording an internal follow-up.", owner: { role: "hr-head" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [HR_ASSIGNMENTS.workforce, HR_ASSIGNMENTS.engagement, HR_ASSIGNMENTS.capability, HR_ASSIGNMENTS.compliance].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing HR assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = hrObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: HR_ASSIGNMENTS.staffing, issue: "unavailable", detail: "No approved critical-role vacancy or time-to-hire threshold is configured in this preview; staffing evidence is illustrative and read-only." }, { assignmentId: HR_ASSIGNMENTS.engagement, issue: "unavailable", detail: "Survey responses and workforce identities are not present in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
