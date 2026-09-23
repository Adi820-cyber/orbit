import { describe, expect, it } from "vitest";
import { monthOrdinal, parseMonth, periodAtOffset, periodRange } from "../periods.ts";
import {
  monthOrdinal as monthOrdinalFromIndex,
  parseMonth as parseMonthFromIndex,
  periodAtOffset as periodAtOffsetFromIndex,
  monthlyPeriods,
} from "../index.ts";
import { COMPANY_MANIFEST as M } from "../manifest.ts";

/**
 * Period arithmetic is load-bearing for every fact, observation and trend in
 * the dataset, and its failure mode is silent: a malformed period string is
 * produced without error and only shows up much later as a missing point on a
 * chart. So these tests assert on the produced strings directly rather than on
 * round-trip behaviour.
 */
describe("periodAtOffset", () => {
  it("moves forward within a year", () => {
    expect(periodAtOffset("2025-03", 0)).toBe("2025-03");
    expect(periodAtOffset("2025-03", 1)).toBe("2025-04");
    expect(periodAtOffset("2025-01", 11)).toBe("2025-12");
  });

  it("moves forward across year boundaries", () => {
    expect(periodAtOffset("2025-12", 1)).toBe("2026-01");
    expect(periodAtOffset("2025-03", 12)).toBe("2026-03");
    expect(periodAtOffset("2024-09", 23)).toBe("2026-08");
  });

  /**
   * Regression. The original implementation derived the month with
   * `zeroBased % 12`, and JavaScript's `%` is remainder rather than modulo, so
   * it stayed negative while `Math.floor` had already borrowed the year.
   * `periodAtOffset("2025-03", -3)` returned "2024-00" and `-12` returned
   * "2024--9". Forward offsets were unaffected, which is why the original test
   * suite was green.
   */
  it("moves backward across year boundaries", () => {
    expect(periodAtOffset("2025-03", -1)).toBe("2025-02");
    expect(periodAtOffset("2025-03", -2)).toBe("2025-01");
    expect(periodAtOffset("2025-03", -3)).toBe("2024-12");
    expect(periodAtOffset("2025-03", -12)).toBe("2024-03");
    expect(periodAtOffset("2025-03", -13)).toBe("2024-02");
    expect(periodAtOffset("2025-01", -1)).toBe("2024-12");
    expect(periodAtOffset("2025-01", -25)).toBe("2022-12");
  });

  /**
   * The specific call a year-on-year or trailing-twelve-month comparison makes.
   * Checked across every month of the manifest range, because the broken
   * version only failed for the months where the offset crossed January.
   */
  it("produces a valid, parseable period for every offset the KPI layer will use", () => {
    const offsets = [-24, -13, -12, -11, -6, -3, -1, 0, 1, 3, 6, 11, 12, 13, 24];
    for (const period of monthlyPeriods()) {
      for (const offset of offsets) {
        const shifted = periodAtOffset(period, offset);
        expect(() => parseMonth(shifted), `${period} ${offset} -> ${shifted}`).not.toThrow();
        expect(monthOrdinal(shifted) - monthOrdinal(period), `${period} ${offset}`).toBe(offset);
      }
    }
  });

  it("is its own inverse", () => {
    for (const offset of [-24, -13, -1, 0, 1, 13, 24]) {
      expect(periodAtOffset(periodAtOffset("2025-07", offset), -offset)).toBe("2025-07");
    }
  });

  it("rejects a non-integer offset rather than producing a fractional month", () => {
    expect(() => periodAtOffset("2025-03", 1.5)).toThrow();
    expect(() => periodAtOffset("2025-03", Number.NaN)).toThrow();
  });

  it("rejects a malformed starting period", () => {
    expect(() => periodAtOffset("2024-00", 1)).toThrow();
    expect(() => periodAtOffset("2024--9", 1)).toThrow();
  });
});

describe("periodRange", () => {
  it("returns count ascending, gap-free periods starting at firstMonth", () => {
    expect(periodRange("2024-11", 4)).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });

  it("returns nothing for a zero-length range", () => {
    expect(periodRange("2025-01", 0)).toEqual([]);
  });

  it("rejects a negative or fractional count", () => {
    expect(() => periodRange("2025-01", -1)).toThrow();
    expect(() => periodRange("2025-01", 2.5)).toThrow();
  });
});

describe("monthlyPeriods", () => {
  it("spans the manifest range exactly, inclusive of both bounds", () => {
    const periods = monthlyPeriods();
    expect(periods).toHaveLength(M.periods.monthCount);
    expect(periods[0]).toBe(M.periods.firstMonth);
    expect(periods.at(-1)).toBe(M.periods.lastMonth);
  });
});

/**
 * `index.ts` re-exports these rather than holding its own copies. It previously
 * carried byte-identical duplicates of `parseMonth` and `monthOrdinal`, tested
 * by a separate suite, so a fix to one copy left the other wrong and green.
 * Identity — not equivalence — is what rules that out.
 */
describe("public entrypoint", () => {
  it("re-exports the single period implementation rather than a copy", () => {
    expect(parseMonthFromIndex).toBe(parseMonth);
    expect(monthOrdinalFromIndex).toBe(monthOrdinal);
    expect(periodAtOffsetFromIndex).toBe(periodAtOffset);
  });
});
