import { describe, expect, it } from "vitest";
import { FRAMEWORK_MANIFEST, ROLES, ROLE_KPI_ASSIGNMENTS } from "@orbit/kpi-framework";
import { baseGrainsForRole, deriveEntitlements } from "../entitlements.ts";
import { descendantsOf, highestGrain, isStrictlyBelow, ORG_GRAINS } from "../grain-order.ts";

/**
 * ADR 0011 §4 requires these to fail the BUILD, not a review: "If the generated
 * matrix stops matching the workbook, that is a bug."
 */

const rows = deriveEntitlements();

describe("grain DAG (ADR 0011 §4)", () => {
  it("does not contain segment", () => {
    // ADR 0012: segment is a payer dimension, not a position in this hierarchy.
    expect(ORG_GRAINS).not.toContain("segment");
    expect(ORG_GRAINS).toHaveLength(4);
  });

  it("makes region and coe incomparable, which is the whole point", () => {
    // A numeric level would put these on the same rung and permit a `region`
    // breakdown for coe-lead. Reachability forbids it in both directions.
    expect(isStrictlyBelow("region", "coe")).toBe(false);
    expect(isStrictlyBelow("coe", "region")).toBe(false);
  });

  it("reaches both branches from group", () => {
    const below = descendantsOf("group");
    expect([...below].toSorted()).toEqual(["coe", "facility", "region"]);
  });

  it("puts facility below region and below coe", () => {
    expect(isStrictlyBelow("facility", "region")).toBe(true);
    expect(isStrictlyBelow("facility", "coe")).toBe(true);
  });

  it("puts nothing below facility", () => {
    expect(descendantsOf("facility").size).toBe(0);
  });

  it("never treats a grain as strictly below itself", () => {
    for (const g of ORG_GRAINS) {
      expect(isStrictlyBelow(g, g), g + ' below itself').toBe(false);
    }
  });

  it("resolves group as highest for clinical-director's two base grains", () => {
    expect(highestGrain(["group", "coe"])).toBe("group");
    expect(highestGrain(["coe", "group"])).toBe("group");
  });

  it("refuses to guess a highest grain for an incomparable pair", () => {
    // Two incomparable base grains would make the breakdown invariant
    // ambiguous in exactly the way ADR 0011 §4 was corrected to avoid.
    expect(() => highestGrain(["region", "coe"])).toThrow(/no single highest grain/);
  });
});

describe("base grain derivation (ADR 0011 §1)", () => {
  it("assigns a base grain to all 14 roles", () => {
    for (const role of ROLES) {
      expect(baseGrainsForRole(role.id).length, role.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives group grain to exactly the eight roles deployed as '1 group role'", () => {
    const groupRoles = ROLES.filter((r) => r.deployment === "1 group role").map((r) => r.id);
    expect(groupRoles).toHaveLength(8);
    // The regression this guards: the original rule ANDed a `Group *` level and
    // silently dropped corporate-revenue-lead, whose level is Commercial growth.
    expect(groupRoles).toContain("corporate-revenue-lead");
    for (const id of groupRoles) {
      expect(baseGrainsForRole(id), id).toContain("group");
    }
  });

  it("derives region, facility and coe grains from their deployment values", () => {
    expect(baseGrainsForRole("regional-coo")).toEqual(["region"]);
    expect(baseGrainsForRole("coe-lead")).toEqual(["coe"]);
    for (const id of ["hospital-dho", "people-executive", "bd-lead", "billing-lead"] as const) {
      expect(baseGrainsForRole(id), id).toEqual(["facility"]);
    }
  });

  it("gives clinical-director coe in addition to group, and only that role", () => {
    expect([...baseGrainsForRole("clinical-director")].toSorted()).toEqual(["coe", "group"]);
    const multi = ROLES.filter((r) => baseGrainsForRole(r.id).length > 1).map((r) => r.id);
    expect(multi).toEqual(["clinical-director"]);
  });
});

describe("matrix invariants (ADR 0011 §4)", () => {
  it("emits exactly 109 rows, matching the framework manifest", () => {
    expect(rows).toHaveLength(109);
    expect(rows).toHaveLength(FRAMEWORK_MANIFEST.assignmentCount);
  });

  it("matches each role's kpiCount", () => {
    for (const role of ROLES) {
      const forRole = rows.filter((r) => r.roleId === role.id);
      expect(forRole.length, role.id).toBe(role.kpiCount);
    }
  });

  it("is unique on (frameworkVersion, role, assignmentId)", () => {
    const keys = rows.map((r) => `${r.frameworkVersion}|${r.roleId}|${r.assignmentId}`);
    expect(new Set(keys).size).toBe(rows.length);
  });

  it("references only assignments that exist in the framework", () => {
    const known = new Set(ROLE_KPI_ASSIGNMENTS.map((a) => a.assignmentId));
    const unknown = rows.filter((r) => !known.has(r.assignmentId)).map((r) => r.assignmentId);
    expect(unknown).toEqual([]);
  });

  it("covers every framework assignment exactly once", () => {
    const covered = new Set(rows.map((r) => r.assignmentId));
    expect(covered.size).toBe(ROLE_KPI_ASSIGNMENTS.length);
  });

  it("carries no row with grain segment, in grains or breakdowns", () => {
    const offending = rows.filter(
      (r) =>
        (r.grains as readonly string[]).includes("segment") ||
        (r.breakdowns as readonly string[]).includes("segment"),
    );
    expect(offending).toEqual([]);
  });

  it("never emits an empty grains array", () => {
    expect(rows.filter((r) => r.grains.length === 0)).toEqual([]);
  });

  it("keeps every breakdown strictly below the row's highest base grain", () => {
    const violations: string[] = [];
    for (const r of rows) {
      const base = highestGrain(r.grains);
      for (const b of r.breakdowns) {
        if (!isStrictlyBelow(b, base)) violations.push(`${r.roleId}: ${b} not below ${base}`);
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });

  it("grants no role group as a breakdown", () => {
    // Nothing is above group, so a group breakdown is always upward.
    const bad = rows.filter((r) => (r.breakdowns as readonly string[]).includes("group"));
    expect(bad).toEqual([]);
  });

  it("gives leaf-grain roles no breakdowns at all", () => {
    for (const id of ["hospital-dho", "people-executive", "bd-lead", "billing-lead"] as const) {
      const forRole = rows.filter((r) => r.roleId === id);
      expect(forRole.length, id).toBeGreaterThan(0);
      for (const r of forRole) expect(r.breakdowns, id).toEqual([]);
    }
  });

  it("stamps every row with the framework definition version", () => {
    for (const r of rows) {
      expect(r.frameworkVersion).toBe(FRAMEWORK_MANIFEST.definitionVersion);
    }
  });

  it("reproduces ADR 0011 §4's worked table exactly", () => {
    const expected: Record<string, { base: string; breakdowns: string[] }> = {
      chairman: { base: "group", breakdowns: ["region"] },
      "group-cfo": { base: "group", breakdowns: ["region"] },
      "clinical-director": { base: "group", breakdowns: ["coe", "facility"] },
      "regional-coo": { base: "region", breakdowns: ["facility"] },
      "coe-lead": { base: "coe", breakdowns: ["facility"] },
      "hospital-dho": { base: "facility", breakdowns: [] },
    };
    for (const [roleId, want] of Object.entries(expected)) {
      const row = rows.find((r) => r.roleId === roleId);
      expect(row, roleId).toBeDefined();
      expect(highestGrain(row!.grains), `${roleId} highest base`).toBe(want.base);
      expect([...row!.breakdowns].toSorted(), `${roleId} breakdowns`).toEqual(want.breakdowns.toSorted());
    }
  });
});

describe("determinism", () => {
  it("produces identical output on repeated derivation", () => {
    expect(JSON.stringify(deriveEntitlements())).toBe(JSON.stringify(deriveEntitlements()));
  });
});
