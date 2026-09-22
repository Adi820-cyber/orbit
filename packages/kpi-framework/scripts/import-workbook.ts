/**
 * Workbook importer for @orbit/kpi-framework.
 *
 * Reads `Africare_Group_KPI_Framework.xlsx` and generates the typed,
 * checksummed source files under `src/generated/`. This is the ONLY
 * supported way to produce those files — never hand-edit generated output.
 *
 * Usage:
 *   npm run import -- <path-to-xlsx>
 *
 * The workbook path is provided at run time and is never committed or
 * hardcoded, per docs/source-material/README.md.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type {
  RoleDefinition,
  RoleKpiAssignment,
  KpiDefinitionFamily,
  EnterpriseOutcome,
  GovernanceRule,
  FrameworkManifest,
} from "../src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src/generated");

const ROLE_MATRIX_SHEET = "Role KPI Matrix";
const KPI_DEFINITIONS_SHEET = "KPI Definitions";
const GROUP_SCORECARD_SHEET = "Group Scorecard";
const GOVERNANCE_SHEET = "Governance & Targeting";

// Fixed row ranges verified by direct inspection of the workbook.
// If a future workbook revision changes these, the invariant tests in
// src/__tests__ will fail loudly rather than silently importing wrong data.
const ROLE_MATRIX_DATA_ROWS = { start: 6, end: 114 };
const KPI_DEFINITIONS_DATA_ROWS = { start: 6, end: 34 };
const GROUP_SCORECARD_OUTCOME_ROWS = { start: 5, end: 12 };
const GROUP_SCORECARD_CASCADE_ROWS = { start: 16, end: 29 };
const GOVERNANCE_DATA_ROWS = { start: 5, end: 14 };

function cellString(row: ExcelJS.Row, col: number): string {
  const value = row.getCell(col).value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) {
    // Formula cell (e.g. COUNTIF) — use its computed result.
    return String((value as { result: unknown }).result ?? "");
  }
  return String(value).trim();
}

function cellNumber(row: ExcelJS.Row, col: number): number {
  const value = row.getCell(col).value;
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return NaN;
  if (typeof value === "object" && "result" in value) {
    const result = (value as { result: unknown }).result;
    return typeof result === "number" ? result : NaN;
  }
  return NaN;
}

/**
 * Reviewed mapping from Role KPI Matrix assignment titles to one or more
 * KPI Definitions family names. This is a manually authored, reviewed
 * decomposition — not an automatic guess. Each entry was checked against
 * the workbook's "KPI Definitions" sheet (29 families) and the assignment's
 * own definition/formula text.
 *
 * Multi-family entries reflect PRD §3.1: "109 assignments are not
 * necessarily 109 distinct underlying metrics... several assignments
 * bundle multiple measures." Bundled assignments list every family they
 * combine, in the order the assignment's formula/title presents them.
 *
 * Keys are lowercased assignment KPI titles for case-insensitive lookup.
 */
const ASSIGNMENT_TO_FAMILIES: Record<string, readonly string[]> = {
  // Chairman
  "group net revenue vs approved budget": ["Net revenue"],
  "group ebitda vs approved budget": ["EBITDA"],
  "operating cash flow and working capital vs plan": ["Operating cash flow"],
  "group clinical quality and safety index": ["Clinical quality scorecard"],
  "group patient experience index": ["Patient experience"],
  "coe, corporate and expansion milestones": ["COE contribution", "Contract utilisation"],
  "critical governance, legal and audit actions closed": ["Legal and compliance closure"],

  // Chief / Group Clinical Medical Director
  "clinical quality scorecard": ["Clinical quality scorecard"],
  "serious adverse-event rate and review closure": ["Serious adverse events"],
  "protocol compliance and critical audit closure": ["Protocol compliance"],
  "clinical patient experience score": ["Patient experience"],
  "medical credentialing and capability completion": ["Mandatory learning / credentialing"],

  // Regional COO
  "coe revenue and contribution vs plan": ["COE contribution"],
  "clinical propositions converted to revenue": ["New business revenue", "Qualified pipeline"],

  // Billing & Revenue Lead / Corporate Revenue & Insurance Lead
  "claim clean rate and denial value": ["First-pass claim acceptance", "Denied or rejected claim value"],
  "new service, coe and corporate revenue vs plan": ["New business revenue", "COE contribution"],
  "claim first-pass acceptance and rejection value": [
    "First-pass claim acceptance",
    "Denied or rejected claim value",
  ],
  "claim first-pass acceptance rate": ["First-pass claim acceptance"],
  "claim submission turnaround time": ["First-pass claim acceptance"],
  "rejected or denied claim value": ["Denied or rejected claim value"],
  "payer reconciliation and documentation completeness": ["Unbilled revenue"],
  "revenue leakage and avoidable credit notes": ["Unbilled revenue"],

  // Hospital DHO
  "facility readiness, licensure and safety actions": ["Legal and compliance closure"],

  // People Executive
  "approved position fill rate and time to fill": ["Critical-role attrition"],
  "roster adherence and labour productivity": ["Workforce productivity"],
  "performance review and talent-matrix completion": ["Mandatory learning / credentialing"],
  "mandatory training and credentialing completion": ["Mandatory learning / credentialing"],
  "hr and statutory actions closed on time": ["Legal and compliance closure"],
  "manpower cost vs plan": ["Workforce productivity"],

  // Business Development Lead
  "lead-to-revenue conversion": ["New business revenue", "Qualified pipeline"],
  "active referrer network and referral revenue": ["Referral conversion", "New business revenue"],
  "new-service and coe lead conversion": ["Qualified pipeline", "COE contribution"],
  "corporate opportunities handed over and accepted": ["Qualified pipeline"],
  "acquisition economics vs plan": ["New business revenue"],

  // COE Lead
  "approved coe programme milestones": ["COE contribution"],

  // Corporate Revenue & Insurance Lead
  "active contracted accounts vs plan": ["Contract utilisation"],
  "new corporate and insurer tie-up conversion": ["Qualified pipeline"],
  "contract renewal and account retention rate": ["Contract utilisation"],
  "commercial term yield": ["Contract utilisation"],
  "payer issue closure": ["Denied or rejected claim value"],

  // Group CFO
  "cash flow, liquidity and working capital vs plan": ["Operating cash flow"],
  "forecast and budget quality": ["Forecast accuracy"],
  "controllable cost improvement vs plan": ["Procurement savings"],
  "financial controls and leakage actions closed": ["Legal and compliance closure"],
  "finance compliance and audit-action closure": ["Legal and compliance closure"],

  // Procurement Head
  "contract and purchase-order compliance": ["Legal and compliance closure"],
  "critical consumable stockouts and service disruption": ["Inventory days / obsolete stock"],
  "inventory days and obsolete stock": ["Inventory days / obsolete stock"],
  "purchase request to purchase-order turnaround": ["Procurement savings"],
  "supplier quality and service-level performance": ["Procurement savings"],
  "rate-card adherence and maverick spend": ["Procurement savings"],
  "supplier risk and continuity actions closed": ["Inventory days / obsolete stock"],

  // HR Head
  "group workforce cost and productivity vs plan": ["Workforce productivity"],
  "critical-role staffing and time to hire": ["Critical-role attrition"],
  "mandatory learning, capability and succession coverage": ["Mandatory learning / credentialing"],
  "performance-management and talent-review completion": ["Mandatory learning / credentialing"],
  "employment compliance and grievance closure": ["Legal and compliance closure"],

  // Legal Head
  "contract turnaround time": ["Legal and compliance closure"],
  "high-risk contract review and approval compliance": ["Legal and compliance closure"],
  "license, filing and regulatory-calendar compliance": ["Legal and compliance closure"],
  "material litigation and dispute action milestones": ["Legal and compliance closure"],
  "commercial and payer dispute support turnaround": ["Legal and compliance closure"],
  "policy refresh and required legal training completion": ["Legal and compliance closure"],
  "governance and audit legal actions closed": ["Legal and compliance closure"],

  // Head of Analytics & Digital Transformation
  "kpi dashboard availability and refresh on time": ["KPI data quality"],
  "monthly kpi pack delivered to calendar": ["KPI data quality"],
  "priority dashboard adoption and report rationalisation": ["KPI data quality"],
  "approved insight actions closed": ["KPI data quality"],
  "digital roadmap and benefit realisation": ["Forecast accuracy"],
};

/**
 * Maps a role-KPI assignment to one or more KPI Definitions families.
 * Order of attempts: exact family-name match, reviewed override table,
 * substring containment. Never guesses — unmapped assignments are flagged
 * `unresolved` for manual review rather than faked.
 */
function resolveDefinitionFamilies(
  kpi: string,
  definitionFamilies: readonly KpiDefinitionFamily[],
): { families: readonly string[]; unresolvedReason: string | null } {
  const familyNames = definitionFamilies.map((f) => f.family);
  const key = kpi.toLowerCase();

  const exact = familyNames.find((f) => f.toLowerCase() === key);
  if (exact) return { families: [exact], unresolvedReason: null };

  const override = ASSIGNMENT_TO_FAMILIES[key];
  if (override) {
    const invalid = override.filter((f) => !familyNames.includes(f));
    if (invalid.length > 0) {
      return {
        families: [],
        unresolvedReason: `Override table references unknown family/families: ${invalid.join(", ")}.`,
      };
    }
    return { families: override, unresolvedReason: null };
  }

  const contains = familyNames.find(
    (f) => key.includes(f.toLowerCase()) || f.toLowerCase().includes(key),
  );
  if (contains) return { families: [contains], unresolvedReason: null };

  return {
    families: [],
    unresolvedReason: `No KPI Definitions family matched assignment KPI "${kpi}". Requires manual review.`,
  };
}

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    console.error("Usage: npm run import -- <path-to-xlsx>");
    process.exit(1);
  }

  const absolutePath = resolve(workbookPath);
  const fileBuffer = await readFile(absolutePath);
  const sourceChecksum = createHash("sha256").update(fileBuffer).digest("hex");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);

  const matrixSheet = workbook.getWorksheet(ROLE_MATRIX_SHEET);
  const definitionsSheet = workbook.getWorksheet(KPI_DEFINITIONS_SHEET);
  const scorecardSheet = workbook.getWorksheet(GROUP_SCORECARD_SHEET);
  const governanceSheet = workbook.getWorksheet(GOVERNANCE_SHEET);

  if (!matrixSheet || !definitionsSheet || !scorecardSheet || !governanceSheet) {
    throw new Error(
      "Expected all four sheets (Group Scorecard, Role KPI Matrix, KPI Definitions, " +
        "Governance & Targeting) to be present. Workbook structure may have changed.",
    );
  }

  // --- KPI Definitions (must be parsed first; assignments resolve against it) ---
  const definitionFamilies: KpiDefinitionFamily[] = [];
  for (let r = KPI_DEFINITIONS_DATA_ROWS.start; r <= KPI_DEFINITIONS_DATA_ROWS.end; r++) {
    const row = definitionsSheet.getRow(r);
    const family = cellString(row, 1);
    if (!family) continue;
    definitionFamilies.push({
      sourceRow: r,
      family,
      standardDefinition: cellString(row, 2),
      numeratorDenominatorControl: cellString(row, 3),
      targetSteward: cellString(row, 4),
      primarySource: cellString(row, 5),
      notes: cellString(row, 6),
    });
  }

  // --- Role KPI Matrix (109 assignments) ---
  const assignments: RoleKpiAssignment[] = [];
  for (let r = ROLE_MATRIX_DATA_ROWS.start; r <= ROLE_MATRIX_DATA_ROWS.end; r++) {
    const row = matrixSheet.getRow(r);
    const role = cellString(row, 2);
    if (!role) continue;

    const kpi = cellString(row, 5);
    const { families, unresolvedReason } = resolveDefinitionFamilies(kpi, definitionFamilies);

    assignments.push({
      sourceRow: r,
      level: cellString(row, 1),
      role,
      reportsTo: cellString(row, 3),
      keyDeliverable: cellString(row, 4),
      kpi,
      definition: cellString(row, 6),
      weight: cellNumber(row, 7),
      targetBasis: cellString(row, 8),
      review: cellString(row, 9),
      primaryDataSource: cellString(row, 10),
      keyCollaborator: cellString(row, 11),
      definitionFamilies: families,
      unresolvedReason,
    });
  }

  // --- Group Scorecard: enterprise outcomes ---
  const enterpriseOutcomes: EnterpriseOutcome[] = [];
  for (let r = GROUP_SCORECARD_OUTCOME_ROWS.start; r <= GROUP_SCORECARD_OUTCOME_ROWS.end; r++) {
    const row = scorecardSheet.getRow(r);
    const outcome = cellString(row, 1);
    if (!outcome) continue;
    enterpriseOutcomes.push({
      sourceRow: r,
      outcome,
      cmoAccountability: cellString(row, 2),
      primaryContributionOwners: cellString(row, 3),
      targetBasis: cellString(row, 4),
      review: cellString(row, 5),
      dataSource: cellString(row, 6),
    });
  }

  // --- Group Scorecard: accountability cascade → role definitions ---
  const roles: RoleDefinition[] = [];
  for (let r = GROUP_SCORECARD_CASCADE_ROWS.start; r <= GROUP_SCORECARD_CASCADE_ROWS.end; r++) {
    const row = scorecardSheet.getRow(r);
    const name = cellString(row, 1);
    if (!name) continue;
    roles.push({
      name,
      level: "", // filled in below from matrix rows
      deployment: cellString(row, 2),
      reportsTo: cellString(row, 3),
      primaryFocus: cellString(row, 4),
      kpiCount: cellNumber(row, 5),
      cadence: cellString(row, 6),
    });
  }
  // Backfill "level" per role from the matrix (first matching assignment).
  for (const role of roles) {
    const match = assignments.find((a) => a.role === role.name);
    if (match) role.level = match.level;
  }

  // --- Governance & Targeting ---
  const governanceRules: GovernanceRule[] = [];
  for (let r = GOVERNANCE_DATA_ROWS.start; r <= GOVERNANCE_DATA_ROWS.end; r++) {
    const row = governanceSheet.getRow(r);
    const kpiFamily = cellString(row, 1);
    if (!kpiFamily) continue;
    governanceRules.push({
      sourceRow: r,
      kpiFamily,
      targetSettingApproach: cellString(row, 2),
      targetOwner: cellString(row, 3),
      definitionOwner: cellString(row, 4),
      reportingCadence: cellString(row, 5),
      escalationReview: cellString(row, 6),
    });
  }

  // --- Manifest ---
  const unresolvedCount = assignments.filter((a) => a.definitionFamilies.length === 0).length;
  const manifest: FrameworkManifest = {
    sourceChecksum,
    sourceFileName: basename(absolutePath),
    generatedAt: new Date().toISOString(),
    definitionVersion: "v1",
    roleCount: roles.length,
    assignmentCount: assignments.length,
    definitionFamilyCount: definitionFamilies.length,
    unresolvedAssignmentCount: unresolvedCount,
  };

  await mkdir(OUT_DIR, { recursive: true });

  const header =
    `/**\n * GENERATED FILE — DO NOT EDIT BY HAND.\n * Produced by scripts/import-workbook.ts from ${manifest.sourceFileName}.\n * Regenerate with: npm run import -- <path-to-xlsx>\n */\n\n`;

  await writeFile(
    resolve(OUT_DIR, "roles.ts"),
    header +
      `import type { RoleDefinition } from "../types.ts";\n\n` +
      `export const ROLES: readonly RoleDefinition[] = ${JSON.stringify(roles, null, 2)} as const;\n`,
  );

  await writeFile(
    resolve(OUT_DIR, "kpi-definitions.ts"),
    header +
      `import type { KpiDefinitionFamily } from "../types.ts";\n\n` +
      `export const KPI_DEFINITIONS: readonly KpiDefinitionFamily[] = ${JSON.stringify(
        definitionFamilies,
        null,
        2,
      )} as const;\n`,
  );

  await writeFile(
    resolve(OUT_DIR, "role-kpi-assignments.ts"),
    header +
      `import type { RoleKpiAssignment } from "../types.ts";\n\n` +
      `export const ROLE_KPI_ASSIGNMENTS: readonly RoleKpiAssignment[] = ${JSON.stringify(
        assignments,
        null,
        2,
      )} as const;\n`,
  );

  await writeFile(
    resolve(OUT_DIR, "enterprise-outcomes.ts"),
    header +
      `import type { EnterpriseOutcome } from "../types.ts";\n\n` +
      `export const ENTERPRISE_OUTCOMES: readonly EnterpriseOutcome[] = ${JSON.stringify(
        enterpriseOutcomes,
        null,
        2,
      )} as const;\n`,
  );

  await writeFile(
    resolve(OUT_DIR, "governance-rules.ts"),
    header +
      `import type { GovernanceRule } from "../types.ts";\n\n` +
      `export const GOVERNANCE_RULES: readonly GovernanceRule[] = ${JSON.stringify(
        governanceRules,
        null,
        2,
      )} as const;\n`,
  );

  await writeFile(
    resolve(OUT_DIR, "manifest.ts"),
    header +
      `import type { FrameworkManifest } from "../types.ts";\n\n` +
      `export const FRAMEWORK_MANIFEST: FrameworkManifest = ${JSON.stringify(manifest, null, 2)};\n`,
  );

  console.log("Import complete:");
  console.log(`  Roles: ${manifest.roleCount}`);
  console.log(`  Assignments: ${manifest.assignmentCount}`);
  console.log(`  Definition families: ${manifest.definitionFamilyCount}`);
  console.log(`  Unresolved assignments: ${manifest.unresolvedAssignmentCount}`);
  console.log(`  Source checksum: ${manifest.sourceChecksum}`);
  if (unresolvedCount > 0) {
    console.warn(
      `\nWARNING: ${unresolvedCount} assignment(s) could not be mapped to a definition family. ` +
        `See src/generated/role-kpi-assignments.ts for details (unresolvedReason field).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
