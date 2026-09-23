import { OrbitBrand } from "@orbit/ui-kit";
import type {
  DataLimitation,
  DataQuality,
  Exception,
  KpiAssignmentSummary,
  OnTrackItem,
  ScopeEntity,
} from "@orbit/contracts";
import {
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import {
  ApiConfigurationError,
  ApiRequestError,
  getBriefPagePayload,
  type BriefPagePayload,
} from "../../lib/api";
import {
  AuthConfigurationError,
  getCurrentSession,
} from "../../lib/auth";
import { regionalCooViewConfig } from "../../roles/regional-coo/config";
import "./brief.css";

interface ReadyState {
  status: "ready";
  payload: BriefPagePayload;
}

interface FailureState {
  status: "out_of_scope" | "unavailable";
  message: string;
}

export type BriefLoaderData = ReadyState | FailureState;

export async function briefLoader({
  request,
}: LoaderFunctionArgs): Promise<BriefLoaderData | Response> {
  let session;

  try {
    session = await getCurrentSession();
  } catch (error: unknown) {
    if (error instanceof AuthConfigurationError) {
      return redirect("/login?returnTo=%2F");
    }

    throw error;
  }

  if (!session) {
    const requestUrl = new URL(request.url);
    const returnTo = `${requestUrl.pathname}${requestUrl.search}`;
    return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  try {
    const payload = await getBriefPagePayload(session.access_token);

    if (payload.membership.role !== regionalCooViewConfig.roleId) {
      return {
        status: "out_of_scope",
        message:
          "This first brief view is available only to a verified Regional COO membership.",
      };
    }

    return { status: "ready", payload };
  } catch (error: unknown) {
    if (error instanceof ApiConfigurationError) {
      return {
        status: "unavailable",
        message:
          "Orbit's decision service connection has not been configured for this environment.",
      };
    }

    if (error instanceof ApiRequestError) {
      if (error.code === "unauthenticated") {
        return redirect("/login?returnTo=%2F");
      }

      if (error.code === "forbidden" || error.code === "out_of_scope") {
        return {
          status: "out_of_scope",
          message:
            "Your verified membership does not permit this regional brief.",
        };
      }

      return {
        status: "unavailable",
        message: error.message,
      };
    }

    return {
      status: "unavailable",
      message: "Orbit could not prepare the morning brief.",
    };
  }
}

function Icon({ name }: { name: "brief" | "inbox" | "explorer" | "ask" | "actions" | "audit" | "alert" | "monitor" | "track" | "quality" }) {
  const paths = {
    brief: <><path d="M4 5.5h16v14H4z"/><path d="M8 2.5v6M16 2.5v6M4 10.5h16"/></>,
    inbox: <><path d="M4 4.5h16v15H4z"/><path d="m4 14 4-4h8l4 4M8 14h8"/></>,
    explorer: <><path d="M4 19.5V10M10 19.5V4M16 19.5v-7M22 19.5H2"/></>,
    ask: <><path d="M4 4.5h16v12H9l-5 4z"/><path d="M8 8.5h8M8 12.5h5"/></>,
    actions: <><path d="M5 3.5h14v17H5z"/><path d="m8 9 2 2 5-5M8 15h8"/></>,
    audit: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    alert: <><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4M12 17h.01"/></>,
    monitor: <><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></>,
    track: <><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    quality: <><path d="M12 3 4.5 6v5.5c0 4.8 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.7 7.5-9.5V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  };

  return (
    <svg className="brief-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const navigation = [
  { icon: "brief", label: "Morning brief", active: true },
  { icon: "inbox", label: "Priority inbox", active: false },
  { icon: "explorer", label: "KPI explorer", active: false },
  { icon: "ask", label: "Guided Ask", active: false },
  { icon: "actions", label: "Actions", active: false },
  { icon: "audit", label: "Audit", active: false },
] as const;

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(value));
}

function periodLabel(period: BriefPagePayload["brief"]["period"]) {
  const start = `${period.start}T00:00:00Z`;
  const end = `${period.end}T00:00:00Z`;

  if (period.cadence === "month") {
    return formatDate(start, { month: "long", year: "numeric" });
  }

  return `${formatDate(start, { month: "short", day: "numeric" })}–${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function roleLabel(value: string) {
  const acronyms = new Set(["coo", "dho"]);

  return value
    .split("-")
    .map((part) =>
      acronyms.has(part)
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

function scopeLabel(entity: ScopeEntity) {
  return `${humanize(entity.grain)} scope`;
}

function assignmentMap(assignments: KpiAssignmentSummary[]) {
  return new Map(
    assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
}

function assignmentLabel(
  assignmentId: string,
  assignments: Map<string, KpiAssignmentSummary>,
) {
  return assignments.get(assignmentId)?.kpi ?? "Assignment unavailable";
}

function QualityChips({ quality }: { quality: DataQuality }) {
  return (
    <div className="brief-chip-row" aria-label="Data quality">
      <span className="chip-illustrative">Illustrative</span>
      <span className="orbit-status" data-state={quality.freshness}>
        {humanize(quality.freshness)}
      </span>
      {quality.reconciliation !== "not_applicable" ? (
        <span className="orbit-status" data-state={quality.reconciliation}>
          {humanize(quality.reconciliation)}
        </span>
      ) : null}
    </div>
  );
}

function EvidenceDetails({ item }: { item: Exception | OnTrackItem }) {
  return (
    <details className="brief-evidence">
      <summary>Evidence and scope</summary>
      <dl className="brief-evidence__grid">
        <div>
          <dt>Scope</dt>
          <dd>{scopeLabel(item.entity)}</dd>
        </div>
        <div>
          <dt>Scope reference</dt>
          <dd className="brief-reference">{item.entity.entityId}</dd>
        </div>
        <div>
          <dt>Definition version</dt>
          <dd>{item.evidence.definitionVersion}</dd>
        </div>
        <div>
          <dt>Evidence records</dt>
          <dd className="is-illustrative">{item.evidence.observationIds.length}</dd>
        </div>
      </dl>
    </details>
  );
}

function ExceptionCard({
  item,
  assignments,
}: {
  item: Exception;
  assignments: Map<string, KpiAssignmentSummary>;
}) {
  const tone = item.priority === "act_now" ? "danger" : "warning";

  return (
    <article className="brief-decision-card" data-tone={tone}>
      <div className="brief-decision-card__topline">
        <span className="brief-priority">
          <Icon name={item.priority === "act_now" ? "alert" : "monitor"} />
          {item.priority === "act_now" ? "Act now" : "Monitor"}
        </span>
        <span className="brief-comparison">
          Compared with {humanize(item.comparisonBasis).toLowerCase()}
        </span>
      </div>
      <div className="brief-decision-card__body">
        <div className="brief-decision-card__copy">
          <p className="brief-scope-line">
            {scopeLabel(item.entity)} · {periodLabel(item.period)}
          </p>
          <h3>{assignmentLabel(item.assignmentId, assignments)}</h3>
          <p className="brief-change">{item.whatChanged}</p>
          <p className="brief-reason">{item.whyItMatters}</p>
        </div>
        <div className="brief-decision-card__meta">
          <QualityChips quality={item.dataQuality} />
          <p>
            <span>Accountable role</span>
            <strong>{roleLabel(item.owner.role)}</strong>
          </p>
          <p>
            <span>Detection</span>
            <strong>
              {item.detection.kind === "seeded_scenario"
                ? item.detection.scenarioLabel
                : "Reviewed rule"}
            </strong>
          </p>
        </div>
      </div>
      <EvidenceDetails item={item} />
    </article>
  );
}

function OnTrackCard({
  item,
  assignments,
}: {
  item: OnTrackItem;
  assignments: Map<string, KpiAssignmentSummary>;
}) {
  return (
    <article className="brief-track-card">
      <span className="brief-track-card__icon">
        <Icon name="track" />
      </span>
      <div>
        <p className="brief-scope-line">
          {scopeLabel(item.entity)} · {periodLabel(item.period)}
        </p>
        <h3>{assignmentLabel(item.assignmentId, assignments)}</h3>
        <p>{item.summary}</p>
        <QualityChips quality={item.dataQuality} />
      </div>
      <EvidenceDetails item={item} />
    </article>
  );
}

function LimitationItem({
  item,
  assignments,
}: {
  item: DataLimitation;
  assignments: Map<string, KpiAssignmentSummary>;
}) {
  const label = item.assignmentId
    ? assignmentLabel(item.assignmentId, assignments)
    : "Brief-wide limitation";

  return (
    <li>
      <span className="brief-limitation__icon">
        <Icon name="quality" />
      </span>
      <div>
        <strong>{label}</strong>
        <p>{item.detail}</p>
      </div>
      <span className="orbit-status" data-state={item.issue}>
        {humanize(item.issue)}
      </span>
    </li>
  );
}

function BriefNavigation() {
  return (
    <nav className="brief-nav" aria-label="Orbit workspace">
      {navigation.map((item) =>
        item.active ? (
          <a key={item.label} href="#brief-content" aria-current="page">
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ) : (
          <span key={item.label} aria-disabled="true">
            <Icon name={item.icon} />
            <span>{item.label}</span>
            <span className="orbit-visually-hidden">Not available in this slice</span>
          </span>
        ),
      )}
    </nav>
  );
}

function BriefFailure({ state }: { state: FailureState }) {
  return (
    <main className="orbit-page brief-failure">
      <OrbitBrand compact tagline="Healthcare performance platform" />
      <section className="orbit-card orbit-stack">
        <span
          className="orbit-status"
          data-state={state.status === "out_of_scope" ? "out_of_scope" : "unavailable"}
        >
          {state.status === "out_of_scope" ? "Out of scope" : "Unavailable"}
        </span>
        <h1 className="orbit-page-title">
          {state.status === "out_of_scope"
            ? "This brief is not available for your membership."
            : "The morning brief is temporarily unavailable."}
        </h1>
        <p className="orbit-text-muted">{state.message}</p>
        <a className="orbit-button" data-variant="secondary" href="/">
          Try again
        </a>
      </section>
    </main>
  );
}

export function RegionalCooBriefPage({
  payload,
}: {
  payload: BriefPagePayload;
}) {
  const { brief, kpis, membership } = payload;
  const assignments = assignmentMap(kpis.assignments);
  const asOf = formatDate(brief.asOf, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="brief-app-shell">
      <aside className="brief-sidebar">
        <OrbitBrand compact tagline="Healthcare performance platform" />
        <BriefNavigation />
        <div className="brief-sidebar__scope">
          <span className="orbit-meta">Verified view</span>
          <strong>{regionalCooViewConfig.title}</strong>
          <span>{membership.scopes.map(scopeLabel).join(", ")}</span>
        </div>
      </aside>

      <div className="brief-workspace">
        <header className="brief-mobile-header">
          <OrbitBrand compact tagline="Healthcare performance platform" />
        </header>
        <div className="brief-mobile-nav">
          <BriefNavigation />
        </div>

        <main id="brief-content" className="brief-main" tabIndex={-1}>
          <header className="brief-heading">
            <div>
              <p className="brief-eyebrow">{regionalCooViewConfig.eyebrow}</p>
              <h1>Your morning decision brief</h1>
              <p>{regionalCooViewConfig.description}</p>
            </div>
            <div className="brief-period-card" aria-label="Reporting period">
              <span>Reporting period</span>
              <strong>{periodLabel(brief.period)}</strong>
              <small>As of {asOf} UTC</small>
            </div>
          </header>

          <div className="orbit-disclosure-banner brief-disclosure" role="note">
            <span>Illustrative environment</span>
            <span>{brief.disclosure}</span>
          </div>

          <section className="brief-summary" aria-label="Brief summary">
            <a href="#act-now" data-tone="danger">
              <span><Icon name="alert" /> Act now</span>
              <strong className="is-illustrative">{brief.actNow.length}</strong>
              <small>Decision-ready exception</small>
            </a>
            <a href="#monitor" data-tone="warning">
              <span><Icon name="monitor" /> Monitor</span>
              <strong className="is-illustrative">{brief.monitor.length}</strong>
              <small>Signals to watch</small>
            </a>
            <a href="#on-track" data-tone="success">
              <span><Icon name="track" /> On track</span>
              <strong className="is-illustrative">{brief.onTrack.length}</strong>
              <small>Reassurance, not a score</small>
            </a>
            <a href="#limitations" data-tone="neutral">
              <span><Icon name="quality" /> Limitations</span>
              <strong className="is-illustrative">{brief.dataLimitations.length}</strong>
              <small>Known data constraints</small>
            </a>
          </section>

          <section id="act-now" className="brief-section" aria-labelledby="act-now-title">
            <div className="brief-section__heading">
              <div>
                <p className="brief-section__kicker">Decide first</p>
                <h2 id="act-now-title">Act now</h2>
              </div>
              <p>Exceptions that need an accountable decision or evidence review.</p>
            </div>
            <div className="brief-decision-list">
              {brief.actNow.length ? brief.actNow.map((item) => (
                <ExceptionCard key={item.exceptionId} item={item} assignments={assignments} />
              )) : <p className="brief-empty">No act-now exceptions were returned for this scope.</p>}
            </div>
          </section>

          <section id="monitor" className="brief-section" aria-labelledby="monitor-title">
            <div className="brief-section__heading">
              <div>
                <p className="brief-section__kicker">Keep in view</p>
                <h2 id="monitor-title">Monitor</h2>
              </div>
              <p>Signals that need observation before an operating decision.</p>
            </div>
            <div className="brief-decision-list">
              {brief.monitor.length ? brief.monitor.map((item) => (
                <ExceptionCard key={item.exceptionId} item={item} assignments={assignments} />
              )) : <p className="brief-empty">No monitor items were returned for this scope.</p>}
            </div>
          </section>

          <section id="on-track" className="brief-section" aria-labelledby="on-track-title">
            <div className="brief-section__heading">
              <div>
                <p className="brief-section__kicker">Reassurance</p>
                <h2 id="on-track-title">On track</h2>
              </div>
              <p>A concise view of areas without a current exception.</p>
            </div>
            <div className="brief-track-grid">
              {brief.onTrack.length ? brief.onTrack.map((item) => (
                <OnTrackCard key={`${item.assignmentId}:${item.entity.entityId}`} item={item} assignments={assignments} />
              )) : <p className="brief-empty">No on-track summaries were returned for this scope.</p>}
            </div>
          </section>

          <section id="limitations" className="brief-section brief-limitations" aria-labelledby="limitations-title">
            <div className="brief-section__heading">
              <div>
                <p className="brief-section__kicker">Read before deciding</p>
                <h2 id="limitations-title">Data limitations</h2>
              </div>
              <p>Missing, late, stale, or unreconciled inputs are never filled with plausible values.</p>
            </div>
            {brief.dataLimitations.length ? (
              <ul>
                {brief.dataLimitations.map((item, index) => (
                  <LimitationItem key={`${item.assignmentId ?? "brief"}:${item.issue}:${index}`} item={item} assignments={assignments} />
                ))}
              </ul>
            ) : <p className="brief-empty">No additional data limitations were returned.</p>}
          </section>

          <footer className="brief-footer">
            <span>Framework {kpis.frameworkVersion}</span>
            <span>Role and scope are derived from the verified membership boundary.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export function BriefRoute() {
  const data = useLoaderData<BriefLoaderData>();

  if (data.status !== "ready") {
    return <BriefFailure state={data} />;
  }

  return <RegionalCooBriefPage payload={data.payload} />;
}
