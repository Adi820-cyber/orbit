import type {
  KpiAssignmentSummary,
  MeasureValue,
  Period,
  ScopeEntity,
  Target,
} from "@orbit/contracts";

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return `${formatDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} UTC`;
}

export function formatDay(value: string) {
  return formatDate(`${value}T00:00:00Z`, { month: "short", day: "numeric", year: "numeric" });
}

export function periodLabel(period: Period) {
  const start = `${period.start}T00:00:00Z`;
  const end = `${period.end}T00:00:00Z`;

  if (period.cadence === "month") {
    return formatDate(start, { month: "long", year: "numeric" });
  }

  return `${formatDate(start, { month: "short", day: "numeric" })}–${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function shortPeriodLabel(period: Period) {
  const start = `${period.start}T00:00:00Z`;

  if (period.cadence === "month") {
    return formatDate(start, { month: "short", year: "2-digit" });
  }

  return periodLabel(period);
}

export function humanize(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const ROLE_ACRONYMS = new Set(["coo", "dho", "cfo", "coe", "hr", "bd"]);

export function roleLabel(role: string) {
  return role
    .split("-")
    .map((part) =>
      ROLE_ACRONYMS.has(part)
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

export function scopeLabel(entity: ScopeEntity) {
  return `${humanize(entity.grain)} scope`;
}

export function formatNumber(value: number) {
  return numberFormat.format(value);
}

/** Missing is never zero, and a zero denominator is not applicable (PRD §7.9). */
export function measureText(value: MeasureValue, unit: string) {
  switch (value.status) {
    case "available":
      return `${formatNumber(value.value)} ${unit}`.trim();
    case "missing":
      return value.reason === "missing_denominator" ? "Unavailable — denominator missing" : "Not reported";
    case "not_applicable":
      return value.reason === "zero_denominator"
        ? "Not applicable — zero denominator"
        : "Not applicable — invalid denominator";
  }
}

export function measureState(value: MeasureValue) {
  if (value.status === "available") return "ready";
  if (value.status === "missing") {
    return value.reason === "missing_denominator" ? "missing_denominator" : "missing";
  }
  return "unavailable";
}

export function targetText(target: Target, unit: string) {
  const approval = (value: "demo_parameter" | "unapproved") =>
    value === "demo_parameter" ? "illustrative demo parameter" : "unapproved";

  switch (target.state) {
    case "not_configured":
      return "Target not configured";
    case "configured":
      return `${formatNumber(target.value)} ${unit}, ${target.direction.replaceAll("_", " ")} (${approval(target.approval)})`;
    case "configured_range":
      return `${formatNumber(target.low)}–${formatNumber(target.high)} ${unit} (${approval(target.approval)})`;
  }
}

export function assignmentLabel(
  assignmentId: string,
  assignments: ReadonlyMap<string, KpiAssignmentSummary>,
) {
  return assignments.get(assignmentId)?.kpi ?? "Assignment unavailable";
}

export function assignmentMap(assignments: readonly KpiAssignmentSummary[]) {
  return new Map(assignments.map((assignment) => [assignment.assignmentId, assignment]));
}

export function monthStart(month: string) {
  return `${month}-01`;
}

export function monthEnd(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return `${month}-28`;
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export function monthOf(date: string) {
  return date.slice(0, 7);
}
