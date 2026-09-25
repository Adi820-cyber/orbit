import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AskResponse, GuidedPrompt, MeasureValue as MeasureValueContract, Target } from "@orbit/contracts";
import { Link, useFetcher } from "react-router";
import { assignmentLabel, formatNumber, humanize, periodLabel, roleLabel } from "../../lib/format";
import { Icon, MeasureValue } from "../workspace/components";
import { useEntityLabel, useWorkspace, useWorkspacePath } from "../workspace/environment";
import { newActionHref } from "../workspace/links";
import type { AskActionData, AskLoaderData } from "./route";
import "./chat.css";

/*
 * Ask Orbit as a small chat panel, available on every workspace page.
 *
 * It posts to the same /ask route action as the full Ask page, so every
 * question is re-authorized on the server and every answer is the same
 * evidence-backed card, rendered here as a message with proper tables.
 * Nothing about scope or data changes; only the presentation does.
 */

interface Exchange {
  id: number;
  question: string;
  result: AskActionData | null;
}

const OUTCOME_LABEL: Record<AskResponse["outcome"], { label: string; state: string }> = {
  answered: { label: "Answered", state: "ready" },
  clarification_needed: { label: "Needs more detail", state: "missing" },
  no_data: { label: "No data", state: "missing" },
  out_of_scope: { label: "Out of scope", state: "out_of_scope" },
  unavailable: { label: "Unavailable", state: "unavailable" },
};

function withUnit(value: number, unit: string) {
  return unit === "percent" ? `${formatNumber(value)}%` : `${formatNumber(value)} ${unit}`;
}

/** "≥ 100%" style; the demo-parameter status is stated once under the table. */
function compactTarget(target: Target, unit: string) {
  switch (target.state) {
    case "not_configured":
      return "No target";
    case "configured":
      return `${target.direction === "higher_is_better" ? "≥" : "≤"} ${withUnit(target.value, unit)}`;
    case "configured_range":
      return `${formatNumber(target.low)}–${withUnit(target.high, unit)}`;
  }
}

function ChatValue({ value, unit }: { value: MeasureValueContract; unit: string }) {
  if (value.status !== "available") return <MeasureValue value={value} unit={unit} />;
  return <span className="is-illustrative">{withUnit(value.value, unit)}</span>;
}

function ObservationTable({ response }: { response: AskResponse }) {
  const entityLabel = useEntityLabel();
  const rows = response.card.relevantRecords.observations;
  if (rows.length === 0) return null;
  const demoTargets = rows.some((row) => row.target.state !== "not_configured" && row.target.approval === "demo_parameter");

  return (
    <div className="ask-chat__table-wrap">
      <table className="ask-chat__table">
        <caption className="orbit-visually-hidden">Figures used for this answer</caption>
        <thead>
          <tr>
            <th scope="col">Scope</th>
            <th scope="col">Period</th>
            <th scope="col" data-numeric="true">Value</th>
            <th scope="col">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.observationId}>
              <th scope="row">
                <span className="ask-chat__grain">{humanize(row.entity.grain)}</span> {entityLabel(row.entity)}
              </th>
              <td>{periodLabel(row.period)}</td>
              <td data-numeric="true"><ChatValue value={row.value} unit={row.unit} /></td>
              <td className="ask-chat__muted">{compactTarget(row.target, row.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {demoTargets ? <p className="ask-chat__footnote">Targets are illustrative demo parameters, not approved targets.</p> : null}
    </div>
  );
}

function ExceptionTable({ response }: { response: AskResponse }) {
  const entityLabel = useEntityLabel();
  const { assignments } = useWorkspace();
  const rows = response.card.relevantRecords.exceptions;
  if (rows.length === 0) return null;

  return (
    <div className="ask-chat__table-wrap">
      <table className="ask-chat__table">
        <caption className="orbit-visually-hidden">Exceptions used for this answer</caption>
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">KPI</th>
            <th scope="col">Scope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.exceptionId}>
              <td>
                <span className="orbit-status" data-state={row.priority === "act_now" ? "critical" : "late"}>
                  {row.priority === "act_now" ? "Act now" : "Monitor"}
                </span>
              </td>
              <th scope="row">{assignmentLabel(row.assignmentId, assignments)}</th>
              <td>{entityLabel(row.entity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Answer({ result }: { result: AskActionData }) {
  const { environment } = useWorkspace();
  const entityLabel = useEntityLabel();

  if (!result.ok) {
    return (
      <div className="ask-chat__bubble ask-chat__bubble--orbit" data-tone="error">
        <p>{result.message}</p>
      </div>
    );
  }

  const { response, understoodAs } = result;
  const card = response.card;
  const outcome = OUTCOME_LABEL[response.outcome];
  const hasDetail = card.reasoning.length > 0 || card.definitionBasis.length > 0 || card.limitations.length > 0;

  return (
    <div className="ask-chat__bubble ask-chat__bubble--orbit">
      <div className="ask-chat__chips">
        <span className="orbit-status" data-state={outcome.state}>{outcome.label}</span>
        <span className="chip-illustrative">Illustrative</span>
      </div>
      {understoodAs ? (
        <p className="ask-chat__understood">
          Understood as <strong>{understoodAs}</strong>
        </p>
      ) : null}
      <p className="ask-chat__answer">{card.answer}</p>
      <ObservationTable response={response} />
      <ExceptionTable response={response} />
      {card.limitations.length ? (
        <ul className="ask-chat__limitations">
          {card.limitations.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {hasDetail ? (
        <details className="ask-chat__details">
          <summary>How Orbit answered</summary>
          {card.reasoning.length ? (
            <>
              <h4>Reasoning</h4>
              <ol>{card.reasoning.map((line) => <li key={line}>{line}</li>)}</ol>
            </>
          ) : null}
          {card.definitionBasis.length ? (
            <>
              <h4>Definition basis</h4>
              <ul>{card.definitionBasis.map((basis) => <li key={`${basis.kind}:${basis.reference}`}>{basis.text}</li>)}</ul>
            </>
          ) : null}
          <h4>Scope</h4>
          <p>
            {roleLabel(card.scope.role)} ·{" "}
            {card.scope.entities.map((entity) => `${humanize(entity.grain)} ${entityLabel(entity)}`).join(", ")}
            {card.period ? ` · ${periodLabel(card.period)}` : ""}
          </p>
          {response.mode === "assisted" ? (
            <p className="ask-chat__muted">
              An AI model may have reworded the answer sentence. Every figure and record above comes from Orbit&apos;s data.
            </p>
          ) : null}
        </details>
      ) : null}
      {response.outcome === "answered" && card.nextAction ? (
        <Link
          className="orbit-button ask-chat__next"
          data-variant="secondary"
          to={newActionHref(environment.basePath, {
            assignmentId: card.nextAction.assignmentId,
            entity: card.nextAction.entity,
            evidence: card.nextAction.evidence,
          })}
        >
          Record an action from this
        </Link>
      ) : null}
      <p className="ask-chat__disclosure">{response.disclosure}</p>
    </div>
  );
}

/** Enter sends; Shift+Enter adds a new line. */
function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

export function AskChat() {
  const path = useWorkspacePath();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const askFetcher = useFetcher<AskActionData>();
  const promptsFetcher = useFetcher<AskLoaderData>();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const nextId = useRef(1);
  const pendingId = useRef<number | null>(null);
  const busy = askFetcher.state !== "idle";
  const prompts: readonly GuidedPrompt[] = promptsFetcher.data?.prompts.prompts ?? [];
  const assisted = promptsFetcher.data?.prompts.mode === "assisted";

  // Load the caller's guided questions the first time the panel opens.
  useEffect(() => {
    if (open && promptsFetcher.state === "idle" && !promptsFetcher.data) {
      void promptsFetcher.load(path("/ask"));
    }
  }, [open, path, promptsFetcher]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Attach each answer to the question that asked it.
  useEffect(() => {
    if (askFetcher.state !== "idle" || !askFetcher.data || pendingId.current === null) return;
    const id = pendingId.current;
    const data = askFetcher.data;
    pendingId.current = null;
    setExchanges((current) => current.map((exchange) => (exchange.id === id ? { ...exchange, result: data } : exchange)));
  }, [askFetcher.state, askFetcher.data]);

  // Keep the newest message in view.
  const messageCount = exchanges.length + exchanges.filter((exchange) => exchange.result).length;
  useEffect(() => {
    const log = logRef.current;
    if (log && messageCount > 0) log.scrollTop = log.scrollHeight;
  }, [messageCount]);

  // Escape closes the panel when focus is inside it, and returns focus to the button.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && panelRef.current?.contains(document.activeElement)) {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function send(question: string, fields: Record<string, string>) {
    if (busy) return;
    const id = nextId.current++;
    pendingId.current = id;
    setExchanges((current) => [...current, { id, question, result: null }]);
    void askFetcher.submit(fields, { method: "post", action: path("/ask") });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (question.length < 3) return;
    setDraft("");
    send(question, { question });
  }

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  return (
    <>
      {open ? (
        <section id={panelId} ref={panelRef} className="ask-chat" aria-label="Ask Orbit">
          <header className="ask-chat__header">
            <div>
              <h2>Ask Orbit</h2>
              <p>Answers only from data you are authorized to see.</p>
            </div>
            <div className="ask-chat__header-actions">
              <Link className="ask-chat__link" to={path("/ask")} onClick={() => setOpen(false)}>
                Full page
              </Link>
              <button className="ask-chat__close" type="button" onClick={close} aria-label="Close Ask Orbit">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          <ol className="ask-chat__log" ref={logRef} aria-live="polite" aria-label="Conversation">
            {exchanges.length === 0 ? (
              <li className="ask-chat__welcome">
                <div className="ask-chat__bubble ask-chat__bubble--orbit">
                  <p>
                    Ask about your KPIs in plain words, for example{" "}
                    <em>&ldquo;How did revenue compare with last month?&rdquo;</em>, or pick a question below.
                  </p>
                  {promptsFetcher.data && !assisted ? (
                    <p className="ask-chat__muted">
                      Questions in your own words need the AI assistant, which is not configured here. The suggested
                      questions always work.
                    </p>
                  ) : null}
                </div>
              </li>
            ) : null}
            {exchanges.map((exchange) => (
              <li key={exchange.id} className="ask-chat__exchange">
                <div className="ask-chat__bubble ask-chat__bubble--you">
                  <p>{exchange.question}</p>
                </div>
                {exchange.result ? (
                  <Answer result={exchange.result} />
                ) : (
                  <div className="ask-chat__bubble ask-chat__bubble--orbit ask-chat__typing">
                    <span className="orbit-visually-hidden">Orbit is checking your scope and preparing the evidence.</span>
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </div>
                )}
              </li>
            ))}
          </ol>

          {prompts.length ? (
            <fieldset className="ask-chat__suggestions">
              <legend className="orbit-visually-hidden">Suggested questions</legend>
              {prompts.slice(0, 6).map((prompt) => (
                <button
                  key={prompt.promptId}
                  className="ask-chat__suggestion"
                  type="button"
                  disabled={busy}
                  onClick={() => send(prompt.label, { guided: JSON.stringify(prompt.request) })}
                >
                  {prompt.label}
                </button>
              ))}
            </fieldset>
          ) : null}

          <form className="ask-chat__composer" onSubmit={onSubmit}>
            <label className="orbit-visually-hidden" htmlFor={`${panelId}-input`}>
              Your question
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              className="ask-chat__input"
              rows={1}
              maxLength={500}
              value={draft}
              placeholder="Ask about your KPIs…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={sendOnEnter}
            />
            <button className="orbit-button ask-chat__send" type="submit" disabled={busy || draft.trim().length < 3}>
              {busy ? "…" : "Send"}
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={launcherRef}
        className="workspace-ask-launcher"
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="ask" />
        <span>{open ? "Close" : "Ask Orbit"}</span>
      </button>
    </>
  );
}
