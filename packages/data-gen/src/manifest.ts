/**
 * Orbit fictional-company manifest — Kestrion Health Group.
 *
 * ── What this file is ──────────────────────────────────────────────────────
 * The reviewed record of every invented fact about the demonstration company
 * (PRD §8.1, §8.4). Maruti owns these choices; Aditya may override currency,
 * fiscal calendar, or scale (TEAM_ASSIGNMENTS.md §5 "Depends on").
 *
 * ── What this file is NOT ──────────────────────────────────────────────────
 * Not Africare data. Not client data. Not real operating numbers. Not a
 * clinical or financial benchmark. Every figure is an illustrative anchor the
 * generator derives from; no observation is hardcoded here or anywhere else
 * (RULES.md: "Never hardcode realistic-looking values, facility names,
 * targets, thresholds, or clinical claims").
 *
 * ── On the naming ─────────────────────────────────────────────────────────
 * "Kestrion" was checked against real healthcare organizations before adoption
 * and is not one. Every facility carries the `Kestrion` group prefix so the
 * fiction is explicit and a facility name cannot be mistaken for a real
 * hospital that happens to share a place-name element.
 *
 * ── Structure is workbook-derived; COE structure is not ───────────────────
 * Two regions and six hospitals (three per region) come from the workbook's
 * Group Scorecard: "Regional COO — 2 roles; 3 hospitals each" and
 * "Hospital DHO — 6 roles; one per hospital". North/South naming follows
 * PRD §5.3, which already refers to "Regional COO North" and "Regional COO
 * South".
 *
 * The COE structure is a *configuration choice*. The workbook says COE
 * deployment is "As approved by COE plan" and fixes no count, and PRD §4
 * item 8 states plainly that the demo COE structure is not a client fact.
 */

import type { CompanyManifest } from "./manifest-types.ts";

/**
 * Facility slugs are letter-ordered (a–f) so tests and review output can
 * reason about them positionally: a/b/c are North, d/e/f are South.
 */
export const COMPANY_MANIFEST: CompanyManifest = {
  seed: 20260923,
  manifestVersion: "v1",
  provenance: "illustrative",
  disclosure:
    "Fictional demonstration company. All figures and targets are illustrative; " +
    "not validated clinical or financial guidance.",

  /**
   * UTC for both storage and display. A fictional group has no real
   * jurisdiction, and picking a real regional timezone would imply a
   * geography and regulator the dataset does not model. Storing UTC also
   * keeps period boundaries unambiguous, which matters because monthly
   * aggregation is the core reporting grain.
   */
  timezone: "UTC",

  organizations: [
    {
      slug: "kestrion",
      name: "Kestrion Health Group",
      kind: "demo",
    },
    {
      /**
       * Second organization required by PRD §8.1 for tenant-isolation tests.
       * Named with an explicit marker so it can never be mistaken for demo
       * content if it leaks into a screenshot. Per ADR 0002, this is separate
       * *users* in a separate org — never one user holding two memberships.
       */
      slug: "halveston-test-fixture",
      name: "Halveston Care Group (test fixture)",
      kind: "test-fixture",
    },
  ],

  regions: [
    { slug: "north", name: "Kestrion Northern Region", shortName: "North" },
    { slug: "south", name: "Kestrion Southern Region", shortName: "South" },
  ],

  /**
   * Six hospitals, three per region. Bed counts and revenue weights are
   * deliberately uneven — a dataset where every facility is identical hides
   * roll-up bugs and makes facility comparison meaningless. revenueWeight
   * sums to exactly 1 across all six (asserted by test).
   */
  facilities: [
    {
      slug: "avenhurst",
      name: "Kestrion Avenhurst Hospital",
      regionSlug: "north",
      staffedBeds: 420,
      revenueWeight: 0.24,
    },
    {
      slug: "brackmoor",
      name: "Kestrion Brackmoor Hospital",
      regionSlug: "north",
      staffedBeds: 260,
      revenueWeight: 0.15,
    },
    {
      slug: "calderwyn",
      name: "Kestrion Calderwyn Hospital",
      regionSlug: "north",
      staffedBeds: 180,
      revenueWeight: 0.11,
    },
    {
      slug: "dunmarrow",
      name: "Kestrion Dunmarrow Hospital",
      regionSlug: "south",
      staffedBeds: 380,
      revenueWeight: 0.22,
    },
    {
      slug: "elverton",
      name: "Kestrion Elverton Hospital",
      regionSlug: "south",
      staffedBeds: 300,
      revenueWeight: 0.18,
    },
    {
      slug: "farrowgate",
      name: "Kestrion Farrowgate Hospital",
      regionSlug: "south",
      staffedBeds: 160,
      revenueWeight: 0.1,
    },
  ],

  /**
   * Three COEs, deliberately spanning different reporting grains so the
   * entitlement matrix has something real to test:
   *   - one region-scoped in North
   *   - one region-scoped in South
   *   - one group-scoped spanning both
   *
   * A COE-scoped role must see its own COE and not another's, and a
   * group-scoped COE must not leak facility detail the viewer lacks. With
   * only same-grain COEs neither case is exercised.
   *
   * PRD §8.2 warning that applies here: COE segments may overlap hospital
   * totals. They are segments, and the generator must never add them to the
   * group a second time.
   */
  coes: [
    {
      slug: "cardiac-sciences",
      name: "Kestrion Cardiac Sciences COE",
      hostFacilitySlug: "avenhurst",
      reportingGrain: "region",
      regionSlug: "north",
    },
    {
      slug: "oncology",
      name: "Kestrion Oncology COE",
      hostFacilitySlug: "dunmarrow",
      reportingGrain: "region",
      regionSlug: "south",
    },
    {
      slug: "orthopaedics-spine",
      name: "Kestrion Orthopaedics & Spine COE",
      hostFacilitySlug: "calderwyn",
      reportingGrain: "group",
      regionSlug: null,
    },
  ],

  /**
   * Fiscal year = calendar year. The workbook specifies no fiscal calendar,
   * only "Board-approved annual and monthly budget" and an "annual operating
   * plan", so this is a free choice.
   *
   * Calendar year is chosen for v1 because it removes a whole class of
   * off-by-a-quarter aggregation bug while the roll-up rules are still being
   * written. A non-calendar fiscal year is a genuinely better *test* of the
   * system — it catches code that assumes FY equals CY — and is worth
   * adopting once the roll-ups are proven. Recorded so the tradeoff is a
   * decision rather than an oversight.
   */
  fiscalCalendar: {
    startMonth: 1,
    description: "Fiscal year runs January–December (aligned to calendar year).",
  },

  /**
   * 24 complete monthly periods (PRD §8.1). The range ends at the last
   * complete month relative to the manifest date, so no partial month is
   * presented as a finished period.
   *
   * PRD §8.1 also requires that annual and quarterly measures keep their real
   * cadence rather than acquiring fabricated monthly observations. The
   * generator enforces that from each KPI's `review` column in
   * @orbit/kpi-framework, not from this range.
   */
  periods: {
    firstMonth: "2024-09",
    lastMonth: "2026-08",
    monthCount: 24,
  },

  /**
   * Money is held in minor units (cents) as integers. Storing money as float
   * invites drift that breaks the reconciliation invariants PRD §8.2 requires
   * (revenue, costs, budgets and EBITDA must reconcile).
   *
   * USD is chosen as a geography-neutral reporting currency for a fictional
   * group. It carries no claim about where the company operates or which
   * payer system applies.
   *
   * These are opening anchors. The generator derives each month's facts from
   * them plus seeded variation and the scenarios below; it does not read a
   * per-month figure from here.
   */
  scale: {
    currency: "USD",
    openingAnnualNetRevenueMinor: 41_800_000_000,
    annualRevenueGrowthRate: 0.086,
    openingEbitdaMargin: 0.174,
  },

  /**
   * The nine labelled scenarios PRD §8.3 requires, each anchored to a period
   * and entity. Every one is a fictional narrative used to test the product —
   * not an asserted operational correlation.
   *
   * The capacity scenario at Brackmoor is the one the Regional COO vertical
   * slice in PRD §5.3 walks through, so it sits in North and lands late
   * enough in the range to have trend history behind it.
   */
  scenarios: [
    {
      slug: "revenue-growth-margin-pressure",
      title: "Growth with margin compression",
      narrative: "revenue growth with margin pressure",
      onsetMonth: "2026-03",
      grain: "group",
      entitySlug: "kestrion",
      explanation:
        "Net revenue grows ahead of plan while EBITDA margin declines, driven in " +
        "the model by case-mix shift toward lower-margin service lines and higher " +
        "agency staffing cost. Growth and margin are modelled together so the two " +
        "movements reconcile rather than contradicting each other.",
    },
    {
      slug: "delayed-collections-aging",
      title: "Collections slowdown and aging build",
      narrative: "delayed collections / aging",
      onsetMonth: "2026-04",
      grain: "facility",
      entitySlug: "elverton",
      explanation:
        "Cash posting slows against a stable billing run-rate, so receivables and " +
        "the older aging buckets build. DSO rises as a consequence of the modelled " +
        "receivable and revenue movements, not as an independently injected value.",
    },
    {
      slug: "claim-quality-denials",
      title: "Claim quality deterioration",
      narrative: "claim-quality problem",
      onsetMonth: "2026-02",
      grain: "facility",
      entitySlug: "farrowgate",
      explanation:
        "First-pass claim acceptance falls and denied claim value rises for a " +
        "subset of payers. Modelled as a documentation-completeness problem at " +
        "submission, so acceptance and denial move as two views of one cause.",
    },
    {
      slug: "capacity-constraint",
      title: "Sustained capacity constraint",
      narrative: "capacity issue",
      onsetMonth: "2026-05",
      grain: "facility",
      entitySlug: "brackmoor",
      explanation:
        "Staffed beds available fall while demand holds, so utilisation rises " +
        "toward its ceiling and throughput growth flattens. Capacity is modelled " +
        "in staffed bed days with an explicit numerator and denominator, per the " +
        "workbook's requirement to state the capacity unit and never combine " +
        "unlike units. This is the scenario the Regional COO vertical slice uses.",
    },
    {
      slug: "staffing-gap",
      title: "Critical-role staffing gap",
      narrative: "staffing gap",
      onsetMonth: "2026-04",
      grain: "facility",
      entitySlug: "brackmoor",
      explanation:
        "Vacancies in designated critical roles rise and time-to-fill lengthens. " +
        "Placed at the same facility as the capacity constraint and one month " +
        "earlier, because the staffing shortfall is what reduces staffed beds in " +
        "the model. The relationship is generated, not implied by coincidence.",
    },
    {
      slug: "procurement-stock-risk",
      title: "Consumable supply risk",
      narrative: "procurement / stock risk",
      onsetMonth: "2026-06",
      grain: "group",
      entitySlug: "kestrion",
      explanation:
        "A supplier service-level decline raises stockout risk for specific " +
        "critical consumables, with inventory days and obsolete stock reported " +
        "separately from the stockout count, per the workbook's note that " +
        "critical stockouts are reported separately.",
    },
    {
      slug: "legal-deadline",
      title: "Approaching regulatory deadline",
      narrative: "legal deadline",
      onsetMonth: "2026-07",
      grain: "facility",
      entitySlug: "calderwyn",
      explanation:
        "A licence renewal and a filing fall due within the review window, with " +
        "actions open against a controlled calendar. Critical items stay " +
        "individually visible rather than being averaged into a closure rate.",
    },
    {
      slug: "clinical-governance-exception",
      title: "Clinical governance exception",
      narrative: "clinical-governance exception",
      onsetMonth: "2026-06",
      grain: "facility",
      entitySlug: "dunmarrow",
      explanation:
        "Required incident reviews and corrective actions fall behind their due " +
        "dates. Reported as review-and-closure completion against actions due. " +
        "No clinical threshold is asserted and no safety judgement is implied — " +
        "the workbook is explicit that no universal clinical threshold is assumed.",
    },
    {
      slug: "late-unreconciled-source",
      title: "Late and unreconciled source feed",
      narrative: "late / unreconciled data source",
      onsetMonth: "2026-08",
      grain: "facility",
      entitySlug: "avenhurst",
      explanation:
        "A source feed arrives late and unreconciled for the closing period, so " +
        "affected measures must render as stale or unreconciled rather than " +
        "being filled with a plausible number. Exists specifically to prove " +
        "missing is kept distinct from zero (PRD §7.9, FR-02).",
    },
  ],
} as const;
