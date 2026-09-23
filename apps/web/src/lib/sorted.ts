/** A sorted copy; `Array#toSorted` needs the ES2023 lib, which the pinned tsconfig.base.json does not include. */
export function sorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy, never the caller's array
  return [...items].sort(compare);
}
