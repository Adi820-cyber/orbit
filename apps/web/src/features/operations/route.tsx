import type { MeasureValue, OperationsAttendance, OperationsDay, OperationsNow, OperationsResponse } from "@orbit/contracts";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { formatDateTime, formatDay, formatNumber } from "../../lib/format";
import { Disclosure, QualityChips, ScrollRegion, SurfaceHeading } from "../workspace/components";
import { withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "./operations.css";

export function operationsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<OperationsResponse> =>
    withClient(environment, request, (client) => client.operations());
}

function percent(value: MeasureValue): string {
  return value.status === "available" ? `${formatNumber(value.value)}%` : "Not applicable";
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="operations-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <dd className="operations-tile__note">{note}</dd> : null}
    </div>
  );
}

function NowTiles({ now }: { now: OperationsNow }) {
  const { staffing, doctors, visits, services } = now;
  const credentialAttention = doctors.credentialExpiring + doctors.credentialExpired + doctors.credentialSuspended;
  return (
    <dl className="operations-tiles">
      <Tile label="On duty now" value={formatNumber(staffing.onDutyNow)} note={`of ${formatNumber(staffing.rosteredToday)} rostered today`} />
      <Tile label="Late today" value={formatNumber(staffing.lateToday)} />
      <Tile label="Absent today" value={formatNumber(staffing.absentToday)} />
      <Tile label="Missing punch today" value={formatNumber(staffing.missingPunchToday)} note="Reported as missing, never as zero hours" />
      <Tile label="Open visits" value={formatNumber(visits.openNow)} note={`${formatNumber(visits.openInpatients)} inpatient`} />
      <Tile label="Visits started today" value={formatNumber(visits.startedToday)} note={`${formatNumber(visits.startedLast7Days)} in 7 days`} />
      <Tile label="Services delivered today" value={formatNumber(services.deliveredToday)} note={`${formatNumber(services.deliveredLast7Days)} in 7 days`} />
      <Tile label="Doctor credentials needing attention" value={formatNumber(credentialAttention)} note={`of ${formatNumber(doctors.total)} doctors`} />
      <Tile label="Corrections awaiting review" value={formatNumber(now.pendingCorrections)} />
      <Tile label="Active staff" value={formatNumber(staffing.activeStaff)} />
    </dl>
  );
}

function AttendanceSummary({ attendance }: { attendance: OperationsAttendance }) {
  return (
    <p className="operations-attendance">
      Over the last {attendance.days} finished days, {formatNumber(attendance.finished)} shifts ended:{" "}
      {percent(attendance.completionRate)} had a complete in and out pair, {percent(attendance.onTimeRate)} on time,{" "}
      {percent(attendance.missingPunchRate)} with a missing punch, {percent(attendance.absentRate)} absent.
    </p>
  );
}

function DailyTable({ days, caption }: { days: readonly OperationsDay[]; caption: string }) {
  if (!days.length) return <p className="workspace-empty">No finished days to show yet.</p>;
  return (
    <ScrollRegion label={caption}>
      <table className="workspace-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" data-numeric="true">Rostered</th>
            <th scope="col" data-numeric="true">On time</th>
            <th scope="col" data-numeric="true">Late</th>
            <th scope="col" data-numeric="true">Left early</th>
            <th scope="col" data-numeric="true">Missing punch</th>
            <th scope="col" data-numeric="true">Absent</th>
            <th scope="col" data-numeric="true">On leave</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatDay(day.date)}</th>
              <td data-numeric="true">{formatNumber(day.rostered)}</td>
              <td data-numeric="true">{formatNumber(day.onTime)}</td>
              <td data-numeric="true">{formatNumber(day.late)}</td>
              <td data-numeric="true">{formatNumber(day.earlyExit)}</td>
              <td data-numeric="true">{formatNumber(day.missingPunch)}</td>
              <td data-numeric="true">{formatNumber(day.absent)}</td>
              <td data-numeric="true">{formatNumber(day.onLeave)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function OperationsPage({ data }: { data: OperationsResponse }) {
  return (
    <>
      <title>Hospital operations | Orbit</title>
      <SurfaceHeading
        eyebrow="Live from the hospital operations system"
        title="Hospital operations"
        description="Staffing, visits and services recorded by the hospital operations system, for the hospitals in your scope. Counts only: no person or patient is named here."
      />
      <Disclosure text={data.disclosure} />
      <QualityChips quality={data.dataQuality} />
      <ul className="operations-limitations">
        {data.dataQuality.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
      <p className="orbit-meta">
        As of {formatDateTime(data.asOf)}. Last activity recorded {formatDateTime(data.dataQuality.refreshedAt)}.
      </p>

      {data.hospitals.length === 0 ? (
        <p className="workspace-empty">Your scope covers no hospital with operations data.</p>
      ) : (
        <>
          <section aria-labelledby="operations-total">
            <h2 id="operations-total">
              {data.hospitals.length === 1 ? data.hospitals[0]?.name : `All ${data.rollup.hospitals} hospitals in your scope`}
            </h2>
            <NowTiles now={data.rollup.now} />
            <AttendanceSummary attendance={data.rollup.attendance} />
            <DailyTable days={data.rollup.daily} caption={`Attendance by day, last ${data.periodDays} finished days`} />
          </section>

          {data.hospitals.length > 1 ? (
            <section aria-labelledby="operations-by-hospital">
              <h2 id="operations-by-hospital">By hospital</h2>
              <ScrollRegion label="Hospitals">
                <table className="workspace-table">
                  <caption>Today, and attendance over the last {data.periodDays} finished days</caption>
                  <thead>
                    <tr>
                      <th scope="col">Hospital</th>
                      <th scope="col" data-numeric="true">On duty</th>
                      <th scope="col" data-numeric="true">Late today</th>
                      <th scope="col" data-numeric="true">Absent today</th>
                      <th scope="col" data-numeric="true">Open visits</th>
                      <th scope="col" data-numeric="true">Services today</th>
                      <th scope="col" data-numeric="true">Complete in/out</th>
                      <th scope="col" data-numeric="true">On time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hospitals.map((hospital) => (
                      <tr key={hospital.facilityId}>
                        <th scope="row">{hospital.name}</th>
                        <td data-numeric="true">
                          {formatNumber(hospital.now.staffing.onDutyNow)} / {formatNumber(hospital.now.staffing.rosteredToday)}
                        </td>
                        <td data-numeric="true">{formatNumber(hospital.now.staffing.lateToday)}</td>
                        <td data-numeric="true">{formatNumber(hospital.now.staffing.absentToday)}</td>
                        <td data-numeric="true">{formatNumber(hospital.now.visits.openNow)}</td>
                        <td data-numeric="true">{formatNumber(hospital.now.services.deliveredToday)}</td>
                        <td data-numeric="true">{percent(hospital.attendance.completionRate)}</td>
                        <td data-numeric="true">{percent(hospital.attendance.onTimeRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

export function OperationsRoute() {
  return <OperationsPage data={useLoaderData<OperationsResponse>()} />;
}
