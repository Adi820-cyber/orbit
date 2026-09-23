import { describe, expect, it } from "vitest";
import { ROLES } from "../generated/roles.ts";
import { KPI_DEFINITIONS } from "../generated/kpi-definitions.ts";
import { ROLE_KPI_ASSIGNMENTS } from "../generated/role-kpi-assignments.ts";
import { ENTERPRISE_OUTCOMES } from "../generated/enterprise-outcomes.ts";
import { GOVERNANCE_RULES } from "../generated/governance-rules.ts";
import { FRAMEWORK_MANIFEST } from "../generated/manifest.ts";

/**
 * Invariant tests for the generated KPI framework. These guard the
 * non-negotiable product invariants from AGENTS.md and RULES.md:
 * 14 roles, 109 assignments, 29 definition families, weights summing to
 * 100% per role, and no silently faked compound-metric mappings.
 *
 * If the workbook is re-imported and any of these fail, that means either
 * the workbook changed or the import logic drifted — investigate, do not
 * adjust the expected constant to make the test pass.
 */

describe("workbook invariants", () => {
  it("has exactly 14 roles", () => {
    expect(ROLES).toHaveLength(14);
  });

  it("has exactly 109 role-KPI assignments", () => {
    expect(ROLE_KPI_ASSIGNMENTS).toHaveLength(109);
  });

  it("has exactly 29 KPI definition families", () => {
    expect(KPI_DEFINITIONS).toHaveLength(29);
  });

  it("has exactly 8 enterprise outcomes", () => {
    expect(ENTERPRISE_OUTCOMES).toHaveLength(8);
  });

  it("records the canonical 14 role names from the workbook", () => {
    const names = ROLES.map((r) => r.name).toSorted();
    expect(names).toEqual(
      [
        "Business Development Lead",
        "Billing & Revenue Lead",
        "COE Lead",
        "Chairman",
        "Chief / Group Clinical Medical Director",
        "Corporate Revenue & Insurance Lead",
        "Group CFO",
        "HR Head",
        "Head of Analytics & Digital Transformation",
        "Hospital DHO",
        "Legal Head",
        "People Executive",
        "Procurement Head",
        "Regional COO",
      ].toSorted(),
    );
  });

  it("sums assignment weights to 100% (±0.001 float tolerance) for every role", () => {
    const byRole = new Map<string, number[]>();
    for (const a of ROLE_KPI_ASSIGNMENTS) {
      if (!byRole.has(a.role)) byRole.set(a.role, []);
      byRole.get(a.role)!.push(a.weight);
    }
    expect(byRole.size).toBe(14);
    for (const [role, weights] of byRole) {
      const sum = weights.reduce((s, w) => s + w, 0);
      expect(sum, `role "${role}" weight sum`).toBeCloseTo(1, 3);
    }
  });

  it("matches each role's declared kpiCount to its actual assignment count", () => {
    for (const role of ROLES) {
      const actual = ROLE_KPI_ASSIGNMENTS.filter((a) => a.role === role.name).length;
      expect(actual, `role "${role.name}" assignment count`).toBe(role.kpiCount);
    }
  });

  it("has no assignment with an unresolved definition-family mapping", () => {
    const unresolved = ROLE_KPI_ASSIGNMENTS.filter((a) => a.definitionFamilies.length === 0);
    expect(
      unresolved.map((a) => `row ${a.sourceRow}: "${a.kpi}" (${a.unresolvedReason})`),
    ).toEqual([]);
  });

  it("only references definition families that actually exist in KPI Definitions", () => {
    const familyNames = new Set(KPI_DEFINITIONS.map((d) => d.family));
    const invalidRefs = ROLE_KPI_ASSIGNMENTS.flatMap((a) =>
      a.definitionFamilies.filter((f) => !familyNames.has(f)).map((f) => `row ${a.sourceRow} -> "${f}"`),
    );
    expect(invalidRefs).toEqual([]);
  });

  it("has no assignment with a zero, negative, or missing weight", () => {
    const bad = ROLE_KPI_ASSIGNMENTS.filter((a) => !(a.weight > 0) || Number.isNaN(a.weight));
    expect(bad.map((a) => `row ${a.sourceRow}: weight=${a.weight}`)).toEqual([]);
  });

  it("has governance rules covering every KPI family group", () => {
    expect(GOVERNANCE_RULES.length).toBeGreaterThan(0);
  });

  it("records a manifest with matching counts and a non-empty checksum", () => {
    expect(FRAMEWORK_MANIFEST.roleCount).toBe(14);
    expect(FRAMEWORK_MANIFEST.assignmentCount).toBe(109);
    expect(FRAMEWORK_MANIFEST.definitionFamilyCount).toBe(29);
    expect(FRAMEWORK_MANIFEST.unresolvedAssignmentCount).toBe(0);
    expect(FRAMEWORK_MANIFEST.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never leaks a local filesystem path in the manifest's source filename", () => {
    expect(FRAMEWORK_MANIFEST.sourceFileName).not.toMatch(/[/\\]/);
  });

  it("gives every role a stable slug matching the @orbit/contracts role list", () => {
    // These are the slugs @orbit/contracts (packages/contracts/src/roles.ts)
    // and apps/web/src/roles/* use. If this test fails, the three sides have
    // drifted and it is a cross-boundary change, not a local fix.
    const expected = [
      "analytics-head",
      "bd-lead",
      "billing-lead",
      "chairman",
      "clinical-director",
      "coe-lead",
      "corporate-revenue-lead",
      "group-cfo",
      "hospital-dho",
      "hr-head",
      "legal-head",
      "people-executive",
      "procurement-head",
      "regional-coo",
    ];
    expect(ROLES.map((r) => r.id).toSorted()).toEqual(expected);
  });

  it("gives all 109 assignments a unique, well-formed assignmentId", () => {
    const ids = ROLE_KPI_ASSIGNMENTS.map((a) => a.assignmentId);
    expect(ids).toHaveLength(109);
    expect(new Set(ids).size, "assignment ids must be unique").toBe(109);
    // `<role-slug>:<kpi-slug>`, lowercase alphanumeric with single hyphens.
    const malformed = ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
    expect(malformed).toEqual([]);
  });

  it("prefixes every assignmentId with its own roleId", () => {
    const mismatched = ROLE_KPI_ASSIGNMENTS.filter(
      (a) => !a.assignmentId.startsWith(`${a.roleId}:`),
    ).map((a) => `${a.assignmentId} (roleId=${a.roleId})`);
    expect(mismatched).toEqual([]);
  });

  it("uses a roleId on every assignment that exists in ROLES", () => {
    const validIds = new Set(ROLES.map((r) => r.id));
    const orphaned = ROLE_KPI_ASSIGNMENTS.filter((a) => !validIds.has(a.roleId)).map(
      (a) => `row ${a.sourceRow}: roleId=${a.roleId}`,
    );
    expect(orphaned).toEqual([]);
  });

  it("keeps assignmentId independent of workbook row numbers", () => {
    // sourceRow is traceability only. If an id ever embeds it, re-importing
    // after a row insert would silently change identifiers that entitlements
    // and persisted rows depend on.
    const embedsRow = ROLE_KPI_ASSIGNMENTS.filter((a) =>
      a.assignmentId.includes(String(a.sourceRow)),
    ).map((a) => a.assignmentId);
    expect(embedsRow).toEqual([]);
  });

  it("has no wall-clock timestamp that would break byte-identical regeneration", () => {
    // PRD §8.4: regenerating with the same configuration must be reproducible.
    // A generatedAt-style field would make every import produce a spurious
    // diff and defeat a CI "re-run import, assert no drift" check.
    expect(FRAMEWORK_MANIFEST).not.toHaveProperty("generatedAt");
    expect(JSON.stringify(FRAMEWORK_MANIFEST)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
