import { describe, expect, it } from "vitest";
import { COMPANY_MANIFEST as M } from "../manifest.ts";

/**
 * Invariants on the fictional-company manifest. These guard the structural
 * facts the generator and the RLS fixtures depend on, and the PRD §8.1
 * requirements that are objectively checkable.
 *
 * If one of these fails, either the manifest drifted from the workbook's
 * operating shape or a requirement was dropped — investigate rather than
 * relaxing the assertion.
 */

const facilitySlugs = new Set(M.facilities.map((f) => f.slug));
const regionSlugs = new Set(M.regions.map((r) => r.slug));
const orgSlugs = new Set(M.organizations.map((o) => o.slug));
const coeSlugs = new Set(M.coes.map((c) => c.slug));

describe("organization structure (workbook-derived)", () => {
  it("has exactly two regions", () => {
    expect(M.regions).toHaveLength(2);
  });

  it("has exactly six facilities", () => {
    expect(M.facilities).toHaveLength(6);
  });

  it("puts exactly three facilities in each region", () => {
    for (const region of M.regions) {
      const inRegion = M.facilities.filter((f) => f.regionSlug === region.slug);
      expect(inRegion, `facilities in ${region.slug}`).toHaveLength(3);
    }
  });

  it("gives every facility a region that exists", () => {
    const orphans = M.facilities
      .filter((f) => !regionSlugs.has(f.regionSlug))
      .map((f) => `${f.slug} -> ${f.regionSlug}`);
    expect(orphans).toEqual([]);
  });

  it("uses unique slugs within every entity collection", () => {
    expect(orgSlugs.size).toBe(M.organizations.length);
    expect(regionSlugs.size).toBe(M.regions.length);
    expect(facilitySlugs.size).toBe(M.facilities.length);
    expect(coeSlugs.size).toBe(M.coes.length);
  });
});

describe("tenant fixtures", () => {
  it("has exactly one demo organization", () => {
    expect(M.organizations.filter((o) => o.kind === "demo")).toHaveLength(1);
  });

  it("has a separate test-fixture organization for isolation tests", () => {
    // PRD §8.1 requires a second, test-only organization.
    expect(M.organizations.filter((o) => o.kind === "test-fixture").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("marks the test-fixture organization unmistakably in its display name", () => {
    for (const org of M.organizations.filter((o) => o.kind === "test-fixture")) {
      expect(org.name.toLowerCase()).toMatch(/test|fixture/);
    }
  });
});

describe("COE structure (configuration choice, not workbook fact)", () => {
  it("hosts every COE at a facility that exists", () => {
    const orphans = M.coes
      .filter((c) => !facilitySlugs.has(c.hostFacilitySlug))
      .map((c) => `${c.slug} -> ${c.hostFacilitySlug}`);
    expect(orphans).toEqual([]);
  });

  it("pairs region-scoped COEs with a real region and group-scoped ones with null", () => {
    for (const coe of M.coes) {
      if (coe.reportingGrain === "region") {
        expect(coe.regionSlug, `${coe.slug} must name a region`).not.toBeNull();
        expect(regionSlugs.has(coe.regionSlug!), `${coe.slug} region exists`).toBe(true);
      } else {
        expect(coe.regionSlug, `${coe.slug} is group-scoped so regionSlug must be null`).toBeNull();
      }
    }
  });

  it("covers more than one reporting grain so entitlement grains are exercised", () => {
    // A COE set that is all one grain cannot test cross-grain authorization.
    expect(new Set(M.coes.map((c) => c.reportingGrain)).size).toBeGreaterThan(1);
  });

  it("places a region-scoped COE in each region", () => {
    for (const region of M.regions) {
      const coesHere = M.coes.filter(
        (c) => c.reportingGrain === "region" && c.regionSlug === region.slug,
      );
      expect(coesHere.length, `region-scoped COEs in ${region.slug}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("scale anchors", () => {
  it("sums facility revenue weights to exactly 1", () => {
    const sum = M.facilities.reduce((s, f) => s + f.revenueWeight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("gives every facility a positive bed count and revenue weight", () => {
    for (const f of M.facilities) {
      expect(f.staffedBeds, `${f.slug} staffedBeds`).toBeGreaterThan(0);
      expect(f.revenueWeight, `${f.slug} revenueWeight`).toBeGreaterThan(0);
    }
  });

  it("varies facility size so roll-up bugs and comparisons are detectable", () => {
    // Identical facilities would make facility comparison meaningless and hide
    // aggregation errors.
    expect(new Set(M.facilities.map((f) => f.staffedBeds)).size).toBeGreaterThan(1);
    expect(new Set(M.facilities.map((f) => f.revenueWeight)).size).toBeGreaterThan(1);
  });

  it("holds money as an integer in minor units", () => {
    // Float money breaks the reconciliation invariants PRD §8.2 requires.
    expect(Number.isInteger(M.scale.openingAnnualNetRevenueMinor)).toBe(true);
  });

  it("uses a plausible fractional rate for growth and margin, not a percentage", () => {
    // Guards against someone writing 8.6 meaning 8.6%.
    expect(M.scale.annualRevenueGrowthRate).toBeGreaterThan(0);
    expect(M.scale.annualRevenueGrowthRate).toBeLessThan(1);
    expect(M.scale.openingEbitdaMargin).toBeGreaterThan(0);
    expect(M.scale.openingEbitdaMargin).toBeLessThan(1);
  });
});

describe("period range", () => {
  it("declares 24 monthly periods (PRD §8.1)", () => {
    expect(M.periods.monthCount).toBe(24);
  });

  it("uses YYYY-MM format for both bounds", () => {
    expect(M.periods.firstMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    expect(M.periods.lastMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it("spans exactly monthCount months inclusive of both bounds", () => {
    const [fy, fm] = M.periods.firstMonth.split("-").map(Number) as [number, number];
    const [ly, lm] = M.periods.lastMonth.split("-").map(Number) as [number, number];
    const span = (ly - fy) * 12 + (lm - fm) + 1;
    expect(span).toBe(M.periods.monthCount);
  });

  it("ends on a month that is already complete", () => {
    // A partial month must never be presented as a finished period.
    const [ly, lm] = M.periods.lastMonth.split("-").map(Number) as [number, number];
    const now = new Date();
    const lastComplete = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const declared = new Date(Date.UTC(ly, lm - 1, 1));
    expect(declared.getTime()).toBeLessThan(lastComplete.getTime());
  });
});

describe("fiscal calendar", () => {
  it("names a valid start month", () => {
    expect(M.fiscalCalendar.startMonth).toBeGreaterThanOrEqual(1);
    expect(M.fiscalCalendar.startMonth).toBeLessThanOrEqual(12);
  });

  it("carries a human-readable description for disclosure surfaces", () => {
    expect(M.fiscalCalendar.description.length).toBeGreaterThan(0);
  });
});

describe("scenarios (PRD §8.3)", () => {
  const requiredNarratives = [
    "revenue growth with margin pressure",
    "delayed collections / aging",
    "claim-quality problem",
    "capacity issue",
    "staffing gap",
    "procurement / stock risk",
    "legal deadline",
    "clinical-governance exception",
    "late / unreconciled data source",
  ];

  it("covers all nine required narratives", () => {
    expect([...M.scenarios.map((s) => s.narrative)].sort()).toEqual([...requiredNarratives].sort());
  });

  it("uses unique scenario slugs", () => {
    expect(new Set(M.scenarios.map((s) => s.slug)).size).toBe(M.scenarios.length);
  });

  it("anchors every scenario to an entity that exists at its declared grain", () => {
    for (const s of M.scenarios) {
      const known =
        s.grain === "facility"
          ? facilitySlugs.has(s.entitySlug)
          : s.grain === "region"
            ? regionSlugs.has(s.entitySlug)
            : s.grain === "coe"
              ? coeSlugs.has(s.entitySlug)
              : orgSlugs.has(s.entitySlug);
      expect(known, `${s.slug} anchors to unknown ${s.grain} "${s.entitySlug}"`).toBe(true);
    }
  });

  it("places every scenario onset inside the period range", () => {
    const toIndex = (m: string) => {
      const [y, mo] = m.split("-").map(Number) as [number, number];
      return y * 12 + mo;
    };
    const first = toIndex(M.periods.firstMonth);
    const last = toIndex(M.periods.lastMonth);
    for (const s of M.scenarios) {
      const at = toIndex(s.onsetMonth);
      expect(at, `${s.slug} onset ${s.onsetMonth} before range`).toBeGreaterThanOrEqual(first);
      expect(at, `${s.slug} onset ${s.onsetMonth} after range`).toBeLessThanOrEqual(last);
    }
  });

  it("gives every scenario a substantive explanation (PRD §8.2)", () => {
    // Every unusual value needs an explicit scenario explanation.
    for (const s of M.scenarios) {
      expect(s.explanation.length, `${s.slug} explanation too thin`).toBeGreaterThan(80);
    }
  });
});

describe("provenance and reproducibility (PRD §8.4)", () => {
  it("marks provenance as illustrative", () => {
    expect(M.provenance).toBe("illustrative");
  });

  it("carries a disclosure naming the data as fictional and not guidance", () => {
    expect(M.disclosure.toLowerCase()).toContain("fictional");
    expect(M.disclosure.toLowerCase()).toContain("illustrative");
  });

  it("fixes an integer seed so generation is reproducible", () => {
    expect(Number.isInteger(M.seed)).toBe(true);
  });

  it("stamps a manifest version", () => {
    expect(M.manifestVersion.length).toBeGreaterThan(0);
  });
});
