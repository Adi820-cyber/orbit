import { describe, expect, it } from "vitest";
import { COMPANY_MANIFEST as M } from "../manifest.ts";
import { monthOrdinal, periodAtOffset } from "../periods.ts";
import {
  generateAllFinancialFacts,
  generateFinancialFacts,
  type FinancialFact,
} from "../facts/financial.ts";

/**
 * Reconciliation invariants for the financial fact generator. These guard the
 * property the module's own header claims: derived totals are *defined* as
 * the arithmetic of their parts, so a mismatch here means the model changed,
 * not that rounding drifted. If one of these fails, investigate the model
 * rather than loosening the assertion.
 */

const FIRST_FACILITY = M.facilities[0]!.slug;

describe("reconciliation (exact, not approximate)", () => {
  const facts = generateFinancialFacts(FIRST_FACILITY);

  it("generates one fact per period in the manifest range", () => {
    expect(facts).toHaveLength(M.periods.monthCount);
  });

  it("defines netRevenue as gross less the three deductions", () => {
    for (const f of facts) {
      expect(f.netRevenue, f.period).toBe(
        f.grossBilled - f.discounts - f.contractualAdjustments - f.otherDeductions,
      );
    }
  });

  it("defines totalOperatingCost as the sum of the three cost lines", () => {
    for (const f of facts) {
      expect(f.totalOperatingCost, f.period).toBe(
        f.staffCost + f.consumableCost + f.otherOperatingCost,
      );
    }
  });

  it("defines ebitda as netRevenue less totalOperatingCost", () => {
    for (const f of facts) {
      expect(f.ebitda, f.period).toBe(f.netRevenue - f.totalOperatingCost);
    }
  });

  it("defines closingReceivables as opening plus net revenue less collections and write-offs", () => {
    for (const f of facts) {
      expect(f.closingReceivables, f.period).toBe(
        f.openingReceivables + f.netRevenue - f.collections - f.writeOffs,
      );
    }
  });

  it("sums the four aging buckets to exactly closingReceivables", () => {
    for (const f of facts) {
      const { current, days31to60, days61to90, over90 } = f.aging;
      expect(current + days31to60 + days61to90 + over90, f.period).toBe(f.closingReceivables);
    }
  });

  it("carries closing receivables forward as the next period's opening", () => {
    for (let i = 1; i < facts.length; i++) {
      expect(facts[i]!.openingReceivables, facts[i]!.period).toBe(facts[i - 1]!.closingReceivables);
    }
  });

  it("never lets collections exceed what is actually collectable", () => {
    for (const f of facts) {
      const collectable = f.openingReceivables + f.netRevenue;
      expect(f.collections, f.period).toBeLessThanOrEqual(collectable);
      expect(f.collections + f.writeOffs, f.period).toBeLessThanOrEqual(collectable);
    }
  });

  it("keeps every amount a whole minor-unit integer", () => {
    for (const f of facts) {
      const amounts: number[] = [
        f.grossBilled,
        f.discounts,
        f.contractualAdjustments,
        f.otherDeductions,
        f.netRevenue,
        f.staffCost,
        f.consumableCost,
        f.otherOperatingCost,
        f.totalOperatingCost,
        f.ebitda,
        f.budgetNetRevenue,
        f.budgetEbitda,
        f.openingReceivables,
        f.collections,
        f.writeOffs,
        f.closingReceivables,
        f.aging.current,
        f.aging.days31to60,
        f.aging.days61to90,
        f.aging.over90,
      ];
      for (const amount of amounts) expect(Number.isInteger(amount), f.period).toBe(true);
    }
  });

  it("produces periods in ascending, gap-free order matching the manifest range", () => {
    const expected = Array.from({ length: M.periods.monthCount }, (_, i) =>
      periodAtOffset(M.periods.firstMonth, i),
    );
    expect(facts.map((f) => f.period)).toEqual(expected);
    for (let i = 1; i < facts.length; i++) {
      expect(monthOrdinal(facts[i]!.period)).toBe(monthOrdinal(facts[i - 1]!.period) + 1);
    }
  });
});

describe("budget figures", () => {
  it("does not move with a scenario's revenue or cost modifiers", () => {
    const baseline = generateFinancialFacts(FIRST_FACILITY);
    const scaled = generateFinancialFacts(FIRST_FACILITY, () => ({
      revenueMultiplier: 1.5,
      costMultiplier: 1.3,
    }));

    for (let i = 0; i < baseline.length; i++) {
      expect(scaled[i]!.budgetNetRevenue, baseline[i]!.period).toBe(baseline[i]!.budgetNetRevenue);
      expect(scaled[i]!.budgetEbitda, baseline[i]!.period).toBe(baseline[i]!.budgetEbitda);
    }
  });
});

describe("scenario modifiers", () => {
  it("raises gross billed when revenueMultiplier is applied", () => {
    const baseline = generateFinancialFacts(FIRST_FACILITY);
    const boosted = generateFinancialFacts(FIRST_FACILITY, () => ({ revenueMultiplier: 2 }));
    for (let i = 0; i < baseline.length; i++) {
      expect(boosted[i]!.grossBilled).toBeGreaterThan(baseline[i]!.grossBilled);
    }
  });

  it("still reconciles exactly under an overlay", () => {
    const facts = generateFinancialFacts(FIRST_FACILITY, (period) => ({
      revenueMultiplier: 1.4,
      costMultiplier: 1.2,
      collectionMultiplier: 0.8,
      overdueSkew: period >= "2025-06" ? 0.7 : 0,
    }));
    for (const f of facts) {
      expect(f.netRevenue, f.period).toBe(
        f.grossBilled - f.discounts - f.contractualAdjustments - f.otherDeductions,
      );
      expect(f.ebitda, f.period).toBe(f.netRevenue - (f.staffCost + f.consumableCost + f.otherOperatingCost));
      const { current, days31to60, days61to90, over90 } = f.aging;
      expect(current + days31to60 + days61to90 + over90, f.period).toBe(f.closingReceivables);
    }
  });
});

describe("determinism", () => {
  it("reproduces an identical snapshot for the same facility", () => {
    expect(generateFinancialFacts(FIRST_FACILITY)).toEqual(generateFinancialFacts(FIRST_FACILITY));
  });

  it("gives different facilities different facts", () => {
    const [a, b] = M.facilities;
    const factsA = generateFinancialFacts(a!.slug);
    const factsB = generateFinancialFacts(b!.slug);
    expect(factsA[0]!.grossBilled).not.toBe(factsB[0]!.grossBilled);
  });
});

describe("input validation", () => {
  it("rejects an unknown facility slug", () => {
    expect(() => generateFinancialFacts("not-a-real-facility")).toThrow(/Unknown facility/);
  });
});

describe("generateAllFinancialFacts", () => {
  const all = generateAllFinancialFacts();

  it("covers every manifest facility, in manifest order", () => {
    expect(all).toHaveLength(M.facilities.length * M.periods.monthCount);
    const firstSlugPerFacility: string[] = [];
    for (const f of all) {
      if (!firstSlugPerFacility.includes(f.facilitySlug)) firstSlugPerFacility.push(f.facilitySlug);
    }
    expect(firstSlugPerFacility).toEqual(M.facilities.map((f) => f.slug));
  });

  it("matches per-facility generation exactly", () => {
    for (const facility of M.facilities) {
      const solo = generateFinancialFacts(facility.slug);
      const fromAll = all.filter((f) => f.facilitySlug === facility.slug);
      expect(fromAll).toEqual(solo satisfies readonly FinancialFact[]);
    }
  });

  it("routes per-facility modifiers to the right facility", () => {
    const [a, b] = M.facilities;
    const boosted = generateAllFinancialFacts((slug) => (slug === a!.slug ? { revenueMultiplier: 3 } : {}));
    const aFirst = boosted.find((f) => f.facilitySlug === a!.slug);
    const bFacts = boosted.filter((f) => f.facilitySlug === b!.slug);
    const bBaseline = generateFinancialFacts(b!.slug);

    expect(aFirst!.grossBilled).toBeGreaterThan(generateFinancialFacts(a!.slug)[0]!.grossBilled);
    expect(bFacts).toEqual(bBaseline);
  });
});
