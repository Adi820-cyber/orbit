import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const PROCUREMENT_ASSIGNMENTS = {
  savings: "procurement-head:finance-validated-procurement-savings-vs-plan",
  compliance: "procurement-head:contract-and-purchase-order-compliance",
  stockouts: "procurement-head:critical-consumable-stockouts-and-service-disruption",
  inventory: "procurement-head:inventory-days-and-obsolete-stock",
  turnaround: "procurement-head:purchase-request-to-purchase-order-turnaround",
  supplier: "procurement-head:supplier-quality-and-service-level-performance",
  maverick: "procurement-head:rate-card-adherence-and-maverick-spend",
  continuity: "procurement-head:supplier-risk-and-continuity-actions-closed",
} as const;

const PROCUREMENT_LIMITATION = "Illustrative procurement-governance fixture; values are not validated savings, inventory, supplier, or service-disruption measures and contain no patient, employee, supplier, or purchase records.";
interface ProcurementProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; }
const PROFILES: Record<string, ProcurementProfile> = {
  [PROCUREMENT_ASSIGNMENTS.savings]: { numerator: "Finance-validated savings delivered", denominator: "Approved procurement savings plan", unit: "% of plan", base: 86, drift: 2 },
  [PROCUREMENT_ASSIGNMENTS.compliance]: { numerator: "Addressable spend through approved contracts and POs", denominator: "Addressable spend reviewed", unit: "% of reviewed spend", base: 89, drift: 1 },
  [PROCUREMENT_ASSIGNMENTS.stockouts]: { numerator: "Critical supply-continuity controls met", denominator: "Critical supply-continuity controls reviewed", unit: "% of reviewed controls", base: 87, drift: 2, limitation: "Stockout event counts, item-level detail, and service-disruption root causes are not connected in this preview." },
  [PROCUREMENT_ASSIGNMENTS.inventory]: { numerator: "Inventory-policy indicators within approved context", denominator: "Inventory-policy indicators reviewed", unit: "% of reviewed indicators", base: 81, drift: 2, limitation: "Inventory days and obsolete-stock value are represented as one illustrative control index." },
  [PROCUREMENT_ASSIGNMENTS.turnaround]: { numerator: "Purchase-request turnaround indicators meeting service level", denominator: "Purchase-request turnaround indicators reviewed", unit: "% of reviewed indicators", base: 84, drift: 1 },
  [PROCUREMENT_ASSIGNMENTS.supplier]: { numerator: "Supplier quality and service-level indicators met", denominator: "Supplier quality and service-level indicators reviewed", unit: "% of reviewed indicators", base: 83, drift: 1 },
  [PROCUREMENT_ASSIGNMENTS.maverick]: { numerator: "Rate-card and approved-channel controls met", denominator: "Rate-card and approved-channel controls reviewed", unit: "% of reviewed controls", base: 79, drift: 2 },
  [PROCUREMENT_ASSIGNMENTS.continuity]: { numerator: "Supplier continuity actions closed by due date", denominator: "Supplier continuity actions due", unit: "% of actions due", base: 90, drift: 1 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Procurement Head fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const disruptionScenario = assignmentId === PROCUREMENT_ASSIGNMENTS.stockouts && month >= PERIODS.length - 2 ? -18 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + disruptionScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Procurement Head fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [PROCUREMENT_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const PROCUREMENT_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const PROCUREMENT_OBSERVATIONS: readonly Observation[] = Object.values(PROCUREMENT_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => PROCUREMENT_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function procurementFindObservation(id: string) { return PROCUREMENT_OBSERVATIONS.find((row) => row.observationId === id); }
export function procurementObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return PROCUREMENT_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function procurementSeriesFor(assignmentId: string, entity: ScopeEntity) { return PROCUREMENT_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function procurementBreakdownRows(assignmentId: string, period: Period) { return PROCUREMENT_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function procurementBrief(): RegionBrief {
  const current = procurementObservationFor(PROCUREMENT_ASSIGNMENTS.stockouts); const prior = procurementObservationFor(PROCUREMENT_ASSIGNMENTS.stockouts, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:procurement-head:stockout-continuity", assignmentId: PROCUREMENT_ASSIGNMENTS.stockouts, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "safety", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Critical consumable stockout and service-disruption movement (preview fixture)" }, whatChanged: `Critical supply-continuity controls moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review approved inventory and service-continuity evidence with accountable collaborators before recording an internal follow-up.", owner: { role: "procurement-head" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [PROCUREMENT_ASSIGNMENTS.savings, PROCUREMENT_ASSIGNMENTS.compliance, PROCUREMENT_ASSIGNMENTS.supplier, PROCUREMENT_ASSIGNMENTS.continuity].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Procurement assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = procurementObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: PROCUREMENT_ASSIGNMENTS.stockouts, issue: "unavailable", detail: "No universal stockout or service-disruption threshold is configured in this preview; the control index is illustrative and read-only." }, { assignmentId: PROCUREMENT_ASSIGNMENTS.inventory, issue: "unavailable", detail: "Inventory days and obsolete-stock value are represented as one illustrative control index." }];
  return { exceptions, onTrack, dataLimitations };
}
