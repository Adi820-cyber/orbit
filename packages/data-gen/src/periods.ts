/**
 * Period parsing and arithmetic for `YYYY-MM` reporting months.
 *
 * Extracted from `index.ts` so fact generators can import it without depending
 * on the package entrypoint, which imports them — a cycle that would otherwise
 * make module initialisation order significant.
 */

/** A calendar month, parsed from a `YYYY-MM` string. */
export interface YearMonth {
  year: number;
  /** 1-12. */
  month: number;
}

/**
 * Parses a `YYYY-MM` period string, rejecting anything else.
 *
 * Replaces an earlier `.split("-").map(Number) as [number, number]`, which
 * asserted a tuple shape nothing had checked: a malformed string such as
 * "2024" or "2024-09-01" would have destructured to `undefined` and produced
 * NaN arithmetic silently, in the code that defines every reporting period in
 * the dataset. Flagged by oxlint's `typescript/no-unsafe-type-assertion`.
 */
export function parseMonth(value: string): YearMonth {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  const yearPart = match?.[1];
  const monthPart = match?.[2];
  if (yearPart === undefined || monthPart === undefined) {
    throw new Error(`Invalid period "${value}". Expected YYYY-MM with month 01-12.`);
  }
  return { year: Number(yearPart), month: Number(monthPart) };
}

/**
 * Absolute month ordinal, for comparing or differencing two periods without
 * date arithmetic. Only meaningful relative to another value from this
 * function.
 */
export function monthOrdinal(value: string): number {
  const { year, month } = parseMonth(value);
  return year * 12 + month;
}

/**
 * The `YYYY-MM` period `offset` months after `from`. Negative offsets go back.
 *
 * The month is derived by subtracting the borrowed years rather than with
 * `zeroBased % 12`. JavaScript's `%` is remainder, not modulo, so it stays
 * negative for negative operands while `Math.floor` has already borrowed the
 * year — which produced strings like `2024--9` for `periodAtOffset("2025-03",
 * -12)`. That is exactly the call a year-on-year or trailing-twelve-month
 * comparison makes, and the malformed value was returned silently: `parseMonth`
 * would reject it, but nothing re-parses on the way out, so it would have
 * reached an observation row and surfaced only as a gap in a chart.
 */
export function periodAtOffset(from: string, offset: number): string {
  if (!Number.isInteger(offset)) {
    throw new Error(`periodAtOffset requires an integer offset, got ${offset}.`);
  }
  const { year, month } = parseMonth(from);
  const zeroBased = month - 1 + offset;
  const yearsBorrowed = Math.floor(zeroBased / 12);
  const y = year + yearsBorrowed;
  const m = zeroBased - yearsBorrowed * 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Every `YYYY-MM` period from `firstMonth` for `count` months, ascending.
 *
 * The one place a period *range* is produced, so a range and its members
 * cannot disagree.
 */
export function periodRange(firstMonth: string, count: number): readonly string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`periodRange requires a non-negative integer count, got ${count}.`);
  }
  return Array.from({ length: count }, (_, i) => periodAtOffset(firstMonth, i));
}
