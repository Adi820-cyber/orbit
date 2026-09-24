import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, GROUP, PERIODS, REGION_NORTH, REGION_SOUTH, type RegionBrief } from "./dataset";

export const LEGAL_ASSIGNMENTS = {
  contracts: "legal-head:contract-turnaround-time",
  approvals: "legal-head:high-risk-contract-review-and-approval-compliance",
  regulatory: "legal-head:license-filing-and-regulatory-calendar-compliance",
  litigation: "legal-head:material-litigation-and-dispute-action-milestones",
  disputes: "legal-head:commercial-and-payer-dispute-support-turnaround",
  training: "legal-head:policy-refresh-and-required-legal-training-completion",
  governance: "legal-head:governance-and-audit-legal-actions-closed",
} as const;

const LEGAL_LIMITATION = "Illustrative legal-governance fixture; values are not validated legal, regulatory, litigation, or dispute measures and contain no contract, employee, patient, or matter records.";
interface LegalProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; }
const PROFILES: Record<string, LegalProfile> = {
  [LEGAL_ASSIGNMENTS.contracts]: { numerator: "Contracts completed within approved service level", denominator: "Contracts due for completion", unit: "% of contracts due", base: 86, drift: 1 },
  [LEGAL_ASSIGNMENTS.approvals]: { numerator: "High-risk agreements reviewed before execution", denominator: "High-risk agreements executed", unit: "% of agreements", base: 91, drift: 1 },
  [LEGAL_ASSIGNMENTS.regulatory]: { numerator: "Licences, filings and registrations completed on time", denominator: "Licences, filings and registrations due", unit: "% of items due", base: 88, drift: 2, limitation: "The regulatory register, jurisdiction detail, and item-level due dates are not connected in this preview." },
  [LEGAL_ASSIGNMENTS.litigation]: { numerator: "Material matter milestones completed by due date", denominator: "Material matter milestones due", unit: "% of milestones due", base: 84, drift: 2 },
  [LEGAL_ASSIGNMENTS.disputes]: { numerator: "Commercial and payer disputes supported within service level", denominator: "Commercial and payer disputes due", unit: "% of disputes due", base: 82, drift: 1 },
  [LEGAL_ASSIGNMENTS.training]: { numerator: "Policy refresh and required legal-learning indicators met", denominator: "Policy refresh and legal-learning indicators reviewed", unit: "% of reviewed indicators", base: 89, drift: 1 },
  [LEGAL_ASSIGNMENTS.governance]: { numerator: "Governance and audit legal actions closed by due date", denominator: "Governance and audit legal actions due", unit: "% of actions due", base: 90, drift: 1 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function valueFor(assignmentId: string, entity: ScopeEntity, month: number, familyIndex: number) {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Legal Head fixture profile for ${assignmentId}.`);
  const entityOffset = entity.grain === "group" ? 0 : entity.entityId === REGION_NORTH.entityId ? 2 : -2;
  const regulatoryScenario = assignmentId === LEGAL_ASSIGNMENTS.regulatory && month >= PERIODS.length - 2 ? -16 : 0;
  const value = Math.max(0, Math.min(100, profile.base + entityOffset + familyIndex * 2 + profile.drift * ((month % 4) - 1) + regulatoryScenario));
  const denominator = entity.grain === "group" ? 100 : 50;
  return { numerator: Math.round((denominator * value) / 100), denominator };
}
function observation(assignmentId: string, family: string, entity: ScopeEntity, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId];
  if (!profile) throw new Error(`Missing Legal Head fixture profile for ${assignmentId}.`);
  const facts = valueFor(assignmentId, entity, month, familyIndex);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(facts.numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(facts.denominator) },
  ];
  return { observationId: `obs:${slug(family)}:${entity.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity, period, unit: profile.unit, value: ratio(facts.numerator, facts.denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [LEGAL_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}

const LEGAL_ENTITIES: readonly ScopeEntity[] = [GROUP, REGION_NORTH, REGION_SOUTH];
export const LEGAL_OBSERVATIONS: readonly Observation[] = Object.values(LEGAL_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.flatMap((period, month) => LEGAL_ENTITIES.map((entity) => observation(assignmentId, family.family, entity, period, month, familyIndex)))));
export function legalFindObservation(id: string) { return LEGAL_OBSERVATIONS.find((row) => row.observationId === id); }
export function legalObservationFor(assignmentId: string, period = CURRENT_PERIOD, entity: ScopeEntity = GROUP) { return LEGAL_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.entity.entityId === entity.entityId && row.period.start === period.start); }
export function legalSeriesFor(assignmentId: string, entity: ScopeEntity) { return LEGAL_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function legalBreakdownRows(assignmentId: string, period: Period) { return LEGAL_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === "region" && row.period.start === period.start); }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }

export function legalBrief(): RegionBrief {
  const current = legalObservationFor(LEGAL_ASSIGNMENTS.regulatory); const prior = legalObservationFor(LEGAL_ASSIGNMENTS.regulatory, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue < priorValue) exceptions.push({ exceptionId: "exc:legal-head:regulatory-compliance", assignmentId: LEGAL_ASSIGNMENTS.regulatory, entity: GROUP, period: CURRENT_PERIOD, priority: "act_now", category: "legal", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Regulatory-calendar compliance movement (preview fixture)" }, whatChanged: `License, filing and regulatory-calendar compliance moved from ${priorValue}% to ${currentValue}% between the compared periods.`, whyItMatters: "Review the approved regulatory evidence and accountable collaborators before recording an internal follow-up.", owner: { role: "legal-head" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [LEGAL_ASSIGNMENTS.contracts, LEGAL_ASSIGNMENTS.approvals, LEGAL_ASSIGNMENTS.training, LEGAL_ASSIGNMENTS.governance].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Legal assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = legalObservationFor(assignmentId); return row ? [{ assignmentId, entity: GROUP, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: LEGAL_ASSIGNMENTS.regulatory, issue: "unavailable", detail: "No approved regulatory-calendar threshold is configured in this preview; compliance evidence is illustrative and read-only." }, { assignmentId: LEGAL_ASSIGNMENTS.litigation, issue: "unavailable", detail: "Matter-level exposure, strategy, and litigation records are not connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
