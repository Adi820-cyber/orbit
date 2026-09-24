import { describe, expect, it } from "vitest";
import { ExceptionSchema, ObservationSchema, OnTrackItemSchema } from "@orbit/contracts";
import { ROLE_IDS, ROLE_KPI_ASSIGNMENTS } from "@orbit/kpi-framework";
import { deriveEntitlements } from "../entitlements.ts";
import { generateAllOperationalFacts } from "../facts/operational.ts";
import { compactRows, rebuildObservation } from "../kpi-seed.ts";
import { deriveAllExceptions, deriveAllObservations, deriveAllOnTrack, deriveLimitations, FAMILY_SPECS, GENERIC_SCENARIO_LABEL } from "../kpis.ts";
import { COMPANY_MANIFEST } from "../manifest.ts";

const REFRESHED_AT = "2026-09-02T06:00:00.000Z";
const facts = generateAllOperationalFacts();
const rows = deriveAllObservations({ refreshedAt: REFRESHED_AT }, facts);
const exceptions = deriveAllExceptions(rows);
const onTrack = deriveAllOnTrack(rows);
const months = [...new Set(facts.map((row) => row.period))].toSorted();
const latest = months.at(-1) ?? "";
const byKey = new Map(rows.map((row) => [row.observationKey, row]));
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001";

function monthBounds(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 0, mon ?? 0, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function numberOf(key: string, role: "numerator" | "denominator"): number {
  const component = byKey.get(key)?.components.find((entry) => entry.role === role);
  if (component?.value.status !== "available") throw new Error(`${key} has no ${role}`);
  return component.value.value;
}

describe("all-role KPI observations", () => {
  it("covers all 109 assignments at every base and breakdown grain, every month", () => {
    expect(new Set(rows.map((row) => row.assignmentId)).size).toBe(ROLE_KPI_ASSIGNMENTS.length);
    const entities = { group: 1, region: COMPANY_MANIFEST.regions.length, facility: COMPANY_MANIFEST.facilities.length, coe: COMPANY_MANIFEST.coes.length };
    for (const entitlement of deriveEntitlements()) {
      const grains = new Set([...entitlement.grains, ...entitlement.breakdowns]);
      const expected = [...grains].reduce((sum, grain) => sum + entities[grain], 0) * months.length;
      expect(rows.filter((row) => row.assignmentId === entitlement.assignmentId), entitlement.assignmentId).toHaveLength(expected);
    }
  });

  it("gives every observation a unique key and is deterministic", () => {
    expect(byKey.size).toBe(rows.length);
    expect(deriveAllObservations({ refreshedAt: REFRESHED_AT })).toEqual(rows);
  });

  it("has a family spec for every family the workbook assigns", () => {
    const assigned = new Set(ROLE_KPI_ASSIGNMENTS.flatMap((assignment) => assignment.definitionFamilies));
    expect([...assigned].filter((family) => !FAMILY_SPECS[family])).toEqual([]);
  });

  it("rolls regions and the group up from summed numerators and denominators (PRD §7.7)", () => {
    const month = months[3] ?? "";
    for (const id of ["regional-coo:hospital-and-clinic-capacity-utilisation", "regional-coo:patient-volume-and-referral-conversion"]) {
      const north = COMPANY_MANIFEST.facilities.filter((facility) => facility.regionSlug === "north");
      for (const role of ["numerator", "denominator"] as const) {
        const sum = north.reduce((total, facility) => total + numberOf(`obs:${id}:facility:${facility.slug}:${month}`, role), 0);
        expect(numberOf(`obs:${id}:region:north:${month}`, role)).toBeCloseTo(sum, 1);
      }
    }
  });

  it("keeps KPIs of one role that share a family distinct, and roll-ups still sums", () => {
    const legal = rows.filter((row) => row.assignmentId.startsWith("legal-head:") && row.entity.grain === "group" && row.month === latest);
    expect(new Set(legal.map((row) => JSON.stringify(row.value))).size).toBeGreaterThan(1);
    const id = "legal-head:contract-turnaround-time";
    const month = months[5] ?? "";
    const regions = COMPANY_MANIFEST.regions.map((region) => numberOf(`obs:${id}:region:${region.slug}:${month}`, "numerator"));
    expect(numberOf(`obs:${id}:group:kestrion:${month}`, "numerator")).toBeCloseTo(regions.reduce((a, b) => a + b, 0), 1);
  });

  it("sets no target on clinical families: the workbook assumes no universal clinical threshold", () => {
    for (const family of ["Clinical quality scorecard", "Serious adverse events", "Protocol compliance"]) {
      expect(FAMILY_SPECS[family]?.target).toEqual({ state: "not_configured" });
    }
    const configured = rows.filter((row) => row.target.state !== "not_configured");
    expect(configured.every((row) => "approval" in row.target && row.target.approval === "demo_parameter")).toBe(true);
  });

  it("shows the late source as missing at its facility and says what a roll-up excludes (PRD §7.9)", () => {
    const late = COMPANY_MANIFEST.scenarios.find((scenario) => scenario.slug === "late-unreconciled-source");
    const facility = byKey.get(`obs:billing-lead:cash-collections-vs-monthly-plan:facility:${late?.entitySlug ?? ""}:${latest}`);
    expect(facility?.value).toEqual({ status: "missing", reason: "not_reported" });
    expect(facility?.dataQuality).toMatchObject({ reconciliation: "unreconciled", freshness: "late" });
    const region = byKey.get(`obs:group-cfo:group-collections-and-dso-vs-plan:group:kestrion:${latest}`);
    expect(region?.value.status).toBe("available");
    expect(region?.dataQuality.limitations[0]).toMatch(/^Excludes /);
    expect(deriveLimitations(rows).length).toBeGreaterThan(0);
  });

  it("gives every role something in its brief: an exception or an on-track item", () => {
    for (const roleId of ROLE_IDS) {
      const items = exceptions.filter((row) => row.ownerRole === roleId).length + onTrack.filter((row) => row.assignmentId.startsWith(`${roleId}:`)).length;
      expect(items, roleId).toBeGreaterThan(0);
    }
  });

  it("labels every exception as a seeded scenario and backs it with existing observations", () => {
    expect(exceptions.length).toBeGreaterThan(0);
    for (const exception of exceptions) {
      expect(exception.scenarioLabel === GENERIC_SCENARIO_LABEL || exception.scenarioLabel.startsWith("Demo scenario: ")).toBe(true);
      expect(exception.evidenceKeys.every((key) => byKey.has(key))).toBe(true);
    }
  });

  it("never lists one KPI and entity as both an exception and on track", () => {
    const flagged = new Set(exceptions.map((row) => `${row.assignmentId}|${row.entity.grain}|${row.entity.slug}`));
    expect(onTrack.filter((row) => flagged.has(`${row.assignmentId}|${row.entity.grain}|${row.entity.slug}`))).toEqual([]);
  });
});

describe("KPI rows match the shared contracts", () => {
  it("every observation parses as ObservationSchema", () => {
    const failures = rows.filter(
      (row) =>
        !ObservationSchema.safeParse({
          observationId: row.observationKey,
          assignmentId: row.assignmentId,
          definitionFamily: row.definitionFamily,
          definitionVersion: row.definitionVersion,
          entity: { grain: row.entity.grain, entityId: PLACEHOLDER_ID },
          period: { cadence: "month", ...monthBounds(row.month) },
          unit: row.unit,
          value: row.value,
          components: row.components,
          target: row.target,
          provenance: "illustrative",
          dataQuality: row.dataQuality,
        }).success,
    );
    expect(failures.map((row) => row.observationKey)).toEqual([]);
  });

  it("every exception parses as ExceptionSchema", () => {
    for (const exception of exceptions) {
      const parsed = ExceptionSchema.safeParse({
        exceptionId: exception.exceptionKey,
        assignmentId: exception.assignmentId,
        entity: { grain: exception.entity.grain, entityId: PLACEHOLDER_ID },
        period: { cadence: "month", ...monthBounds(exception.month) },
        priority: exception.priority,
        category: exception.category,
        comparisonBasis: exception.comparisonBasis,
        detection: { kind: "seeded_scenario", scenarioLabel: exception.scenarioLabel },
        whatChanged: exception.whatChanged,
        whyItMatters: exception.whyItMatters,
        owner: { role: exception.ownerRole },
        actionState: "none",
        evidence: { observationIds: exception.evidenceKeys, definitionVersion: "v1", datasetChecksum: "checksum" },
        provenance: "illustrative",
        dataQuality: byKey.get(exception.evidenceKeys[0] ?? "")?.dataQuality,
      });
      expect(parsed.success, exception.exceptionKey).toBe(true);
    }
  });

  it("every on-track item parses as OnTrackItemSchema", () => {
    const failures = onTrack.filter(
      (item) =>
        !OnTrackItemSchema.safeParse({
          assignmentId: item.assignmentId,
          entity: { grain: item.entity.grain, entityId: PLACEHOLDER_ID },
          period: { cadence: "month", ...monthBounds(item.month) },
          summary: item.summary,
          evidence: { observationIds: item.evidenceKeys, definitionVersion: "v1", datasetChecksum: "checksum" },
          provenance: "illustrative",
          dataQuality: byKey.get(item.evidenceKeys[0] ?? "")?.dataQuality,
        }).success,
    );
    expect(failures).toEqual([]);
  });

  it("the compact seed form rebuilds every observation exactly", () => {
    const compact = compactRows(rows);
    const version = rows[0]?.definitionVersion ?? "v1";
    expect(compact.rows.map((row) => rebuildObservation(row, compact.qualities, version))).toEqual(rows);
  });
});
