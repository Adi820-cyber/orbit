import { useState } from "react";
import type { PermittedAssignee } from "@orbit/contracts";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { ApiRequestError } from "../../lib/api";
import { formText } from "../../lib/form";
import { assignmentLabel, humanize, roleLabel } from "../../lib/format";
import { Disclosure, SurfaceHeading, SurfaceState } from "../workspace/components";
import {
  mutate,
  useWorkspace,
  withClient,
  workspacePath,
  type MutationFailure,
  type WorkspaceEnvironment,
} from "../workspace/environment";
import { explorerHref, parseActionDraft, type ActionDraftSource } from "../workspace/links";
import "./actions.css";

export interface NewActionData {
  draft: ActionDraftSource;
  assignees: PermittedAssignee[];
  idempotencyKey: string;
  defaultDue: string;
  today: string;
}

type NewActionResult = MutationFailure | { ok: false; code: "incomplete"; message: string; field: "title" | "assignee" | "due" };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function requireDraft(request: Request) {
  const draft = parseActionDraft(new URL(request.url).searchParams);
  if (!draft) {
    throw new ApiRequestError(
      "invalid_request",
      "An action must cite evidence. Start from an exception, an explorer view, or an answered question.",
      400,
    );
  }
  return draft;
}

export function newActionLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<NewActionData> => {
    const draft = requireDraft(request);
    const { assignees } = await withClient(environment, request, (client) =>
      client.assignees({ assignmentId: draft.assignmentId, grain: draft.entity.grain, entityId: draft.entity.entityId }),
    );
    const today = new Date();
    const due = new Date(today);
    due.setUTCDate(due.getUTCDate() + 14);

    return {
      draft,
      assignees,
      // One key per rendered form: a double submit or retry replays instead of duplicating.
      idempotencyKey: crypto.randomUUID(),
      defaultDue: isoDay(due),
      today: isoDay(today),
    };
  };
}

export function newActionAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<NewActionResult | Response> => {
    const draft = requireDraft(request);
    const form = await request.formData();
    const title = formText(form, "title").trim();
    const assigneeId = formText(form, "assigneeId");
    const dueDate = formText(form, "dueDate");
    const idempotencyKey = formText(form, "idempotencyKey");

    if (!title || title.length > 200) {
      return { ok: false, code: "incomplete", field: "title", message: "Enter a title of up to 200 characters." };
    }
    if (!assigneeId) {
      return { ok: false, code: "incomplete", field: "assignee", message: "Choose a permitted assignee." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return { ok: false, code: "incomplete", field: "due", message: "Choose a due date." };
    }

    const result = await mutate(environment, request, (client) =>
      client.createAction({
        idempotencyKey,
        title,
        assignmentId: draft.assignmentId,
        entity: draft.entity,
        evidence: draft.evidence,
        assigneeId,
        dueDate,
      }),
    );

    if (!result.ok) return result;
    const status = result.value.replayed ? "replayed" : "created";
    return redirect(
      `${workspacePath(environment.basePath, `/actions/${encodeURIComponent(result.value.action.actionId)}`)}?${status}=1`,
    );
  };
}

export function NewActionPage({ data, result }: { data: NewActionData; result: NewActionResult | undefined }) {
  const { assignments, environment, kpis } = useWorkspace();
  const navigation = useNavigation();
  const pending = navigation.state === "submitting";
  // Revalidation re-runs the loader; the key must stay fixed so a retry replays rather than duplicates.
  const [idempotencyKey] = useState(data.idempotencyKey);
  const { draft, assignees } = data;
  const kpi = assignmentLabel(draft.assignmentId, assignments);
  const fieldError = (field: "title" | "assignee" | "due") =>
    result && result.code === "incomplete" && "field" in result && result.field === field ? result.message : null;

  return (
    <>
      <title>Record action | Orbit</title>
      <SurfaceHeading
        eyebrow="Human decision"
        title="Record an internal action"
        description="You decide; Orbit records. The action cites the evidence below, is assigned only to someone permitted to see it, and is stored in Orbit only — nothing is emailed or sent to an external tool."
      />

      <Disclosure text={kpis.disclosure} />

      <div className="new-action-layout">
        <section className="workspace-panel new-action-evidence" aria-labelledby="evidence-title">
          <h2 id="evidence-title">Evidence this action cites</h2>
          <dl>
            <div>
              <dt>KPI assignment</dt>
              <dd>{kpi}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>
                {humanize(draft.entity.grain)} · <span className="workspace-reference">{draft.entity.entityId}</span>
              </dd>
            </div>
            <div>
              <dt>Observations</dt>
              <dd>
                <ul className="new-action-observations">
                  {draft.evidence.observationIds.map((id) => (
                    <li key={id} className="workspace-reference">{id}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>Definition version</dt>
              <dd>{draft.evidence.definitionVersion}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd className="workspace-reference">{draft.evidence.datasetChecksum}</dd>
            </div>
          </dl>
          {assignments.get(draft.assignmentId)?.grains.includes(draft.entity.grain) ? (
            <Link className="workspace-inline-link" to={explorerHref(environment.basePath, draft.assignmentId, draft.entity)}>
              Review this evidence in the explorer
            </Link>
          ) : null}
          <p className="orbit-field-message">The server re-verifies this evidence and your scope when you submit.</p>
        </section>

        {assignees.length === 0 ? (
          <SurfaceState
            kind="empty"
            title="No permitted assignee exists for this evidence."
            message="Orbit only offers assignees whose scope sits inside yours (ADR 0011 §6) and who may be assigned this assignment. None was found, and none was invented."
          />
        ) : (
          <section className="workspace-panel" aria-labelledby="action-form-title">
            <h2 id="action-form-title">Action details</h2>
            {result && result.code !== "incomplete" ? (
              <div className="workspace-alert" role="alert">
                <strong>{result.code === "conflict" ? "This could not be recorded as sent" : "Orbit did not record this action"}</strong>
                <span>{result.message}</span>
              </div>
            ) : null}
            <Form className="workspace-form" method="post" noValidate>
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <label className="orbit-field">
                <span className="orbit-field-label">Title</span>
                <input
                  aria-describedby={fieldError("title") ? "title-error" : "title-hint"}
                  aria-invalid={Boolean(fieldError("title"))}
                  className="orbit-input"
                  maxLength={200}
                  name="title"
                  placeholder={`Review ${kpi.toLowerCase()} evidence`}
                  required
                  type="text"
                />
                {fieldError("title") ? (
                  <span className="orbit-field-message" data-tone="danger" id="title-error">{fieldError("title")}</span>
                ) : (
                  <span className="orbit-field-message" id="title-hint">State the decision or follow-up, not a diagnosis.</span>
                )}
              </label>

              <fieldset className="new-action-assignees" aria-describedby={fieldError("assignee") ? "assignee-error" : undefined}>
                <legend className="orbit-field-label">Assign to</legend>
                {assignees.map((assignee, index) => (
                  <label key={assignee.assigneeId} className="new-action-assignee">
                    <input defaultChecked={index === 0 && assignees.length === 1} name="assigneeId" type="radio" value={assignee.assigneeId} />
                    <strong>{roleLabel(assignee.role)}</strong>
                    <span className="workspace-reference">
                      {assignee.scopes.map((scope) => `${humanize(scope.grain)} · ${scope.entityId}`).join(", ")}
                    </span>
                  </label>
                ))}
                {fieldError("assignee") ? (
                  <span className="orbit-field-message" data-tone="danger" id="assignee-error">{fieldError("assignee")}</span>
                ) : null}
              </fieldset>

              <label className="orbit-field">
                <span className="orbit-field-label">Due date</span>
                <input
                  aria-invalid={Boolean(fieldError("due"))}
                  className="orbit-input"
                  defaultValue={data.defaultDue}
                  min={data.today}
                  name="dueDate"
                  required
                  type="date"
                />
                {fieldError("due") ? <span className="orbit-field-message" data-tone="danger">{fieldError("due")}</span> : null}
              </label>

              <button className="orbit-button" disabled={pending} type="submit">
                {pending ? "Recording…" : "Record action"}
              </button>
            </Form>
          </section>
        )}
      </div>
    </>
  );
}

export function NewActionRoute() {
  return <NewActionPage data={useLoaderData<NewActionData>()} result={useActionData<NewActionResult>()} />;
}
