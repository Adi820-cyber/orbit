import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import type {
  AttendanceBoardResponse,
  AttendanceStatus,
  CorrectionListResponse,
  RecordPunchResponse,
  RosterDayResponse,
} from "@orbit/contracts";
import { formText } from "../../lib/form";
import { ScrollRegion, SurfaceHeading } from "../workspace/components";
import { mutate, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import { erpMutation, type ErpActionResult } from "./home";
import {
  ATTENDANCE_LABEL,
  AttendanceChip,
  clock,
  day,
  workedText,
  ErpDisclosure,
  facilityFromUrl,
  Field,
  FormMessage,
  instantFromLocal,
  label,
  Pager,
  todayUtc,
  useErp,
  useErpHref,
  when,
} from "./shared";

const COUNT_ORDER: readonly AttendanceStatus[] = [
  "on-duty", "present", "late", "early-exit", "missing-punch", "absent", "scheduled", "on-leave", "unrostered", "off",
];

// ---------------------------------------------------------------------------
// Attendance board
// ---------------------------------------------------------------------------

export function attendanceLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    return withClient(environment, request, (client) => client.erp.board({ facilityId: facilityFromUrl(request), date }));
  };
}

export function attendanceAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const intent = formText(form, "intent");
    const staffId = formText(form, "staffId");

    if (intent === "punch" || intent === "backdate") {
      const direction = formText(form, "direction");
      const punchedAt = intent === "backdate" ? instantFromLocal(formText(form, "punchedAt")) : undefined;
      if (intent === "backdate" && !punchedAt) return { ok: false, code: "invalid_request", message: "Enter the punch time." };
      const result = await mutate(environment, request, (client) =>
        client.erp.punch({ staffId, direction, idempotencyKey: formText(form, "idempotencyKey"), punchedAt }),
      );
      if (!result.ok) return result;
      return { ok: true, message: punchMessage(result.value) };
    }
    if (intent === "correct") {
      const proposedIn = instantFromLocal(formText(form, "proposedIn"));
      const proposedOut = instantFromLocal(formText(form, "proposedOut"));
      if (!proposedIn && !proposedOut) return { ok: false, code: "invalid_request", message: "Propose an in time, an out time, or both." };
      return erpMutation(
        environment,
        request,
        (client) =>
          client.erp.requestCorrection({ staffId, shiftDate: formText(form, "shiftDate"), proposedIn, proposedOut, reason: formText(form, "reason") }),
        "Correction requested. An admin will review it.",
      );
    }
    return { ok: false, code: "invalid_request", message: "Unknown request." };
  };
}

/**
 * Says what a punch did. A punch outside every rostered shift window still
 * stays on record, but does not count toward the shift; the desk is told so
 * rather than seeing nothing change.
 */
export function punchMessage(response: RecordPunchResponse): string {
  const { punch, day: derived, replayed } = response;
  const time = clock(punch.punchedAt);
  if (replayed) return `Already recorded at ${time}.`;
  const counted = derived.rosterId === null || (derived.status !== "scheduled" && derived.status !== "absent");
  if (!counted) {
    return `Recorded ${punch.direction} at ${time}, but it is outside this person's shift window, so it does not count toward the shift. Request a correction if needed.`;
  }
  return `Punched ${punch.direction} at ${time}. Status: ${ATTENDANCE_LABEL[derived.status].toLowerCase()}.`;
}

function PunchButtons({ staffId, onDuty }: { staffId: string; onDuty: boolean }) {
  const fetcher = useFetcher<ErpActionResult>();
  const busy = fetcher.state !== "idle";
  // One key per rendered button pair: a double click replays instead of recording twice.
  const idempotencyKey = crypto.randomUUID();
  return (
    <fetcher.Form method="post" className="erp-inline-form">
      <input type="hidden" name="intent" value="punch" />
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <button className="orbit-button" data-variant={onDuty ? "secondary" : undefined} name="direction" value="in" type="submit" disabled={busy}>
        In
      </button>
      <button className="orbit-button" data-variant={onDuty ? undefined : "secondary"} name="direction" value="out" type="submit" disabled={busy}>
        Out
      </button>
      {fetcher.data ? (
        <span className="erp-message" data-tone={fetcher.data.ok ? "success" : "danger"} role={fetcher.data.ok ? "status" : "alert"}>
          {fetcher.data.message}
        </span>
      ) : null}
    </fetcher.Form>
  );
}

function CorrectionForm({ staffId, shiftDate, admin }: { staffId: string; shiftDate: string; admin: boolean }) {
  const fetcher = useFetcher<ErpActionResult>();
  return (
    <details className="erp-details">
      <summary>Fix times</summary>
      <fetcher.Form method="post" className="erp-form-grid">
        <input type="hidden" name="intent" value="correct" />
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name="shiftDate" value={shiftDate} />
        <Field label="Proposed in (UTC)">
          <input className="orbit-input" type="datetime-local" name="proposedIn" />
        </Field>
        <Field label="Proposed out (UTC)">
          <input className="orbit-input" type="datetime-local" name="proposedOut" />
        </Field>
        <Field label="Reason">
          <input className="orbit-input" name="reason" required minLength={3} maxLength={500} />
        </Field>
        <button className="orbit-button" type="submit" disabled={fetcher.state !== "idle"}>
          Request correction
        </button>
        <FormMessage result={fetcher.data} />
      </fetcher.Form>
      {admin ? (
        <fetcher.Form method="post" className="erp-form-grid">
          <input type="hidden" name="intent" value="backdate" />
          <input type="hidden" name="staffId" value={staffId} />
          <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
          <Field label="Missed punch time (UTC)" hint="Admins only; within the last 31 days.">
            <input className="orbit-input" type="datetime-local" name="punchedAt" required />
          </Field>
          <Field label="Direction">
            <select className="orbit-select" name="direction" defaultValue="out">
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </Field>
          <button className="orbit-button" data-variant="secondary" type="submit" disabled={fetcher.state !== "idle"}>
            Record missed punch
          </button>
        </fetcher.Form>
      ) : null}
    </details>
  );
}

export function AttendanceRoute() {
  const board = useLoaderData<AttendanceBoardResponse>();
  const { facilityName, shiftName, isAdmin } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const live = board.date === todayUtc();

  return (
    <>
      <title>Attendance | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(board.facilityId)}
        title={`Attendance, ${day(board.date)}`}
        description={`Derived from the roster, in/out punches and approved corrections, as of ${when(board.asOf)}. A missing punch is shown as missing, never as zero hours.`}
      />
      <ErpDisclosure />

      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Date">
          <input className="orbit-input" type="date" name="date" defaultValue={board.date} />
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Show</button>
        <Link className="orbit-button" data-variant="quiet" to={href("/attendance")}>Today</Link>
      </Form>

      <ul className="erp-counts" aria-label="Attendance counts">
        <li>
          <strong>{board.onDuty}</strong> in now
        </li>
        {COUNT_ORDER.filter((status) => board.counts[status] > 0).map((status) => (
          <li key={status}>
            <strong>{board.counts[status]}</strong> {ATTENDANCE_LABEL[status].toLowerCase()}
          </li>
        ))}
      </ul>

      {board.rows.length ? (
        <ScrollRegion label="Attendance">
          <table className="workspace-table erp-table">
            <caption>Times are UTC, the organization's time zone</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Shift</th>
                <th scope="col">Status</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col">Worked</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map(({ staff, day: attendance }) => (
                <tr key={staff.staffId}>
                  <th scope="row">
                    <Link className="workspace-inline-link" to={href(`/staff/${staff.staffId}`, { month: board.date.slice(0, 7) })}>
                      {staff.displayName}
                    </Link>
                    <span className="erp-sub">{staff.employeeCode} · {staff.designation}</span>
                  </th>
                  <td>
                    {attendance.shiftTemplateId ? shiftName(attendance.shiftTemplateId) : "Not rostered"}
                    {attendance.shiftStart ? <span className="erp-sub">{clock(attendance.shiftStart)}–{clock(attendance.shiftEnd)}</span> : null}
                  </td>
                  <td>
                    <AttendanceChip status={attendance.status} />
                    {attendance.lateMinutes ? <span className="erp-sub">{attendance.lateMinutes} min late</span> : null}
                    {attendance.earlyExitMinutes ? <span className="erp-sub">left {attendance.earlyExitMinutes} min early</span> : null}
                    {attendance.corrected ? <span className="erp-sub">Corrected</span> : null}
                  </td>
                  <td>{clock(attendance.firstIn)}</td>
                  <td>{clock(attendance.lastOut)}</td>
                  <td>{workedText(attendance)}</td>
                  <td>
                    {live ? <PunchButtons staffId={staff.staffId} onDuty={attendance.onDuty} /> : null}
                    <CorrectionForm staffId={staff.staffId} shiftDate={board.date} admin={isAdmin} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">No staff are employed at this facility on this date.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export function correctionsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    return withClient(environment, request, (client) =>
      client.erp.corrections({
        facilityId: facilityFromUrl(request),
        state: url.searchParams.get("state"),
        page: url.searchParams.get("page"),
      }),
    );
  };
}

export function correctionsAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const decision = formText(form, "decision");
    const note = formText(form, "note").trim();
    return erpMutation(
      environment,
      request,
      (client) =>
        client.erp.decideCorrection(formText(form, "correctionId"), {
          version: Number(formText(form, "version")),
          decision,
          ...(note ? { note } : {}),
        }),
      decision === "approved" ? "Correction approved; attendance re-derived." : "Correction rejected.",
    );
  };
}

export function CorrectionsRoute() {
  const list = useLoaderData<CorrectionListResponse>();
  const result = useActionData<ErpActionResult>();
  const { isAdmin, facilityName, facilityId } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const state = search.get("state") ?? undefined;

  return (
    <>
      <title>Corrections | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Attendance corrections"
        description="Requested fixes to in/out times. Punches are never edited: an approved correction replaces the times it proposes. Only an admin decides, and never their own request."
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <nav className="erp-toolbar" aria-label="Filter corrections">
        <Link className="orbit-button" data-variant={state === "submitted" ? undefined : "secondary"} to={href("/corrections", { state: "submitted" })}>Waiting</Link>
        <Link className="orbit-button" data-variant={state === "approved" ? undefined : "secondary"} to={href("/corrections", { state: "approved" })}>Approved</Link>
        <Link className="orbit-button" data-variant={state === "rejected" ? undefined : "secondary"} to={href("/corrections", { state: "rejected" })}>Rejected</Link>
        <Link className="orbit-button" data-variant={state ? "secondary" : undefined} to={href("/corrections")}>All</Link>
      </nav>

      {list.items.length ? (
        <ScrollRegion label="Corrections">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Shift date</th>
                <th scope="col">Proposed in</th>
                <th scope="col">Proposed out</th>
                <th scope="col">Reason</th>
                <th scope="col">State</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((correction) => (
                <tr key={correction.correctionId}>
                  <th scope="row">{correction.staffName}</th>
                  <td>{day(correction.shiftDate)}</td>
                  <td>{clock(correction.proposedIn)}</td>
                  <td>{clock(correction.proposedOut)}</td>
                  <td>{correction.reason}</td>
                  <td>
                    <span className="orbit-status" data-state={correction.state === "approved" ? "ready" : correction.state === "rejected" ? "unavailable" : "late"}>
                      {label(correction.state === "submitted" ? "waiting" : correction.state)}
                    </span>
                  </td>
                  <td>
                    {correction.state !== "submitted" ? (
                      <span>{correction.decisionNote ?? "—"}<span className="erp-sub">{when(correction.decidedAt)}</span></span>
                    ) : !isAdmin ? (
                      <span className="erp-sub">Waiting for an admin</span>
                    ) : correction.requestedByMe ? (
                      <span className="erp-sub">You requested this; another admin decides</span>
                    ) : (
                      <Form method="post" className="erp-inline-form">
                        <input type="hidden" name="correctionId" value={correction.correctionId} />
                        <input type="hidden" name="version" value={correction.version} />
                        <input className="orbit-input" name="note" placeholder="Note (optional)" maxLength={500} aria-label="Decision note" />
                        <button className="orbit-button" name="decision" value="approved" type="submit">Approve</button>
                        <button className="orbit-button" data-variant="secondary" name="decision" value="rejected" type="submit">Reject</button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">No corrections match.</p>
      )}
      <Pager {...list.page} href={(page) => href("/corrections", { state, page: String(page) })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export function rostersLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) => {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    return withClient(environment, request, (client) => client.erp.roster({ facilityId: facilityFromUrl(request), date }));
  };
}

export function rostersAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const shift = formText(form, "shiftTemplateId");
    const version = formText(form, "version");
    return erpMutation(
      environment,
      request,
      (client) =>
        client.erp.setRoster({
          staffId: formText(form, "staffId"),
          date: formText(form, "date"),
          shiftTemplateId: shift || null,
          ...(version ? { version: Number(version) } : {}),
        }),
      shift ? "Shift saved." : "Day set to off.",
    );
  };
}

function RosterRow({ row, date, templates }: { row: RosterDayResponse["rows"][number]; date: string; templates: RosterDayResponse["shiftTemplates"] }) {
  const fetcher = useFetcher<ErpActionResult>();
  return (
    <tr>
      <th scope="row">
        {row.staff.displayName}
        <span className="erp-sub">{row.staff.designation}</span>
      </th>
      <td>
        <fetcher.Form method="post" className="erp-inline-form">
          <input type="hidden" name="staffId" value={row.staff.staffId} />
          <input type="hidden" name="date" value={date} />
          {row.assignment ? <input type="hidden" name="version" value={row.assignment.version} /> : null}
          <select
            className="orbit-select"
            name="shiftTemplateId"
            defaultValue={row.assignment?.shiftTemplateId ?? ""}
            aria-label={`Shift for ${row.staff.displayName}`}
          >
            <option value="">Off</option>
            {templates.map((template) => (
              <option key={template.shiftTemplateId} value={template.shiftTemplateId}>
                {template.name} {template.startTime}–{template.endTime}
              </option>
            ))}
          </select>
          <button className="orbit-button" data-variant="secondary" type="submit" disabled={fetcher.state !== "idle"}>
            Save
          </button>
          {fetcher.data ? (
            <span className="erp-message" data-tone={fetcher.data.ok ? "success" : "danger"} role={fetcher.data.ok ? "status" : "alert"}>
              {fetcher.data.message}
            </span>
          ) : null}
        </fetcher.Form>
      </td>
    </tr>
  );
}

export function RostersRoute() {
  const roster = useLoaderData<RosterDayResponse>();
  const { facilityName, isAdmin } = useErp();
  const [search] = useSearchParams();
  const past = roster.date < todayUtc();

  return (
    <>
      <title>Rosters | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(roster.facilityId)}
        title={`Roster, ${day(roster.date)}`}
        description="One planned shift per person per day. Shifts that end after midnight count toward the day they start. Shift patterns are illustrative demo configuration."
      />
      <ErpDisclosure />
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <Field label="Date">
          <input className="orbit-input" type="date" name="date" defaultValue={roster.date} />
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Show</button>
      </Form>
      {past && !isAdmin ? (
        <p className="erp-note" role="note">This date has passed: only an admin can change its roster.</p>
      ) : null}
      <ScrollRegion label="Roster">
        <table className="workspace-table erp-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Shift</th>
            </tr>
          </thead>
          <tbody>
            {roster.rows.map((row) => (
              <RosterRow key={row.staff.staffId} row={row} date={roster.date} templates={roster.shiftTemplates} />
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
