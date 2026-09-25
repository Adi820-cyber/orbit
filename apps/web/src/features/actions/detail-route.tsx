import {
  ActionStateSchema,
  type Action,
  type ActionDetailResponse,
  type ActionState,
  type PermittedAssignee,
} from "@orbit/contracts";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { formText } from "../../lib/form";
import { actionStateLabel, assignmentLabel, formatDateTime, formatDay, humanize, roleLabel } from "../../lib/format";
import { ActionStateChip, Disclosure, EvidenceSummary, SurfaceHeading } from "../workspace/components";
import {
  mutate,
  type MutationFailure,
  useEntityLabel,
  useWorkspace,
  useWorkspacePath,
  withClient,
  type WorkspaceEnvironment,
} from "../workspace/environment";
import { explorerHref } from "../workspace/links";
import "./actions.css";

type Incomplete = { ok: false; code: "incomplete"; message: string; intent: Intent };
type Intent = "transition" | "delegate";
type DetailResult =
  | { ok: true; intent: "transition"; action: Action }
  | { ok: true; intent: "delegate"; action: Action }
  | (MutationFailure & { intent: Intent })
  | Incomplete;

export interface ActionDetailData {
  detail: ActionDetailResponse;
  /** People the caller may hand this work to; loaded only when the server says they may delegate. */
  delegates: readonly PermittedAssignee[];
}

export function actionDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<ActionDetailData> =>
    withClient(environment, request, async (client) => {
      const detail = await client.action(params.actionId ?? "");
      const delegates = detail.viewer.canDelegate ? (await client.delegates(detail.action.actionId)).assignees : [];
      return { detail, delegates };
    });
}

export function actionTransitionAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<DetailResult> => {
    const form = await request.formData();
    const actionId = params.actionId ?? "";
    const expectedVersion = Number(form.get("expectedVersion"));

    if (form.get("intent") === "delegate") {
      const title = formText(form, "title").trim();
      const assigneeId = formText(form, "assigneeId");
      const dueDate = formText(form, "dueDate");
      if (!title || !assigneeId || !dueDate) {
        return { ok: false, code: "incomplete", intent: "delegate", message: "Choose a person, give the task a title, and set a due date." };
      }
      const result = await mutate(environment, request, (client) =>
        client.delegateAction(actionId, { idempotencyKey: formText(form, "idempotencyKey"), title, assigneeId, dueDate }),
      );
      return result.ok ? { ok: true, intent: "delegate", action: result.value.action } : { ...result, intent: "delegate" };
    }

    const toState = ActionStateSchema.safeParse(form.get("toState"));
    const reason = formText(form, "reason").trim();
    if (!toState.success) return { ok: false, code: "incomplete", intent: "transition", message: "Choose what to do next." };
    if (!reason || reason.length > 500) {
      return {
        ok: false,
        code: "incomplete",
        intent: "transition",
        message: "Add a note of up to 500 characters; it is kept in the action's history.",
      };
    }
    const result = await mutate(environment, request, (client) =>
      client.transitionAction(actionId, { toState: toState.data, expectedVersion, reason }),
    );
    return result.ok ? { ok: true, intent: "transition", action: result.value.action } : { ...result, intent: "transition" };
  };
}

const LIFECYCLE: readonly ActionState[] = ["open", "acknowledged", "in_progress", "submitted", "completed"];

/** What each allowed move is called for the person making it. */
const MOVE_COPY: Record<ActionState, { label: string; hint: string; variant?: "secondary" | "danger" }> = {
  acknowledged: { label: "Acknowledge", hint: "Confirm you have seen this and own it." },
  in_progress: { label: "Start work", hint: "Show that work is under way." },
  submitted: { label: "Submit for approval", hint: "Send the finished work to the person who raised it." },
  completed: { label: "Approve", hint: "Accept the work and close the action." },
  cancelled: { label: "Cancel action", hint: "Withdraw the action. This cannot be undone.", variant: "danger" },
  open: { label: "Reopen", hint: "" },
};
const SEND_BACK = { label: "Send back", hint: "Return it to the assignee with what is still needed.", variant: "secondary" as const };

function moveCopy(move: ActionState, from: ActionState) {
  return move === "in_progress" && from === "submitted" ? SEND_BACK : MOVE_COPY[move];
}

function Lifecycle({ state }: { state: ActionState }) {
  const reached = LIFECYCLE.indexOf(state);

  return (
    <ol className="action-lifecycle" aria-label="Action lifecycle">
      {LIFECYCLE.map((step, index) => (
        <li
          key={step}
          data-state={state === "cancelled" ? "skipped" : index < reached ? "done" : index === reached ? "current" : "todo"}
          aria-current={step === state ? "step" : undefined}
        >
          {actionStateLabel(step)}
        </li>
      ))}
      {state === "cancelled" ? <li data-state="cancelled" aria-current="step">Cancelled</li> : null}
    </ol>
  );
}

/** One sentence telling the viewer whose turn it is when they have nothing to do. */
function waitingText(detail: ActionDetailResponse): string {
  const { action, viewer } = detail;
  if (action.state === "completed") return "Approved and closed. A follow-up is a new action with its own evidence.";
  if (action.state === "cancelled") return "Cancelled. A follow-up is a new action with its own evidence.";
  if (viewer.relation === "assignee" && action.state === "submitted") {
    return `Submitted. Waiting for the ${roleLabel(action.creatorRole)} to approve it or send it back.`;
  }
  return `Waiting for the ${roleLabel(action.assignee.role)} to ${action.state === "open" ? "acknowledge it" : "finish and submit it"}.`;
}

function Failure({ result, intent }: { result: DetailResult | undefined; intent: Intent }) {
  const revalidator = useRevalidator();
  if (!result || result.ok || result.intent !== intent) return null;
  return (
    <div className="workspace-alert" role="alert">
      <strong>{result.code === "forbidden" ? "Not permitted" : "Not updated"}</strong>
      <span>{result.message}</span>
      {result.code === "conflict" ? (
        <button className="orbit-button" data-variant="secondary" type="button" onClick={() => void revalidator.revalidate()}>
          Reload the latest version
        </button>
      ) : null}
    </div>
  );
}

function NextStep({ detail, result }: { detail: ActionDetailResponse; result: DetailResult | undefined }) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting" && navigation.formData?.get("intent") === "transition";
  const { action, viewer } = detail;

  return (
    <section className="workspace-panel" aria-labelledby="next-title">
      <h2 id="next-title">{viewer.moves.length ? "Your next step" : "Status"}</h2>
      <Failure result={result} intent="transition" />
      {result?.ok && result.intent === "transition" ? (
        <output className="workspace-alert" data-tone="success">
          <strong>Now {actionStateLabel(result.action.state).toLowerCase()}.</strong>
          <span>Your note was added to the history below.</span>
        </output>
      ) : null}
      {viewer.moves.length === 0 ? (
        <p className="orbit-field-message">{waitingText(detail)}</p>
      ) : (
        <Form className="workspace-form" method="post" key={action.version}>
          <input type="hidden" name="intent" value="transition" />
          <input type="hidden" name="expectedVersion" value={action.version} />
          <label className="orbit-field">
            <span className="orbit-field-label">Note</span>
            <textarea
              className="orbit-textarea"
              maxLength={500}
              name="reason"
              required
              placeholder={action.state === "submitted" ? "What you approved, or what is still needed" : "What you did or found"}
            />
          </label>
          <div className="action-moves">
            {viewer.moves.map((move) => {
              const copy = moveCopy(move, action.state);
              return (
                <div className="action-move" key={move}>
                  <button
                    className="orbit-button"
                    data-variant={copy.variant}
                    disabled={pending}
                    name="toState"
                    type="submit"
                    value={move}
                  >
                    {copy.label}
                  </button>
                  <span className="orbit-field-message">{copy.hint}</span>
                </div>
              );
            })}
          </div>
        </Form>
      )}
    </section>
  );
}

function Delegation({ data, result }: { data: ActionDetailData; result: DetailResult | undefined }) {
  const navigation = useNavigation();
  const pending = navigation.state === "submitting" && navigation.formData?.get("intent") === "delegate";
  const { action } = data.detail;
  const created = result?.ok && result.intent === "delegate" ? result.action : null;

  return (
    <section className="workspace-panel" aria-labelledby="delegate-title">
      <h2 id="delegate-title">Delegate part of this work</h2>
      <p className="orbit-field-message">
        Hand a task to someone in your own scope. It keeps this action's evidence, and you approve it when they submit it.
        You can submit this action once the delegated work is closed.
      </p>
      <Failure result={result} intent="delegate" />
      {created ? (
        <output className="workspace-alert" data-tone="success">
          <strong>Delegated to the {roleLabel(created.assignee.role)}.</strong>
          <span>It appears under "Delegated work" below.</span>
        </output>
      ) : null}
      {data.delegates.length === 0 ? (
        <p className="workspace-empty">There is nobody inside your scope to delegate this to.</p>
      ) : (
        <Form className="workspace-form" method="post" key={`delegate-${data.detail.children.length}`}>
          <input type="hidden" name="intent" value="delegate" />
          <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
          <label className="orbit-field">
            <span className="orbit-field-label">Person</span>
            <select className="orbit-select" name="assigneeId" defaultValue="" required>
              <option value="" disabled>Choose who does it</option>
              {data.delegates.map((person) => (
                <option key={person.assigneeId} value={person.assigneeId}>{roleLabel(person.role)}</option>
              ))}
            </select>
          </label>
          <label className="orbit-field">
            <span className="orbit-field-label">Task</span>
            <input className="orbit-input" name="title" maxLength={200} required defaultValue={action.title} />
          </label>
          <label className="orbit-field">
            <span className="orbit-field-label">Due</span>
            <input className="orbit-input" name="dueDate" type="date" required defaultValue={action.dueDate} max={action.dueDate} />
          </label>
          <button className="orbit-button" data-variant="secondary" disabled={pending} type="submit">
            {pending ? "Delegating…" : "Delegate"}
          </button>
        </Form>
      )}
    </section>
  );
}

function Children({ items }: { items: readonly Action[] }) {
  const path = useWorkspacePath();
  if (items.length === 0) return null;
  return (
    <section className="workspace-panel action-wide" aria-labelledby="children-title">
      <h2 id="children-title">Delegated work</h2>
      <table className="action-table">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Assigned to</th>
            <th scope="col">State</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {items.map((child) => (
            <tr key={child.actionId}>
              <td><Link to={path(`/actions/${encodeURIComponent(child.actionId)}`)}>{child.title}</Link></td>
              <td>{roleLabel(child.assignee.role)}</td>
              <td><ActionStateChip state={child.state} /></td>
              <td>{formatDay(child.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function History({ detail }: { detail: ActionDetailResponse }) {
  if (detail.history.length === 0) return null;
  return (
    <section className="workspace-panel action-wide" aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      <ol className="action-history">
        {detail.history.map((event, index) => (
          <li key={`${event.occurredAt}-${index}`}>
            <p className="action-history__head">
              <strong>{roleLabel(event.actorRole)}</strong>{" "}
              {event.fromState === null
                ? "created the action"
                : event.fromState === "submitted" && event.toState === "in_progress"
                  ? "sent it back"
                  : event.toState === "completed"
                    ? "approved it"
                    : `moved it to ${actionStateLabel(event.toState).toLowerCase()}`}
              <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
            </p>
            {event.fromState === null ? null : <p className="action-history__reason">{event.reason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ActionDetailPage({ data, result }: { data: ActionDetailData; result: DetailResult | undefined }) {
  const { detail } = data;
  const { action } = detail;
  const entityLabel = useEntityLabel();
  const { assignments, environment, kpis } = useWorkspace();
  const path = useWorkspacePath();
  const [search] = useSearchParams();
  const kpi = assignmentLabel(action.assignmentId, assignments);
  const canExplore = assignments.get(action.assignmentId)?.grains.includes(action.entity.grain);

  return (
    <>
      <title>{`${action.title} | Actions | Orbit`}</title>
      <nav className="explorer-crumbs" aria-label="Breadcrumb">
        <Link to={path("/actions")}>Actions</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{action.title}</span>
      </nav>
      <SurfaceHeading
        eyebrow={detail.viewer.relation === "creator" ? "Action you raised" : "Action assigned to you"}
        title={action.title}
        back="/actions"
        description={`${kpi} · ${humanize(action.entity.grain)} ${action.entityLabel ?? entityLabel(action.entity)}. Stored in Orbit only; nothing was sent outside Orbit.`}
        aside={<ActionStateChip state={action.state} />}
      />

      {search.get("created") ? (
        <output className="workspace-alert action-banner" data-tone="success">
          <strong>Action recorded.</strong>
          <span>The evidence snapshot and an audit event were stored together.</span>
        </output>
      ) : null}
      {search.get("replayed") ? (
        <output className="workspace-alert action-banner" data-tone="success">
          <strong>Already recorded.</strong>
          <span>This request had already been accepted, so the original action is shown rather than a duplicate.</span>
        </output>
      ) : null}
      {detail.parent ? (
        <p className="action-parent">
          Delegated from <Link to={path(`/actions/${encodeURIComponent(detail.parent.actionId)}`)}>{detail.parent.title}</Link>
        </p>
      ) : null}

      <Disclosure text={kpis.disclosure} />

      <Lifecycle state={action.state} />

      <div className="action-detail-layout">
        <section className="workspace-panel" aria-labelledby="facts-title">
          <h2 id="facts-title">Details</h2>
          <dl className="action-facts">
            <div><dt>KPI assignment</dt><dd>{kpi}</dd></div>
            <div><dt>Raised by</dt><dd>{roleLabel(action.creatorRole)}</dd></div>
            <div><dt>Assigned to</dt><dd>{roleLabel(action.assignee.role)}</dd></div>
            <div><dt>Due</dt><dd>{formatDay(action.dueDate)}</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(action.createdAt)}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDateTime(action.updatedAt)}</dd></div>
          </dl>
          <p className="orbit-field-message">
            The evidence snapshot below is fixed at creation and does not move when observations change.
          </p>
          <div className="action-evidence">
            <EvidenceSummary entity={action.entity} evidence={action.evidence} />
          </div>
          {canExplore ? (
            <Link className="workspace-inline-link" to={explorerHref(environment.basePath, action.assignmentId, action.entity)}>
              Open current evidence in the explorer
            </Link>
          ) : null}
        </section>

        <div className="action-side">
          <NextStep detail={detail} result={result} />
          {detail.viewer.canDelegate ? <Delegation data={data} result={result} /> : null}
        </div>

        <Children items={detail.children} />
        <History detail={detail} />
      </div>
    </>
  );
}

export function ActionDetailRoute() {
  return <ActionDetailPage data={useLoaderData<ActionDetailData>()} result={useActionData<DetailResult>()} />;
}
