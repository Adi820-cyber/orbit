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

/** The `YYYY-MM` period `offset` months after `from`. */
export function periodAtOffset(from: string, offset: number): string {
  const { year, month } = parseMonth(from);
  const zeroBased = month - 1 + offset;
  const y = year + Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
