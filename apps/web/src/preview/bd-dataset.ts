import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, PERIODS, type RegionBrief } from "./dataset";
import { DHO_FACILITY } from "./dho-dataset";

export const BD_ASSIGNMENTS = {
  revenue: "bd-lead:new-business-revenue-vs-plan",
  pipeline: "bd-lead:qualified-pipeline-coverage",
  conversion: "bd-lead:lead-to-revenue-conversion",
  referrers: "bd-lead:active-referrer-network-and-referral-revenue",
  service: "bd-lead:new-service-and-coe-lead-conversion",
  corporate: "bd-lead:corporate-opportunities-handed-over-and-accepted",
  crm: "bd-lead:crm-completeness-and-forecast-accuracy",
  economics: "bd-lead:acquisition-economics-vs-plan",
} as const;

const BD_LIMITATION = "Illustrative business-development fixture; values are not validated commercial or financial measures and contain no real customer, payer, or referral records.";
interface BdProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; reported?: { id: string; label: string; unit: string }; }
const PROFILES: Record<string, BdProfile> = {
  [BD_ASSIGNMENTS.revenue]: { numerator: "Approved new-business revenue", denominator: "Approved new-business revenue plan", unit: "% of plan", base: 86, drift: 2 },
  [BD_ASSIGNMENTS.pipeline]: { numerator: "Qualified documented pipeline", denominator: "Approved future-period pipeline requirement", unit: "% of requirement", base: 91, drift: 3 },
  [BD_ASSIGNMENTS.conversion]: { numerator: "Qualified leads generating completed billable service", denominator: "Qualified leads", unit: "% of qualified leads", base: 64, drift: 2 },
  [BD_ASSIGNMENTS.referrers]: { numerator: "Active referrer activity and referral revenue indicators met", denominator: "Active referrer activity and referral revenue indicators reviewed", unit: "% of reviewed indicators", base: 77, drift: 2 },
  [BD_ASSIGNMENTS.service]: { numerator: "Approved new-service and COE leads converted", denominator: "Qualified new-service and COE leads", unit: "% of qualified leads", base: 61, drift: 2 },
  [BD_ASSIGNMENTS.corporate]: { numerator: "Corporate opportunities accepted after handover", denominator: "Qualified corporate handovers", unit: "% of handovers", base: 73, drift: 1 },
  [BD_ASSIGNMENTS.crm]: { numerator: "Required CRM and forecast indicators meeting the standard", denominator: "Required CRM and forecast indicators reviewed", unit: "% of reviewed indicators", base: 84, drift: 1, reported: { id: "forecast_error", label: "Forecast error context", unit: "%" } },
  [BD_ASSIGNMENTS.economics]: { numerator: "Attributable new revenue delivered", denominator: "Approved channel plan", unit: "% of plan", base: 81, drift: 2, limitation: "Acquisition cost and finance-approved attribution are not separately reported in this preview." },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function observation(assignmentId: string, family: string, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId]; if (!profile) throw new Error(`Missing Business Development fixture profile for ${assignmentId}.`);
  const forecastScenario = assignmentId === BD_ASSIGNMENTS.crm && month >= PERIODS.length - 2 ? -18 : 0;
  const denominator = 100; const value = Math.max(0, Math.min(100, profile.base + familyIndex * 2 + profile.drift * ((month % 4) - 1) + forecastScenario)); const numerator = Math.round((denominator * value) / 100);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(denominator) },
  ];
  if (profile.reported) components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(8 + (month % 4) * 2) });
  return { observationId: `obs:${slug(family)}:${DHO_FACILITY.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity: DHO_FACILITY, period, unit: profile.unit, value: ratio(numerator, denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [BD_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}
export const BD_OBSERVATIONS: Observation[] = Object.values(BD_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.map((period, month) => observation(assignmentId, family.family, period, month, familyIndex))));
export function bdFindObservation(id: string) { return BD_OBSERVATIONS.find((row) => row.observationId === id); }
export function bdObservationFor(assignmentId: string, period = CURRENT_PERIOD) { return BD_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.period.start === period.start); }
export function bdSeriesFor(assignmentId: string, entity: ScopeEntity) { return BD_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function bdBreakdownRows(): Observation[] { return []; }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }
export function bdBrief(): RegionBrief {
  const current = bdObservationFor(BD_ASSIGNMENTS.crm); const prior = bdObservationFor(BD_ASSIGNMENTS.crm, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:bd-lead:crm-forecast-accuracy", assignmentId: BD_ASSIGNMENTS.crm, entity: DHO_FACILITY, period: CURRENT_PERIOD, priority: "act_now", category: "performance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "CRM completeness and forecast accuracy movement (preview fixture)" }, whatChanged: `CRM and forecast-quality indicators moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the opportunity evidence and accountable handover owners before recording an internal follow-up.", owner: { role: "bd-lead" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [BD_ASSIGNMENTS.revenue, BD_ASSIGNMENTS.pipeline, BD_ASSIGNMENTS.conversion, BD_ASSIGNMENTS.corporate].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Business Development assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = bdObservationFor(assignmentId); return row ? [{ assignmentId, entity: DHO_FACILITY, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: BD_ASSIGNMENTS.crm, issue: "unavailable", detail: "No approved CRM data-quality threshold is configured in this preview; the indicator is read-only and illustrative." }, { assignmentId: BD_ASSIGNMENTS.economics, issue: "unavailable", detail: "Acquisition cost and finance-approved attribution are not connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
