import { describe, expect, it } from "vitest";
import { generateAllFinancialFacts } from "../facts/financial.ts";
import { COMPANY_MANIFEST } from "../manifest.ts";
import { deriveFinancialObservations, FINANCIAL_ASSIGNMENTS, percentOfBudget } from "../observations.ts";

const facts = generateAllFinancialFacts();
const rows = deriveFinancialObservations(facts);

describe("derived financial observations", () => {
  it("covers the seven vs-budget assignments at their base and breakdown grains, every month", () => {
    const months = new Set(facts.map((fact) => fact.period)).size;
    // chairman ×2 and group-cfo: group + 2 regions; regional-coo ×2: 2 regions + 6 facilities; hospital-dho ×2: 6 facilities.
    expect(rows).toHaveLength((3 + 3 + 3 + 8 + 8 + 6 + 6) * months);
    expect(new Set(rows.map((row) => row.assignmentId))).toEqual(new Set(Object.keys(FINANCIAL_ASSIGNMENTS)));
  });

  it("gives every observation a unique, stable key", () => {
    expect(new Set(rows.map((row) => row.observationKey)).size).toBe(rows.length);
    expect(deriveFinancialObservations(facts)).toEqual(rows);
  });

  it("rolls a region up from summed numerator and denominator, never averaged percentages (PRD §7.7)", () => {
    const month = facts[0]?.period ?? "";
    const northFacilities = COMPANY_MANIFEST.facilities.filter((facility) => facility.regionSlug === "north").map((facility) => facility.slug);
    const parts = facts.filter((fact) => fact.period === month && northFacilities.includes(fact.facilitySlug));
    const actual = parts.reduce((sum, fact) => sum + fact.netRevenue, 0);
    const budget = parts.reduce((sum, fact) => sum + fact.budgetNetRevenue, 0);
    const north = rows.find((row) => row.observationKey === `obs:regional-coo:regional-net-revenue-vs-approved-budget:region:north:${month}`);
    expect(north?.components.map((component) => component.value)).toEqual([
      { status: "available", value: actual / 100 },
      { status: "available", value: budget / 100 },
    ]);
    expect(north?.value).toEqual(percentOfBudget(actual, budget));
  });

  it("keeps a zero or negative budget distinct from a number (PRD §7.9)", () => {
    expect(percentOfBudget(10, 0)).toEqual({ status: "not_applicable", reason: "zero_denominator" });
    expect(percentOfBudget(10, -5)).toEqual({ status: "not_applicable", reason: "invalid_denominator" });
    expect(percentOfBudget(987, 1000)).toEqual({ status: "available", value: 98.7 });
  });

  it("never derives a target: the budget is the denominator, not a target", () => {
    expect(JSON.stringify(rows)).not.toContain('"target"');
  });
});
