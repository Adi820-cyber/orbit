/**
 * Hand-written type definitions for the KPI framework package.
 * These types describe the *shape* of generated output — they are not
 * generated themselves and may be edited directly.
 *
 * Source of truth for the underlying data: `Africare_Group_KPI_Framework.xlsx`
 * (kept outside Git per docs/source-material/README.md). See
 * `scripts/import-workbook.ts` for the generator that produces
 * `src/generated/*`.
 */

/**
 * Stable slug identifying one of the 14 role types. This is the wire/storage
 * identifier used by `@orbit/contracts`, the entitlement matrix, the database,
 * and `apps/web/src/roles/*` folder names.
 *
 * Slugs are deliberately NOT derived from the workbook name by slugification
 * (e.g. "Chief / Group Clinical Medical Director" -> `clinical-director` is not
 * mechanically derivable). They come from the reviewed table in
 * `scripts/import-workbook.ts` and are kept stable even if the workbook's
 * display wording changes. The canonical workbook name is always preserved
 * separately in `RoleDefinition.name` (PRD §4 forbids renaming roles).
 */
export type RoleId =
  | "chairman"
  | "clinical-director"
  | "regional-coo"
  | "hospital-dho"
  | "people-executive"
  | "bd-lead"
  | "billing-lead"
  | "coe-lead"
  | "corporate-revenue-lead"
  | "group-cfo"
  | "procurement-head"
  | "hr-head"
  | "legal-head"
  | "analytics-head";

/** One of the 14 canonical role types from the workbook's Role KPI Matrix. */
export interface RoleDefinition {
  /**
   * Stable slug for this role. Safe to persist, index, and put in a URL.
   * Matches `RoleIdSchema` in `@orbit/contracts` and the `apps/web/src/roles/*`
   * folder names.
   */
  id: RoleId;
  /** Canonical role name exactly as it appears in the workbook. Never renamed. */
  name: string;
  /** Organizational level/grouping label from the workbook (column "Level"). */
  level: string;
  /** Who this role reports to, per the workbook. */
  reportsTo: string;
  /** Deployment shape from the Group Scorecard sheet, e.g. "2 roles; 3 hospitals each". */
  deployment: string;
  /** Primary focus statement from the Group Scorecard sheet. */
  primaryFocus: string;
  /** Reporting cadence from the Group Scorecard sheet. */
  cadence: string;
  /** Number of KPI assignments for this role. Must equal assignments.length for this role. */
  kpiCount: number;
}

/** One row from the workbook's "Role KPI Matrix" sheet (one role-KPI assignment). */
export interface RoleKpiAssignment {
  /**
   * Stable identifier for this assignment, formatted `<roleId>:<kpi-slug>`
   * (e.g. `billing-lead:claim-first-pass-acceptance-rate`).
   *
   * Safe to persist, index, reference from the entitlement matrix, and expose
   * in an API payload or URL. Deliberately NOT derived from `sourceRow`, so
   * inserting or reordering workbook rows does not change it.
   *
   * Uniqueness is guaranteed across all 109 assignments by a test; the
   * generator also fails loudly rather than emitting a duplicate. Because the
   * slug derives from the KPI title, editing a KPI's wording in the workbook
   * WILL change its id — that is a definition change that must be versioned
   * deliberately (PRD §7.2), not an invisible rename.
   */
  assignmentId: string;
  /** 1-based row number in the source workbook, for traceability only. Not an identifier. */
  sourceRow: number;
  level: string;
  /** Canonical workbook role name. Never renamed (PRD §4). */
  role: string;
  /** Stable role slug — use this for joins, storage, and entitlement lookups. */
  roleId: RoleId;
  reportsTo: string;
  /** The "Key deliverable" column — the business outcome this KPI serves. */
  keyDeliverable: string;
  /** The KPI name/title (workbook column "KPI"). */
  kpi: string;
  /** Definition / formula text exactly as authored in the workbook. */
  definition: string;
  /** Weight as a fraction (0-1). Weights for one role/version must sum to 1. */
  weight: number;
  targetBasis: string;
  review: string;
  primaryDataSource: string;
  keyCollaborator: string;
  /**
   * KPI Definitions families this assignment maps to. Most assignments map
   * to exactly one family. Some assignments bundle multiple measures (e.g.
   * "Claim clean rate and denial value" bundles two families) and map to
   * more than one, per PRD §3.1: "109 assignments are not necessarily 109
   * distinct underlying metrics... several assignments bundle multiple
   * measures." Empty array means fully unresolved — see unresolvedReason.
   */
  definitionFamilies: readonly string[];
  /**
   * Set when this assignment could not be mapped to any KPI Definitions
   * family with confidence. Never silently guessed — surfaced so consumers
   * must handle it explicitly rather than treating it as resolved.
   */
  unresolvedReason: string | null;
}

/** One row from the workbook's "KPI Definitions" sheet (a definition family). */
export interface KpiDefinitionFamily {
  sourceRow: number;
  /** Family name, e.g. "Net revenue", "DSO". */
  family: string;
  standardDefinition: string;
  numeratorDenominatorControl: string;
  targetSteward: string;
  primarySource: string;
  notes: string;
}

/** One row from the workbook's "Group Scorecard" sheet (enterprise outcome). */
export interface EnterpriseOutcome {
  sourceRow: number;
  outcome: string;
  cmoAccountability: string;
  primaryContributionOwners: string;
  targetBasis: string;
  review: string;
  dataSource: string;
}

/** One row from the workbook's "Governance & Targeting" sheet. */
export interface GovernanceRule {
  sourceRow: number;
  kpiFamily: string;
  targetSettingApproach: string;
  targetOwner: string;
  definitionOwner: string;
  reportingCadence: string;
  escalationReview: string;
}

/** Manifest describing the source workbook and generation provenance. */
export interface FrameworkManifest {
  /** SHA-256 checksum of the exact workbook bytes used for this generation. */
  sourceChecksum: string;
  /** Original workbook filename (not a path — never leaks a local path). */
  sourceFileName: string;
  /** Version stamp for this generated framework snapshot. */
  definitionVersion: string;
  roleCount: number;
  assignmentCount: number;
  definitionFamilyCount: number;
  /** Assignment rows that could not be resolved to one definition family. */
  unresolvedAssignmentCount: number;
}
