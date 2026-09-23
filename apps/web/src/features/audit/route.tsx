import type { AuditEvent, AuditListResponse } from "@orbit/contracts";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { formatDateTime, humanize, roleLabel } from "../../lib/format";
import { Disclosure, ScrollRegion, SurfaceHeading } from "../workspace/components";
import { useWorkspace, useWorkspacePath, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "./audit.css";

export function auditLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<AuditListResponse> => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return withClient(environment, request, (client) => client.audit(cursor));
  };
}

const KIND_TONE: Record<AuditEvent["kind"], string> = {
  action_created: "ready",
  action_transitioned: "illustrative",
  ask_answered: "illustrative",
  access_denied: "out_of_scope",
  evidence_viewed: "unavailable",
};

function Target({ event }: { event: AuditEvent }) {
  const path = useWorkspacePath();
  if (!event.target) return <span className="orbit-meta">None</span>;
  if (event.target.type === "action") {
    return (
      <Link className="workspace-reference" to={path(`/actions/${encodeURIComponent(event.target.id)}`)}>
        {event.target.id}
      </Link>
    );
  }
  return (
    <span>
      {humanize(event.target.type)} · <span className="workspace-reference">{event.target.id}</span>
    </span>
  );
}

export function AuditPage({ audit }: { audit: AuditListResponse }) {
  const [search] = useSearchParams();
  const path = useWorkspacePath();
  const { kpis } = useWorkspace();

  return (
    <>
      <title>Audit | Orbit</title>
      <SurfaceHeading
        eyebrow="Accountability"
        title="Audit trail"
        description="Accepted actions, state changes, Ask outcomes, evidence views, and access denials. App users cannot rewrite or delete these entries; no tokens, secrets, or question text are recorded."
      />
      <Disclosure text={kpis.disclosure} />
      <p className="audit-note" role="note">
        This is an application-protected persistent audit trail, not a claim of cryptographic immutability. Which entries
        each role may read is still an open entitlement decision.
      </p>

      {audit.items.length ? (
        <ScrollRegion label="Audit events">
          <table className="workspace-table">
            <caption>Most recent first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Actor role</th>
                <th scope="col">Target</th>
                <th scope="col">Outcome</th>
                <th scope="col">Request</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((event) => (
                <tr key={event.eventId}>
                  <td className="audit-time">{formatDateTime(event.occurredAt)}</td>
                  <th scope="row">
                    <span className="orbit-status" data-state={KIND_TONE[event.kind]}>{humanize(event.kind)}</span>
                  </th>
                  <td>{roleLabel(event.actorRole)}</td>
                  <td><Target event={event} /></td>
                  <td>{humanize(event.outcome)}</td>
                  <td className="workspace-reference">{event.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">No audit entries are visible to you yet.</p>
      )}

      {audit.nextCursor || search.get("cursor") ? (
        <nav className="inbox-pagination" aria-label="Audit pages">
          {search.get("cursor") ? <Link className="orbit-button" data-variant="secondary" to={path("/audit")}>Newest</Link> : null}
          {audit.nextCursor ? (
            <Link
              className="orbit-button"
              data-variant="secondary"
              to={`${path("/audit")}?${new URLSearchParams({ cursor: audit.nextCursor }).toString()}`}
            >
              Older entries
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

export function AuditRoute() {
  return <AuditPage audit={useLoaderData<AuditListResponse>()} />;
}
