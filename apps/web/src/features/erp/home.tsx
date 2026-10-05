import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { ErpSummaryResponse } from "@orbit/contracts";
import type { ApiClient } from "../../lib/api";
import { SurfaceHeading } from "../workspace/components";
import { mutate, withClient, type MutationFailure, type WorkspaceEnvironment } from "../workspace/environment";
import { day, ErpDisclosure, facilityFromUrl, useErp, useErpHref, when } from "./shared";

/** Result of a form action on an ERP page; shown inline, never as a page error. */
export type ErpActionResult = { ok: true; message: string } | MutationFailure;

/** Runs one mutation and reports it inline (shared by every ERP page action). */
export async function erpMutation(
  environment: WorkspaceEnvironment,
  request: Request,
  run: (client: ApiClient) => Promise<unknown>,
  success: string,
): Promise<ErpActionResult> {
  const result = await mutate(environment, request, run);
  return result.ok ? { ok: true, message: success } : result;
}

export function erpHomeLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs) =>
    withClient(environment, request, (client) => client.erp.summary({ facilityId: facilityFromUrl(request) }));
}

function Tile({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "attention" }) {
  return (
    <Link className="erp-tile" data-tone={tone && value > 0 ? tone : undefined} to={href}>
      <span className="erp-tile__value is-illustrative">{value}</span>
      <span className="erp-tile__label">{label}</span>
    </Link>
  );
}

export function ErpHomeRoute() {
  const summary = useLoaderData<ErpSummaryResponse>();
  const { facilityName, facilityId, isAdmin } = useErp();
  const href = useErpHref();

  return (
    <>
      <title>Today | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title={`Today, ${day(summary.date)}`}
        description={`Who is on shift, which visits are open, and what needs a decision. As of ${when(summary.asOf)}.`}
      />
      <ErpDisclosure />

      <section className="workspace-section" aria-labelledby="staff-today">
        <div className="workspace-section__heading">
          <h2 id="staff-today">Staff on today's roster</h2>
        </div>
        <div className="erp-tiles">
          <Tile label="Rostered today" value={summary.staff.rostered} href={href("/attendance")} />
          <Tile label="On duty now" value={summary.staff.onDuty} href={href("/attendance")} />
          <Tile label="Late" value={summary.staff.late} href={href("/attendance")} tone="attention" />
          <Tile label="Missing a punch" value={summary.staff.missingPunch} href={href("/attendance")} tone="attention" />
          <Tile label="Absent" value={summary.staff.absent} href={href("/attendance")} tone="attention" />
          <Tile label="Active staff" value={summary.staff.active} href={href("/staff")} />
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="patients-today">
        <div className="workspace-section__heading">
          <h2 id="patients-today">Patients and services</h2>
        </div>
        <div className="erp-tiles">
          <Tile label="Inpatients admitted" value={summary.encounters.openInpatients} href={href("/visits", { status: "open", type: "inpatient" })} />
          <Tile label="Other open visits" value={summary.encounters.openOther} href={href("/visits", { status: "open" })} />
          <Tile label="Visits started today" value={summary.encounters.startedToday} href={href("/visits", { date: summary.date })} />
          <Tile label="Services delivered today" value={summary.servicesDeliveredToday} href={href("/visits", { date: summary.date })} />
          <Tile label="Patients registered today" value={summary.patientsRegisteredToday} href={href("/patients")} />
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="decisions">
        <div className="workspace-section__heading">
          <h2 id="decisions">Needs a decision</h2>
        </div>
        <div className="erp-tiles">
          <Tile
            label={isAdmin ? "Attendance corrections to review" : "Corrections waiting for an admin"}
            value={summary.pendingCorrections}
            href={href("/corrections", { state: "submitted" })}
            tone="attention"
          />
          <Tile
            label="Doctors with an expiring, expired or suspended credential"
            value={summary.doctorsNeedingCredentialAttention}
            href={href("/doctors")}
            tone="attention"
          />
        </div>
      </section>
    </>
  );
}
