import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useFetcher } from "react-router";
import { roleLabel } from "../../lib/format";
import { useWorkspace, useWorkspacePath } from "../workspace/environment";
import type { ChatbotActionData } from "./action";
import "./chatbot.css";

/*
 * RAG Chatbot panel — a floating chat widget available on every workspace page.
 *
 * Posts to POST /api/chatbot, which runs the full auth + embedding + vector
 * search + narration pipeline. Every answer is scoped to the caller's role and
 * entities via RLS. Sources (knowledge chunks) are cited in the response.
 */

type ChatbotResult = ChatbotActionData;

interface Exchange {
  id: number;
  message: string;
  result: ChatbotResult | null;
}

/** Enter sends; Shift+Enter adds a new line. */
function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

function BotAnswer({ result }: { result: ChatbotResult }) {
  if (!result.ok) {
    return (
      <div className="chatbot-panel__bubble chatbot-panel__bubble--bot" data-tone="error">
        <p>{result.message}</p>
      </div>
    );
  }

  const { value: response } = result;
  return (
    <div className="chatbot-panel__bubble chatbot-panel__bubble--bot">
      <div className="chatbot-panel__chips">
        <span className="orbit-status" data-state="ready">
          {roleLabel(response.role)}
        </span>
        <span className="chip-illustrative">Illustrative</span>
      </div>
      <p className="chatbot-panel__answer">{response.answer}</p>
      {response.sources.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "var(--orbit-font-size-200)", color: "var(--orbit-color-secondary-strong)", fontWeight: "var(--orbit-font-weight-semibold)" }}>
            {response.sources.length} source{response.sources.length === 1 ? "" : "s"} used
          </summary>
          <ul className="chatbot-panel__sources">
            {response.sources.map((source) => (
              <li key={source.chunkId} className="chatbot-panel__source">
                <span className="chatbot-panel__source-title">{source.title}</span>
                <span className="chatbot-panel__source-score">{Math.round(source.similarity * 100)}% match</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {response.mode === "assisted" ? (
        <p className="chatbot-panel__mode">
          AI-assisted wording. Every source and figure comes from Orbit&apos;s data.
        </p>
      ) : null}
      <p className="chatbot-panel__disclosure">{response.disclosure}</p>
    </div>
  );
}

export function ChatbotPanel() {
  const path = useWorkspacePath();
  const { membership } = useWorkspace();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const fetcher = useFetcher<ChatbotActionData>();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const nextId = useRef(1);
  const pendingId = useRef<number | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  // Attach each answer to the question that asked it.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || pendingId.current === null) return;
    const id = pendingId.current;
    const data = fetcher.data;
    pendingId.current = null;
    setExchanges((current) =>
      current.map((exchange) =>
        exchange.id === id ? { ...exchange, result: data } : exchange,
      ),
    );
  }, [fetcher.state, fetcher.data]);

  // Keep the newest message in view.
  const messageCount = exchanges.length + exchanges.filter((e) => e.result).length;
  useEffect(() => {
    const log = logRef.current;
    if (log && messageCount > 0) log.scrollTop = log.scrollHeight;
  }, [messageCount]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && panelRef.current?.contains(document.activeElement)) {
        restoreFocus.current = true;
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function send(message: string) {
    if (busy) return;
    const id = nextId.current++;
    pendingId.current = id;
    setExchanges((current) => [...current, { id, message, result: null }]);
    void fetcher.submit({ message }, { method: "post", action: path("/chatbot") });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (message.length < 3) return;
    setDraft("");
    send(message);
  }

  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }

  return (
    <>
      {open ? (
        <section id={panelId} ref={panelRef} className="chatbot-panel" aria-label="Orbit Chatbot">
          <header className="chatbot-panel__header">
            <div>
              <h2>Orbit Chatbot</h2>
              <p>Answers scoped to your role and authorized data.</p>
            </div>
            <div className="chatbot-panel__header-actions">
              <span className="chatbot-panel__role-badge">{roleLabel(membership.role)}</span>
              <button className="chatbot-panel__close" type="button" onClick={close} aria-label="Close Chatbot">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          <ol className="chatbot-panel__log" ref={logRef} aria-live="polite" aria-label="Conversation">
            {exchanges.length === 0 ? (
              <li className="chatbot-panel__exchange">
                <div className="chatbot-panel__bubble chatbot-panel__bubble--bot">
                  <p>
                    Hi! I&apos;m your Orbit assistant. Ask me anything about your authorized scope — I&apos;ll only use
                    information you&apos;re permitted to see as <strong>{roleLabel(membership.role)}</strong>.
                  </p>
                  <p className="chatbot-panel__mode">
                    Answers come from a curated knowledge base, filtered by your role and scope.
                    Orbit never invents numbers or policy citations.
                  </p>
                </div>
              </li>
            ) : null}
            {exchanges.map((exchange) => (
              <li key={exchange.id} className="chatbot-panel__exchange">
                <div className="chatbot-panel__bubble chatbot-panel__bubble--you">
                  <p>{exchange.message}</p>
                </div>
                {exchange.result ? (
                  <BotAnswer result={exchange.result} />
                ) : (
                  <div className="chatbot-panel__bubble chatbot-panel__bubble--bot chatbot-panel__typing">
                    <span className="orbit-visually-hidden">Searching your authorized knowledge base…</span>
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </div>
                )}
              </li>
            ))}
          </ol>

          <form className="chatbot-panel__composer" onSubmit={onSubmit}>
            <label className="orbit-visually-hidden" htmlFor={`${panelId}-input`}>
              Your question
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              className="chatbot-panel__input"
              rows={1}
              maxLength={1000}
              value={draft}
              placeholder="Ask about your scope…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={sendOnEnter}
            />
            <button className="orbit-button chatbot-panel__send" type="submit" disabled={busy || draft.trim().length < 3}>
              {busy ? "…" : "Send"}
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={launcherRef}
        className="chatbot-panel__launcher"
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        💬
        <span>{open ? "Close" : "Chatbot"}</span>
      </button>
    </>
  );
}
