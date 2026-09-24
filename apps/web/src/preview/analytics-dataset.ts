import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const ANALYTICS_ASSIGNMENTS = {
  availability: "analytics-head:kpi-dashboard-availability-and-refresh-on-time",
  quality: "analytics-head:kpi-data-quality-and-reconciliation",
  pack: "analytics-head:monthly-kpi-pack-delivered-to-calendar",
  adoption: "analytics-head:priority-dashboard-adoption-and-report-rationalisation",
  forecast: "analytics-head:revenue-collections-and-cash-forecast-accuracy",
  actions: "analytics-head:approved-insight-actions-closed",
  roadmap: "analytics-head:digital-roadmap-and-benefit-realisation",
} as const;

const ANALYTICS_LIMITATION = "Illustrative analytics-governance fixture; values are not validated dashboard, data-quality, forecast, adoption, or digital-benefit measures and contain no user, patient, employee, or source-system records.";
interface AnalyticsProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; }
const PROFILES: Record<string, AnalyticsProfile> = {
  [ANALYTICS_ASSIGNMENTS.availability]: { numerator: "Critical dashboards available and refreshed on time", denominator: "Critical dashboards due for refresh", unit: "% of dashboards due", base: 93, drift: 1 },
  [ANALYTICS_ASSIGNMENTS.quality]: { numerator: "Critical KPI data-quality checks passed", denominator: "Critical KPI data-quality checks reviewed", unit: "% of reviewed checks", base: 88, drift: 2, limitation: "Source-system completeness, reconciliation evidence, and data-owner detail are not connected in this preview." },
  [ANALYTICS_ASSIGNMENTS.pack]: { numerator: "Monthly KPI packs delivered complete and on time", denominator: "Monthly KPI packs due", unit: "% of packs due", base: 91, drift: 1 },
  [ANALYTICS_ASSIGNMENTS.adoption]: { numerator: "Priority dashboard adoption and report-rationalisation indicators met", denominator: "Priority dashboard adoption indicators reviewed", unit: "% of reviewed indicators", base: 79, drift: 2 },
  [ANALYTICS_ASSIGNMENTS.forecast]: { numerator: "Revenue, collections and cash forecast indicators accurate", denominator: "Forecast accuracy indicators reviewed", unit: "% of reviewed indicators", base: 84, drift: 1 },
  [ANALYTICS_ASSIGNMENTS.actions]: { numerator: "Approved insight actions closed by due date", denominator: "Approved insight actions due", unit: "% of actions due", base: 86, drift: 1 },
  [ANALYTICS_ASSIGNMENTS.roadmap]: { numerator: "Digital roadmap milestones and benefit indicators met", denominator: "Digital roadmap milestones and benefit indicators reviewed", unit: "% of reviewed indicators", base: 82, drift: 2, limitation: "Project-level business cases and finance-validated benefits are not connected in this preview." },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Analytics Head fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const qualityScenario = assignmentId === ANALYTICS_ASSIGNMENTS.quality && month >= PERIODS.length - 2 ? -18 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + qualityScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Analytics Head fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [ANALYTICS_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const ANALYTICS_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const ANALYTICS_OBSERVATIONS: readonly Observation[] = Object.values(ANALYTICS_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => ANALYTICS_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function analyticsFindObservation(id: string) { return ANALYTICS_OBSERVATIONS.find((row) => row.observationId === id); }
export function analyticsObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return ANALYTICS_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function analyticsSeriesFor(assignmentId: string, entity: ScopeEntity) { return ANALYTICS_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function analyticsBreakdownRows(assignmentId: string, period: Period) { return ANALYTICS_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function analyticsBrief(): RegionBrief {
  const current = analyticsObservationFor(ANALYTICS_ASSIGNMENTS.quality); const prior = analyticsObservationFor(ANALYTICS_ASSIGNMENTS.quality, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:analytics-head:data-quality", assignmentId: ANALYTICS_ASSIGNMENTS.quality, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "compliance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "KPI data quality and reconciliation movement (preview fixture)" }, whatChanged: `Critical KPI data-quality checks moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved data-quality evidence and accountable collaborators before recording an internal follow-up.", owner: { role: "analytics-head" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [ANALYTICS_ASSIGNMENTS.availability, ANALYTICS_ASSIGNMENTS.pack, ANALYTICS_ASSIGNMENTS.forecast, ANALYTICS_ASSIGNMENTS.actions].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Analytics assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = analyticsObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: ANALYTICS_ASSIGNMENTS.quality, issue: "unavailable", detail: "No approved data-quality reconciliation threshold is configured in this preview; quality evidence is illustrative and read-only." }, { assignmentId: ANALYTICS_ASSIGNMENTS.roadmap, issue: "unavailable", detail: "Project-level business cases and finance-validated benefits are not connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
