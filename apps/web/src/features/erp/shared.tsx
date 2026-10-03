import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation, useRouteError } from "react-router";
import type {
  AttendanceStatus,
  CredentialStatus,
  ErpReferenceResponse,
  OperatorMeResponse,
} from "@orbit/contracts";
import { ApiRequestError } from "../../lib/api";
import { formatDateTime, formatDay } from "../../lib/format";
import { SurfaceState } from "../workspace/components";
import { describeError } from "../workspace/states";

/*
 * Shared pieces of the hospital-operations (ERP) area (ADR 0016). Role and
 * scope shown here come from `GET /api/me`, for display and navigation only;
 * the API enforces them on every request.
 */

export interface ErpData {
  identity: OperatorMeResponse;
  reference: ErpReferenceResponse;
  /** The facility every page works with: the hospital account's own, or the admin's choice. */
  facilityId: string;
}

export const ErpContext = createContext<ErpData | null>(null);

/** id → display name, for ids the reference data lists; anything else is "Not visible", never a raw id. */
function lookup<T>(items: readonly T[], key: keyof T, name: keyof T) {
  const map = new Map(items.map((item) => [String(item[key]), String(item[name])]));
  return (id: string | null | undefined) => (id ? (map.get(id) ?? "Not visible") : "—");
}

export function useErp() {
  const value = useContext(ErpContext);
  if (!value) throw new Error("ERP pages must render inside the ERP layout.");
  return {
    ...value,
    isAdmin: value.identity.operatorRole === "admin",
    facilityName: lookup(value.reference.facilities, "facilityId", "name"),
    departmentName: lookup(value.reference.departments, "departmentId", "name"),
    specialtyName: lookup(value.reference.specialties, "specialtyId", "name"),
    shiftName: lookup(value.reference.shiftTemplates, "shiftTemplateId", "name"),
  };
}

/** The facility a request works with, from the URL (admins) or the verified scope (hospital accounts). */
export function facilityFromUrl(request: Request): string | undefined {
  return new URL(request.url).searchParams.get("facility") ?? undefined;
}

/** Builds ERP links that keep the selected facility. */
export function useErpHref() {
  const { search } = useLocation();
  const facility = new URLSearchParams(search).get("facility");
  return (path: string, params: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams();
    if (facility) query.set("facility", facility);
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    const text = query.toString();
    return `/erp${path === "/" ? "" : path}${text ? `?${text}` : ""}`;
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  present: "ready",
  "on-duty": "fresh",
  late: "late",
  "early-exit": "late",
  "missing-punch": "missing",
  absent: "critical",
  scheduled: "empty",
  off: "empty",
  "on-leave": "illustrative",
  unrostered: "unavailable",
};

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  "on-duty": "On duty",
  late: "Late",
  "early-exit": "Left early",
  "missing-punch": "Missing punch",
  absent: "Absent",
  scheduled: "Scheduled",
  off: "Off",
  "on-leave": "On leave",
  unrostered: "Worked unrostered",
};

export function AttendanceChip({ status }: { status: AttendanceStatus }) {
  return (
    <span className="orbit-status" data-state={ATTENDANCE_TONE[status]}>
      {ATTENDANCE_LABEL[status]}
    </span>
  );
}

const CREDENTIAL_TONE: Record<CredentialStatus, string> = {
  active: "ready",
  expiring: "late",
  expired: "critical",
  suspended: "critical",
};

export function CredentialChip({ status }: { status: CredentialStatus }) {
  return (
    <span className="orbit-status" data-state={CREDENTIAL_TONE[status]}>
      Credential {status}
    </span>
  );
}

/** `HH:MM` in UTC (the demo organization's time zone) from an ISO instant; a dash when missing. */
export function clock(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(11, 16);
}

export function when(value: string | null | undefined) {
  return value ? formatDateTime(value) : "—";
}

export function day(value: string | null | undefined) {
  return value ? formatDay(value) : "—";
}

/** Worked time for a day: "Not complete" only when a punch is missing; a dash when no work was due. */
export function workedText(entry: { status: AttendanceStatus; workedMinutes: number | null }) {
  if (entry.workedMinutes === null && ["off", "on-leave", "scheduled", "absent"].includes(entry.status)) return "—";
  return duration(entry.workedMinutes);
}

/** Minutes as hours and minutes. `null` (missing) is never shown as zero. */
export function duration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "Not complete";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

export function label(value: string) {
  const text = value.replaceAll("-", " ").replaceAll("_", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A `datetime-local` value (entered in UTC) as an ISO instant, or undefined when empty. */
export function instantFromLocal(value: string): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00Z` : undefined;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function ErpDisclosure() {
  const { reference } = useErp();
  return (
    <div className="orbit-disclosure-banner workspace-disclosure" role="note">
      <span>Illustrative records</span>
      <span>{reference.disclosure}</span>
    </div>
  );
}

export function FormMessage({ result }: { result: { ok: boolean; message?: string } | undefined }) {
  if (!result) return null;
  return (
    <p className="erp-message" data-tone={result.ok ? "success" : "danger"} role={result.ok ? "status" : "alert"}>
      {result.message}
    </p>
  );
}

export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="erp-count">{total} {total === 1 ? "record" : "records"}</p>;
  return (
    <nav className="erp-pager" aria-label="Pages">
      <span className="erp-count">
        Page {page} of {pages} · {total} records
      </span>
      {page > 1 ? <Link className="orbit-button" data-variant="secondary" to={href(page - 1)}>Previous</Link> : null}
      {page < pages ? <Link className="orbit-button" data-variant="secondary" to={href(page + 1)}>Next</Link> : null}
    </nav>
  );
}

export function Field({ label: text, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="orbit-field">
      <span className="orbit-field-label">{text}</span>
      {children}
      {hint ? <span className="orbit-field-message">{hint}</span> : null}
    </label>
  );
}

/** Route-level failure inside the ERP area: explicit, never a blank or partial page. */
export function ErpErrorBoundary() {
  const error = useRouteError();
  const described =
    error instanceof ApiRequestError && error.code === "conflict"
      ? { kind: "invalid_request" as const, title: "That change could not be made.", message: error.message }
      : describeError(error);
  return (
    <>
      <title>Unavailable | Orbit hospital operations</title>
      <SurfaceState kind={described.kind} title={described.title} message={described.message} level={1}>
        <Link className="orbit-button" data-variant="secondary" to="/erp">
          Back to today
        </Link>
      </SurfaceState>
    </>
  );
}
