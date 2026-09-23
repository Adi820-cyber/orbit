/**
 * Derives the entitlement matrix from the workbook framework.
 *
 * Implements ADR 0011. The whole point of that ADR is that this is **rules
 * applied mechanically to generated data**, not 109 hand-assigned rows — so
 * anyone can re-derive the output and check it, and nothing here is a
 * realistic-looking value with no traceable source (RULES.md).
 *
 * Two inputs, both already generated and tested:
 *   - `ROLES` / `ROLE_KPI_ASSIGNMENTS` from `@orbit/kpi-framework`
 *   - `deployment`, which is a workbook field, not a judgement
 *
 * One deliberate judgement, flagged in ADR 0011 §1 and reproduced here rather
 * than hidden: `clinical-director` gets `coe` in addition to `group`.
 */

import { ROLES, ROLE_KPI_ASSIGNMENTS, FRAMEWORK_MANIFEST } from "@orbit/kpi-framework";
import type { RoleId } from "@orbit/kpi-framework";
import { highestGrain, isStrictlyBelow, type OrgGrain } from "./grain-order.ts";

/** One derived entitlement row. Mirrors `orbit.entitlements`. */
export interface EntitlementRow {
  frameworkVersion: string;
  roleId: RoleId;
  assignmentId: string;
  /** Grains this role may read the assignment at. Never empty. */
  grains: readonly OrgGrain[];
  /** Grains it may decompose by. May legitimately be empty. */
  breakdowns: readonly OrgGrain[];
}

/**
 * Base grain by `deployment` value — ADR 0011 §1.
 *
 * Keyed on `deployment` ALONE. The original rule also required a `Group *`
 * level, which silently excluded `corporate-revenue-lead` (its level is
 * `Commercial growth`) and produced a role with no grain. No role outside these
 * four deployment values exists, and no role outside the eight group roles
 * carries `1 group role`, so `deployment` is fully discriminating on its own.
 */
const BASE_GRAIN_BY_DEPLOYMENT: Readonly<Record<string, OrgGrain>> = {
  "1 group role": "group",
  "2 roles; 3 hospitals each": "region",
  "6 roles; one per hospital": "facility",
  "As approved by COE plan": "coe",
};

/**
 * Additional base grains beyond what `deployment` implies.
 *
 * ADR 0011 §1: `clinical-director` gets `coe` because its `primaryFocus` reads
 * "Clinical governance, COEs, corporate clinical propositions" — COEs are
 * explicitly its remit. The ADR calls this "the one line in this table most
 * worth arguing with", so it lives in its own table rather than blended into
 * the mechanical rule, and any future addition has to be added here
 * deliberately.
 */
const ADDITIONAL_BASE_GRAINS: Partial<Record<RoleId, readonly OrgGrain[]>> = {
  "clinical-director": ["coe"],
};

/**
 * Permitted breakdowns per role — ADR 0011 §2.
 *
 * A breakdown lets a role decompose its own figure; it does not widen which
 * entities the role can see. Every entry is validated against the grain DAG by
 * `deriveEntitlements`, so a typo here fails the build rather than granting
 * something.
 *
 * Roles at the leaf grain get none: nothing below `facility` exists in the org
 * model.
 */
const BREAKDOWNS_BY_ROLE: Readonly<Record<RoleId, readonly OrgGrain[]>> = {
  chairman: ["region"],
  "clinical-director": ["coe", "facility"],
  "regional-coo": ["facility"],
  "hospital-dho": [],
  "people-executive": [],
  "bd-lead": [],
  "billing-lead": [],
  "coe-lead": ["facility"],
  // ADR 0011 §2 marks this row the weakest in the table: a payer dimension may
  // be what this role actually needs, not a geographic one. ADR 0012 then
  // concluded the payer dimension is not a scope grain at all, so `region`
  // stands in for something deliberately not modelled rather than being a
  // considered fit. Recorded here so it is not mistaken for a settled choice.
  "corporate-revenue-lead": ["region"],
  "group-cfo": ["region"],
  "procurement-head": ["region"],
  "hr-head": ["region"],
  "legal-head": ["region"],
  "analytics-head": ["region"],
};

/** Base grains for one role, from `deployment` plus any reviewed addition. */
export function baseGrainsForRole(roleId: RoleId): readonly OrgGrain[] {
  const role = ROLES.find((r) => r.id === roleId);
  if (!role) throw new Error(`Unknown role "${roleId}".`);

  const fromDeployment = BASE_GRAIN_BY_DEPLOYMENT[role.deployment];
  if (!fromDeployment) {
    throw new Error(
      `Role "${roleId}" has deployment "${role.deployment}", which maps to no ` +
        `base grain. ADR 0011 §1 covers four deployment values; a new one is a ` +
        `workbook change needing a reviewed rule, not a default.`,
    );
  }

  const additional = ADDITIONAL_BASE_GRAINS[roleId] ?? [];
  return [...new Set<OrgGrain>([fromDeployment, ...additional])];
}

/**
 * The full matrix: one row per role-KPI assignment.
 *
 * Throws rather than emitting a questionable row. ADR 0011 §4 asks for these to
 * fail the build rather than a review, and a generator that degrades gracefully
 * would defeat that.
 */
export function deriveEntitlements(): readonly EntitlementRow[] {
  const rows: EntitlementRow[] = [];

  for (const assignment of ROLE_KPI_ASSIGNMENTS) {
    const roleId = assignment.roleId;
    const grains = baseGrainsForRole(roleId);
    const breakdowns = BREAKDOWNS_BY_ROLE[roleId];

    if (breakdowns === undefined) {
      throw new Error(
        `Role "${roleId}" has no breakdown entry. Every one of the 14 roles ` +
          `needs an explicit entry — including an empty array — so that "none" ` +
          `is a decision rather than an omission.`,
      );
    }

    // Validate against the DAG here, not only in tests: a bad breakdown is a
    // widening of authorization, and it should be impossible to generate one.
    const base = highestGrain(grains);
    for (const breakdown of breakdowns) {
      if (!isStrictlyBelow(breakdown, base)) {
        throw new Error(
          `Role "${roleId}": breakdown "${breakdown}" is not strictly below its ` +
            `highest base grain "${base}" in the grain DAG. ADR 0011 §2 forbids ` +
            `upward and sideways breakdowns — region and coe are incomparable, ` +
            `so neither may break the other down.`,
        );
      }
    }

    rows.push({
      frameworkVersion: FRAMEWORK_MANIFEST.definitionVersion,
      roleId,
      assignmentId: assignment.assignmentId,
      grains,
      breakdowns,
    });
  }

  return rows;
}
