/**
 * Types for the Orbit fictional-company manifest.
 *
 * The manifest is the single reviewed place where every invented fact about
 * the demonstration company lives: names, structure, currency, calendar,
 * timezone, scale anchors, and scenario dates (PRD §8.1, §8.4).
 *
 * Nothing here is an Africare fact, a client fact, or a real operating
 * number. Every value is a deliberate demo-only choice, and the generator
 * derives observations from these anchors rather than hardcoding
 * realistic-looking values elsewhere (RULES.md).
 */

/** Stable slug used as a database key and in generated ids. */
export type Slug = string;

/** Reporting currency for the fictional group. ISO 4217 code. */
export type CurrencyCode = string;

/**
 * Which grain an entity sits at. Mirrors `GrainSchema` in `@orbit/contracts`
 * so membership scopes and entitlements line up with the org model.
 */
export type Grain = "group" | "region" | "facility" | "coe" | "segment";

/** The fictional group itself. */
export interface OrganizationManifest {
  slug: Slug;
  /** Display name. Clearly fictional; see `docs/` note in the manifest module. */
  name: string;
  /**
   * Marks this organization as the primary demo tenant or a test-only tenant
   * used to prove cross-organization isolation (PRD §8.1, §8.3).
   */
  kind: "demo" | "test-fixture";
}

/** One of the two regions. */
export interface RegionManifest {
  slug: Slug;
  name: string;
  /** Short label used in role account naming, e.g. "North". */
  shortName: string;
}

/** One of the six hospitals. */
export interface FacilityManifest {
  slug: Slug;
  name: string;
  /** Region this facility reports into. */
  regionSlug: Slug;
  /**
   * Staffed-bed capacity anchor. The generator derives capacity utilisation
   * from staffed bed days built on this number; it is not itself an observation.
   * Illustrative only.
   */
  staffedBeds: number;
  /**
   * Relative revenue weight within the group, used to distribute group-level
   * financial anchors across facilities. Weights across all facilities sum to 1.
   */
  revenueWeight: number;
}

/**
 * A centre of excellence. The workbook says COE deployment is "As approved by
 * COE plan" and fixes no count, so this structure is a configuration choice
 * (PRD §4, item 8: "The demo COE structure is a configuration choice, not a
 * client fact").
 */
export interface CoeManifest {
  slug: Slug;
  name: string;
  /** Facility that physically hosts the COE. */
  hostFacilitySlug: Slug;
  /**
   * The grain this COE's performance is reported at. A region-scoped COE is
   * visible to that region; a group-scoped one spans both regions. Having both
   * kinds is deliberate — it exercises different entitlement grains.
   */
  reportingGrain: Extract<Grain, "region" | "group">;
  /** Region slug when `reportingGrain` is "region"; null when group-wide. */
  regionSlug: Slug | null;
}

/** Fiscal calendar definition. */
export interface FiscalCalendarManifest {
  /** 1-12. The month the fiscal year opens. */
  startMonth: number;
  /** Human-readable description of the convention, for disclosure surfaces. */
  description: string;
}

/** The inclusive range of complete monthly periods the dataset covers. */
export interface PeriodRangeManifest {
  /** First month, `YYYY-MM`. */
  firstMonth: string;
  /** Last month, `YYYY-MM`. Must be a complete month. */
  lastMonth: string;
  /** Count of monthly periods inclusive. PRD §8.1 requires 24. */
  monthCount: number;
}

/**
 * Scale anchors the generator builds facts from. These are inputs, not
 * outputs — no observation is hardcoded. All illustrative.
 */
export interface ScaleManifest {
  /** Reporting currency for all money measures. */
  currency: CurrencyCode;
  /**
   * Approximate annual group net revenue at the start of the period range,
   * in minor units (cents) to keep money integral and avoid float drift.
   */
  openingAnnualNetRevenueMinor: number;
  /** Target annual growth rate applied across the period range, as a fraction. */
  annualRevenueGrowthRate: number;
  /** Group EBITDA margin anchor at the start of the range, as a fraction. */
  openingEbitdaMargin: number;
}

/**
 * One of the nine labelled scenarios from PRD §8.3, anchored to a period and
 * an entity so the generator can place it deterministically.
 */
export interface ScenarioManifest {
  slug: Slug;
  /** Short title shown in review output, not a product-facing string. */
  title: string;
  /** Which of PRD §8.3's nine required narratives this covers. */
  narrative: string;
  /** Month the scenario becomes visible, `YYYY-MM`. */
  onsetMonth: string;
  /** Grain the scenario is anchored at. */
  grain: Grain;
  /** Slug of the anchoring entity: facility, region, coe, or the org for group. */
  entitySlug: Slug;
  /**
   * Narrative explanation. PRD §8.2 requires every unusual value to have an
   * explicit scenario explanation and forbids implying an unmodelled causal
   * relationship.
   */
  explanation: string;
}

/** The complete manifest. */
export interface CompanyManifest {
  /** Fixed seed. Same seed plus same manifest must reproduce byte-identically. */
  seed: number;
  /** Version stamp for this manifest revision. */
  manifestVersion: string;
  /**
   * Provenance marker carried into every generated record. PRD §8.4 requires
   * `provenance: "illustrative"` to survive into public records.
   */
  provenance: "illustrative";
  /** Disclosure string rendered on number surfaces (PRD §8.4). */
  disclosure: string;
  /** Timezone all timestamps are stored and displayed in. */
  timezone: string;
  organizations: readonly OrganizationManifest[];
  regions: readonly RegionManifest[];
  facilities: readonly FacilityManifest[];
  coes: readonly CoeManifest[];
  fiscalCalendar: FiscalCalendarManifest;
  periods: PeriodRangeManifest;
  scale: ScaleManifest;
  scenarios: readonly ScenarioManifest[];
}
