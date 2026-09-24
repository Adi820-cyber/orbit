/**
 * Public API of `@orbit/data-gen`.
 *
 * Owns the fictional-company manifest and (once built) the deterministic
 * generator that derives synthetic facts from it, per PRD §8 and
 * TEAM_ASSIGNMENTS.md §5.
 *
 * The generator itself is not implemented yet. The manifest is published first
 * because the schema migrations and RLS fixtures need the organization shape
 * (regions, facilities, COEs, tenants) to exist as a reviewed artifact before
 * tables are written against it.
 */

export type {
  Slug,
  CurrencyCode,
  Grain,
  OrganizationManifest,
  RegionManifest,
  FacilityManifest,
  CoeManifest,
  FiscalCalendarManifest,
  PeriodRangeManifest,
  ScaleManifest,
  ScenarioManifest,
  CompanyManifest,
} from "./manifest-types.ts";

export { COMPANY_MANIFEST } from "./manifest.ts";

import { COMPANY_MANIFEST } from "./manifest.ts";
import type { FacilityManifest, RegionManifest } from "./manifest-types.ts";
import { periodRange } from "./periods.ts";

/** The primary demonstration organization. */
export const DEMO_ORGANIZATION = COMPANY_MANIFEST.organizations.find((o) => o.kind === "demo")!;

/** Facilities belonging to one region, in manifest order. */
export function facilitiesInRegion(regionSlug: string): readonly FacilityManifest[] {
  return COMPANY_MANIFEST.facilities.filter((f) => f.regionSlug === regionSlug);
}

/** Look up a region by slug. */
export function getRegion(regionSlug: string): RegionManifest | undefined {
  return COMPANY_MANIFEST.regions.find((r) => r.slug === regionSlug);
}

/** Look up a facility by slug. */
export function getFacility(facilitySlug: string): FacilityManifest | undefined {
  return COMPANY_MANIFEST.facilities.find((f) => f.slug === facilitySlug);
}

/**
 * Period arithmetic lives in `./periods.ts` and is re-exported here so callers
 * have one entrypoint. It is deliberately NOT reimplemented: this file
 * previously carried its own byte-identical copies of `parseMonth` and
 * `monthOrdinal`, and inlined the month-offset arithmetic a third time inside
 * `monthlyPeriods`. Two copies with two passing test suites is how a fix lands
 * in one of them and the other silently keeps the bug.
 */
export type { YearMonth } from "./periods.ts";
export { parseMonth, monthOrdinal, periodAtOffset, periodRange } from "./periods.ts";

/**
 * Every monthly period in the dataset range as `YYYY-MM`, ascending.
 * Derived from the manifest rather than stored, so the range and the period
 * list cannot disagree.
 */
export function monthlyPeriods(): readonly string[] {
  return periodRange(COMPANY_MANIFEST.periods.firstMonth, COMPANY_MANIFEST.periods.monthCount);
}
