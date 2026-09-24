/**
 * Writes supabase/seed/0002_financial_observations.sql from the financial facts.
 *
 * Run: npm run generate:observations --workspace=@orbit/data-gen
 *
 * Deterministic: the same facts produce byte-identical SQL, and the dataset
 * checksum is the SHA-256 of the observation payload, so a regeneration that
 * changes nothing changes nothing in the database either (idempotent inserts).
 * Entity ids are resolved from slugs inside the SQL, never hard-coded.
 *
 * Needs migrations 000700 and 000800, and seed 0001, applied first.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_MANIFEST } from "../src/manifest.ts";
import { deriveFinancialObservations } from "../src/observations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(here, "../../../supabase/seed/0002_financial_observations.sql");

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) throw new Error(`bad month ${month}`);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

const rows = deriveFinancialObservations();
const demo = COMPANY_MANIFEST.organizations.find((org) => org.kind === "demo");
if (!demo) throw new Error("company manifest has no demo organization");

const payload = JSON.stringify(rows);
const checksum = createHash("sha256").update(payload).digest("hex");
const lastMonth = rows.map((row) => row.month).sort().at(-1);
if (!lastMonth) throw new Error("no observations derived");
const current = monthBounds(lastMonth);
// Simulated refresh: two days after the period closes, 06:00 UTC (PRD FR-02).
const asOfDate = new Date(`${current.end}T06:00:00.000Z`);
asOfDate.setUTCDate(asOfDate.getUTCDate() + 2);
const asOf = asOfDate.toISOString();

const dataQuality = JSON.stringify({
  state: "illustrative",
  reconciliation: "reconciled",
  freshness: "current",
  refreshedAt: asOf,
  limitations: [],
});
const target = JSON.stringify({ state: "not_configured" });

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("-- =========================================================================");
w("-- 0002_financial_observations.sql");
w("--");
w("-- GENERATED FILE — DO NOT EDIT BY HAND.");
w("-- Produced by packages/data-gen/scripts/generate-observations.ts");
w(`-- Dataset checksum: ${checksum}`);
w(`-- Observations    : ${rows.length} (net revenue and EBITDA vs approved budget only)`);
w("--");
w("-- Illustrative synthetic data (PRD §8.4). Idempotent: safe to re-run.");
w("-- Requires migrations 20260924000700 and 20260924000800, and seed 0001.");
w("-- =========================================================================");
w();
w("begin;");
w();
w("create temp table _entities (grain text, slug text, id uuid) on commit drop;");
w(`insert into _entities select 'group', o.slug, o.id from orbit.organizations o where o.slug = ${q(demo.slug)};`);
w(`insert into _entities select 'region', r.slug, r.id from orbit.regions r join orbit.organizations o on o.id = r.organization_id where o.slug = ${q(demo.slug)};`);
w(`insert into _entities select 'facility', f.slug, f.id from orbit.facilities f join orbit.organizations o on o.id = f.organization_id where o.slug = ${q(demo.slug)};`);
w();
w("insert into orbit.datasets (organization_id, checksum, definition_version, as_of, current_period_cadence, current_period_start, current_period_end, is_current)");
w(`select o.id, ${q(checksum)}, ${q(rows[0]?.definitionVersion ?? "v1")}, ${q(asOf)}::timestamptz, 'month', ${q(current.start)}::date, ${q(current.end)}::date, false`);
w(`from orbit.organizations o where o.slug = ${q(demo.slug)}`);
w("on conflict (organization_id, checksum) do nothing;");
w();
w("-- Make this dataset the current one for the organization.");
w(`update orbit.datasets d set is_current = false from orbit.organizations o where o.id = d.organization_id and o.slug = ${q(demo.slug)} and d.checksum <> ${q(checksum)} and d.is_current;`);
w(`update orbit.datasets d set is_current = true from orbit.organizations o where o.id = d.organization_id and o.slug = ${q(demo.slug)} and d.checksum = ${q(checksum)};`);
w();
w("insert into orbit.kpi_observations (observation_key, organization_id, dataset_id, assignment_id, definition_family, definition_version, entity_grain, entity_id, period_cadence, period_start, period_end, unit, value, components, target, data_quality)");
w("select v.observation_key, d.organization_id, d.id, v.assignment_id, v.definition_family, v.definition_version, v.grain, e.id, 'month', v.period_start::date, v.period_end::date, v.unit, v.value::jsonb, v.components::jsonb, v.target::jsonb, v.data_quality::jsonb");
w("from (values");
rows.forEach((row, index) => {
  const bounds = monthBounds(row.month);
  const sep = index === rows.length - 1 ? "" : ",";
  w(
    `  (${[
      row.observationKey,
      row.assignmentId,
      row.definitionFamily,
      row.definitionVersion,
      row.entity.grain,
      row.entity.slug,
      bounds.start,
      bounds.end,
      row.unit,
      JSON.stringify(row.value),
      JSON.stringify(row.components),
      target,
      dataQuality,
    ]
      .map(q)
      .join(", ")})${sep}`,
  );
});
w(") as v(observation_key, assignment_id, definition_family, definition_version, grain, slug, period_start, period_end, unit, value, components, target, data_quality)");
w("join _entities e on e.grain = v.grain and e.slug = v.slug");
w(`join orbit.datasets d on d.checksum = ${q(checksum)}`);
w(`join orbit.organizations o on o.id = d.organization_id and o.slug = ${q(demo.slug)}`);
w("on conflict (dataset_id, observation_key) do nothing;");
w();
w("commit;");
w();

writeFileSync(seedPath, lines.join("\n"));
console.log(`Wrote ${rows.length} observations to ${seedPath} (dataset ${checksum.slice(0, 12)}…)`);
