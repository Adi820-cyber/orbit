import type { ComponentMeasure, DataLimitation, Exception, MeasureValue, Observation, OnTrackItem, Period, ScopeEntity } from "@orbit/contracts";
import { getAssignment, getDefinitionFamiliesForAssignment } from "@orbit/kpi-framework";
import { AS_OF, CURRENT_PERIOD, DATASET_CHECKSUM, DEFINITION_VERSION, PERIODS, type RegionBrief } from "./dataset";
import { DHO_FACILITY } from "./dho-dataset";

export const BILLING_ASSIGNMENTS = {
  acceptance: "billing-lead:claim-first-pass-acceptance-rate",
  turnaround: "billing-lead:claim-submission-turnaround-time",
  denied: "billing-lead:rejected-or-denied-claim-value",
  collections: "billing-lead:cash-collections-vs-monthly-plan",
  dso: "billing-lead:dso-and-aged-receivables",
  unbilled: "billing-lead:unbilled-revenue-and-cash-posting-reconciliation",
  payer: "billing-lead:payer-reconciliation-and-documentation-completeness",
  leakage: "billing-lead:revenue-leakage-and-avoidable-credit-notes",
} as const;

const BILLING_LIMITATION = "Illustrative revenue-cycle fixture; values are not validated financial or payer measures and contain no patient, payer, or claim records.";
interface BillingProfile { numerator: string; denominator: string; unit: string; base: number; drift: number; limitation?: string; reported?: { id: string; label: string; unit: string }; }
const PROFILES: Record<string, BillingProfile> = {
  [BILLING_ASSIGNMENTS.acceptance]: { numerator: "Claims accepted without resubmission", denominator: "Claims submitted", unit: "% of submitted claims", base: 89, drift: 1 },
  [BILLING_ASSIGNMENTS.turnaround]: { numerator: "Illustrative submission-timeliness index", denominator: "Submission-timeliness index basis", unit: "illustrative days context", base: 82, drift: 1 },
  [BILLING_ASSIGNMENTS.denied]: { numerator: "Rejected or denied claim value", denominator: "Submitted claim value", unit: "% of submitted value", base: 7, drift: 1, limitation: "Payer segmentation and root-cause detail are not connected in this preview." },
  [BILLING_ASSIGNMENTS.collections]: { numerator: "Cash posted and reconciled", denominator: "Approved monthly collection plan", unit: "% of plan", base: 87, drift: 2 },
  [BILLING_ASSIGNMENTS.dso]: { numerator: "Illustrative receivables-days measure", denominator: "Approved DSO and ageing context", unit: "illustrative days context", base: 54, drift: 2 },
  [BILLING_ASSIGNMENTS.unbilled]: { numerator: "Revenue-integrity indicators reconciled", denominator: "Revenue-integrity indicators reviewed", unit: "% of reviewed indicators", base: 81, drift: 2 },
  [BILLING_ASSIGNMENTS.payer]: { numerator: "Payer and documentation indicators meeting standard", denominator: "Payer and documentation indicators reviewed", unit: "% of reviewed indicators", base: 85, drift: 1 },
  [BILLING_ASSIGNMENTS.leakage]: { numerator: "Avoidable leakage and credit-note controls met", denominator: "Leakage controls reviewed", unit: "% of reviewed controls", base: 79, drift: 2 },
};
function amount(value: number): MeasureValue { return { status: "available", value }; }
function slug(value: string) { return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
function ratio(numerator: number, denominator: number): MeasureValue { return { status: "available", value: Math.round((numerator / denominator) * 1000) / 10 }; }
function observation(assignmentId: string, family: string, period: Period, month: number, familyIndex: number): Observation {
  const profile = PROFILES[assignmentId]; if (!profile) throw new Error(`Missing Billing & Revenue fixture profile for ${assignmentId}.`);
  const denialScenario = assignmentId === BILLING_ASSIGNMENTS.denied && month >= PERIODS.length - 2 ? 5 : 0;
  const denominator = 100; const value = Math.max(0, Math.min(100, profile.base + familyIndex * 2 + profile.drift * ((month % 4) - 1) + denialScenario)); const numerator = Math.round((denominator * value) / 100);
  const components: ComponentMeasure[] = [
    { componentId: `${slug(family)}_numerator`, label: profile.numerator, role: "numerator", unit: "illustrative units", value: amount(numerator) },
    { componentId: `${slug(family)}_denominator`, label: profile.denominator, role: "denominator", unit: "illustrative units", value: amount(denominator) },
  ];
  if (profile.reported) components.push({ componentId: profile.reported.id, label: profile.reported.label, role: "measure", unit: profile.reported.unit, value: amount(20 + (month % 4) * 2) });
  return { observationId: `obs:${slug(family)}:${DHO_FACILITY.entityId}:${period.start.slice(0, 7)}`, assignmentId, definitionFamily: family, definitionVersion: DEFINITION_VERSION, entity: DHO_FACILITY, period, unit: profile.unit, value: ratio(numerator, denominator), components, target: { state: "not_configured" }, provenance: "illustrative", dataQuality: { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: AS_OF, limitations: [BILLING_LIMITATION, ...(profile.limitation ? [profile.limitation] : [])] } };
}
export const BILLING_OBSERVATIONS: Observation[] = Object.values(BILLING_ASSIGNMENTS).flatMap((assignmentId) => getDefinitionFamiliesForAssignment(assignmentId).flatMap((family, familyIndex) => PERIODS.map((period, month) => observation(assignmentId, family.family, period, month, familyIndex))));
export function billingFindObservation(id: string) { return BILLING_OBSERVATIONS.find((row) => row.observationId === id); }
export function billingObservationFor(assignmentId: string, period = CURRENT_PERIOD) { return BILLING_OBSERVATIONS.find((row) => row.assignmentId === assignmentId && row.period.start === period.start); }
export function billingSeriesFor(assignmentId: string, entity: ScopeEntity) { return BILLING_OBSERVATIONS.filter((row) => row.assignmentId === assignmentId && row.entity.grain === entity.grain && row.entity.entityId === entity.entityId); }
export function billingBreakdownRows(): Observation[] { return []; }
function evidenceOf(observations: readonly Observation[]) { return { observationIds: observations.map((row) => row.observationId), definitionVersion: DEFINITION_VERSION, datasetChecksum: DATASET_CHECKSUM }; }
function valueOf(row: Observation | undefined) { return row?.value.status === "available" ? row.value.value : null; }
export function billingBrief(): RegionBrief {
  const current = billingObservationFor(BILLING_ASSIGNMENTS.denied); const prior = billingObservationFor(BILLING_ASSIGNMENTS.denied, PERIODS[PERIODS.length - 3]); const exceptions: Exception[] = []; const currentValue = valueOf(current); const priorValue = valueOf(prior);
  if (current && prior && currentValue !== null && priorValue !== null && currentValue > priorValue) exceptions.push({ exceptionId: "exc:billing-lead:denied-claim-value", assignmentId: BILLING_ASSIGNMENTS.denied, entity: DHO_FACILITY, period: CURRENT_PERIOD, priority: "act_now", category: "performance", comparisonBasis: "prior_period", detection: { kind: "seeded_scenario", scenarioLabel: "Rejected or denied claim value movement (preview fixture)" }, whatChanged: `Rejected or denied claim value moved from ${priorValue}% to ${currentValue}% of submitted value between the compared periods.`, whyItMatters: "Review payer and documentation evidence with the Hospital DHO before recording an internal follow-up.", owner: { role: "billing-lead" }, actionState: "none", evidence: evidenceOf([prior, current]), provenance: "illustrative", dataQuality: current.dataQuality });
  const onTrackAssignments = [BILLING_ASSIGNMENTS.acceptance, BILLING_ASSIGNMENTS.collections, BILLING_ASSIGNMENTS.payer, BILLING_ASSIGNMENTS.leakage].map((assignmentId) => { const assignment = getAssignment(assignmentId); if (!assignment) throw new Error(`Missing Billing & Revenue assignment metadata for ${assignmentId}.`); return [assignmentId, assignment.kpi] as const; });
  const onTrack: OnTrackItem[] = onTrackAssignments.flatMap(([assignmentId, label]) => { const row = billingObservationFor(assignmentId); return row ? [{ assignmentId, entity: DHO_FACILITY, period: CURRENT_PERIOD, summary: `${label} is reported for the current illustrative period; review the definition and limitations before relying on it.`, evidence: evidenceOf([row]), provenance: "illustrative" as const, dataQuality: row.dataQuality }] : []; });
  const dataLimitations: DataLimitation[] = [{ assignmentId: BILLING_ASSIGNMENTS.dso, issue: "unavailable", detail: "The approved DSO day convention and ageing threshold are not configured in this preview." }, { assignmentId: BILLING_ASSIGNMENTS.denied, issue: "unavailable", detail: "Payer segmentation and denial root-cause detail are not connected in this preview." }];
  return { exceptions, onTrack, dataLimitations };
}
