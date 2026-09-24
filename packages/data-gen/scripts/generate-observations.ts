/**
 * Writes the KPI dataset seeds for every role from the operational facts:
 *
 *   supabase/seed/0005_kpi_observations.sql  all 109 assignments, 24 months
 *   supabase/seed/0006_kpi_exceptions.sql    seeded exceptions + data limitations
 *   supabase/seed/0007_kpi_brief_on_track.sql
 *
 * Run: npm run generate:observations --workspace=@orbit/data-gen
 *
 * Deterministic: the same facts produce byte-identical SQL, and the dataset
 * checksum is the SHA-256 of the observation payload. Inserts are idempotent.
 * Entity ids are resolved from slugs inside the SQL, never hard-coded.
 *
 * The observation file is compact: each row carries only its numbers, and the
 * SQL builds the observation JSON from small family and assignment tables, so
 * about 14,000 rows fit in about a megabyte. `kpi-seed.test.ts` checks the rows
 * this script writes rebuild exactly the observations `kpis.ts` derives.
 *
 * The CLI records each seed file's hash and does not re-run a changed file, so
 * a new dataset needs new file names; the dataset switches over atomically
 * when 0005 marks it current.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAllExceptions, deriveAllObservations, deriveAllOnTrack, deriveLimitations } from "../src/kpis.ts";
import { compactRows, FAMILY_TABLE, ASSIGNMENT_TABLE } from "../src/kpi-seed.ts";
import { COMPANY_MANIFEST } from "../src/manifest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, "../../../supabase/seed");

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlValue(value: string | number | null): string {
  if (value === null) return "null";
  return typeof value === "number" ? String(value) : q(value);
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) throw new Error(`bad month ${month}`);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

const demo = COMPANY_MANIFEST.organizations.find((org) => org.kind === "demo");
if (!demo) throw new Error("company manifest has no demo organization");
const demoSlug = demo.slug;
const months = COMPANY_MANIFEST.periods;

// Simulated refresh: two days after the latest period closes, 06:00 UTC (PRD FR-02).
const lastMonth = (() => {
  const [year, mon] = months.firstMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (mon ?? 1) - 1 + months.monthCount - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
})();
const current = monthBounds(lastMonth);
const asOfDate = new Date(`${current.end}T06:00:00.000Z`);
asOfDate.setUTCDate(asOfDate.getUTCDate() + 2);
const asOf = asOfDate.toISOString();

const rows = deriveAllObservations({ refreshedAt: asOf });
const exceptions = deriveAllExceptions(rows);
const onTrack = deriveAllOnTrack(rows);
const limitations = deriveLimitations(rows);
const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const definitionVersion = rows[0]?.definitionVersion ?? "v1";
const compact = compactRows(rows);

const lines: string[] = [];
const w = (s = "") => lines.push(s);

function header(name: string, summary: string): void {
  lines.length = 0;
  w("-- =========================================================================");
  w(`-- ${name}`);
  w("--");
  w("-- GENERATED FILE — DO NOT EDIT BY HAND.");
  w("-- Produced by packages/data-gen/scripts/generate-observations.ts");
  w(`-- Dataset checksum: ${checksum}`);
  w(`-- ${summary}`);
  w("--");
  w("-- Illustrative synthetic data (PRD §8.4). Idempotent: safe to re-run.");
  w("-- Demo targets are demo parameters, not approved targets. Needs Maruti's");
  w("-- plausibility review before an external demo (PRD §8.2).");
  w("-- =========================================================================");
  w();
  w("begin;");
  w();
  w("create temp table _entities (grain text, slug text, id uuid) on commit drop;");
  w(`insert into _entities select 'group', o.slug, o.id from orbit.organizations o where o.slug = ${q(demoSlug)};`);
  w(`insert into _entities select 'region', r.slug, r.id from orbit.regions r join orbit.organizations o on o.id = r.organization_id where o.slug = ${q(demoSlug)};`);
  w(`insert into _entities select 'facility', f.slug, f.id from orbit.facilities f join orbit.organizations o on o.id = f.organization_id where o.slug = ${q(demoSlug)};`);
  w(`insert into _entities select 'coe', c.slug, c.id from orbit.coes c join orbit.organizations o on o.id = c.organization_id where o.slug = ${q(demoSlug)};`);
  w();
}

function write(name: string): void {
  w("commit;");
  w();
  writeFileSync(resolve(seedDir, name), lines.join("\n"));
}

function valuesBlock(tuples: readonly (readonly (string | number | null)[])[]): void {
  tuples.forEach((tuple, index) => w(`  (${tuple.map(sqlValue).join(", ")})${index === tuples.length - 1 ? "" : ","}`));
}

// ── 0005: observations ────────────────────────────────────────────────────
header("0005_kpi_observations.sql", `Observations    : ${rows.length} (all 109 assignments, every permitted grain, ${months.monthCount} months)`);
w("insert into orbit.datasets (organization_id, checksum, definition_version, as_of, current_period_cadence, current_period_start, current_period_end, is_current)");
w(`select o.id, ${q(checksum)}, ${q(definitionVersion)}, ${q(asOf)}::timestamptz, 'month', ${q(current.start)}::date, ${q(current.end)}::date, false`);
w(`from orbit.organizations o where o.slug = ${q(demoSlug)}`);
w("on conflict (organization_id, checksum) do nothing;");
w();
w("-- Definition families: unit, demo target, and numerator/denominator labels.");
w("create temp table _families (family text primary key, unit text, target jsonb, num_id text, num_label text, num_unit text, den_id text, den_label text, den_unit text) on commit drop;");
w("insert into _families values");
valuesBlock(FAMILY_TABLE.map((row) => [row.family, row.unit, JSON.stringify(row.target), row.numId, row.numLabel, row.numUnit, row.denId, row.denLabel, row.denUnit]));
w(";");
w();
w("-- Assignments by index; a bundled assignment names its second family (ADR 0004).");
w("create temp table _assignments (idx int primary key, assignment_id text, family text, second_family text) on commit drop;");
w("insert into _assignments values");
valuesBlock(ASSIGNMENT_TABLE.map((row) => [row.idx, row.assignmentId, row.family, row.secondFamily]));
w(";");
w();
w("-- Data-quality variants by index (0 = current and reconciled).");
w("create temp table _quality (idx int primary key, data_quality jsonb) on commit drop;");
w("insert into _quality values");
valuesBlock(compact.qualities.map((quality, idx) => [idx, JSON.stringify(quality)]));
w(";");
w();
w("-- Status codes: a = available, m = missing (not reported), z = zero denominator, i = invalid denominator.");
w("create temp table _rows (a_idx int, grain text, slug text, month text, status text, value numeric, num numeric, den numeric, s_status text, s_value numeric, q_idx int) on commit drop;");
const CHUNK = 2000;
for (let start = 0; start < compact.rows.length; start += CHUNK) {
  w("insert into _rows values");
  valuesBlock(compact.rows.slice(start, start + CHUNK).map((row) => [row.a, row.grain, row.slug, row.month, row.status, row.value, row.num, row.den, row.sStatus, row.sValue, row.q]));
  w(";");
}
w();
w("create function pg_temp.measure(status text, value numeric) returns jsonb language sql immutable as $$");
w("  select case status");
w("    when 'a' then jsonb_build_object('status', 'available', 'value', value)");
w("    when 'm' then jsonb_build_object('status', 'missing', 'reason', 'not_reported')");
w("    when 'z' then jsonb_build_object('status', 'not_applicable', 'reason', 'zero_denominator')");
w("    when 'i' then jsonb_build_object('status', 'not_applicable', 'reason', 'invalid_denominator')");
w("  end");
w("$$;");
w();
w("insert into orbit.kpi_observations (observation_key, organization_id, dataset_id, assignment_id, definition_family, definition_version, entity_grain, entity_id, period_cadence, period_start, period_end, unit, value, components, target, data_quality)");
w("select 'obs:' || a.assignment_id || ':' || r.grain || ':' || r.slug || ':' || r.month,");
w(`  d.organization_id, d.id, a.assignment_id, a.family, ${q(definitionVersion)}, r.grain, e.id, 'month',`);
w("  (r.month || '-01')::date, ((r.month || '-01')::date + interval '1 month' - interval '1 day')::date,");
w("  f.unit, pg_temp.measure(r.status, r.value),");
w("  case when r.status = 'm' then '[]'::jsonb else");
w("    jsonb_build_array(");
w("      jsonb_build_object('componentId', f.num_id, 'label', f.num_label, 'role', 'numerator', 'unit', f.num_unit, 'value', pg_temp.measure('a', r.num)),");
w("      jsonb_build_object('componentId', f.den_id, 'label', f.den_label, 'role', 'denominator', 'unit', f.den_unit, 'value', pg_temp.measure('a', r.den)))");
w("    || case when a.second_family is null then '[]'::jsonb else jsonb_build_array(");
w("      jsonb_build_object('componentId', 'family:' || a.second_family, 'label', a.second_family, 'role', 'measure', 'unit', s.unit, 'value', pg_temp.measure(r.s_status, r.s_value))) end");
w("  end,");
w("  f.target, q.data_quality");
w("from _rows r");
w("join _assignments a on a.idx = r.a_idx");
w("join _families f on f.family = a.family");
w("left join _families s on s.family = a.second_family");
w("join _quality q on q.idx = r.q_idx");
w("join _entities e on e.grain = r.grain and e.slug = r.slug");
w(`join orbit.datasets d on d.checksum = ${q(checksum)}`);
w(`join orbit.organizations o on o.id = d.organization_id and o.slug = ${q(demoSlug)}`);
w("on conflict (dataset_id, observation_key) do nothing;");
w();
w("-- Make this dataset the current one for the organization.");
w(`update orbit.datasets d set is_current = false from orbit.organizations o where o.id = d.organization_id and o.slug = ${q(demoSlug)} and d.checksum <> ${q(checksum)} and d.is_current;`);
w(`update orbit.datasets d set is_current = true from orbit.organizations o where o.id = d.organization_id and o.slug = ${q(demoSlug)} and d.checksum = ${q(checksum)};`);
w();
write("0005_kpi_observations.sql");

// ── 0006: exceptions and data limitations ─────────────────────────────────
header("0006_kpi_exceptions.sql", `Exceptions      : ${exceptions.length} labelled seeded scenarios; data limitations: ${limitations.length}`);
const dataQualityByKey = new Map(rows.map((row) => [row.observationKey, row.dataQuality]));
if (exceptions.length > 0) {
  w("insert into orbit.exceptions (exception_key, organization_id, dataset_id, assignment_id, entity_grain, entity_id, period_cadence, period_start, period_end, priority, category, comparison_basis, detection, what_changed, why_it_matters, owner_role, evidence, data_quality)");
  w("select v.exception_key, d.organization_id, d.id, v.assignment_id, v.grain, e.id, 'month', v.period_start::date, v.period_end::date, v.priority, v.category, v.comparison_basis, v.detection::jsonb, v.what_changed, v.why_it_matters, v.owner_role, v.evidence::jsonb, v.data_quality::jsonb");
  w("from (values");
  valuesBlock(
    exceptions.map((exception) => {
      const bounds = monthBounds(exception.month);
      const evidence = { observationIds: exception.evidenceKeys, definitionVersion, datasetChecksum: checksum };
      return [
        exception.exceptionKey,
        exception.assignmentId,
        exception.entity.grain,
        exception.entity.slug,
        bounds.start,
        bounds.end,
        exception.priority,
        exception.category,
        exception.comparisonBasis,
        JSON.stringify({ kind: "seeded_scenario", scenarioLabel: exception.scenarioLabel }),
        exception.whatChanged,
        exception.whyItMatters,
        exception.ownerRole,
        JSON.stringify(evidence),
        JSON.stringify(dataQualityByKey.get(exception.evidenceKeys[0] ?? "")),
      ];
    }),
  );
  w(") as v(exception_key, assignment_id, grain, slug, period_start, period_end, priority, category, comparison_basis, detection, what_changed, why_it_matters, owner_role, evidence, data_quality)");
  w("join _entities e on e.grain = v.grain and e.slug = v.slug");
  w(`join orbit.datasets d on d.checksum = ${q(checksum)}`);
  w(`join orbit.organizations o on o.id = d.organization_id and o.slug = ${q(demoSlug)}`);
  w("on conflict (dataset_id, exception_key) do nothing;");
  w();
}
if (limitations.length > 0) {
  w("-- Limitations have no natural key, so the file inserts them only once per dataset.");
  w("insert into orbit.data_limitations (organization_id, dataset_id, assignment_id, issue, detail)");
  w("select d.organization_id, d.id, v.assignment_id, v.issue, v.detail");
  w("from (values");
  valuesBlock(limitations.map((row) => [row.assignmentId, row.issue, row.detail]));
  w(") as v(assignment_id, issue, detail)");
  w(`join orbit.datasets d on d.checksum = ${q(checksum)}`);
  w(`join orbit.organizations o on o.id = d.organization_id and o.slug = ${q(demoSlug)}`);
  w("where not exists (select 1 from orbit.data_limitations l where l.dataset_id = d.id and l.assignment_id = v.assignment_id and l.issue = v.issue);");
  w();
}
write("0006_kpi_exceptions.sql");

// ── 0007: on-track brief items ────────────────────────────────────────────
header("0007_kpi_brief_on_track.sql", `On-track items  : ${onTrack.length} (within the demo target, latest month)`);
if (onTrack.length > 0) {
  w("insert into orbit.brief_on_track (item_key, organization_id, dataset_id, assignment_id, entity_grain, entity_id, period_cadence, period_start, period_end, summary, evidence, data_quality)");
  w("select v.item_key, d.organization_id, d.id, v.assignment_id, v.grain, e.id, 'month', v.period_start::date, v.period_end::date, v.summary, v.evidence::jsonb, v.data_quality::jsonb");
  w("from (values");
  valuesBlock(
    onTrack.map((item) => {
      const bounds = monthBounds(item.month);
      const evidence = { observationIds: item.evidenceKeys, definitionVersion, datasetChecksum: checksum };
      return [item.itemKey, item.assignmentId, item.entity.grain, item.entity.slug, bounds.start, bounds.end, item.summary, JSON.stringify(evidence), JSON.stringify(dataQualityByKey.get(item.evidenceKeys[0] ?? ""))];
    }),
  );
  w(") as v(item_key, assignment_id, grain, slug, period_start, period_end, summary, evidence, data_quality)");
  w("join _entities e on e.grain = v.grain and e.slug = v.slug");
  w(`join orbit.datasets d on d.checksum = ${q(checksum)}`);
  w(`join orbit.organizations o on o.id = d.organization_id and o.slug = ${q(demoSlug)}`);
  w("on conflict (dataset_id, item_key) do nothing;");
  w();
}
write("0007_kpi_brief_on_track.sql");

console.log(
  `Wrote ${rows.length} observations, ${exceptions.length} exceptions, ${limitations.length} limitations, ${onTrack.length} on-track items (dataset ${checksum.slice(0, 12)}…)`,
);
