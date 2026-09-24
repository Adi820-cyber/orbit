import { describe, expect, it } from "vitest";
import { DataQualitySchema, ExceptionSchema, ObservationSchema, TargetSchema } from "@orbit/contracts";
import { deriveFinancialObservations, deriveSeededExceptions, SEEDED_SCENARIO_LABEL } from "../observations.ts";

/*
 * The seed (scripts/generate-observations.ts) stores these rows and the API
 * reassembles them into ObservationSchema. This rebuilds each row exactly as
 * the API's SQL does, so a seeded row the API would reject fails here in CI,
 * not as a 500 in the demo. The entity id is a placeholder uuid: the database
 * resolves slugs to real ids.
 */
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001";
const target = { state: "not_configured" };
const dataQuality = { state: "illustrative", reconciliation: "reconciled", freshness: "current", refreshedAt: "2026-09-02T06:00:00.000Z", limitations: [] };

function monthBounds(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 0, mon ?? 0, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

describe("seeded observations match the shared contract", () => {
  it("the fixed target and data-quality blocks parse", () => {
    expect(TargetSchema.parse(target)).toEqual(target);
    expect(DataQualitySchema.parse(dataQuality)).toEqual(dataQuality);
  });

  it("every one of the derived rows parses as ObservationSchema", () => {
    const failures = deriveFinancialObservations().filter((row) => {
      const observation = {
        observationId: row.observationKey,
        assignmentId: row.assignmentId,
        definitionFamily: row.definitionFamily,
        definitionVersion: row.definitionVersion,
        entity: { grain: row.entity.grain, entityId: PLACEHOLDER_ID },
        period: { cadence: "month", ...monthBounds(row.month) },
        unit: row.unit,
        value: row.value,
        components: row.components,
        target,
        provenance: "illustrative",
        dataQuality,
      };
      return !ObservationSchema.safeParse(observation).success;
    });
    expect(failures).toEqual([]);
  });

  it("every seeded exception parses as ExceptionSchema, labelled as a seeded scenario", () => {
    const rows = deriveFinancialObservations();
    const exceptions = deriveSeededExceptions(rows);
    expect(exceptions.length).toBeGreaterThan(0);
    const keys = new Set(rows.map((row) => row.observationKey));
    for (const exception of exceptions) {
      expect(exception.evidenceKeys.every((key) => keys.has(key))).toBe(true);
      const parsed = ExceptionSchema.safeParse({
        exceptionId: exception.exceptionKey,
        assignmentId: exception.assignmentId,
        entity: { grain: exception.entity.grain, entityId: PLACEHOLDER_ID },
        period: { cadence: "month", ...monthBounds(exception.month) },
        priority: exception.priority,
        category: "performance",
        comparisonBasis: "budget",
        detection: { kind: "seeded_scenario", scenarioLabel: SEEDED_SCENARIO_LABEL },
        whatChanged: exception.whatChanged,
        whyItMatters: exception.whyItMatters,
        owner: { role: exception.ownerRole },
        actionState: "none",
        evidence: { observationIds: exception.evidenceKeys, definitionVersion: "v1", datasetChecksum: "checksum" },
        provenance: "illustrative",
        dataQuality,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
