/**
 * Public API of `@orbit/kpi-framework`.
 *
 * This package is the single source of truth for the workbook framework:
 * 14 roles, 109 role-KPI assignments, 29 definition families, 8 enterprise
 * outcomes, and the governance/targeting rules (TEAM_ASSIGNMENTS.md §5).
 *
 * Everything under `./generated/` is produced by `scripts/import-workbook.ts`
 * from `Africare_Group_KPI_Framework.xlsx` and must never be hand-edited.
 * Regenerate with: `npm run import -- <path-to-xlsx>`
 */

export type {
  RoleId,
  RoleDefinition,
  RoleKpiAssignment,
  KpiDefinitionFamily,
  EnterpriseOutcome,
  GovernanceRule,
  FrameworkManifest,
} from "./types.ts";

export { ROLES } from "./generated/roles.ts";
export { ROLE_KPI_ASSIGNMENTS } from "./generated/role-kpi-assignments.ts";
export { KPI_DEFINITIONS } from "./generated/kpi-definitions.ts";
export { ENTERPRISE_OUTCOMES } from "./generated/enterprise-outcomes.ts";
export { GOVERNANCE_RULES } from "./generated/governance-rules.ts";
export { FRAMEWORK_MANIFEST } from "./generated/manifest.ts";

import type { RoleDefinition, RoleId, RoleKpiAssignment, KpiDefinitionFamily } from "./types.ts";
import { ROLES } from "./generated/roles.ts";
import { ROLE_KPI_ASSIGNMENTS } from "./generated/role-kpi-assignments.ts";
import { KPI_DEFINITIONS } from "./generated/kpi-definitions.ts";

/**
 * All 14 stable role slugs. Use this to derive a contracts enum or a database
 * check constraint so the list never drifts from the workbook import.
 */
export const ROLE_IDS: readonly RoleId[] = ROLES.map((r) => r.id);

/** Look up a role by its stable slug. Returns `undefined` for an unknown id. */
export function getRole(roleId: RoleId): RoleDefinition | undefined {
  return ROLES.find((r) => r.id === roleId);
}

/**
 * Every assignment belonging to one role, in workbook order.
 * Returns an empty array for an unknown id — callers that require a
 * non-empty result should check, rather than assuming the role exists.
 */
export function getAssignmentsForRole(roleId: RoleId): readonly RoleKpiAssignment[] {
  return ROLE_KPI_ASSIGNMENTS.filter((a) => a.roleId === roleId);
}

/** Look up a single assignment by its stable `<roleId>:<kpi-slug>` id. */
export function getAssignment(assignmentId: string): RoleKpiAssignment | undefined {
  return ROLE_KPI_ASSIGNMENTS.find((a) => a.assignmentId === assignmentId);
}

/** Look up a KPI definition family by its exact workbook family name. */
export function getDefinitionFamily(family: string): KpiDefinitionFamily | undefined {
  return KPI_DEFINITIONS.find((d) => d.family === family);
}

/**
 * The definition families backing one assignment, resolved to full rows.
 *
 * Most assignments resolve to exactly one family; 8 of the 109 bundle two
 * (PRD §3.1). Callers must handle the multi-family case rather than assuming
 * a single definition — see ADR 0004.
 */
export function getDefinitionFamiliesForAssignment(
  assignmentId: string,
): readonly KpiDefinitionFamily[] {
  const assignment = getAssignment(assignmentId);
  if (!assignment) return [];
  return assignment.definitionFamilies
    .map((family) => getDefinitionFamily(family))
    .filter((d): d is KpiDefinitionFamily => d !== undefined);
}
