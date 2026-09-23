/**
 * Generates the deterministic seed for the framework, organization structure,
 * and entitlement matrix.
 *
 *   npm run generate --workspace=@orbit/data-gen
 *
 * Writes:
 *   supabase/seed/0001_framework_and_org.sql   — idempotent seed
 *   data/snapshots/seed-manifest.json          — reviewable summary + checksum
 *
 * WHAT IS AND IS NOT HERE
 *   Reference and authorization data only: the workbook framework, the fictional
 *   org structure, and the derived entitlement matrix. All of it is mechanically
 *   derived from `@orbit/kpi-framework` and `COMPANY_MANIFEST`.
 *
 *   NOT here: memberships, and no synthetic facts or KPI observations.
 *
 *   Memberships are excluded because `org_memberships.subject` is a Supabase
 *   Auth user id. Inventing UUIDs would create membership rows pointing at
 *   users that do not exist, which is worse than having none — the API would
 *   resolve a membership for a subject that can never authenticate. They land
 *   once demo accounts are provisioned (PRD §8.1), which is a separate step.
 *
 *   Facts and observations are deliberately separate work (PRD §8.2, facts
 *   first then derived KPIs) and must not be seeded while the legacy
 *   `service_role` key is still enabled — ADR 0008 §4.1's window.
 *
 * IDEMPOTENT BY CONSTRUCTION
 *   Every insert is `on conflict ... do nothing` or guarded by the natural key,
 *   so re-running is safe. `data:reset` stays a separate, explicit command
 *   (ARCH §7.5) and is not implemented here.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENTERPRISE_OUTCOMES,
  FRAMEWORK_MANIFEST,
  GOVERNANCE_RULES,
  KPI_DEFINITIONS,
  ROLES,
  ROLE_KPI_ASSIGNMENTS,
} from "@orbit/kpi-framework";

import { COMPANY_MANIFEST } from "../src/manifest.ts";
import { deriveEntitlements } from "../src/entitlements.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const seedPath = resolve(repoRoot, "supabase/seed/0001_framework_and_org.sql");
const snapshotPath = resolve(repoRoot, "data/snapshots/seed-manifest.json");

/** Single-quote a SQL string literal, escaping embedded quotes. */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A Postgres text[] literal. */
function textArray(values: readonly string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map(q).join(", ")}]::text[]`;
}

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("-- =========================================================================");
w("-- 0001_framework_and_org.sql");
w("--");
w("-- GENERATED FILE — DO NOT EDIT BY HAND.");
w("-- Produced by packages/data-gen/scripts/generate-seed.ts");
w("-- Regenerate with: npm run generate --workspace=@orbit/data-gen");
w("--");
w(`-- Framework source : ${FRAMEWORK_MANIFEST.sourceFileName}`);
w(`-- Framework version: ${FRAMEWORK_MANIFEST.definitionVersion}`);
w(`-- Source checksum  : ${FRAMEWORK_MANIFEST.sourceChecksum}`);
w(`-- Company manifest : ${COMPANY_MANIFEST.manifestVersion} (seed ${COMPANY_MANIFEST.seed})`);
w("--");
w("-- Idempotent: safe to re-run. Contains no memberships, no facts, and no KPI");
w("-- observations — see the script header for why each is excluded.");
w("-- =========================================================================");
w();
w("begin;");
w();

// ---------------------------------------------------------------------------
// Framework version
// ---------------------------------------------------------------------------
w("-- Framework version -------------------------------------------------------");
w("insert into orbit.framework_versions");
w("  (version, source_file_name, source_checksum, role_count, assignment_count,");
w("   definition_count, is_current)");
w("values (");
w(`  ${q(FRAMEWORK_MANIFEST.definitionVersion)},`);
w(`  ${q(FRAMEWORK_MANIFEST.sourceFileName)},`);
w(`  ${q(FRAMEWORK_MANIFEST.sourceChecksum)},`);
w(`  ${FRAMEWORK_MANIFEST.roleCount}, ${FRAMEWORK_MANIFEST.assignmentCount},`);
w(`  ${FRAMEWORK_MANIFEST.definitionFamilyCount}, true`);
w(")");
w("on conflict (version) do nothing;");
w();
w("-- Resolved once and reused below, so the seed never depends on a literal id.");
w("create temp table _fv on commit drop as");
w(`  select id from orbit.framework_versions where version = ${q(FRAMEWORK_MANIFEST.definitionVersion)};`);
w();

// ---------------------------------------------------------------------------
// Role ids
// ---------------------------------------------------------------------------
w("-- Canonical role slugs (version-independent) -----------------------------");
w("insert into orbit.role_ids (role_id) values");
w(ROLES.map((r) => `  (${q(r.id)})`).join(",\n"));
w("on conflict (role_id) do nothing;");
w();

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
w("-- Roles (versioned detail) ------------------------------------------------");
w("insert into orbit.roles");
w("  (framework_version_id, role_id, name, level, reports_to, deployment,");
w("   primary_focus, cadence, kpi_count)");
w("select fv.id, v.* from _fv fv, (values");
w(
  ROLES.map(
    (r) =>
      `  (${q(r.id)}, ${q(r.name)}, ${q(r.level)}, ${q(r.reportsTo)}, ` +
      `${q(r.deployment)}, ${q(r.primaryFocus)}, ${q(r.cadence)}, ${r.kpiCount})`,
  ).join(",\n"),
);
w(") as v(role_id, name, level, reports_to, deployment, primary_focus, cadence, kpi_count)");
w("on conflict (framework_version_id, role_id) do nothing;");
w();

// ---------------------------------------------------------------------------
// KPI definition families
// ---------------------------------------------------------------------------
w("-- KPI definition families (29) -------------------------------------------");
w("insert into orbit.kpi_definitions");
w("  (framework_version_id, family, standard_definition,");
w("   numerator_denominator_control, target_steward, primary_source, notes, source_row)");
w("select fv.id, v.* from _fv fv, (values");
w(
  KPI_DEFINITIONS.map(
    (d) =>
      `  (${q(d.family)}, ${q(d.standardDefinition)}, ${q(d.numeratorDenominatorControl)}, ` +
      `${q(d.targetSteward)}, ${q(d.primarySource)}, ${q(d.notes)}, ${d.sourceRow})`,
  ).join(",\n"),
);
w(") as v(family, standard_definition, numerator_denominator_control,");
w("       target_steward, primary_source, notes, source_row)");
w("on conflict (framework_version_id, family) do nothing;");
w();

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
w("-- Role-KPI assignments (109) ---------------------------------------------");
w("insert into orbit.role_kpi_assignments");
w("  (framework_version_id, assignment_id, role_id, kpi, key_deliverable, definition,");
w("   weight, target_basis, review, primary_data_source, key_collaborator, source_row)");
w("select fv.id, v.* from _fv fv, (values");
w(
  ROLE_KPI_ASSIGNMENTS.map(
    (a) =>
      `  (${q(a.assignmentId)}, ${q(a.roleId)}, ${q(a.kpi)}, ${q(a.keyDeliverable)}, ` +
      `${q(a.definition)}, ${a.weight}, ${q(a.targetBasis)}, ${q(a.review)}, ` +
      `${q(a.primaryDataSource)}, ${q(a.keyCollaborator)}, ${a.sourceRow})`,
  ).join(",\n"),
);
w(") as v(assignment_id, role_id, kpi, key_deliverable, definition, weight,");
w("       target_basis, review, primary_data_source, key_collaborator, source_row)");
w("on conflict (framework_version_id, assignment_id) do nothing;");
w();

// ---------------------------------------------------------------------------
// Definition components
// ---------------------------------------------------------------------------
w("-- Assignment -> definition family mapping --------------------------------");
w("-- 8 of the 109 map to two families (ADR 0004). component_position preserves");
w("-- the order the assignment's own title presents the measures in.");
w("insert into orbit.definition_components");
w("  (framework_version_id, assignment_id, family, component_position, unresolved_reason)");
w("select fv.id, v.* from _fv fv, (values");
{
  const rows: string[] = [];
  for (const a of ROLE_KPI_ASSIGNMENTS) {
    a.definitionFamilies.forEach((family, i) => {
      const reason = a.unresolvedReason === null ? "null" : q(a.unresolvedReason);
      rows.push(`  (${q(a.assignmentId)}, ${q(family)}, ${i}, ${reason})`);
    });
  }
  w(rows.join(",\n"));
}
w(") as v(assignment_id, family, component_position, unresolved_reason)");
w("on conflict (framework_version_id, assignment_id, family) do nothing;");
w();

// ---------------------------------------------------------------------------
// Governance rules
// ---------------------------------------------------------------------------
w("-- Governance and targeting rules -----------------------------------------");
w("-- Records HOW targets are set. Contains no approved numeric targets: the");
w("-- workbook has none (PRD §3.1) and inventing them is forbidden.");
w("insert into orbit.governance_rules");
w("  (framework_version_id, kpi_family_group, target_setting_approach, target_owner,");
w("   definition_owner, reporting_cadence, escalation_review, source_row)");
w("select fv.id, v.* from _fv fv, (values");
w(
  GOVERNANCE_RULES.map(
    (g) =>
      `  (${q(g.kpiFamily)}, ${q(g.targetSettingApproach)}, ${q(g.targetOwner)}, ` +
      `${q(g.definitionOwner)}, ${q(g.reportingCadence)}, ${q(g.escalationReview)}, ${g.sourceRow})`,
  ).join(",\n"),
);
w(") as v(kpi_family_group, target_setting_approach, target_owner,");
w("       definition_owner, reporting_cadence, escalation_review, source_row)");
w("on conflict (framework_version_id, kpi_family_group) do nothing;");
w();

// ---------------------------------------------------------------------------
// Enterprise outcomes
// ---------------------------------------------------------------------------
w("-- Enterprise outcomes (8) ------------------------------------------------");
w("insert into orbit.enterprise_outcomes");
w("  (framework_version_id, outcome, cmo_accountability, primary_contribution_owners,");
w("   target_basis, review, data_source, source_row)");
w("select fv.id, v.* from _fv fv, (values");
w(
  ENTERPRISE_OUTCOMES.map(
    (o) =>
      `  (${q(o.outcome)}, ${q(o.cmoAccountability)}, ${q(o.primaryContributionOwners)}, ` +
      `${q(o.targetBasis)}, ${q(o.review)}, ${q(o.dataSource)}, ${o.sourceRow})`,
  ).join(",\n"),
);
w(") as v(outcome, cmo_accountability, primary_contribution_owners,");
w("       target_basis, review, data_source, source_row)");
w("on conflict (framework_version_id, outcome) do nothing;");
w();

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
w("-- Organizations ----------------------------------------------------------");
w("insert into orbit.organizations");
w("  (slug, name, kind, currency, fiscal_year_start_month, timezone)");
w("values");
w(
  COMPANY_MANIFEST.organizations
    .map(
      (o) =>
        `  (${q(o.slug)}, ${q(o.name)}, ${q(o.kind)}, ${q(COMPANY_MANIFEST.scale.currency)}, ` +
        `${COMPANY_MANIFEST.fiscalCalendar.startMonth}, ${q(COMPANY_MANIFEST.timezone)})`,
    )
    .join(",\n"),
);
w("on conflict (slug) do nothing;");
w();

const demoOrg = COMPANY_MANIFEST.organizations.find((o) => o.kind === "demo")!;

w("-- Regions ---------------------------------------------------------------");
w("insert into orbit.regions (organization_id, slug, name, short_name)");
w("select o.id, v.* from orbit.organizations o, (values");
w(
  COMPANY_MANIFEST.regions
    .map((r) => `  (${q(r.slug)}, ${q(r.name)}, ${q(r.shortName)})`)
    .join(",\n"),
);
w(") as v(slug, name, short_name)");
w(`where o.slug = ${q(demoOrg.slug)}`);
w("on conflict (organization_id, slug) do nothing;");
w();

w("-- Facilities ------------------------------------------------------------");
w("-- staffed_beds is a capacity ANCHOR the generator derives bed days from,");
w("-- not an observation. revenue_weight distributes group anchors; sums to 1.");
w("insert into orbit.facilities");
w("  (organization_id, region_id, slug, name, staffed_beds, revenue_weight)");
w("select o.id, r.id, v.slug, v.name, v.staffed_beds, v.revenue_weight");
w("from orbit.organizations o");
w("join orbit.regions r on r.organization_id = o.id");
w(", (values");
w(
  COMPANY_MANIFEST.facilities
    .map(
      (f) =>
        `  (${q(f.slug)}, ${q(f.name)}, ${q(f.regionSlug)}, ${f.staffedBeds}, ${f.revenueWeight})`,
    )
    .join(",\n"),
);
w(") as v(slug, name, region_slug, staffed_beds, revenue_weight)");
w(`where o.slug = ${q(demoOrg.slug)} and r.slug = v.region_slug`);
w("on conflict (organization_id, slug) do nothing;");
w();

w("-- Centres of excellence -------------------------------------------------");
w("-- Configuration choice, not a workbook fact (PRD §4 item 8). COE output");
w("-- OVERLAPS facility totals; it is a segment view and must never be added to");
w("-- the group twice (PRD §8.2).");
w("insert into orbit.coes");
w("  (organization_id, host_facility_id, slug, name, reporting_grain, region_id)");
w("select o.id, f.id, v.slug, v.name, v.reporting_grain,");
w("       (select r.id from orbit.regions r");
w("         where r.organization_id = o.id and r.slug = v.region_slug)");
w("from orbit.organizations o");
w("join orbit.facilities f on f.organization_id = o.id");
w(", (values");
w(
  COMPANY_MANIFEST.coes
    .map(
      (c) =>
        `  (${q(c.slug)}, ${q(c.name)}, ${q(c.hostFacilitySlug)}, ` +
        `${q(c.reportingGrain)}, ${c.regionSlug === null ? "null" : q(c.regionSlug)})`,
    )
    .join(",\n"),
);
w(") as v(slug, name, host_slug, reporting_grain, region_slug)");
w(`where o.slug = ${q(demoOrg.slug)} and f.slug = v.host_slug`);
w("on conflict (organization_id, slug) do nothing;");
w();

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------
const entitlements = deriveEntitlements();

w("-- Entitlement matrix (ADR 0011) ----------------------------------------");
w("-- Global per framework version, keyed by role and assignment (ADR 0005).");
w("-- No organization column: this says what a ROLE may see, not what a tenant");
w("-- owns. Derived mechanically from `deployment` plus the reviewed breakdown");
w("-- table; every row is re-derivable and checked by build-failing tests.");
w("insert into orbit.entitlements");
w("  (framework_version_id, role_id, assignment_id, grains, breakdowns)");
w("select fv.id, v.* from _fv fv, (values");
w(
  entitlements
    .map(
      (e) =>
        `  (${q(e.roleId)}, ${q(e.assignmentId)}, ${textArray(e.grains)}, ${textArray(e.breakdowns)})`,
    )
    .join(",\n"),
);
w(") as v(role_id, assignment_id, grains, breakdowns)");
w("on conflict (framework_version_id, role_id, assignment_id) do nothing;");
w();
w("commit;");
w();

const sql = lines.join("\n");
const checksum = createHash("sha256").update(sql).digest("hex");

await mkdir(dirname(seedPath), { recursive: true });
await writeFile(seedPath, sql, "utf8");

const componentRows = ROLE_KPI_ASSIGNMENTS.reduce((n, a) => n + a.definitionFamilies.length, 0);

const snapshot = {
  generatedBy: "packages/data-gen/scripts/generate-seed.ts",
  frameworkVersion: FRAMEWORK_MANIFEST.definitionVersion,
  frameworkSourceFile: FRAMEWORK_MANIFEST.sourceFileName,
  frameworkSourceChecksum: FRAMEWORK_MANIFEST.sourceChecksum,
  companyManifestVersion: COMPANY_MANIFEST.manifestVersion,
  seed: COMPANY_MANIFEST.seed,
  provenance: COMPANY_MANIFEST.provenance,
  disclosure: COMPANY_MANIFEST.disclosure,
  seedFile: "supabase/seed/0001_framework_and_org.sql",
  seedChecksum: checksum,
  rowCounts: {
    frameworkVersions: 1,
    roleIds: ROLES.length,
    roles: ROLES.length,
    kpiDefinitions: KPI_DEFINITIONS.length,
    roleKpiAssignments: ROLE_KPI_ASSIGNMENTS.length,
    definitionComponents: componentRows,
    governanceRules: GOVERNANCE_RULES.length,
    enterpriseOutcomes: ENTERPRISE_OUTCOMES.length,
    organizations: COMPANY_MANIFEST.organizations.length,
    regions: COMPANY_MANIFEST.regions.length,
    facilities: COMPANY_MANIFEST.facilities.length,
    coes: COMPANY_MANIFEST.coes.length,
    entitlements: entitlements.length,
  },
  excluded: {
    memberships:
      "org_memberships.subject is a Supabase Auth user id. Seeding invented " +
      "UUIDs would point memberships at users that cannot authenticate. Lands " +
      "once demo accounts are provisioned (PRD §8.1).",
    factsAndObservations:
      "Separate work (PRD §8.2, facts first then derived KPIs), and must not be " +
      "seeded while the legacy service_role key is enabled (ADR 0008 §4.1).",
  },
} as const;

await mkdir(dirname(snapshotPath), { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log("Seed generated.");
console.log(`  ${seedPath}`);
console.log(`  ${snapshotPath}`);
console.log(`  sha256: ${checksum}`);
for (const [table, n] of Object.entries(snapshot.rowCounts)) {
  console.log(`    ${table.padEnd(22)} ${n}`);
}
