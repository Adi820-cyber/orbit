import { ActionStateSchema, type Action, type ActionResponse, type ActionState } from "@orbit/contracts";
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
import { assignmentLabel, formatDateTime, formatDay, humanize, roleLabel } from "../../lib/format";
import { ActionStateChip, Disclosure, EvidenceSummary, SurfaceHeading } from "../workspace/components";
import {
  mutate,
  useWorkspace,
  useWorkspacePath,
  withClient,
  type MutationFailure,
  type WorkspaceEnvironment,
} from "../workspace/environment";
import { explorerHref } from "../workspace/links";
import "./actions.css";

type TransitionResult = { ok: true; action: Action } | MutationFailure | { ok: false; code: "incomplete"; message: string };

export function actionDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<ActionResponse> =>
    withClient(environment, request, (client) => client.action(params.actionId ?? ""));
}

export function actionTransitionAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<TransitionResult> => {
    const form = await request.formData();
    const toState = ActionStateSchema.safeParse(form.get("toState"));
    const reason = formText(form, "reason").trim();
    const expectedVersion = Number(form.get("expectedVersion"));

    if (!toState.success) return { ok: false, code: "incomplete", message: "Choose the state to move this action to." };
    if (!reason || reason.length > 500) {
      return { ok: false, code: "incomplete", message: "Give a reason of up to 500 characters; it is kept in the audit trail." };
    }

    const result = await mutate(environment, request, (client) =>
      client.transitionAction(params.actionId ?? "", { toState: toState.data, expectedVersion, reason }),
    );
    return result.ok ? { ok: true, action: result.value.action } : result;
  };
}

const LIFECYCLE: readonly ActionState[] = ["open", "acknowledged", "in_progress", "completed"];
const MOVES: readonly ActionState[] = ["acknowledged", "in_progress", "completed", "cancelled"];

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
          {humanize(step)}
        </li>
      ))}
      {state === "cancelled" ? <li data-state="cancelled" aria-current="step">Cancelled</li> : null}
    </ol>
  );
}

export function ActionDetailPage({ action, result }: { action: Action; result: TransitionResult | undefined }) {
  const { assignments, environment, kpis } = useWorkspace();
  const path = useWorkspacePath();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [search] = useSearchParams();
  const pending = navigation.state === "submitting";
  const terminal = action.state === "completed" || action.state === "cancelled";
  const kpi = assignmentLabel(action.assignmentId, assignments);
  const canExplore = assignments.get(action.assignmentId)?.grains.includes(action.entity.grain);

  return (
    <>
      <title>{`${action.title} | Actions | Orbit`}</title>
      <nav className="explorer-crumbs" aria-label="Breadcrumb">
        <Link to={path("/actions")}>Actions</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{action.actionId}</span>
      </nav>
      <SurfaceHeading
        eyebrow="Internal action"
        title={action.title}
        description={`${kpi} · ${humanize(action.entity.grain)} ${action.entity.entityId}. Stored in Orbit only; nothing was sent outside Orbit.`}
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

      <Disclosure text={kpis.disclosure} />

      <Lifecycle state={action.state} />

      <div className="action-detail-layout">
        <section className="workspace-panel" aria-labelledby="facts-title">
          <h2 id="facts-title">Details</h2>
          <dl className="action-facts">
            <div><dt>KPI assignment</dt><dd>{kpi}</dd></div>
            <div><dt>Created by</dt><dd>{roleLabel(action.creatorRole)}</dd></div>
            <div><dt>Assigned to</dt><dd>{roleLabel(action.assignee.role)}</dd></div>
            <div><dt>Due</dt><dd>{formatDay(action.dueDate)}</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(action.createdAt)}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDateTime(action.updatedAt)}</dd></div>
            <div><dt>Version</dt><dd>{action.version}</dd></div>
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

        <section className="workspace-panel" aria-labelledby="transition-title">
          <h2 id="transition-title">Update state</h2>
          {terminal ? (
            <p className="orbit-field-message">
              This action is closed. A follow-up is a new action with its own evidence, so this record stays as it was.
            </p>
          ) : (
            <>
              {result && !result.ok ? (
                <div className="workspace-alert" role="alert">
                  <strong>
                    {result.code === "conflict" ? "Not updated" : result.code === "forbidden" ? "Not permitted" : "Not updated"}
                  </strong>
                  <span>{result.message}</span>
                  {result.code === "conflict" ? (
                    <button className="orbit-button" data-variant="secondary" type="button" onClick={() => void revalidator.revalidate()}>
                      Reload the latest version
                    </button>
                  ) : null}
                </div>
              ) : null}
              {result?.ok ? (
                <output className="workspace-alert" data-tone="success">
                  <strong>State updated to {humanize(result.action.state).toLowerCase()}.</strong>
                  <span>The change and its reason were written to the audit trail.</span>
                </output>
              ) : null}
              <Form className="workspace-form" method="post" key={action.version}>
                <input type="hidden" name="expectedVersion" value={action.version} />
                <label className="orbit-field">
                  <span className="orbit-field-label">Move to</span>
                  <select className="orbit-select" name="toState" defaultValue="">
                    <option value="" disabled>Choose a state</option>
                    {MOVES.filter((state) => state !== action.state).map((state) => (
                      <option key={state} value={state}>{humanize(state)}</option>
                    ))}
                  </select>
                </label>
                <label className="orbit-field">
                  <span className="orbit-field-label">Reason</span>
                  <textarea className="orbit-textarea" maxLength={500} name="reason" required />
                </label>
                <p className="orbit-field-message">
                  The server decides which moves you may make on this action; a refused move is explained here and changes nothing.
                </p>
                <button className="orbit-button" disabled={pending} type="submit">
                  {pending ? "Updating…" : "Update state"}
                </button>
              </Form>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function ActionDetailRoute() {
  const data = useLoaderData<ActionResponse>();
  return <ActionDetailPage action={data.action} result={useActionData<TransitionResult>()} />;
}
