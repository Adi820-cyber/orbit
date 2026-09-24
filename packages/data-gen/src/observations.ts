/**
 * Derived KPI observations from the financial facts (PRD §8.2: facts first,
 * KPIs derived from them).
 *
 * Only what the facts can support without inventing anything:
 *   net revenue vs approved budget, EBITDA vs approved budget,
 * for the seven assignments that measure exactly that, at each assignment's
 * base grain and its permitted breakdown grain (ADR 0011, `deriveEntitlements`).
 *
 * Deliberately NOT derived here, each for a stated reason:
 * - DSO / collections: PRD §8.2 requires a chosen denominator and period
 *   convention for DSO, which is Maruti's call, not this module's.
 * - COE and corporate "vs plan": facility financials carry no COE or payer
 *   attribution, so those figures would be fabricated.
 * - Every non-financial KPI: no generator exists yet for their facts.
 * - Targets: the workbook has no approved numeric targets (PRD §3.1); the
 *   budget is the KPI's denominator, not a target, so `target` stays
 *   `not_configured`.
 *
 * Ratios at region and group grain are computed from summed numerators and
 * denominators, never by averaging facility percentages (PRD §7.7).
 */
import { FRAMEWORK_MANIFEST, getAssignment } from "@orbit/kpi-framework";
import { deriveEntitlements } from "./entitlements.ts";
import { generateAllFinancialFacts, type FinancialFact } from "./facts/financial.ts";
import { COMPANY_MANIFEST } from "./manifest.ts";

export type Grain = "group" | "region" | "facility";

/** An entity by slug; the seed resolves slugs to database ids. */
export interface EntityRef {
  grain: Grain;
  slug: string;
}

export type MeasureValue =
  | { status: "available"; value: number }
  | { status: "not_applicable"; reason: "zero_denominator" | "invalid_denominator" };

export interface DerivedObservation {
  observationKey: string;
  assignmentId: string;
  definitionFamily: string;
  definitionVersion: string;
  entity: EntityRef;
  /** `YYYY-MM`. */
  month: string;
  unit: string;
  value: MeasureValue;
  components: {
    componentId: string;
    label: string;
    role: "numerator" | "denominator";
    unit: string;
    value: MeasureValue;
  }[];
}

interface Measure {
  family: "Net revenue" | "EBITDA";
  actual: (fact: FinancialFact) => number;
  budget: (fact: FinancialFact) => number;
  actualLabel: string;
  budgetLabel: string;
}

const MEASURES: Record<string, Measure> = {
  "net-revenue": {
    family: "Net revenue",
    actual: (fact) => fact.netRevenue,
    budget: (fact) => fact.budgetNetRevenue,
    actualLabel: "Net revenue",
    budgetLabel: "Approved net revenue budget",
  },
  ebitda: {
    family: "EBITDA",
    actual: (fact) => fact.ebitda,
    budget: (fact) => fact.budgetEbitda,
    actualLabel: "EBITDA",
    budgetLabel: "Approved EBITDA budget",
  },
};

/** The seven "vs approved budget" assignments these facts support, and their measure. */
export const FINANCIAL_ASSIGNMENTS: Readonly<Record<string, keyof typeof MEASURES>> = {
  "chairman:group-net-revenue-vs-approved-budget": "net-revenue",
  "chairman:group-ebitda-vs-approved-budget": "ebitda",
  "regional-coo:regional-net-revenue-vs-approved-budget": "net-revenue",
  "regional-coo:regional-ebitda-vs-approved-budget": "ebitda",
  "hospital-dho:hospital-net-revenue-vs-approved-budget": "net-revenue",
  "hospital-dho:hospital-ebitda-vs-approved-budget": "ebitda",
  "group-cfo:group-ebitda-vs-approved-budget": "ebitda",
};

const PERCENT = "percent";

/** Minor units (cents) to major units, exactly representable for display. */
function major(minor: number): number {
  return minor / 100;
}

/**
 * Actual as a percentage of budget, one decimal place. A zero budget is not
 * applicable (PRD §7.9); a negative budget (a planned loss) makes the ratio's
 * direction meaningless, so it is reported as an invalid denominator rather
 * than as a misleading percentage.
 */
export function percentOfBudget(actual: number, budget: number): MeasureValue {
  if (budget === 0) return { status: "not_applicable", reason: "zero_denominator" };
  if (budget < 0) return { status: "not_applicable", reason: "invalid_denominator" };
  return { status: "available", value: Math.round((actual / budget) * 1000) / 10 };
}

function entitiesAt(grain: Grain): EntityRef[] {
  const demo = COMPANY_MANIFEST.organizations.find((org) => org.kind === "demo");
  if (!demo) throw new Error("company manifest has no demo organization");
  switch (grain) {
    case "group":
      return [{ grain, slug: demo.slug }];
    case "region":
      return COMPANY_MANIFEST.regions.map((region) => ({ grain, slug: region.slug }));
    case "facility":
      return COMPANY_MANIFEST.facilities.map((facility) => ({ grain, slug: facility.slug }));
  }
}

/** Facility facts that roll up into one entity. */
function factsFor(entity: EntityRef, month: string, facts: readonly FinancialFact[]): FinancialFact[] {
  const regionOf = new Map(COMPANY_MANIFEST.facilities.map((facility) => [facility.slug, facility.regionSlug]));
  return facts.filter(
    (fact) =>
      fact.period === month &&
      (entity.grain === "group" ||
        (entity.grain === "region" && regionOf.get(fact.facilitySlug) === entity.slug) ||
        (entity.grain === "facility" && fact.facilitySlug === entity.slug)),
  );
}

/** Every derived observation, deterministically ordered. */
export function deriveFinancialObservations(
  facts: readonly FinancialFact[] = generateAllFinancialFacts(),
): DerivedObservation[] {
  const entitlements = deriveEntitlements();
  const months = [...new Set(facts.map((fact) => fact.period))].sort();
  const currency = COMPANY_MANIFEST.scale.currency;
  const rows: DerivedObservation[] = [];

  for (const [assignmentId, measureKey] of Object.entries(FINANCIAL_ASSIGNMENTS)) {
    const assignment = getAssignment(assignmentId);
    const entitlement = entitlements.find((row) => row.assignmentId === assignmentId);
    const measure = MEASURES[measureKey];
    if (!assignment || !entitlement || !measure) {
      throw new Error(`financial assignment ${assignmentId} is missing from the framework or matrix`);
    }
    const grains = [...new Set([...entitlement.grains, ...entitlement.breakdowns])].filter(
      (grain): grain is Grain => grain === "group" || grain === "region" || grain === "facility",
    );

    for (const grain of grains) {
      for (const entity of entitiesAt(grain)) {
        for (const month of months) {
          const parts = factsFor(entity, month, facts);
          if (parts.length === 0) continue;
          const actual = parts.reduce((sum, fact) => sum + measure.actual(fact), 0);
          const budget = parts.reduce((sum, fact) => sum + measure.budget(fact), 0);
          rows.push({
            observationKey: `obs:${assignmentId}:${entity.grain}:${entity.slug}:${month}`,
            assignmentId,
            definitionFamily: measure.family,
            definitionVersion: FRAMEWORK_MANIFEST.definitionVersion,
            entity,
            month,
            unit: PERCENT,
            value: percentOfBudget(actual, budget),
            components: [
              { componentId: `${measureKey}-actual`, label: measure.actualLabel, role: "numerator", unit: currency, value: { status: "available", value: major(actual) } },
              { componentId: `${measureKey}-budget`, label: measure.budgetLabel, role: "denominator", unit: currency, value: { status: "available", value: major(budget) } },
            ],
          });
        }
      }
    }
  }
  return rows;
}
