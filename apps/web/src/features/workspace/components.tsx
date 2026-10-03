import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type {
  ActionState,
  DataQuality,
  EvidenceRef,
  Exception,
  KpiAssignmentSummary,
  MeasureValue as MeasureValueContract,
  OnTrackItem,
  ScopeEntity,
} from "@orbit/contracts";
import {
  actionStateLabel,
  assignmentLabel,
  humanize,
  measureState,
  measureText,
  periodLabel,
  roleLabel,
  scopeLabel,
} from "../../lib/format";
import { useEntityLabel, useWorkspace, workspacePath } from "./environment";
import { askHref, explorerHref, newActionHref } from "./links";

export type IconName =
  | "brief"
  | "inbox"
  | "explorer"
  | "ask"
  | "actions"
  | "audit"
  | "operations"
  | "alert"
  | "monitor"
  | "track"
  | "quality"
  | "arrow"
  | "signout"
  | "reset";

const ICON_PATHS: Record<IconName, ReactNode> = {
  brief: <><path d="M4 5.5h16v14H4z" /><path d="M8 2.5v6M16 2.5v6M4 10.5h16" /></>,
  inbox: <><path d="M4 4.5h16v15H4z" /><path d="m4 14 4-4h8l4 4M8 14h8" /></>,
  explorer: <><path d="M4 19.5V10M10 19.5V4M16 19.5v-7M22 19.5H2" /></>,
  ask: <><path d="M4 4.5h16v12H9l-5 4z" /><path d="M8 8.5h8M8 12.5h5" /></>,
  actions: <><path d="M5 3.5h14v17H5z" /><path d="m8 9 2 2 5-5M8 15h8" /></>,
  audit: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  operations: <><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></>,
  alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4M12 17h.01" /></>,
  monitor: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
  track: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  quality: <><path d="M12 3 4.5 6v5.5c0 4.8 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.7 7.5-9.5V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
  signout: <><path d="M10 4.5H5v15h5" /><path d="M14 8l4 4-4 4M18 12H9" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4.5v4h4" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

export function QualityChips({ quality }: { quality: DataQuality }) {
  return (
    <div className="workspace-chip-row" aria-label="Data quality">
      <span className="chip-illustrative">Illustrative</span>
      <span className="orbit-status" data-state={quality.freshness === "current" ? "fresh" : quality.freshness}>
        {humanize(quality.freshness)}
      </span>
      {quality.reconciliation !== "not_applicable" ? (
        <span className="orbit-status" data-state={quality.reconciliation === "reconciled" ? "ready" : quality.reconciliation}>
          {humanize(quality.reconciliation)}
        </span>
      ) : null}
    </div>
  );
}

export function ActionStateChip({ state }: { state: ActionState | "none" }) {
  if (state === "none") {
    return <span className="orbit-status" data-state="empty">No action recorded</span>;
  }

  const tone = state === "completed" ? "ready" : state === "cancelled" ? "unavailable" : "illustrative";
  return <span className="orbit-status" data-state={tone}>Action {actionStateLabel(state).toLowerCase()}</span>;
}

/** A measured value with its state; missing and not-applicable never render as a number. */
export function MeasureValue({ value, unit }: { value: MeasureValueContract; unit: string }) {
  if (value.status === "available") {
    return <span className="is-illustrative workspace-measure">{measureText(value, unit)}</span>;
  }

  return (
    <span className="orbit-status" data-state={measureState(value)}>
      {measureText(value, unit)}
    </span>
  );
}

export function EvidenceSummary({ entity, evidence }: { entity: ScopeEntity; evidence: EvidenceRef }) {
  const entityLabel = useEntityLabel();
  return (
    <details className="workspace-evidence">
      <summary>Evidence and scope</summary>
      <dl className="workspace-evidence__grid">
        <div>
          <dt>Scope</dt>
          <dd>
            {entityLabel(entity)} · {scopeLabel(entity)}
          </dd>
        </div>
        <div>
          <dt>Scope reference</dt>
          <dd className="workspace-reference">{entity.entityId}</dd>
        </div>
        <div>
          <dt>Definition version</dt>
          <dd>{evidence.definitionVersion}</dd>
        </div>
        <div>
          <dt>Evidence records</dt>
          <dd className="is-illustrative">{evidence.observationIds.length}</dd>
        </div>
      </dl>
      <p className="workspace-evidence__checksum">
        Dataset <span className="workspace-reference">{evidence.datasetChecksum}</span>
      </p>
    </details>
  );
}

function canExplore(summary: KpiAssignmentSummary | undefined, entity: ScopeEntity) {
  return Boolean(summary?.grains.includes(entity.grain));
}

export function ExceptionCard({
  item,
  headingLevel = 3,
}: {
  item: Exception;
  headingLevel?: 2 | 3;
}) {
  const { assignments, environment } = useWorkspace();
  const summary = assignments.get(item.assignmentId);
  const tone = item.priority === "act_now" ? "danger" : "warning";
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const label = assignmentLabel(item.assignmentId, assignments);

  return (
    <article className="exception-card" data-tone={tone} aria-label={`${item.priority === "act_now" ? "Act now" : "Monitor"}: ${label}`}>
      <div className="exception-card__topline">
        <span className="exception-card__priority">
          <Icon name={item.priority === "act_now" ? "alert" : "monitor"} />
          {item.priority === "act_now" ? "Act now" : "Monitor"}
          {item.category !== "performance" ? <span className="orbit-status" data-state="critical">{humanize(item.category)}</span> : null}
        </span>
        <span className="exception-card__comparison">
          {item.comparisonBasis === "none" ? "No comparison basis" : `Compared with ${humanize(item.comparisonBasis).toLowerCase()}`}
        </span>
      </div>
      <div className="exception-card__body">
        <div className="exception-card__copy">
          <p className="workspace-scope-line">
            {scopeLabel(item.entity)} · {periodLabel(item.period)}
          </p>
          <Heading>{label}</Heading>
          <p className="exception-card__change">{item.whatChanged}</p>
          <p className="exception-card__reason">{item.whyItMatters}</p>
        </div>
        <div className="exception-card__meta">
          <QualityChips quality={item.dataQuality} />
          <p>
            <span>Accountable role</span>
            <strong>{roleLabel(item.owner.role)}</strong>
          </p>
          <p>
            <span>Detection</span>
            <strong>{item.detection.kind === "seeded_scenario" ? item.detection.scenarioLabel : "Reviewed rule"}</strong>
          </p>
          <p>
            <span>Action state</span>
            <ActionStateChip state={item.actionState} />
          </p>
        </div>
      </div>
      <div className="exception-card__actions">
        {canExplore(summary, item.entity) ? (
          <Link className="orbit-button" data-variant="secondary" to={explorerHref(environment.basePath, item.assignmentId, item.entity)}>
            Review evidence
          </Link>
        ) : null}
        <Link
          className="orbit-button"
          data-variant="secondary"
          to={askHref(environment.basePath, {
            intent: "report_performance",
            assignmentId: item.assignmentId,
            target: item.entity,
            period: item.period,
          })}
        >
          Ask about this
        </Link>
        <Link
          className="orbit-button"
          to={newActionHref(environment.basePath, {
            assignmentId: item.assignmentId,
            entity: item.entity,
            evidence: item.evidence,
          })}
        >
          Record action
        </Link>
      </div>
      <EvidenceSummary entity={item.entity} evidence={item.evidence} />
    </article>
  );
}

export function OnTrackCard({ item }: { item: OnTrackItem }) {
  const { assignments, environment } = useWorkspace();
  const summary = assignments.get(item.assignmentId);

  return (
    <article className="track-card">
      <span className="track-card__icon">
        <Icon name="track" />
      </span>
      <div>
        <p className="workspace-scope-line">
          {scopeLabel(item.entity)} · {periodLabel(item.period)}
        </p>
        <h3>{assignmentLabel(item.assignmentId, assignments)}</h3>
        <p>{item.summary}</p>
        <QualityChips quality={item.dataQuality} />
        {canExplore(summary, item.entity) ? (
          <Link className="workspace-inline-link" to={explorerHref(environment.basePath, item.assignmentId, item.entity)}>
            Open in explorer <Icon name="arrow" />
          </Link>
        ) : null}
      </div>
      <EvidenceSummary entity={item.entity} evidence={item.evidence} />
    </article>
  );
}

/** A horizontally scrollable table area; it must be keyboard-reachable when it overflows (WCAG 2.1.1). */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable content with no focusable children needs a tab stop
    <section aria-label={label} className={["workspace-table-wrap", className].filter(Boolean).join(" ")} tabIndex={0}>
      {children}
    </section>
  );
}

export function PageBackButton({ fallback = "/" }: { fallback?: string }) {
  const navigate = useNavigate();
  const { environment } = useWorkspace();
  const fallbackPath = workspacePath(environment.basePath, fallback);

  function goBack() {
    const historyIndex = typeof window !== "undefined" ? Number(window.history.state?.idx) : 0;
    if (Number.isInteger(historyIndex) && historyIndex > 0) {
      void navigate(-1);
      return;
    }
    void navigate(fallbackPath);
  }

  return (
    <button className="workspace-back" type="button" onClick={goBack} aria-label="Go back">
      <Icon name="arrow" />
      Back
    </button>
  );
}

export function SurfaceHeading({
  eyebrow,
  title,
  description,
  aside,
  back,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
  back?: string;
}) {
  return (
    <header className="workspace-heading">
      <div className="workspace-heading__main">
        {back ? <PageBackButton fallback={back} /> : null}
        <div>
          <p className="workspace-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {aside}
    </header>
  );
}

export function Disclosure({ text }: { text: string }) {
  return (
    <div className="orbit-disclosure-banner workspace-disclosure" role="note">
      <span>Illustrative environment</span>
      <span>{text}</span>
    </div>
  );
}

export type SurfaceStateKind = "out_of_scope" | "forbidden" | "not_found" | "unavailable" | "invalid_request" | "empty";

const STATE_LABEL: Record<SurfaceStateKind, string> = {
  out_of_scope: "Out of scope",
  forbidden: "Not permitted",
  not_found: "Not found",
  unavailable: "Unavailable",
  invalid_request: "Incomplete request",
  empty: "Nothing to show",
};

export function SurfaceState({
  kind,
  title,
  message,
  children,
  level = 2,
}: {
  kind: SurfaceStateKind;
  title: string;
  message: string;
  children?: ReactNode;
  /** 1 when the state replaces the whole page (an error boundary), so the page still has a main heading. */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section className="workspace-state" data-kind={kind} role={kind === "empty" ? undefined : "alert"}>
      <span className="orbit-status" data-state={kind === "invalid_request" ? "missing" : kind}>
        {STATE_LABEL[kind]}
      </span>
      <Heading>{title}</Heading>
      <p>{message}</p>
      {children ? <div className="workspace-state__actions">{children}</div> : null}
    </section>
  );
}
