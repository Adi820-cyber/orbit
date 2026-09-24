/**
 * Operational facts per facility and month, for every KPI family the workbook
 * assigns (PRD §8.2: facts first, KPIs derived from them).
 *
 * Coherence comes from deriving volumes from the same drivers rather than
 * drawing each KPI independently:
 * - money comes from the financial facts (`facts/financial.ts`), in major units;
 * - capacity comes from each facility's staffed beds and calendar days;
 * - claim, referral and survey volumes scale with billed revenue and occupied
 *   bed days, so a busier hospital has more of all of them;
 * - headcount comes from staff cost, so workforce KPIs move with payroll.
 *
 * The manifest's nine labelled scenarios (PRD §8.3) are applied here, from
 * each one's onset month at its entity: the two financial ones through the
 * financial model's modifiers, the rest on the operational facts. Every rate
 * below is an illustrative demo parameter, not a client figure or a clinical
 * benchmark (PRD §8.1). Needs Maruti's plausibility review before an external
 * demo.
 */
import { COMPANY_MANIFEST } from "../manifest.ts";
import { streamFor, type Rng } from "../rng.ts";
import { generateAllFinancialFacts, type FinancialFact, type FinancialModifiers } from "./financial.ts";

/** Additive facts for one facility and month. Every numeric field sums across facilities. */
export interface OperationalFacts {
  facilitySlug: string;
  /** `YYYY-MM`. */
  period: string;
  // Money (major units)
  netRevenue: number;
  budgetNetRevenue: number;
  ebitda: number;
  budgetEbitda: number;
  collections: number;
  collectionsPlan: number;
  operatingCashFlow: number;
  operatingCashFlowPlan: number;
  closingReceivables: number;
  trailingNetRevenue90: number;
  grossBilled: number;
  unbilledRevenue: number;
  newBusinessRevenue: number;
  newBusinessPlan: number;
  qualifiedPipeline: number;
  pipelineTarget: number;
  procurementSavings: number;
  procurementSavingsPlan: number;
  inventoryValue: number;
  dailyConsumption: number;
  forecastAbsoluteError: number;
  forecastActual: number;
  staffCost: number;
  /** Net revenue of the COE hosted here (a segment of this facility's revenue), 0 when none. */
  coeRevenue: number;
  coePlan: number;
  // Capacity and activity
  availableBedDays: number;
  occupiedBedDays: number;
  eligibleReferrals: number;
  completedReferrals: number;
  // Experience and quality
  surveyResponses: number;
  positiveResponses: number;
  indicatorsAssessed: number;
  indicatorsMet: number;
  seriousEvents: number;
  auditedCases: number;
  compliantCases: number;
  // Claims
  claimsSubmitted: number;
  claimsAcceptedFirstPass: number;
  submittedClaimValue: number;
  deniedClaimValue: number;
  // Workforce
  paidFte: number;
  engagementResponses: number;
  engagedResponses: number;
  criticalHeadcount: number;
  criticalExits: number;
  requiredStaff: number;
  compliantStaff: number;
  // Commercial and governance
  contractedServices: number;
  usedContractedServices: number;
  actionsDue: number;
  actionsClosedOnTime: number;
  kpiRecordsChecked: number;
  kpiRecordsPassed: number;
}

export type ScenarioSlug = (typeof COMPANY_MANIFEST.scenarios)[number]["slug"];

/** Whether a manifest scenario is in effect for a facility in a month. */
export function scenarioActive(slug: ScenarioSlug, facilitySlug: string, period: string): boolean {
  const scenario = COMPANY_MANIFEST.scenarios.find((row) => row.slug === slug);
  if (!scenario || period < scenario.onsetMonth) return false;
  return scenario.grain === "group" || scenario.entitySlug === facilitySlug;
}

/** The financial model's overlay for the two financial scenarios. */
export function financialScenarioModifiers(facilitySlug: string, period: string): FinancialModifiers {
  const on = (slug: ScenarioSlug) => scenarioActive(slug, facilitySlug, period);
  return {
    ...(on("revenue-growth-margin-pressure") ? { revenueMultiplier: 1.03, costMultiplier: 1.05 } : {}),
    ...(on("delayed-collections-aging") ? { collectionMultiplier: 0.78, overdueSkew: 0.4 } : {}),
  };
}

/** Illustrative demo parameters (not benchmarks). */
const DEMO = {
  baseOccupancy: 0.8,
  averageClaimValue: 1_800,
  insuredShareOfBilling: 0.7,
  averageMonthlyStaffCost: 5_200,
  criticalRoleShare: 0.18,
  collectionsPlanShareOfBudget: 0.985,
  operatingCashFlowPlanShareOfBudgetEbitda: 0.92,
  newBusinessShareOfRevenue: 0.06,
  pipelineCoverageMultiple: 3,
  procurementSavingsPlanShare: 0.04,
  inventoryCoverDays: 34,
  /** Share of a host facility's revenue attributed to the COE it hosts. */
  coeShareOfHostRevenue: 0.3,
};

function daysIn(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, month ?? 1, 0)).getUTCDate();
}

function monthsSince(slug: ScenarioSlug, period: string): number {
  const onset = COMPANY_MANIFEST.scenarios.find((row) => row.slug === slug)?.onsetMonth ?? period;
  const [y1, m1] = onset.split("-").map(Number);
  const [y2, m2] = period.split("-").map(Number);
  return ((y2 ?? 0) - (y1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0));
}

const money = (minor: number): number => minor / 100;

/** A count drawn around `expected`, never negative. */
function count(rng: Rng, expected: number, spread = 0.06): number {
  return Math.max(0, Math.round(expected * rng.jitter(spread)));
}

/** A count of successes out of `total` at about `rate`, never above total. */
function successes(rng: Rng, total: number, rate: number, spread = 0.02): number {
  return Math.min(total, Math.max(0, Math.round(total * Math.min(1, rate * rng.jitter(spread)))));
}

function operationalFor(fact: FinancialFact, prior: readonly FinancialFact[], staffedBeds: number): OperationalFacts {
  const rng = streamFor(COMPANY_MANIFEST.seed, "operational", fact.facilitySlug, fact.period);
  const on = (slug: ScenarioSlug) => scenarioActive(slug, fact.facilitySlug, fact.period);
  const capacity = on("capacity-constraint");
  const staffing = on("staffing-gap");
  const claims = on("claim-quality-denials");
  const governance = on("clinical-governance-exception");

  // Capacity constraint: staffed beds fall while demand holds, so utilisation
  // rises toward its ceiling and throughput (referral completion) flattens.
  const days = daysIn(fact.period);
  const demandBedDays = staffedBeds * days * DEMO.baseOccupancy * rng.jitter(0.04);
  const availableBedDays = Math.round(staffedBeds * days * (capacity ? 0.85 : 1));
  const occupiedBedDays = Math.min(Math.round(availableBedDays * 0.97), Math.round(demandBedDays));

  const grossBilled = money(fact.grossBilled);
  const netRevenue = money(fact.netRevenue);
  const budgetNetRevenue = money(fact.budgetNetRevenue);
  const consumables = money(fact.consumableCost);
  const paidFte = Math.max(1, Math.round(money(fact.staffCost) / DEMO.averageMonthlyStaffCost));
  const criticalHeadcount = Math.max(1, Math.round(paidFte * DEMO.criticalRoleShare));
  const claimsSubmitted = count(rng, (grossBilled * DEMO.insuredShareOfBilling) / DEMO.averageClaimValue, 0.03);
  const submittedClaimValue = grossBilled * DEMO.insuredShareOfBilling;
  const eligibleReferrals = count(rng, occupiedBedDays * 0.35);
  const surveyResponses = count(rng, occupiedBedDays * 0.12);
  const engagementResponses = count(rng, paidFte * 0.6);
  const contractedServices = count(rng, claimsSubmitted * 0.4, 0.02);
  const newBusinessPlan = budgetNetRevenue * DEMO.newBusinessShareOfRevenue;
  const actionsDue = rng.int(6, 11);
  const hostsCoe = COMPANY_MANIFEST.coes.some((coe) => coe.hostFacilitySlug === fact.facilitySlug);
  const coePlan = hostsCoe ? budgetNetRevenue * DEMO.coeShareOfHostRevenue : 0;
  // Stock risk builds from its onset: slow-moving stock accumulates while
  // critical lines run short.
  const stockMonths = on("procurement-stock-risk") ? monthsSince("procurement-stock-risk", fact.period) + 1 : 0;

  return {
    facilitySlug: fact.facilitySlug,
    period: fact.period,
    netRevenue,
    budgetNetRevenue,
    ebitda: money(fact.ebitda),
    budgetEbitda: money(fact.budgetEbitda),
    collections: money(fact.collections),
    collectionsPlan: budgetNetRevenue * DEMO.collectionsPlanShareOfBudget,
    operatingCashFlow: money(fact.ebitda) - (money(fact.closingReceivables) - money(fact.openingReceivables)),
    operatingCashFlowPlan: money(fact.budgetEbitda) * DEMO.operatingCashFlowPlanShareOfBudgetEbitda,
    closingReceivables: money(fact.closingReceivables),
    trailingNetRevenue90: [...prior.slice(-2), fact].reduce((sum, row) => sum + money(row.netRevenue), 0),
    grossBilled,
    unbilledRevenue: grossBilled * 0.045 * rng.jitter(0.15),
    newBusinessRevenue: newBusinessPlan * rng.jitter(0.12),
    newBusinessPlan,
    qualifiedPipeline: newBusinessPlan * DEMO.pipelineCoverageMultiple * rng.jitter(0.1),
    pipelineTarget: newBusinessPlan * DEMO.pipelineCoverageMultiple,
    procurementSavings: consumables * 0.038 * rng.jitter(0.2),
    procurementSavingsPlan: consumables * DEMO.procurementSavingsPlanShare,
    inventoryValue: (consumables / 30) * DEMO.inventoryCoverDays * (1 + 0.08 * stockMonths) * rng.jitter(0.04),
    dailyConsumption: consumables / 30,
    forecastAbsoluteError: netRevenue * 0.035 * rng.jitter(0.3),
    forecastActual: netRevenue,
    staffCost: money(fact.staffCost),
    coeRevenue: hostsCoe ? coePlan * (netRevenue / budgetNetRevenue) * rng.jitter(0.04) : 0,
    coePlan,
    availableBedDays,
    occupiedBedDays,
    eligibleReferrals,
    completedReferrals: successes(rng, eligibleReferrals, capacity ? 0.57 : 0.67),
    surveyResponses,
    positiveResponses: successes(rng, surveyResponses, capacity ? 0.8 : 0.86),
    indicatorsAssessed: 40,
    indicatorsMet: successes(rng, 40, 0.92, 0.03),
    seriousEvents: rng.int(0, 2),
    // Clinical governance: reviews and corrective actions fall behind their
    // due dates. Reported as completion against cases due, with no clinical
    // threshold asserted (manifest note).
    auditedCases: 60,
    compliantCases: successes(rng, 60, governance ? 0.8 : 0.96, 0.02),
    claimsSubmitted,
    claimsAcceptedFirstPass: successes(rng, claimsSubmitted, claims ? 0.8 : 0.92),
    submittedClaimValue,
    deniedClaimValue: submittedClaimValue * (claims ? 0.075 : 0.032) * rng.jitter(0.15),
    paidFte,
    engagementResponses,
    engagedResponses: successes(rng, engagementResponses, staffing ? 0.6 : 0.73),
    criticalHeadcount,
    criticalExits: staffing ? rng.int(4, 6) : rng.chance(0.25) ? 1 : 0,
    requiredStaff: paidFte,
    compliantStaff: successes(rng, paidFte, staffing ? 0.87 : 0.96, 0.015),
    contractedServices,
    usedContractedServices: successes(rng, contractedServices, 0.88, 0.04),
    actionsDue,
    actionsClosedOnTime: on("legal-deadline") ? actionsDue - rng.int(4, 5) : successes(rng, actionsDue, 0.95, 0.05),
    kpiRecordsChecked: 500,
    kpiRecordsPassed: successes(rng, 500, 0.985, 0.005),
  };
}

/** Every facility's operational facts, in manifest facility order, oldest month first. */
export function generateAllOperationalFacts(
  financial: readonly FinancialFact[] = generateAllFinancialFacts(financialScenarioModifiers),
): OperationalFacts[] {
  const rows: OperationalFacts[] = [];
  for (const facility of COMPANY_MANIFEST.facilities) {
    const history = financial.filter((fact) => fact.facilitySlug === facility.slug).toSorted((a, b) => a.period.localeCompare(b.period));
    history.forEach((fact, index) => rows.push(operationalFor(fact, history.slice(0, index), facility.staffedBeds)));
  }
  return rows;
}
