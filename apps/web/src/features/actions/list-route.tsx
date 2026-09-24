import type { Action, ActionListResponse } from "@orbit/contracts";
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { assignmentLabel, formatDay, humanize, roleLabel } from "../../lib/format";
import { ActionStateChip, Disclosure, SurfaceHeading } from "../workspace/components";
import {
  useEntityLabel,
  useWorkspace,
  useWorkspacePath,
  withClient,
  type WorkspaceEnvironment,
} from "../workspace/environment";
import "./actions.css";

export function actionsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<ActionListResponse> => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return withClient(environment, request, (client) => client.actions(cursor));
  };
}

const OPEN_STATES = new Set<Action["state"]>(["open", "acknowledged", "in_progress"]);

function ActionRow({ action }: { action: Action }) {
  const entityLabel = useEntityLabel();
  const { assignments } = useWorkspace();
  const path = useWorkspacePath();

  return (
    <li className="action-row">
      <div className="action-row__main">
        <Link className="action-row__title" to={path(`/actions/${encodeURIComponent(action.actionId)}`)}>
          {action.title}
        </Link>
        <p>
          {assignmentLabel(action.assignmentId, assignments)} · {humanize(action.entity.grain)}{" "}
          <span>{entityLabel(action.entity)}</span>
        </p>
      </div>
      <dl className="action-row__facts">
        <div>
          <dt>State</dt>
          <dd><ActionStateChip state={action.state} /></dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{roleLabel(action.creatorRole)}</dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd>{roleLabel(action.assignee.role)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{formatDay(action.dueDate)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ActionsPage({ list }: { list: ActionListResponse }) {
  const [search] = useSearchParams();
  const path = useWorkspacePath();
  const { kpis } = useWorkspace();
  const open = list.items.filter((action) => OPEN_STATES.has(action.state));
  const closed = list.items.filter((action) => !OPEN_STATES.has(action.state));

  return (
    <>
      <title>Actions | Orbit</title>
      <SurfaceHeading
        eyebrow="Human decisions"
        title="Internal actions"
        description="Actions you created or were assigned. Each keeps the evidence snapshot it was created from. Actions are stored in Orbit only; nothing is emailed or sent to an external tool."
      />

      <Disclosure text={kpis.disclosure} />

      <div className="actions-start" role="note">
        <strong>Recording a new action starts from evidence.</strong>
        <span>
          Use "Record action" on an exception in the <Link to={path("/")}>brief</Link> or{" "}
          <Link to={path("/inbox")}>inbox</Link>, or on an answered question in <Link to={path("/ask")}>Guided Ask</Link>, so the
          action cites exactly what you reviewed.
        </span>
      </div>

      <section className="workspace-section" aria-labelledby="open-actions">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">In progress</p>
            <h2 id="open-actions">Open actions</h2>
          </div>
          <p>Open, acknowledged, or in progress.</p>
        </div>
        {open.length ? (
          <ul className="action-list">{open.map((action) => <ActionRow key={action.actionId} action={action} />)}</ul>
        ) : (
          <p className="workspace-empty">No open actions on this page.</p>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="closed-actions">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">Closed</p>
            <h2 id="closed-actions">Completed or cancelled</h2>
          </div>
          <p>Closed actions are terminal; a follow-up is a new action with its own evidence.</p>
        </div>
        {closed.length ? (
          <ul className="action-list">{closed.map((action) => <ActionRow key={action.actionId} action={action} />)}</ul>
        ) : (
          <p className="workspace-empty">No closed actions on this page.</p>
        )}
      </section>

      {list.nextCursor || search.get("cursor") ? (
        <nav className="inbox-pagination" aria-label="Action pages">
          {search.get("cursor") ? <Link className="orbit-button" data-variant="secondary" to={path("/actions")}>First page</Link> : null}
          {list.nextCursor ? (
            <Link
              className="orbit-button"
              data-variant="secondary"
              to={`${path("/actions")}?${new URLSearchParams({ cursor: list.nextCursor }).toString()}`}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

export function ActionsRoute() {
  return <ActionsPage list={useLoaderData<ActionListResponse>()} />;
}
