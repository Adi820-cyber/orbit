import { describe, expect, it } from "vitest";
import { ROLE_IDS, ROLES, getRole } from "@orbit/kpi-framework";
import { roleViewConfigFor } from "./config.ts";

/**
 * The invariant these guard: a role that can authenticate must be able to open
 * the product.
 *
 * `workspaceLoader` throws `RoleViewUnavailableError` when `roleViewConfigFor`
 * returns null, so a missing view config is not a cosmetic gap — it locks the
 * role out entirely, after a successful login, with correct entitlements in the
 * database. Seven of the fourteen roles were in that state before this change.
 *
 * PRD §3.1 requires all 14 roles preserved, and PRD §9 criterion 8 requires all
 * roles to have meaningful distinct emphasis. The count assertion below is
 * deliberately written against the framework rather than the literal 14, so
 * importing a workbook with a different role set fails here instead of silently
 * leaving the new roles unreachable.
 */
describe("role view coverage", () => {
  it("covers every role the framework defines", () => {
    const missing = ROLE_IDS.filter((role) => roleViewConfigFor(role) === null);
    expect(missing, `roles with no view config: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers all 14 workbook roles, matching the preserved role count", () => {
    // Guards the PRD §3.1 invariant from this side too: if the framework ever
    // reports a different number, that is a workbook change needing review.
    expect(ROLE_IDS).toHaveLength(14);
    expect(ROLE_IDS.filter((role) => roleViewConfigFor(role) !== null)).toHaveLength(14);
  });

  it("never returns an empty title, eyebrow, or description", () => {
    for (const role of ROLE_IDS) {
      const config = roleViewConfigFor(role);
      expect(config, role).not.toBeNull();
      expect(config?.title.trim(), `${role} title`).not.toBe("");
      expect(config?.eyebrow.trim(), `${role} eyebrow`).not.toBe("");
      expect(config?.description.trim(), `${role} description`).not.toBe("");
      expect(config?.roleId, `${role} roleId must match its key`).toBe(role);
    }
  });

  it("gives each role a distinct title", () => {
    // PRD §9 criterion 8: roles must be distinguishable, so two roles sharing a
    // header would be a real defect rather than a styling detail.
    const titles = ROLE_IDS.map((role) => roleViewConfigFor(role)?.title);
    expect(new Set(titles).size, `duplicate titles: ${titles.join(", ")}`).toBe(ROLE_IDS.length);
  });

  it("falls back to the workbook name and level when there is no hand-written copy", () => {
    // group-cfo has no entry in COPY, so it must come straight from the
    // framework. This is what makes adding a role a one-place change.
    const definition = getRole("group-cfo");
    const config = roleViewConfigFor("group-cfo");
    expect(config?.title).toBe(definition?.name);
    expect(config?.eyebrow).toBe(definition?.level);
    expect(config?.description).toContain("authorized scope");
  });

  it("prefers hand-written copy over the workbook default", () => {
    // regional-coo deliberately departs from the workbook level
    // ("Regional management") for clearer wording.
    const definition = ROLES.find((role) => role.id === "regional-coo");
    const config = roleViewConfigFor("regional-coo");
    expect(definition?.level).toBe("Regional management");
    expect(config?.eyebrow).toBe("Assigned-region operations");
    expect(config?.title).toBe("Regional COO");
  });

  it("returns null for a role the framework does not define", () => {
    // The genuine fail-closed case, and the only one: not "copy not written yet".
    expect(roleViewConfigFor("not-a-real-role" as never)).toBeNull();
  });
});
