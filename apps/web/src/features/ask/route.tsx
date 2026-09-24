import { useEffect, useRef } from "react";
import {
  AskRequestSchema,
  type AskPromptsResponse,
  type AskRequest,
  type AskResponse,
  type Grain,
  type ScopeEntity,
} from "@orbit/contracts";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { assignmentLabel, humanize, periodLabel, roleLabel } from "../../lib/format";
import { formText } from "../../lib/form";
import { Disclosure, MeasureValue, ScrollRegion, SurfaceHeading } from "../workspace/components";
import {
  mutate,
  type MutationFailure,
  useEntityLabel,
  useWorkspace,
  withClient,
  type WorkspaceEnvironment,
} from "../workspace/environment";
import { monthPeriod, newActionHref, parseEntity, parseGrain } from "../workspace/links";
import "./ask.css";

interface AskPrefill {
  intent: string | null;
  assignmentId: string | null;
  entity: ScopeEntity | null;
  month: string | null;
  breakdown: Grain | undefined;
}

export interface AskLoaderData {
  prompts: AskPromptsResponse;
  prefill: AskPrefill;
}

export type AskActionData =
  | { ok: true; request: AskRequest | null; understoodAs: string | null; response: AskResponse }
  | MutationFailure
  | { ok: false; code: "incomplete"; message: string };

export function askLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<AskLoaderData> => {
    const search = new URL(request.url).searchParams;
    const prompts = await withClient(environment, request, (client) => client.askPrompts());
    return {
      prompts,
      prefill: {
        intent: search.get("intent"),
        assignmentId: search.get("assignmentId"),
        entity: parseEntity(search),
        month: search.get("month"),
        breakdown: parseGrain(search.get("breakdown")),
      },
    };
  };
}

function scopeFromValue(value: FormDataEntryValue | null): ScopeEntity | null {
  if (typeof value !== "string" || !value.includes("|")) return null;
  const [grain, ...rest] = value.split("|");
  return parseEntity(new URLSearchParams({ grain: grain ?? "", entityId: rest.join("|") }));
}

/** Builds a typed request from the form; the contract, not free text, defines what can be asked. */
export function requestFromForm(form: FormData): AskRequest | string {
  const guided = form.get("guided");
  if (typeof guided === "string" && guided) {
    try {
      const parsed = AskRequestSchema.safeParse(JSON.parse(guided));
      return parsed.success ? parsed.data : "This guided question is no longer valid. Reload the page.";
    } catch {
      return "This guided question is no longer valid. Reload the page.";
    }
  }

  const intent = form.get("intent");
  const assignmentId = form.get("assignmentId");
  const target = scopeFromValue(form.get("scope"));
  const period = monthPeriod(formText(form, "month"));
  const compare = monthPeriod(formText(form, "compareMonth"));
  const breakdown = parseGrain(formText(form, "breakdown"));

  const candidate =
    intent === "summarize_exceptions"
      ? { intent }
      : intent === "explain_definition"
        ? { intent, assignmentId }
        : intent === "report_performance"
          ? { intent, assignmentId, target, period }
          : intent === "compare_periods"
            ? { intent, assignmentId, target, period, comparePeriod: compare }
            : intent === "explain_contributors"
              ? { intent, assignmentId, target, period, breakdown }
              : null;

  const parsed = AskRequestSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  if (!candidate) return "Choose a question type.";
  return "Choose every detail this question needs: the KPI, the scope, and the period(s).";
}

export function askAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<AskActionData> => {
    const form = await request.formData();
    const question = form.get("question");
    if (typeof question === "string") {
      if (question.trim().length < 3) {
        return { ok: false, code: "incomplete", message: "Type a question of at least a few words." };
      }
      const asked = await mutate(environment, request, (client) => client.askQuestion(question.trim()));
      return asked.ok
        ? {
            ok: true,
            request: asked.value.interpretedAs?.request ?? null,
            understoodAs: asked.value.interpretedAs?.label ?? null,
            response: asked.value.response,
          }
        : asked;
    }
    const built = requestFromForm(form);
    if (typeof built === "string") {
      return { ok: false, code: "incomplete", message: built };
    }
    const result = await mutate(environment, request, (client) => client.ask(built));
    return result.ok ? { ok: true, request: built, understoodAs: null, response: result.value } : result;
  };
}

const OUTCOME_COPY: Record<AskResponse["outcome"], { label: string; state: string }> = {
  answered: { label: "Answered", state: "ready" },
  clarification_needed: { label: "Clarification needed", state: "missing" },
  no_data: { label: "No data", state: "missing" },
  out_of_scope: { label: "Out of scope", state: "out_of_scope" },
  unavailable: { label: "Unavailable", state: "unavailable" },
};

const BASIS_LABEL: Record<AskResponse["card"]["definitionBasis"][number]["kind"], string> = {
  kpi_definition: "KPI definition",
  target_basis: "Target basis",
  governance_rule: "Governance rule",
  entitlement_rule: "Entitlement rule",
};

const INTENTS: readonly { value: AskRequest["intent"]; label: string }[] = [
  { value: "report_performance", label: "Report performance for a period" },
  { value: "compare_periods", label: "Compare two periods" },
  { value: "explain_contributors", label: "Break down by a permitted grain" },
  { value: "explain_definition", label: "Explain a KPI definition" },
  { value: "summarize_exceptions", label: "Summarize my exceptions" },
];

export function EvidenceCard({ response }: { response: AskResponse }) {
  const entityLabel = useEntityLabel();
  const { assignments, environment } = useWorkspace();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const card = response.card;
  const outcome = OUTCOME_COPY[response.outcome];
  const observations = card.relevantRecords.observations;
  const exceptions = card.relevantRecords.exceptions;

  // Move focus to each new answer so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (response.outcome) headingRef.current?.focus();
  }, [response]);

  return (
    <article className="evidence-card" data-outcome={response.outcome} aria-labelledby="evidence-card-title">
      <header className="evidence-card__header">
        <div className="workspace-chip-row">
          <span className="orbit-status" data-state={outcome.state}>{outcome.label}</span>
          <span className="orbit-status" data-state="illustrative">{humanize(response.mode)} mode</span>
          <span className="chip-illustrative">Illustrative</span>
        </div>
        <h2 id="evidence-card-title" ref={headingRef} tabIndex={-1}>Evidence card</h2>
      </header>

      <section className="evidence-card__section" aria-labelledby="card-answer">
        <h3 id="card-answer">Answer</h3>
        <p className="evidence-card__answer">{card.answer}</p>
        {response.mode === "assisted" ? (
          <p className="evidence-card__assisted">
            This answer&apos;s wording was written by an AI model. Every figure, record, citation and limitation on this
            card comes from Orbit&apos;s data, and wording that added a number would have been rejected.
          </p>
        ) : null}
      </section>

      <section className="evidence-card__section" aria-labelledby="card-records">
        <h3 id="card-records">Relevant records</h3>
        {observations.length === 0 && exceptions.length === 0 ? (
          <p className="evidence-card__none">No records were used for this answer.</p>
        ) : null}
        {observations.length > 0 ? (
          <ScrollRegion label="Observations used">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Period</th>
                  <th scope="col">Definition family</th>
                  <th scope="col" data-numeric="true">Value</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((observation) => (
                  <tr key={observation.observationId}>
                    <th scope="row">
                      {humanize(observation.entity.grain)} · {entityLabel(observation.entity)}
                    </th>
                    <td>{periodLabel(observation.period)}</td>
                    <td>{observation.definitionFamily}</td>
                    <td data-numeric="true"><MeasureValue value={observation.value} unit={observation.unit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : null}
        {exceptions.length > 0 ? (
          <ul className="evidence-card__exceptions">
            {exceptions.map((exception) => (
              <li key={exception.exceptionId}>
                <span className="orbit-status" data-state={exception.priority === "act_now" ? "critical" : "late"}>
                  {exception.priority === "act_now" ? "Act now" : "Monitor"}
                </span>
                <span>{assignmentLabel(exception.assignmentId, assignments)}</span>
                <span>{entityLabel(exception.entity)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="evidence-card__section" aria-labelledby="card-basis">
        <h3 id="card-basis">Definition and policy basis</h3>
        {card.definitionBasis.length ? (
          <dl className="evidence-card__basis">
            {card.definitionBasis.map((basis) => (
              <div key={`${basis.kind}:${basis.reference}`}>
                <dt>{BASIS_LABEL[basis.kind]} <span className="workspace-reference">{basis.reference}</span></dt>
                <dd>{basis.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="evidence-card__none">No definition or policy basis applies. Orbit never cites an external policy it does not hold.</p>
        )}
      </section>

      <section className="evidence-card__section" aria-labelledby="card-reasoning">
        <h3 id="card-reasoning">Reasoning from observed evidence</h3>
        {card.reasoning.length ? (
          <ol className="evidence-card__reasoning">
            {card.reasoning.map((line) => <li key={line}>{line}</li>)}
          </ol>
        ) : (
          <p className="evidence-card__none">No reasoning was produced because no authorized evidence was used.</p>
        )}
      </section>

      <section className="evidence-card__section" aria-labelledby="card-next">
        <h3 id="card-next">Possible next action</h3>
        {response.outcome === "answered" && response.card.nextAction ? (
          <div className="evidence-card__next">
            <p>Record an internal action that cites exactly this evidence. Nothing is sent outside Orbit.</p>
            <Link
              className="orbit-button"
              to={newActionHref(environment.basePath, {
                assignmentId: response.card.nextAction.assignmentId,
                entity: response.card.nextAction.entity,
                evidence: response.card.nextAction.evidence,
              })}
            >
              Record action from this evidence
            </Link>
          </div>
        ) : (
          <p className="evidence-card__none">No action is suggested. Ask never executes an action; you decide.</p>
        )}
      </section>

      <section className="evidence-card__section" aria-labelledby="card-scope">
        <h3 id="card-scope">Scope, period, and limitations</h3>
        <dl className="evidence-card__scope">
          <div>
            <dt>Role</dt>
            <dd>{roleLabel(card.scope.role)}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>
              {card.scope.entities.map((entity) => (
                <span key={`${entity.grain}:${entity.entityId}`} className="workspace-reference">
                  {humanize(entity.grain)} · {entityLabel(entity)}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>{card.period ? periodLabel(card.period) : "Not period-specific"}</dd>
          </div>
        </dl>
        {card.limitations.length ? (
          <ul className="evidence-card__limitations">
            {card.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        ) : null}
      </section>

      <p className="evidence-card__disclosure">{response.disclosure}</p>
    </article>
  );
}

function defaultMonth(prompts: AskPromptsResponse, prefill: AskPrefill) {
  if (prefill.month) return prefill.month;
  for (const prompt of prompts.prompts) {
    if ("period" in prompt.request) return prompt.request.period.start.slice(0, 7);
  }
  return "";
}

function previousMonth(month: string) {
  const [year, index] = month.split("-").map(Number);
  if (!year || !index) return "";
  const date = new Date(Date.UTC(year, index - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function AskPage({ data, result }: { data: AskLoaderData; result: AskActionData | undefined }) {
  const entityLabel = useEntityLabel();
  const { kpis, membership } = useWorkspace();
  const navigation = useNavigation();
  const pending = navigation.state === "submitting" && navigation.formMethod === "POST";
  const { prompts, prefill } = data;
  const month = defaultMonth(prompts, prefill);
  const scopeOptions = [...membership.scopes];
  if (prefill.entity && !scopeOptions.some((scope) => scope.entityId === prefill.entity?.entityId)) {
    scopeOptions.push(prefill.entity);
  }
  const selectedScope = prefill.entity ?? scopeOptions[0];
  const intent = INTENTS.some((item) => item.value === prefill.intent) ? prefill.intent : "report_performance";

  return (
    <>
      <title>Guided Ask | Orbit</title>
      <SurfaceHeading
        eyebrow="Guided Ask"
        title="Ask about your authorized evidence"
        description="Questions are typed requests that Orbit re-authorizes before any data is read. Every answer shows its records, definition basis, reasoning, scope, and limitations."
      />
      <Disclosure text={prompts.disclosure} />

      <div className="ask-mode" role="note">
        <strong>{humanize(prompts.mode)} mode</strong>
        {prompts.mode === "assisted" ? (
          <span>
            Answers come from a reviewed catalogue of question types over evidence you are authorized to see. An AI model
            may reword an answer&apos;s sentence; every figure, record, citation and limitation stays Orbit&apos;s own, and
            wording that adds a number is discarded. Orbit never invents numbers, policy citations, or confidence scores.
          </span>
        ) : (
          <span>
            Answers come from a reviewed catalogue of question types over evidence you are authorized to see. No free-text
            AI model is used, and Orbit never invents numbers, policy citations, or confidence scores.
          </span>
        )}
      </div>

      <div className="ask-layout">
        <div className="ask-controls">
          {prompts.mode === "assisted" ? (
            <section className="workspace-panel" aria-labelledby="own-words-title">
              <h2 id="own-words-title">Ask in your own words</h2>
              <p className="orbit-field-message">
                Orbit maps your question to one of your authorized KPIs, then answers from its own data.
              </p>
              <Form className="workspace-form" method="post">
                <label className="orbit-field">
                  <span className="orbit-field-label">Your question</span>
                  <textarea
                    className="orbit-input ask-question"
                    name="question"
                    required
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    placeholder="For example: how did revenue compare with last month?"
                  />
                </label>
                <button className="orbit-button" disabled={pending} type="submit">
                  {pending ? "Answering…" : "Ask Orbit"}
                </button>
              </Form>
            </section>
          ) : null}
          <section className="workspace-panel" aria-labelledby="guided-title">
            <h2 id="guided-title">Guided questions</h2>
            <p className="orbit-field-message">Built from your role's authorized KPIs; each one is re-checked when sent.</p>
            <ul className="ask-prompts">
              {prompts.prompts.map((prompt) => (
                <li key={prompt.promptId}>
                  <Form method="post">
                    <input type="hidden" name="guided" value={JSON.stringify(prompt.request)} />
                    <button className="ask-prompt" disabled={pending} type="submit">
                      {prompt.label}
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>

          <section className="workspace-panel" aria-labelledby="builder-title">
            <h2 id="builder-title">Build a question</h2>
            <Form className="workspace-form" method="post" key={`${prefill.intent}:${prefill.assignmentId}:${prefill.entity?.entityId}:${month}`}>
              <label className="orbit-field">
                <span className="orbit-field-label">Question type</span>
                <select className="orbit-select" name="intent" defaultValue={intent ?? "report_performance"}>
                  {INTENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="orbit-field">
                <span className="orbit-field-label">KPI assignment</span>
                <select className="orbit-select" name="assignmentId" defaultValue={prefill.assignmentId ?? kpis.assignments[0]?.assignmentId}>
                  {kpis.assignments.map((assignment) => (
                    <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.kpi}</option>
                  ))}
                </select>
              </label>
              <label className="orbit-field">
                <span className="orbit-field-label">Scope</span>
                <select
                  className="orbit-select"
                  name="scope"
                  defaultValue={selectedScope ? `${selectedScope.grain}|${selectedScope.entityId}` : undefined}
                >
                  {scopeOptions.map((scope) => (
                    <option key={`${scope.grain}|${scope.entityId}`} value={`${scope.grain}|${scope.entityId}`}>
                      {humanize(scope.grain)} · {entityLabel(scope)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="workspace-form__row">
                <label className="orbit-field">
                  <span className="orbit-field-label">Period</span>
                  <input className="orbit-input" type="month" name="month" defaultValue={month} />
                </label>
                <label className="orbit-field">
                  <span className="orbit-field-label">Compare with (for comparisons)</span>
                  <input className="orbit-input" type="month" name="compareMonth" defaultValue={month ? previousMonth(month) : ""} />
                </label>
              </div>
              <label className="orbit-field">
                <span className="orbit-field-label">Breakdown (for break-downs)</span>
                <select className="orbit-select" name="breakdown" defaultValue={prefill.breakdown ?? "facility"}>
                  <option value="facility">Facility</option>
                  <option value="region">Region</option>
                  <option value="coe">COE</option>
                </select>
              </label>
              <p className="orbit-field-message">
                Choosing a scope or breakdown you do not hold returns an explicit out-of-scope answer, never a partial one.
              </p>
              <button className="orbit-button" disabled={pending} type="submit">
                {pending ? "Answering…" : "Ask"}
              </button>
            </Form>
          </section>
        </div>

        <div className="ask-result">
          {pending ? <output className="workspace-empty">Checking your scope and preparing the evidence…</output> : null}
          {!pending && result && !result.ok ? (
            <div className="workspace-alert" role="alert">
              <strong>{result.code === "incomplete" ? "More detail needed" : "Orbit could not answer"}</strong>
              <span>{result.message}</span>
            </div>
          ) : null}
          {!pending && result?.ok && result.understoodAs ? (
            <p className="ask-understood">
              Orbit understood your question as: <strong>{result.understoodAs}</strong>
            </p>
          ) : null}
          {!pending && result?.ok ? <EvidenceCard response={result.response} /> : null}
          {!pending && !result ? (
            <p className="workspace-empty">Choose a guided question or build one. The evidence card appears here.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function AskRoute() {
  return <AskPage data={useLoaderData<AskLoaderData>()} result={useActionData<AskActionData>()} />;
}
