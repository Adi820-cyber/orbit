/**
 * Every role's KPI observations, derived from the operational facts
 * (PRD §8.2: facts first, KPIs derived from them). Covers all 109
 * assignments across the 27 definition families the workbook assigns.
 *
 * Rules this module keeps:
 * - Every KPI is computed from a numerator and a denominator summed across
 *   the facilities in the entity, never by averaging facility ratios (PRD §7.7).
 * - A zero denominator is `not_applicable`, never 0 (PRD §7.9).
 * - Targets are demo parameters (`approval: "demo_parameter"`), stated as such;
 *   the workbook has no approved numeric targets (PRD §3.1). Clinical families
 *   get none at all: the workbook assumes no universal clinical threshold.
 * - A late, unreconciled source is missing, never filled in (PRD §7.9): the
 *   facility's value is `missing`, and a roll-up excludes it and says so.
 * - A bundled assignment (ADR 0004) takes its headline value from its first
 *   family and reports every other family as a separate `measure` component,
 *   never merged into a composite.
 * - A COE is a segment of its host facility (manifest note): its facts are a
 *   share of the host's, and are never added to a region or the group.
 *
 * Needs Maruti's plausibility review before an external demo.
 */
import { FRAMEWORK_MANIFEST, ROLE_KPI_ASSIGNMENTS } from "@orbit/kpi-framework";
import { deriveEntitlements } from "./entitlements.ts";
import { generateAllOperationalFacts, scenarioActive, type OperationalFacts, type ScenarioSlug } from "./facts/operational.ts";
import { COMPANY_MANIFEST } from "./manifest.ts";
import { streamFor } from "./rng.ts";

export type KpiGrain = "group" | "region" | "facility" | "coe";

export interface KpiEntityRef {
  grain: KpiGrain;
  slug: string;
}

export type KpiValue =
  | { status: "available"; value: number }
  | { status: "missing"; reason: "not_reported" }
  | { status: "not_applicable"; reason: "zero_denominator" | "invalid_denominator" };

export interface KpiComponent {
  componentId: string;
  label: string;
  role: "numerator" | "denominator" | "measure";
  unit: string;
  value: KpiValue;
}

export type KpiTarget =
  | { state: "not_configured" }
  | { state: "configured"; value: number; direction: "higher_is_better" | "lower_is_better"; approval: "demo_parameter"; basis: string }
  | { state: "configured_range"; low: number; high: number; approval: "demo_parameter"; basis: string };

export interface KpiDataQuality {
  state: "illustrative";
  reconciliation: "reconciled" | "unreconciled";
  freshness: "current" | "late";
  refreshedAt: string;
  limitations: string[];
}

export interface KpiObservation {
  observationKey: string;
  assignmentId: string;
  definitionFamily: string;
  definitionVersion: string;
  entity: KpiEntityRef;
  /** `YYYY-MM`. */
  month: string;
  unit: string;
  value: KpiValue;
  components: KpiComponent[];
  target: KpiTarget;
  dataQuality: KpiDataQuality;
}

type Category = "performance" | "safety" | "legal" | "compliance";

interface Computed {
  value: KpiValue;
  components: KpiComponent[];
}

export interface FamilySpec {
  unit: string;
  target: KpiTarget;
  category: Category;
  /**
   * Manifest scenarios that move this family's values (for labelling seeded
   * exceptions). The late-source scenario is not listed: it makes values
   * missing, and a missing value never raises an exception.
   */
  scenarios: readonly ScenarioSlug[];
  compute: Measure;
}

/** A family's calculation, and which facts are its numerator and denominator. */
export type Measure = ((facts: OperationalFacts) => Computed) & { id: string; numerator: Part; denominator: Part };

const CURRENCY = COMPANY_MANIFEST.scale.currency;
const DEMO_BASIS = "Demo parameter for the illustrative dataset, not an approved target";

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const available = (value: number): KpiValue => ({ status: "available", value });

function component(id: string, label: string, role: KpiComponent["role"], unit: string, value: number): KpiComponent {
  return { componentId: id, label, role, unit, value: available(round(value, 2)) };
}

type NumericKey = { [K in keyof OperationalFacts]: OperationalFacts[K] extends number ? K : never }[keyof OperationalFacts];

export interface Part {
  key: NumericKey;
  label: string;
  unit: string;
}

/** `numerator / denominator × scale`, rounded; a zero or negative denominator is not applicable. */
function ratio(id: string, numerator: Part, denominator: Part, scale: number, places: number): Measure {
  const compute = (facts: OperationalFacts): Computed => {
    const top = facts[numerator.key];
    const bottom = facts[denominator.key];
    const value: KpiValue =
      bottom === 0
        ? { status: "not_applicable", reason: "zero_denominator" }
        : bottom < 0
          ? { status: "not_applicable", reason: "invalid_denominator" }
          : available(round((top / bottom) * scale, places));
    return {
      value,
      components: [
        component(`${id}-numerator`, numerator.label, "numerator", numerator.unit, top),
        component(`${id}-denominator`, denominator.label, "denominator", denominator.unit, bottom),
      ],
    };
  };
  return Object.assign(compute, { id, numerator, denominator });
}

const money = (key: NumericKey, label: string): Part => ({ key, label, unit: CURRENCY });
const counted = (key: NumericKey, label: string, unit = "count"): Part => ({ key, label, unit });
const higher = (value: number): KpiTarget => ({ state: "configured", value, direction: "higher_is_better", approval: "demo_parameter", basis: DEMO_BASIS });
const lower = (value: number): KpiTarget => ({ state: "configured", value, direction: "lower_is_better", approval: "demo_parameter", basis: DEMO_BASIS });
const range = (low: number, high: number): KpiTarget => ({ state: "configured_range", low, high, approval: "demo_parameter", basis: DEMO_BASIS });

const PERCENT = "percent";
const NO_TARGET: KpiTarget = { state: "not_configured" };

/** One spec per definition family the workbook assigns (27 of the 29). */
export const FAMILY_SPECS: Readonly<Record<string, FamilySpec>> = {
  "Net revenue": {
    unit: PERCENT, target: higher(100), category: "performance", scenarios: ["revenue-growth-margin-pressure"],
    compute: ratio("net-revenue", money("netRevenue", "Net revenue"), money("budgetNetRevenue", "Approved net revenue budget"), 100, 1),
  },
  EBITDA: {
    unit: PERCENT, target: higher(100), category: "performance", scenarios: ["revenue-growth-margin-pressure"],
    compute: ratio("ebitda", money("ebitda", "EBITDA"), money("budgetEbitda", "Approved EBITDA budget"), 100, 1),
  },
  "Operating cash flow": {
    unit: PERCENT, target: higher(100), category: "performance", scenarios: ["delayed-collections-aging"],
    compute: ratio("operating-cash-flow", money("operatingCashFlow", "Operating cash flow"), money("operatingCashFlowPlan", "Operating cash flow plan"), 100, 1),
  },
  Collections: {
    unit: PERCENT, target: higher(98), category: "performance", scenarios: ["delayed-collections-aging"],
    compute: ratio("collections", money("collections", "Reconciled cash collected"), money("collectionsPlan", "Collections plan"), 100, 1),
  },
  DSO: {
    unit: "days", target: lower(60), category: "performance", scenarios: ["delayed-collections-aging"],
    compute: ratio("dso", money("closingReceivables", "Trade receivables at month end"), money("trailingNetRevenue90", "Net revenue, last three months"), 90, 1),
  },
  "Capacity utilisation": {
    unit: PERCENT, target: range(75, 90), category: "performance", scenarios: ["capacity-constraint"],
    compute: ratio("capacity", counted("occupiedBedDays", "Occupied staffed bed days", "bed days"), counted("availableBedDays", "Available staffed bed days", "bed days"), 100, 1),
  },
  "Referral conversion": {
    unit: PERCENT, target: higher(62), category: "performance", scenarios: ["capacity-constraint"],
    compute: ratio("referral", counted("completedReferrals", "Referrals completed"), counted("eligibleReferrals", "Eligible referrals"), 100, 1),
  },
  "Patient experience": {
    unit: PERCENT, target: higher(83), category: "performance", scenarios: ["capacity-constraint"],
    compute: ratio("experience", counted("positiveResponses", "Positive survey responses"), counted("surveyResponses", "Survey responses"), 100, 1),
  },
  "Clinical quality scorecard": {
    unit: PERCENT, target: NO_TARGET, category: "safety", scenarios: [],
    compute: ratio("clinical-quality", counted("indicatorsMet", "Quality indicators met"), counted("indicatorsAssessed", "Quality indicators assessed"), 100, 1),
  },
  "Serious adverse events": {
    unit: "per 1,000 occupied bed days", target: NO_TARGET, category: "safety", scenarios: [],
    compute: ratio("serious-events", counted("seriousEvents", "Serious adverse events"), counted("occupiedBedDays", "Occupied bed days", "bed days"), 1000, 2),
  },
  "Protocol compliance": {
    unit: PERCENT, target: NO_TARGET, category: "safety", scenarios: ["clinical-governance-exception"],
    compute: ratio("protocol", counted("compliantCases", "Audited cases compliant"), counted("auditedCases", "Cases audited"), 100, 1),
  },
  "First-pass claim acceptance": {
    unit: PERCENT, target: higher(88), category: "performance", scenarios: ["claim-quality-denials"],
    compute: ratio("first-pass", counted("claimsAcceptedFirstPass", "Claims accepted on first submission"), counted("claimsSubmitted", "Claims submitted"), 100, 1),
  },
  "Denied or rejected claim value": {
    unit: PERCENT, target: lower(5), category: "performance", scenarios: ["claim-quality-denials"],
    compute: ratio("denied", money("deniedClaimValue", "Denied or rejected claim value"), money("submittedClaimValue", "Submitted claim value"), 100, 1),
  },
  "Unbilled revenue": {
    unit: PERCENT, target: lower(6), category: "performance", scenarios: [],
    compute: ratio("unbilled", money("unbilledRevenue", "Completed but unbilled revenue"), money("grossBilled", "Gross billed revenue"), 100, 1),
  },
  Engagement: {
    unit: PERCENT, target: higher(68), category: "performance", scenarios: ["staffing-gap"],
    compute: ratio("engagement", counted("engagedResponses", "Engaged responses"), counted("engagementResponses", "Engagement survey responses"), 100, 1),
  },
  "Critical-role attrition": {
    unit: PERCENT, target: lower(1.2), category: "performance", scenarios: ["staffing-gap"],
    compute: ratio("attrition", counted("criticalExits", "Critical-role exits"), counted("criticalHeadcount", "Critical-role headcount", "FTE"), 100, 1),
  },
  "Mandatory learning / credentialing": {
    unit: PERCENT, target: higher(93), category: "compliance", scenarios: ["staffing-gap"],
    compute: ratio("mandatory-learning", counted("compliantStaff", "Staff with current requirements"), counted("requiredStaff", "Staff with requirements", "FTE"), 100, 1),
  },
  "Workforce productivity": {
    unit: PERCENT, target: lower(54), category: "performance", scenarios: ["revenue-growth-margin-pressure"],
    compute: ratio("staff-cost-ratio", money("staffCost", "Staff cost"), money("netRevenue", "Net revenue"), 100, 1),
  },
  "New business revenue": {
    unit: PERCENT, target: higher(95), category: "performance", scenarios: [],
    compute: ratio("new-business", money("newBusinessRevenue", "New business revenue"), money("newBusinessPlan", "New business revenue plan"), 100, 1),
  },
  "Qualified pipeline": {
    unit: PERCENT, target: higher(95), category: "performance", scenarios: [],
    compute: ratio("pipeline", money("qualifiedPipeline", "Qualified pipeline value"), money("pipelineTarget", "Pipeline coverage target"), 100, 1),
  },
  "COE contribution": {
    unit: PERCENT, target: higher(97), category: "performance", scenarios: [],
    compute: ratio("coe-contribution", money("coeRevenue", "COE net revenue"), money("coePlan", "COE revenue plan"), 100, 1),
  },
  "Contract utilisation": {
    unit: PERCENT, target: higher(85), category: "performance", scenarios: [],
    compute: ratio("contract-utilisation", counted("usedContractedServices", "Contracted services used"), counted("contractedServices", "Contracted services available"), 100, 1),
  },
  "Procurement savings": {
    unit: PERCENT, target: higher(85), category: "performance", scenarios: [],
    compute: ratio("procurement-savings", money("procurementSavings", "Finance-validated savings"), money("procurementSavingsPlan", "Savings plan"), 100, 1),
  },
  "Inventory days / obsolete stock": {
    unit: "days", target: lower(40), category: "performance", scenarios: ["procurement-stock-risk"],
    compute: ratio("inventory-days", money("inventoryValue", "Inventory value"), money("dailyConsumption", "Average daily consumption"), 1, 1),
  },
  "Legal and compliance closure": {
    unit: PERCENT, target: higher(85), category: "legal", scenarios: ["legal-deadline"],
    compute: ratio("closure", counted("actionsClosedOnTime", "Actions closed on time"), counted("actionsDue", "Actions due"), 100, 1),
  },
  "KPI data quality": {
    unit: PERCENT, target: higher(97), category: "compliance", scenarios: [],
    compute: ratio("data-quality", counted("kpiRecordsPassed", "Records passing checks"), counted("kpiRecordsChecked", "Records checked"), 100, 1),
  },
  "Forecast accuracy": {
    unit: PERCENT, target: lower(5), category: "performance", scenarios: [],
    compute: ratio("forecast-error", money("forecastAbsoluteError", "Absolute forecast error"), money("forecastActual", "Actual net revenue"), 100, 1),
  },
};

// ---------------------------------------------------------------------------
// Entities and fact roll-ups
// ---------------------------------------------------------------------------

function demoOrganization() {
  const demo = COMPANY_MANIFEST.organizations.find((org) => org.kind === "demo");
  if (!demo) throw new Error("company manifest has no demo organization");
  return demo;
}

export function entitiesAtGrain(grain: KpiGrain): KpiEntityRef[] {
  switch (grain) {
    case "group":
      return [{ grain, slug: demoOrganization().slug }];
    case "region":
      return COMPANY_MANIFEST.regions.map((region) => ({ grain, slug: region.slug }));
    case "facility":
      return COMPANY_MANIFEST.facilities.map((facility) => ({ grain, slug: facility.slug }));
    case "coe":
      return COMPANY_MANIFEST.coes.map((coe) => ({ grain, slug: coe.slug }));
  }
}

/** Facilities whose facts make up an entity (a COE's is its host). */
export function facilitiesOf(entity: KpiEntityRef): string[] {
  switch (entity.grain) {
    case "group":
      return COMPANY_MANIFEST.facilities.map((facility) => facility.slug);
    case "region":
      return COMPANY_MANIFEST.facilities.filter((facility) => facility.regionSlug === entity.slug).map((facility) => facility.slug);
    case "facility":
      return [entity.slug];
    case "coe":
      return COMPANY_MANIFEST.coes.filter((coe) => coe.slug === entity.slug).map((coe) => coe.hostFacilitySlug);
  }
}

const NUMERIC_KEYS: readonly NumericKey[] = [
  "netRevenue", "budgetNetRevenue", "ebitda", "budgetEbitda", "collections", "collectionsPlan", "operatingCashFlow",
  "operatingCashFlowPlan", "closingReceivables", "trailingNetRevenue90", "grossBilled", "unbilledRevenue",
  "newBusinessRevenue", "newBusinessPlan", "qualifiedPipeline", "pipelineTarget", "procurementSavings",
  "procurementSavingsPlan", "inventoryValue", "dailyConsumption", "forecastAbsoluteError", "forecastActual", "staffCost",
  "coeRevenue", "coePlan", "submittedClaimValue", "deniedClaimValue",
  // Counts from here on.
  "availableBedDays", "occupiedBedDays", "eligibleReferrals", "completedReferrals", "surveyResponses",
  "positiveResponses", "indicatorsAssessed", "indicatorsMet", "seriousEvents", "auditedCases", "compliantCases",
  "claimsSubmitted", "claimsAcceptedFirstPass", "paidFte", "engagementResponses", "engagedResponses",
  "criticalHeadcount", "criticalExits", "requiredStaff", "compliantStaff", "contractedServices",
  "usedContractedServices", "actionsDue", "actionsClosedOnTime", "kpiRecordsChecked", "kpiRecordsPassed",
];

/** Integer-valued facts, which stay whole when a COE takes a share. */
const COUNT_KEYS = new Set<NumericKey>(NUMERIC_KEYS.slice(NUMERIC_KEYS.indexOf("availableBedDays")));

function sumFacts(parts: readonly OperationalFacts[], facilitySlug: string, period: string): OperationalFacts {
  const [first, ...rest] = parts;
  if (!first) throw new Error("sumFacts needs at least one facility");
  const total: OperationalFacts = { ...first, facilitySlug, period };
  for (const key of NUMERIC_KEYS) total[key] = rest.reduce((sum, part) => sum + part[key], first[key]);
  return total;
}

/** Numerator/denominator pairs whose rate a COE may differ from its host on. */
const RATE_PAIRS: readonly [NumericKey, NumericKey][] = [
  ["completedReferrals", "eligibleReferrals"],
  ["positiveResponses", "surveyResponses"],
  ["indicatorsMet", "indicatorsAssessed"],
  ["compliantCases", "auditedCases"],
  ["claimsAcceptedFirstPass", "claimsSubmitted"],
  ["engagedResponses", "engagementResponses"],
  ["compliantStaff", "requiredStaff"],
  ["usedContractedServices", "contractedServices"],
  ["actionsClosedOnTime", "actionsDue"],
];

/**
 * A COE's facts: a share of its host facility's, with its own revenue and plan
 * (the host's `coeRevenue`/`coePlan`) and its own small rate differences.
 */
function coeFacts(coeSlug: string, host: OperationalFacts): OperationalFacts {
  const share = host.coePlan > 0 && host.budgetNetRevenue > 0 ? host.coePlan / host.budgetNetRevenue : 0;
  const rng = streamFor(COMPANY_MANIFEST.seed, "coe", coeSlug, host.period);
  const facts: OperationalFacts = { ...host };
  for (const key of NUMERIC_KEYS) {
    const scaled = host[key] * share;
    facts[key] = COUNT_KEYS.has(key) ? Math.round(scaled) : scaled;
  }
  for (const [top, bottom] of RATE_PAIRS) {
    facts[top] = Math.min(facts[bottom], Math.max(0, Math.round(facts[top] * rng.jitter(0.03))));
  }
  facts.netRevenue = host.coeRevenue;
  facts.budgetNetRevenue = host.coePlan;
  facts.forecastActual = host.coeRevenue;
  facts.coeRevenue = host.coeRevenue;
  facts.coePlan = host.coePlan;
  return facts;
}

/**
 * The late-source scenario: the cash-posting feed of its facility, from its
 * onset month, arrives late and unreconciled. Only the families that read
 * that feed go missing; everything else at the facility still reports.
 */
const LATE_FEED_FAMILIES = new Set(["Collections", "DSO"]);

function lateFacilities(family: string, month: string): Set<string> {
  if (!LATE_FEED_FAMILIES.has(family)) return new Set();
  return new Set(
    COMPANY_MANIFEST.facilities
      .filter((facility) => scenarioActive("late-unreconciled-source", facility.slug, month))
      .map((facility) => facility.slug),
  );
}

/**
 * Several KPIs of one role can share a definition family (e.g. seven legal
 * closure KPIs), yet each measures its own register (contracts, filings,
 * disputes...). The first keeps the family's facts; each further one gets its
 * own deterministic rate, applied per facility before any roll-up so totals
 * remain sums. Assignments shared across roles (e.g. group EBITDA for the
 * Chairman and the CFO) are the first of their family and stay identical.
 */
const TILTED: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const tilted = new Set<string>();
  for (const assignment of ROLE_KPI_ASSIGNMENTS) {
    const key = `${assignment.roleId}|${assignment.definitionFamilies[0] ?? ""}`;
    if (seen.has(key)) tilted.add(assignment.assignmentId);
    seen.add(key);
  }
  return tilted;
})();

function tilt(facts: OperationalFacts, assignmentId: string, measure: Measure): OperationalFacts {
  if (!TILTED.has(assignmentId)) return facts;
  const level = 0.9 + 0.14 * streamFor(COMPANY_MANIFEST.seed, "tilt", assignmentId).unit();
  const monthly = streamFor(COMPANY_MANIFEST.seed, "tilt", assignmentId, facts.facilitySlug, facts.period).jitter(0.03);
  const tilted: OperationalFacts = { ...facts };
  const top = measure.numerator.key;
  const bottom = measure.denominator.key;
  const value = facts[top] * level * monthly;
  tilted[top] = COUNT_KEYS.has(top) ? Math.min(COUNT_KEYS.has(bottom) ? facts[bottom] : Infinity, Math.round(value)) : value;
  return tilted;
}

type EntityFacts =
  | { kind: "facts"; facts: OperationalFacts; excluded: string[] }
  | { kind: "late"; facilities: string[] }
  | { kind: "none" };

function factsFor(
  entity: KpiEntityRef,
  family: string,
  month: string,
  facts: readonly OperationalFacts[],
  adjust: (facts: OperationalFacts) => OperationalFacts = (row) => row,
): EntityFacts {
  const late = lateFacilities(family, month);
  const own = facilitiesOf(entity);
  const lateHere = own.filter((slug) => late.has(slug));
  if ((entity.grain === "coe" || entity.grain === "facility") && lateHere.length > 0) {
    return { kind: "late", facilities: lateHere };
  }
  if (entity.grain === "coe") {
    const coe = COMPANY_MANIFEST.coes.find((row) => row.slug === entity.slug);
    const host = facts.find((row) => row.period === month && row.facilitySlug === coe?.hostFacilitySlug);
    return coe && host ? { kind: "facts", facts: adjust(coeFacts(coe.slug, host)), excluded: [] } : { kind: "none" };
  }
  const included = new Set(own.filter((slug) => !late.has(slug)));
  const parts = facts.filter((row) => row.period === month && included.has(row.facilitySlug)).map(adjust);
  return parts.length === 0 ? { kind: "none" } : { kind: "facts", facts: sumFacts(parts, entity.slug, month), excluded: lateHere };
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  /** ISO timestamp of the simulated refresh (PRD FR-02). */
  refreshedAt: string;
}

type ManifestScenario = (typeof COMPANY_MANIFEST.scenarios)[number];

/** Manifest scenarios in effect for any facility of an entity in a month. */
export function scenariosFor(entity: KpiEntityRef, month: string): ManifestScenario[] {
  const own = facilitiesOf(entity);
  return COMPANY_MANIFEST.scenarios.filter((scenario) => own.some((slug) => scenarioActive(scenario.slug, slug, month)));
}

function facilityName(slug: string): string {
  return COMPANY_MANIFEST.facilities.find((facility) => facility.slug === slug)?.name ?? slug;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (mon ?? 1) - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function currentQuality(refreshedAt: string): KpiDataQuality {
  return { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt, limitations: [] };
}

function lateNote(facilities: readonly string[], month: string): string {
  return `${facilities.map(facilityName).join(", ")} cash-posting data for ${monthLabel(month)} arrived late and is not yet reconciled (demo scenario).`;
}

/** Every observation for every assignment, at its base and breakdown grains, deterministically ordered. */
export function deriveAllObservations(
  options: DeriveOptions,
  facts: readonly OperationalFacts[] = generateAllOperationalFacts(),
): KpiObservation[] {
  const entitlements = deriveEntitlements();
  const months = [...new Set(facts.map((row) => row.period))].toSorted();
  const rows: KpiObservation[] = [];

  for (const assignment of ROLE_KPI_ASSIGNMENTS) {
    const entitlement = entitlements.find((row) => row.assignmentId === assignment.assignmentId);
    const [primary, ...others] = assignment.definitionFamilies;
    const spec = primary ? FAMILY_SPECS[primary] : undefined;
    if (!entitlement || !primary || !spec) {
      throw new Error(`assignment ${assignment.assignmentId} has no entitlement or family spec`);
    }
    const grains = [...new Set<KpiGrain>([...entitlement.grains, ...entitlement.breakdowns])];

    for (const grain of grains) {
      for (const entity of entitiesAtGrain(grain)) {
        for (const month of months) {
          const found = factsFor(entity, primary, month, facts, (row) => tilt(row, assignment.assignmentId, spec.compute));
          if (found.kind === "none") continue;
          const base = {
            observationKey: `obs:${assignment.assignmentId}:${entity.grain}:${entity.slug}:${month}`,
            assignmentId: assignment.assignmentId,
            definitionFamily: primary,
            definitionVersion: FRAMEWORK_MANIFEST.definitionVersion,
            entity,
            month,
            unit: spec.unit,
            target: spec.target,
          };
          if (found.kind === "late") {
            rows.push({
              ...base,
              value: { status: "missing", reason: "not_reported" },
              components: [],
              dataQuality: {
                ...currentQuality(options.refreshedAt),
                reconciliation: "unreconciled",
                freshness: "late",
                limitations: [lateNote(found.facilities, month)],
              },
            });
            continue;
          }
          const headline = spec.compute(found.facts);
          const bundled = others.map((family): KpiComponent => {
            const other = FAMILY_SPECS[family];
            if (!other) throw new Error(`no family spec for ${family}`);
            const otherFacts = factsFor(entity, family, month, facts);
            const value: KpiValue =
              otherFacts.kind === "facts" ? other.compute(otherFacts.facts).value : { status: "missing", reason: "not_reported" };
            return { componentId: `family:${family}`, label: family, role: "measure", unit: other.unit, value };
          });
          rows.push({
            ...base,
            value: headline.value,
            components: [...headline.components, ...bundled],
            dataQuality:
              found.excluded.length === 0
                ? currentQuality(options.refreshedAt)
                : {
                    ...currentQuality(options.refreshedAt),
                    reconciliation: "unreconciled",
                    freshness: "late",
                    limitations: [
                      `Excludes ${found.excluded.map(facilityName).join(", ")}, whose cash-posting data for ${monthLabel(month)} arrived late and is not yet reconciled (demo scenario).`,
                    ],
                  },
          });
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Brief: seeded exceptions and on-track items
// ---------------------------------------------------------------------------

export interface KpiException {
  exceptionKey: string;
  assignmentId: string;
  ownerRole: string;
  entity: KpiEntityRef;
  month: string;
  priority: "act_now" | "monitor";
  category: Category;
  comparisonBasis: "target" | "prior_period";
  scenarioLabel: string;
  whatChanged: string;
  whyItMatters: string;
  evidenceKeys: string[];
}

export interface KpiOnTrack {
  itemKey: string;
  assignmentId: string;
  entity: KpiEntityRef;
  month: string;
  summary: string;
  evidenceKeys: string[];
}

export const GENERIC_SCENARIO_LABEL =
  "Demo scenario: outside the demo target in the latest month (seeded from the illustrative dataset, not a reviewed rule)";

export function formatValue(value: number, unit: string): string {
  return unit === PERCENT ? `${value}%` : `${value} ${unit}`;
}

function targetText(target: KpiTarget, unit: string): string {
  if (target.state === "configured_range") return `the demo range of ${formatValue(target.low, unit)} to ${formatValue(target.high, unit)}`;
  if (target.state === "configured") {
    return `the demo target of ${target.direction === "higher_is_better" ? "at least" : "at most"} ${formatValue(target.value, unit)}`;
  }
  return "no configured target";
}

/** How far outside its target a value is, as a share of the target; 0 when on target or with no target. */
export function shortfall(value: number, target: KpiTarget): number {
  if (target.state === "not_configured") return 0;
  if (target.state === "configured_range") {
    if (value < target.low) return (target.low - value) / target.low;
    if (value > target.high) return (value - target.high) / target.high;
    return 0;
  }
  const gap = target.direction === "higher_is_better" ? target.value - value : value - target.value;
  return gap > 0 ? gap / Math.max(Math.abs(target.value), Number.EPSILON) : 0;
}

function baseGrainsOf(assignmentId: string): readonly string[] {
  return deriveEntitlements().find((entry) => entry.assignmentId === assignmentId)?.grains ?? [];
}

function scenarioLabel(scenario: ManifestScenario): string {
  const where = scenario.grain === "group" ? "across the group" : `at ${facilityName(scenario.entitySlug)}`;
  return `Demo scenario: ${scenario.title.toLowerCase()} ${where}, from ${monthLabel(scenario.onsetMonth)} (seeded, not a reviewed rule)`;
}

/** The month before a scenario's onset: the comparison point for a prior-period exception. */
function monthBefore(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (mon ?? 1) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface Candidate {
  row: KpiObservation;
  gap: number;
  basis: "target" | "prior_period";
  text: string;
  evidence: string[];
  scenario: ManifestScenario | undefined;
}

/**
 * Seeded exceptions (PRD FR-03 "a deliberately seeded scenario labelled as
 * such"), latest month, at each assignment's base grain:
 * - a KPI with a demo target that falls outside it; a named scenario labels
 *   the item when one moves that family at that entity;
 * - a KPI with no target (clinical families) only when a named scenario moves
 *   it, compared with the month before the scenario began, and only if worse.
 * Priority: safety items and the furthest-off item per KPI are "act now"; the
 * rest "monitor". Text states observed figures only, never causes.
 */
export function deriveAllExceptions(rows: readonly KpiObservation[]): KpiException[] {
  const months = [...new Set(rows.map((row) => row.month))].toSorted();
  const latest = months.at(-1);
  const prior = months.at(-2);
  if (!latest) return [];
  const byKey = new Map(rows.map((row) => [row.observationKey, row]));
  const keyOf = (row: KpiObservation, month: string) => `obs:${row.assignmentId}:${row.entity.grain}:${row.entity.slug}:${month}`;
  const exceptions: KpiException[] = [];

  for (const assignment of ROLE_KPI_ASSIGNMENTS) {
    const spec = FAMILY_SPECS[assignment.definitionFamilies[0] ?? ""];
    if (!spec) continue;
    const base = baseGrainsOf(assignment.assignmentId);
    const candidates: Candidate[] = [];

    for (const row of rows) {
      if (row.assignmentId !== assignment.assignmentId || row.month !== latest || !base.includes(row.entity.grain)) continue;
      if (row.value.status !== "available") continue;
      const scenario = scenariosFor(row.entity, latest).find((candidate) => spec.scenarios.includes(candidate.slug));
      const now = `${assignment.kpi} was ${formatValue(row.value.value, row.unit)} in ${monthLabel(latest)}`;

      if (row.target.state !== "not_configured") {
        const gap = shortfall(row.value.value, row.target);
        if (gap <= 0) continue;
        const priorRow = prior ? byKey.get(keyOf(row, prior)) : undefined;
        const priorText =
          priorRow && prior && priorRow.value.status === "available"
            ? ` It was ${formatValue(priorRow.value.value, row.unit)} in ${monthLabel(prior)}.`
            : "";
        candidates.push({
          row,
          gap,
          basis: "target",
          scenario,
          text: `${now}, outside ${targetText(row.target, row.unit)}.${priorText}`,
          evidence: priorRow ? [row.observationKey, priorRow.observationKey] : [row.observationKey],
        });
        continue;
      }
      if (!scenario) continue;
      const before = monthBefore(scenario.onsetMonth);
      const beforeRow = byKey.get(keyOf(row, before));
      if (!beforeRow || beforeRow.value.status !== "available" || row.value.value >= beforeRow.value.value) continue;
      candidates.push({
        row,
        gap: (beforeRow.value.value - row.value.value) / Math.max(beforeRow.value.value, Number.EPSILON),
        basis: "prior_period",
        scenario,
        text: `${now}, against ${formatValue(beforeRow.value.value, row.unit)} in ${monthLabel(before)} before the demo scenario began. No clinical threshold is applied.`,
        evidence: [row.observationKey, beforeRow.observationKey],
      });
    }

    const worst = Math.max(0, ...candidates.map((entry) => entry.gap));
    for (const entry of candidates) {
      exceptions.push({
        exceptionKey: `exc:${assignment.assignmentId}:${entry.row.entity.grain}:${entry.row.entity.slug}:${latest}`,
        assignmentId: assignment.assignmentId,
        ownerRole: assignment.roleId,
        entity: entry.row.entity,
        month: latest,
        priority: spec.category === "safety" || entry.gap === worst ? "act_now" : "monitor",
        category: spec.category,
        comparisonBasis: entry.basis,
        scenarioLabel: entry.scenario ? scenarioLabel(entry.scenario) : GENERIC_SCENARIO_LABEL,
        whatChanged: entry.text,
        whyItMatters:
          `This KPI carries ${Math.round(assignment.weight * 100)}% of the ${assignment.role} scorecard weight in the KPI framework.` +
          (spec.category === "safety" ? " Safety items stay visible regardless of weighted performance." : ""),
        evidenceKeys: entry.evidence,
      });
    }
  }
  return exceptions;
}

/** The mirror of `deriveAllExceptions` for targeted KPIs: base-grain KPIs meeting their demo target in the latest month. */
export function deriveAllOnTrack(rows: readonly KpiObservation[]): KpiOnTrack[] {
  const latest = [...new Set(rows.map((row) => row.month))].toSorted().at(-1);
  if (!latest) return [];
  const items: KpiOnTrack[] = [];
  for (const assignment of ROLE_KPI_ASSIGNMENTS) {
    const base = baseGrainsOf(assignment.assignmentId);
    for (const row of rows) {
      if (row.assignmentId !== assignment.assignmentId || row.month !== latest || !base.includes(row.entity.grain)) continue;
      if (row.value.status !== "available" || row.target.state === "not_configured") continue;
      if (row.dataQuality.reconciliation !== "reconciled") continue;
      if (shortfall(row.value.value, row.target) > 0) continue;
      items.push({
        itemKey: `ok:${assignment.assignmentId}:${row.entity.grain}:${row.entity.slug}:${latest}`,
        assignmentId: assignment.assignmentId,
        entity: row.entity,
        month: latest,
        summary: `${assignment.kpi} was ${formatValue(row.value.value, row.unit)} in ${monthLabel(latest)}, within ${targetText(row.target, row.unit)}.`,
        evidenceKeys: [row.observationKey],
      });
    }
  }
  return items;
}

/** Data limitations for the brief: one per assignment whose latest data is late or unreconciled. */
export function deriveLimitations(rows: readonly KpiObservation[]): { assignmentId: string; issue: "late"; detail: string }[] {
  const latest = [...new Set(rows.map((row) => row.month))].toSorted().at(-1);
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.month !== latest || row.dataQuality.freshness !== "late") continue;
    const detail = row.dataQuality.limitations[0];
    if (detail && !seen.has(row.assignmentId)) seen.set(row.assignmentId, detail);
  }
  return [...seen].map(([assignmentId, detail]) => ({ assignmentId, issue: "late", detail }));
}
