import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const GROUP_CFO_ASSIGNMENTS = {
  ebitda: "group-cfo:group-ebitda-vs-approved-budget",
  cash: "group-cfo:cash-flow-liquidity-and-working-capital-vs-plan",
  collections: "group-cfo:group-collections-and-dso-vs-plan",
  forecast: "group-cfo:forecast-and-budget-quality",
  costs: "group-cfo:controllable-cost-improvement-vs-plan",
  controls: "group-cfo:financial-controls-and-leakage-actions-closed",
  compliance: "group-cfo:finance-compliance-and-audit-action-closure",
} as const;

const CFO_LIMITATION = "Illustrative Group CFO fixture; values are not validated financial, audit, treasury, or cost measures and contain no patient, employee, supplier, or account records.";
interface CfoProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; }
const PROFILES: Record<string, CfoProfile> = {
  [GROUP_CFO_ASSIGNMENTS.ebitda]: { numerator: "Group EBITDA delivered", denominator: "Approved group EBITDA plan", unit: "% of plan", base: 86, drift: 2 },
  [GROUP_CFO_ASSIGNMENTS.cash]: { numerator: "Operating cash and liquidity indicators met", denominator: "Approved cash-plan indicators reviewed", unit: "% of reviewed indicators", base: 82, drift: 1 },
  [GROUP_CFO_ASSIGNMENTS.collections]: { numerator: "Group collections and DSO indicators met", denominator: "Approved collections and DSO indicators reviewed", unit: "% of reviewed indicators", base: 80, drift: 2, limitation: "The approved DSO convention and liquidity headroom calculation are not separately connected in this preview." },
  [GROUP_CFO_ASSIGNMENTS.forecast]: { numerator: "Forecast and budget-quality indicators met", denominator: "Forecast and budget-quality indicators reviewed", unit: "% of reviewed indicators", base: 84, drift: 1 },
  [GROUP_CFO_ASSIGNMENTS.costs]: { numerator: "Finance-validated cost-improvement indicators met", denominator: "Approved cost-improvement indicators reviewed", unit: "% of reviewed indicators", base: 78, drift: 2 },
  [GROUP_CFO_ASSIGNMENTS.controls]: { numerator: "Material control and leakage actions closed by due date", denominator: "Material control and leakage actions due", unit: "% of actions due", base: 88, drift: 1 },
  [GROUP_CFO_ASSIGNMENTS.compliance]: { numerator: "Finance compliance and audit actions closed by due date", denominator: "Finance compliance and audit actions due", unit: "% of actions due", base: 90, drift: 1 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Group CFO fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const controlScenario = assignmentId === GROUP_CFO_ASSIGNMENTS.controls && month >= PERIODS.length - 2 ? -16 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + controlScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Group CFO fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [CFO_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const CFO_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const GROUP_CFO_OBSERVATIONS: readonly Observation[] = Object.values(GROUP_CFO_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => CFO_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function groupCfoFindObservation(id: string) { return GROUP_CFO_OBSERVATIONS.find((row) => row.observationId === id); }
export function groupCfoObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return GROUP_CFO_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function groupCfoSeriesFor(assignmentId: string, entity: ScopeEntity) { return GROUP_CFO_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function groupCfoBreakdownRows(assignmentId: string, period: Period) { return GROUP_CFO_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function groupCfoBrief(): RegionBrief {
  const current = groupCfoObservationFor(GROUP_CFO_ASSIGNMENTS.controls); const prior = groupCfoObservationFor(GROUP_CFO_ASSIGNMENTS.controls, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:group-cfo:financial-controls", assignmentId: GROUP_CFO_ASSIGNMENTS.controls, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "compliance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Financial control and leakage action closure movement (preview fixture)" }, whatChanged: `Material control and leakage action closure moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved control evidence and accountable collaborators before recording an internal follow-up.", owner: { role: "group-cfo" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [GROUP_CFO_ASSIGNMENTS.ebitda, GROUP_CFO_ASSIGNMENTS.cash, GROUP_CFO_ASSIGNMENTS.forecast, GROUP_CFO_ASSIGNMENTS.compliance].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Group CFO assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = groupCfoObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: GROUP_CFO_ASSIGNMENTS.controls, issue: "unavailable", detail: "No approved control-gap materiality threshold is configured in this preview; closure evidence is illustrative and read-only." }, { assignmentId: GROUP_CFO_ASSIGNMENTS.collections, issue: "unavailable", detail: "The approved DSO convention and liquidity headroom calculation are not separately connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
