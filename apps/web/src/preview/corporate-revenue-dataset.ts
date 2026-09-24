import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const CORPORATE_ASSIGNMENTS = {
  revenue: "corporate-revenue-lead:corporate-and-insurer-net-revenue-and-margin-vs-plan",
  accounts: "corporate-revenue-lead:active-contracted-accounts-vs-plan",
  conversion: "corporate-revenue-lead:new-corporate-and-insurer-tie-up-conversion",
  retention: "corporate-revenue-lead:contract-renewal-and-account-retention-rate",
  utilisation: "corporate-revenue-lead:contract-utilisation-and-revenue-per-account",
  yield: "corporate-revenue-lead:commercial-term-yield",
  issues: "corporate-revenue-lead:payer-issue-closure",
  forecast: "corporate-revenue-lead:pipeline-forecast-accuracy-and-crm-completeness",
} as const;

const CORPORATE_LIMITATION = "Illustrative corporate-revenue fixture; values are not validated financial, contract, payer, or account measures and contain no client, patient, or insurer records.";
interface CorporateProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; reported?: { id: string; label: string; unit: string }; }
const PROFILES: Record<string, CorporateProfile> = {
  [CORPORATE_ASSIGNMENTS.revenue]: { numerator: "Corporate and insurer net revenue delivered", denominator: "Approved corporate and insurer plan", unit: "% of plan", base: 88, drift: 2 },
  [CORPORATE_ASSIGNMENTS.accounts]: { numerator: "Active contracted accounts", denominator: "Approved active-account plan", unit: "% of plan", base: 84, drift: 1 },
  [CORPORATE_ASSIGNMENTS.conversion]: { numerator: "Qualified tie-ups signed and approved", denominator: "Qualified corporate and insurer opportunities", unit: "% of qualified opportunities", base: 72, drift: 2 },
  [CORPORATE_ASSIGNMENTS.retention]: { numerator: "Eligible accounts renewed by due date", denominator: "Eligible accounts due for renewal", unit: "% of eligible accounts", base: 86, drift: 1 },
  [CORPORATE_ASSIGNMENTS.utilisation]: { numerator: "Contract utilisation indicators met", denominator: "Contract utilisation indicators reviewed", unit: "% of reviewed indicators", base: 80, drift: 2, limitation: "Account-level utilisation and revenue-per-account detail is not connected in this preview." },
  [CORPORATE_ASSIGNMENTS.yield]: { numerator: "Commercial term and rate-card indicators met", denominator: "Commercial term and rate-card indicators reviewed", unit: "% of reviewed indicators", base: 83, drift: 1 },
  [CORPORATE_ASSIGNMENTS.issues]: { numerator: "Payer and corporate issues closed within service level", denominator: "Payer and corporate issues due", unit: "% of issues due", base: 78, drift: 2, limitation: "Payer segmentation and issue root-cause detail are not connected in this preview." },
  [CORPORATE_ASSIGNMENTS.forecast]: { numerator: "Forecast and CRM-quality indicators met", denominator: "Forecast and CRM-quality indicators reviewed", unit: "% of reviewed indicators", base: 81, drift: 1 },
};

function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Corporate Revenue & Insurance Lead fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const issueScenario = assignmentId === CORPORATE_ASSIGNMENTS.issues && month >= PERIODS.length - 2 ? -15 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + issueScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Corporate Revenue & Insurance Lead fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  if (profile.reported) components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(40 + (month % 4) * 3) });
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [CORPORATE_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const CORPORATE_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const CORPORATE_OBSERVATIONS: readonly Observation[] = Object.values(CORPORATE_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => CORPORATE_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function corporateFindObservation(id: string) { return CORPORATE_OBSERVATIONS.find((row) => row.observationId === id); }
export function corporateObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return CORPORATE_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function corporateSeriesFor(assignmentId: string, entity: ScopeEntity) { return CORPORATE_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function corporateBreakdownRows(assignmentId: string, period: Period) { return CORPORATE_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function corporateBrief(): RegionBrief {
  const current = corporateObservationFor(CORPORATE_ASSIGNMENTS.issues); const prior = corporateObservationFor(CORPORATE_ASSIGNMENTS.issues, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:corporate-revenue-lead:payer-issue-closure", assignmentId: CORPORATE_ASSIGNMENTS.issues, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "performance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Payer issue closure movement (preview fixture)" }, whatChanged: `Payer and corporate issue closure moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved payer-service evidence and accountable collaborators before recording an internal follow-up.", owner: { role: "corporate-revenue-lead" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [CORPORATE_ASSIGNMENTS.revenue, CORPORATE_ASSIGNMENTS.accounts, CORPORATE_ASSIGNMENTS.retention, CORPORATE_ASSIGNMENTS.forecast].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Corporate Revenue assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = corporateObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: CORPORATE_ASSIGNMENTS.issues, issue: "unavailable", detail: "Payer segmentation and issue root-cause detail are not connected in this preview." }, { assignmentId: CORPORATE_ASSIGNMENTS.utilisation, issue: "unavailable", detail: "Account-level utilisation and revenue-per-account detail are not connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
