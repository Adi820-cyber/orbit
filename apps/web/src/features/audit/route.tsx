import type { AuditEvent, AuditListResponse } from "@orbit/contracts";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { actionStateLabel, formatDateTime, humanize, roleLabel } from "../../lib/format";
import { Disclosure, ScrollRegion, SurfaceHeading } from "../workspace/components";
import { useWorkspace, useWorkspacePath, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "./audit.css";

export interface AuditData {
  audit: AuditListResponse;
  /** Titles of the caller's own actions, so the trail names them instead of showing ids. */
  actionTitles: Record<string, string>;
}

export function auditLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<AuditData> => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return withClient(environment, request, async (client) => {
      const [audit, actions] = await Promise.all([client.audit(cursor), client.actions()]);
      return { audit, actionTitles: Object.fromEntries(actions.items.map((action) => [action.actionId, action.title])) };
    });
  };
}

const KIND_TONE: Record<AuditEvent["kind"], string> = {
  action_created: "ready",
  action_transitioned: "illustrative",
  ask_answered: "illustrative",
  access_denied: "out_of_scope",
  evidence_viewed: "unavailable",
};

function Target({ event, titles }: { event: AuditEvent; titles: Record<string, string> }) {
  const path = useWorkspacePath();
  if (!event.target) return <span className="orbit-meta">None</span>;
  if (event.target.type === "action") {
    return (
      <Link to={path(`/actions/${encodeURIComponent(event.target.id)}`)}>
        {titles[event.target.id] ?? "Open the action"}
      </Link>
    );
  }
  return (
    <span>
      {humanize(event.target.type)} · <span className="workspace-reference">{event.target.id}</span>
    </span>
  );
}

/** Action outcomes in the same words as the action pages; "delegated" for a hand-off. */
function outcomeText(event: AuditEvent) {
  if (event.kind === "action_created" && event.outcome === "delegated") return "Delegated part of the work";
  return event.kind.startsWith("action_") ? actionStateLabel(event.outcome) : humanize(event.outcome);
}

export function AuditPage({ audit, actionTitles }: AuditData) {
  const [search] = useSearchParams();
  const path = useWorkspacePath();
  const { kpis } = useWorkspace();

  return (
    <>
      <title>Audit | Orbit</title>
      <SurfaceHeading
        eyebrow="Accountability"
        title="Audit trail"
        description="The recorded history of actions you created or were assigned: each creation and state change, with who made it and the outcome. App users cannot rewrite or delete these entries; no tokens, secrets, or question text are recorded."
      />
      <Disclosure text={kpis.disclosure} />
      <p className="audit-note" role="note">
        This is an application-protected persistent audit trail, not a claim of cryptographic immutability. Ask outcomes,
        evidence views, and access denials are also recorded, but no role reads them in v1 (ADR 0011 §7).
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
                <th scope="col">Action</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reference</th>
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
                  <td><Target event={event} titles={actionTitles} /></td>
                  <td>{outcomeText(event)}</td>
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
  const data = useLoaderData<AuditData>();
  return <AuditPage audit={data.audit} actionTitles={data.actionTitles} />;
}
