import { describe, expect, it } from "vitest";
import {
  ROLE_IDS,
  ROLES,
  ROLE_KPI_ASSIGNMENTS,
  getRole,
  getAssignment,
  getAssignmentsForRole,
  getDefinitionFamily,
  getDefinitionFamiliesForAssignment,
} from "../index.ts";

/**
 * Exercises the package's public entrypoint the way consumers
 * (`services/api`, `packages/data-gen`) will import it. Guards against the
 * package resolving but exporting nothing usable.
 */

describe("public API", () => {
  it("exports all 14 role ids", () => {
    expect(ROLE_IDS).toHaveLength(14);
    expect(new Set(ROLE_IDS).size).toBe(14);
  });

  it("resolves a role by slug", () => {
    const role = getRole("regional-coo");
    expect(role?.name).toBe("Regional COO");
    expect(role?.kpiCount).toBe(9);
  });

  it("returns undefined for an unknown role slug rather than throwing", () => {
    // @ts-expect-error deliberately passing an invalid slug
    expect(getRole("not-a-role")).toBeUndefined();
  });

  it("returns each role's full assignment set", () => {
    for (const role of ROLES) {
      expect(getAssignmentsForRole(role.id), `assignments for ${role.id}`).toHaveLength(
        role.kpiCount,
      );
    }
  });

  it("returns an empty array for an unknown role rather than throwing", () => {
    // @ts-expect-error deliberately passing an invalid slug
    expect(getAssignmentsForRole("not-a-role")).toEqual([]);
  });

  it("round-trips every assignment through getAssignment by id", () => {
    for (const a of ROLE_KPI_ASSIGNMENTS) {
      expect(getAssignment(a.assignmentId)?.assignmentId).toBe(a.assignmentId);
    }
  });

  it("returns undefined for an unknown assignment id", () => {
    expect(getAssignment("chairman:does-not-exist")).toBeUndefined();
  });

  it("resolves a definition family by name", () => {
    expect(getDefinitionFamily("DSO")?.targetSteward).toBe("Group CFO");
    expect(getDefinitionFamily("Not A Family")).toBeUndefined();
  });

  it("resolves every assignment to at least one full definition family row", () => {
    for (const a of ROLE_KPI_ASSIGNMENTS) {
      const families = getDefinitionFamiliesForAssignment(a.assignmentId);
      expect(families.length, `families for ${a.assignmentId}`).toBeGreaterThanOrEqual(1);
      expect(families.length, `families for ${a.assignmentId}`).toBe(a.definitionFamilies.length);
    }
  });

  it("returns an empty array of families for an unknown assignment", () => {
    expect(getDefinitionFamiliesForAssignment("chairman:does-not-exist")).toEqual([]);
  });
});
