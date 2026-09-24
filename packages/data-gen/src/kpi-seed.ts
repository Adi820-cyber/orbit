/**
 * The compact seed form of the KPI observations (see
 * `scripts/generate-observations.ts`): a family table, an assignment table,
 * data-quality variants, and one row of numbers per observation. The SQL
 * rebuilds each observation's JSON from these; `rebuildObservation` does the
 * same in TypeScript so a test can prove the round trip is exact.
 */
import { ROLE_KPI_ASSIGNMENTS } from "@orbit/kpi-framework";
import { FAMILY_SPECS, type KpiComponent, type KpiGrain, type KpiDataQuality, type KpiObservation, type KpiTarget, type KpiValue } from "./kpis.ts";

export interface FamilyRow {
  family: string;
  unit: string;
  target: KpiTarget;
  numId: string;
  numLabel: string;
  numUnit: string;
  denId: string;
  denLabel: string;
  denUnit: string;
}

export const FAMILY_TABLE: readonly FamilyRow[] = Object.entries(FAMILY_SPECS).map(([family, spec]) => ({
  family,
  unit: spec.unit,
  target: spec.target,
  numId: `${spec.compute.id}-numerator`,
  numLabel: spec.compute.numerator.label,
  numUnit: spec.compute.numerator.unit,
  denId: `${spec.compute.id}-denominator`,
  denLabel: spec.compute.denominator.label,
  denUnit: spec.compute.denominator.unit,
}));

export interface AssignmentRow {
  idx: number;
  assignmentId: string;
  family: string;
  secondFamily: string | null;
}

export const ASSIGNMENT_TABLE: readonly AssignmentRow[] = ROLE_KPI_ASSIGNMENTS.map((assignment, idx) => {
  const [family, second, ...rest] = assignment.definitionFamilies;
  if (!family || rest.length > 0) throw new Error(`${assignment.assignmentId}: the seed supports one or two families`);
  return { idx, assignmentId: assignment.assignmentId, family, secondFamily: second ?? null };
});

type Status = "a" | "m" | "z" | "i";

export interface CompactRow {
  a: number;
  grain: KpiGrain;
  slug: string;
  month: string;
  status: Status;
  value: number | null;
  num: number | null;
  den: number | null;
  sStatus: Status | null;
  sValue: number | null;
  q: number;
}

function encode(value: KpiValue): { status: Status; value: number | null } {
  switch (value.status) {
    case "available":
      return { status: "a", value: value.value };
    case "missing":
      return { status: "m", value: null };
    case "not_applicable":
      return { status: value.reason === "zero_denominator" ? "z" : "i", value: null };
  }
}

function decode(status: Status, value: number | null): KpiValue {
  switch (status) {
    case "a":
      return { status: "available", value: value ?? 0 };
    case "m":
      return { status: "missing", reason: "not_reported" };
    case "z":
      return { status: "not_applicable", reason: "zero_denominator" };
    case "i":
      return { status: "not_applicable", reason: "invalid_denominator" };
  }
}

function availableNumber(component: KpiComponent | undefined): number | null {
  return component?.value.status === "available" ? component.value.value : null;
}

/** Encodes the observations; the first data-quality variant is always "current and reconciled". */
export function compactRows(rows: readonly KpiObservation[]): { qualities: KpiDataQuality[]; rows: CompactRow[] } {
  const assignmentIndex = new Map(ASSIGNMENT_TABLE.map((row) => [row.assignmentId, row.idx]));
  const qualityIndex = new Map<string, number>();
  const qualities: KpiDataQuality[] = [];
  const indexOf = (quality: KpiDataQuality): number => {
    const key = JSON.stringify(quality);
    let index = qualityIndex.get(key);
    if (index === undefined) {
      index = qualities.length;
      qualities.push(quality);
      qualityIndex.set(key, index);
    }
    return index;
  };
  const first = rows[0];
  if (first) indexOf({ ...first.dataQuality, reconciliation: "reconciled", freshness: "current", limitations: [] });

  return {
    qualities,
    rows: rows.map((row) => {
      const a = assignmentIndex.get(row.assignmentId);
      if (a === undefined) throw new Error(`unknown assignment ${row.assignmentId}`);
      const headline = encode(row.value);
      const second = row.components.find((component) => component.role === "measure");
      const secondValue = second ? encode(second.value) : null;
      return {
        a,
        grain: row.entity.grain,
        slug: row.entity.slug,
        month: row.month,
        status: headline.status,
        value: headline.value,
        num: availableNumber(row.components.find((component) => component.role === "numerator")),
        den: availableNumber(row.components.find((component) => component.role === "denominator")),
        sStatus: secondValue?.status ?? null,
        sValue: secondValue?.value ?? null,
        q: indexOf(row.dataQuality),
      };
    }),
  };
}

/** What the seed SQL builds from one compact row: the TypeScript mirror used by the round-trip test. */
export function rebuildObservation(row: CompactRow, qualities: readonly KpiDataQuality[], definitionVersion: string): KpiObservation {
  const assignment = ASSIGNMENT_TABLE[row.a];
  const family = FAMILY_TABLE.find((entry) => entry.family === assignment?.family);
  const second = FAMILY_TABLE.find((entry) => entry.family === assignment?.secondFamily);
  const quality = qualities[row.q];
  if (!assignment || !family || !quality) throw new Error(`compact row ${JSON.stringify(row)} does not resolve`);
  const components: KpiComponent[] =
    row.status === "m"
      ? []
      : [
          { componentId: family.numId, label: family.numLabel, role: "numerator", unit: family.numUnit, value: decode("a", row.num) },
          { componentId: family.denId, label: family.denLabel, role: "denominator", unit: family.denUnit, value: decode("a", row.den) },
          ...(second && row.sStatus
            ? [{ componentId: `family:${second.family}`, label: second.family, role: "measure" as const, unit: second.unit, value: decode(row.sStatus, row.sValue) }]
            : []),
        ];
  return {
    observationKey: `obs:${assignment.assignmentId}:${row.grain}:${row.slug}:${row.month}`,
    assignmentId: assignment.assignmentId,
    definitionFamily: family.family,
    definitionVersion,
    entity: { grain: row.grain, slug: row.slug },
    month: row.month,
    unit: family.unit,
    value: decode(row.status, row.value),
    components,
    target: family.target,
    dataQuality: quality,
  };
}
