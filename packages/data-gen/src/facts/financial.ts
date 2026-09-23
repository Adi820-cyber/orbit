/**
 * Monthly financial facts per facility.
 *
 * PRD §8.2: generate underlying facts first and derive KPI components from
 * them. Nothing here is a KPI value — these are the ledger-like figures a KPI
 * is later computed *from*, which is what makes the derived numbers explainable
 * rather than asserted.
 *
 * ── Two rules this module is built around ─────────────────────────────────
 *
 * **1. Money is integer minor units.** Never floats. PRD §8.2 requires revenue,
 * costs, budgets and EBITDA to reconcile, and floating-point money accumulates
 * error that makes exact reconciliation impossible. Every amount here is a
 * whole number of cents.
 *
 * **2. Reconciliation is by construction, not by luck.** Derived totals are
 * *defined* as the arithmetic of their parts:
 *
 *     netRevenue = grossBilled − discounts − contractualAdjustments − otherDeductions
 *     totalOperatingCost = staffCost + consumableCost + otherOperatingCost
 *     ebitda = netRevenue − totalOperatingCost
 *     closingReceivables = openingReceivables + netRevenue − collections − writeOffs
 *
 * So a reconciliation test cannot fail for rounding reasons — it can only fail
 * if someone changes the model, which is exactly what it should catch. The
 * alternative, generating each figure independently and hoping the sums agree,
 * produces drift that gets "fixed" with a fudge factor.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No targets. The workbook contains no approved numeric targets (PRD §3.1) and
 * inventing them is forbidden. `budgetNetRevenue` and `budgetEbitda` are a
 * *budget* — a plan figure the demo accounting model needs so variance is
 * expressible — not a performance target, and they are labelled as such.
 */

import { COMPANY_MANIFEST } from "../manifest.ts";
import { monthOrdinal, parseMonth, periodAtOffset } from "../periods.ts";
import { streamFor } from "../rng.ts";

/** Every amount is an integer count of minor units (cents). */
export type Minor = number;

/**
 * One facility's financial facts for one month.
 *
 * Illustrative throughout. These are not real operating figures and carry no
 * claim about any real organization.
 */
export interface FinancialFact {
  facilitySlug: string;
  /** `YYYY-MM`. */
  period: string;

  // ── Revenue build-up ────────────────────────────────────────────────────
  /** Gross billable revenue before any deduction. */
  grossBilled: Minor;
  discounts: Minor;
  contractualAdjustments: Minor;
  otherDeductions: Minor;
  /** Defined as gross less the three deductions. Never generated directly. */
  netRevenue: Minor;

  // ── Cost build-up ───────────────────────────────────────────────────────
  staffCost: Minor;
  consumableCost: Minor;
  otherOperatingCost: Minor;
  /** Defined as the sum of the three cost lines. */
  totalOperatingCost: Minor;

  /** Defined as netRevenue less totalOperatingCost. May be negative. */
  ebitda: Minor;

  // ── Plan figures ────────────────────────────────────────────────────────
  /**
   * Approved budget for the period. A PLAN figure, not a performance target —
   * the workbook authorises no numeric targets (PRD §3.1).
   */
  budgetNetRevenue: Minor;
  budgetEbitda: Minor;

  // ── Receivables movement ────────────────────────────────────────────────
  openingReceivables: Minor;
  /** Cash posted and reconciled in the period. */
  collections: Minor;
  /** Credit notes and write-offs removed from receivables. */
  writeOffs: Minor;
  /** Defined as opening + netRevenue − collections − writeOffs. */
  closingReceivables: Minor;

  /** Aging of `closingReceivables`. The four buckets sum to it exactly. */
  aging: {
    current: Minor;
    days31to60: Minor;
    days61to90: Minor;
    over90: Minor;
  };
}

/**
 * Seasonality multiplier by calendar month (1-12).
 *
 * A flat year would hide any bug in period handling and make trend charts
 * meaningless, so the shape is deliberate rather than random: a post-new-year
 * dip, a mid-year peak, and a softer December. Fixed rather than seeded,
 * because seasonality is a property of the fictional business, not noise — the
 * same month should behave the same way every year.
 */
const SEASONALITY: Readonly<Record<number, number>> = {
  1: 0.94,
  2: 0.96,
  3: 1.04,
  4: 1.01,
  5: 1.03,
  6: 1.06,
  7: 1.05,
  8: 1.02,
  9: 1.0,
  10: 1.02,
  11: 1.0,
  12: 0.91,
};

/**
 * Deduction and cost rates, as fractions of the line they apply to.
 *
 * Demo-only parameters, chosen to be internally coherent rather than to match
 * any real benchmark. Held here so the shape of the accounting model is
 * reviewable in one place instead of scattered as literals through the
 * generator.
 */
const MODEL = {
  /** Deductions, as fractions of gross billed. */
  discountRate: 0.045,
  contractualAdjustmentRate: 0.082,
  otherDeductionRate: 0.011,

  /** Cost lines, as fractions of net revenue. */
  staffCostRate: 0.512,
  consumableCostRate: 0.203,
  otherOperatingCostRate: 0.111,

  /** Receivables behaviour. */
  collectionRate: 0.93,
  writeOffRate: 0.006,
  /** Opening receivables on the first period, as a multiple of monthly net revenue. */
  openingReceivableMonths: 1.7,

  /** Per-line random variation, so facilities are not scaled copies. */
  jitter: {
    revenue: 0.04,
    deduction: 0.12,
    cost: 0.05,
    collection: 0.05,
  },
} as const;

/** Rounds to a whole minor unit. Central so no call site rounds differently. */
function minor(value: number): Minor {
  return Math.round(value);
}

/**
 * Splits a total into four aging buckets that sum to it EXACTLY.
 *
 * The remainder goes to the final bucket rather than being distributed, so the
 * sum is exact by construction. Proportions drift a little with the scenario
 * weighting, which is the point — a collections problem should age the book.
 */
function splitAging(total: Minor, overdueSkew: number): FinancialFact["aging"] {
  const clampedSkew = Math.max(0, Math.min(1, overdueSkew));

  // Healthy book: most of it current. Skew shifts weight into older buckets.
  const currentShare = 0.62 - 0.3 * clampedSkew;
  const share31to60 = 0.22 + 0.04 * clampedSkew;
  const share61to90 = 0.1 + 0.1 * clampedSkew;

  const current = minor(total * currentShare);
  const days31to60 = minor(total * share31to60);
  const days61to90 = minor(total * share61to90);
  // Absorbs the rounding remainder, so the four always sum to `total`.
  const over90 = total - current - days31to60 - days61to90;

  return { current, days31to60, days61to90, over90 };
}

/** Inputs a caller may override per facility-month, used by scenario overlays. */
export interface FinancialModifiers {
  /** Multiplies gross billed. Above 1 grows revenue. */
  revenueMultiplier?: number;
  /** Multiplies every cost line. Above 1 compresses margin. */
  costMultiplier?: number;
  /** Multiplies the collection rate. Below 1 slows cash. */
  collectionMultiplier?: number;
  /** 0 = healthy aging, 1 = heavily overdue. */
  overdueSkew?: number;
}

/**
 * Generates one facility's financial facts across the manifest's full period
 * range, in ascending order.
 *
 * Receivables carry forward: each month's opening is the previous month's
 * closing, so the book is a continuous ledger rather than 24 unrelated
 * snapshots. That is what makes DSO and aging trends mean anything.
 *
 * `modifiersFor` lets a scenario overlay adjust a specific month without this
 * module knowing about scenarios.
 */
export function generateFinancialFacts(
  facilitySlug: string,
  modifiersFor: (period: string) => FinancialModifiers = () => ({}),
): readonly FinancialFact[] {
  const facility = COMPANY_MANIFEST.facilities.find((f) => f.slug === facilitySlug);
  if (!facility) throw new Error(`Unknown facility "${facilitySlug}".`);

  const { periods, scale, seed } = COMPANY_MANIFEST;
  const firstOrdinal = monthOrdinal(periods.firstMonth);

  // This facility's share of group annual net revenue, per month.
  const facilityMonthlyNet = (scale.openingAnnualNetRevenueMinor * facility.revenueWeight) / 12;

  const facts: FinancialFact[] = [];
  let openingReceivables = minor(facilityMonthlyNet * MODEL.openingReceivableMonths);

  for (let i = 0; i < periods.monthCount; i++) {
    const period = periodAtOffset(periods.firstMonth, i);
    const { month } = parseMonth(period);
    const rng = streamFor(seed, "financial", facilitySlug, period);
    const mods = modifiersFor(period);

    // Compound growth across the range, plus seasonality and noise.
    const monthsElapsed = monthOrdinal(period) - firstOrdinal;
    const growth = (1 + scale.annualRevenueGrowthRate) ** (monthsElapsed / 12);
    const seasonal = SEASONALITY[month] ?? 1;

    const targetNet =
      facilityMonthlyNet *
      growth *
      seasonal *
      rng.jitter(MODEL.jitter.revenue) *
      (mods.revenueMultiplier ?? 1);

    // Work backwards from net to gross, so the deduction rates stay meaningful
    // and net revenue lands near the intended scale.
    const deductionRate =
      (MODEL.discountRate + MODEL.contractualAdjustmentRate + MODEL.otherDeductionRate) *
      rng.jitter(MODEL.jitter.deduction);
    const grossBilled = minor(targetNet / (1 - deductionRate));

    const discounts = minor(grossBilled * MODEL.discountRate * rng.jitter(MODEL.jitter.deduction));
    const contractualAdjustments = minor(
      grossBilled * MODEL.contractualAdjustmentRate * rng.jitter(MODEL.jitter.deduction),
    );
    const otherDeductions = minor(
      grossBilled * MODEL.otherDeductionRate * rng.jitter(MODEL.jitter.deduction),
    );

    // DEFINED, not generated. This is what makes reconciliation exact.
    const netRevenue = grossBilled - discounts - contractualAdjustments - otherDeductions;

    const costMultiplier = mods.costMultiplier ?? 1;
    const staffCost = minor(
      netRevenue * MODEL.staffCostRate * rng.jitter(MODEL.jitter.cost) * costMultiplier,
    );
    const consumableCost = minor(
      netRevenue * MODEL.consumableCostRate * rng.jitter(MODEL.jitter.cost) * costMultiplier,
    );
    const otherOperatingCost = minor(
      netRevenue * MODEL.otherOperatingCostRate * rng.jitter(MODEL.jitter.cost) * costMultiplier,
    );

    const totalOperatingCost = staffCost + consumableCost + otherOperatingCost;
    const ebitda = netRevenue - totalOperatingCost;

    // Budget is the plan the period was measured against, so it does NOT carry
    // the scenario modifiers — a scenario is a deviation FROM plan, and a
    // budget that moved with actuals would make variance permanently zero.
    const budgetNet = facilityMonthlyNet * growth * seasonal;
    const budgetNetRevenue = minor(budgetNet);
    const budgetEbitda = minor(
      budgetNet *
        (1 - MODEL.staffCostRate - MODEL.consumableCostRate - MODEL.otherOperatingCostRate),
    );

    const collectionRate =
      MODEL.collectionRate *
      rng.jitter(MODEL.jitter.collection) *
      (mods.collectionMultiplier ?? 1);

    // Collections are capped at what is actually collectable, so the book can
    // never go negative through over-collection.
    const collectable = openingReceivables + netRevenue;
    const collections = Math.min(minor(collectable * collectionRate), collectable);
    const writeOffs = Math.min(
      minor(netRevenue * MODEL.writeOffRate * rng.jitter(0.3)),
      collectable - collections,
    );

    const closingReceivables = openingReceivables + netRevenue - collections - writeOffs;

    facts.push({
      facilitySlug,
      period,
      grossBilled,
      discounts,
      contractualAdjustments,
      otherDeductions,
      netRevenue,
      staffCost,
      consumableCost,
      otherOperatingCost,
      totalOperatingCost,
      ebitda,
      budgetNetRevenue,
      budgetEbitda,
      openingReceivables,
      collections,
      writeOffs,
      closingReceivables,
      aging: splitAging(closingReceivables, mods.overdueSkew ?? 0),
    });

    openingReceivables = closingReceivables;
  }

  return facts;
}

/** Every facility's financial facts, in manifest facility order. */
export function generateAllFinancialFacts(
  modifiersFor: (facilitySlug: string, period: string) => FinancialModifiers = () => ({}),
): readonly FinancialFact[] {
  return COMPANY_MANIFEST.facilities.flatMap((f) =>
    generateFinancialFacts(f.slug, (period) => modifiersFor(f.slug, period)),
  );
}
