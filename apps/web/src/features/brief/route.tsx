import type { BriefResponse, DataLimitation } from "@orbit/contracts";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { assignmentLabel, formatDateTime, humanize, periodLabel } from "../../lib/format";
import { roleViewConfigFor } from "../../roles/config";
import {
  Disclosure,
  ExceptionCard,
  Icon,
  OnTrackCard,
  SurfaceHeading,
} from "../workspace/components";
import { useWorkspace, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "./brief.css";

export function briefLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<BriefResponse> =>
    withClient(environment, request, (client) => client.brief());
}

function LimitationItem({ item }: { item: DataLimitation }) {
  const { assignments } = useWorkspace();
  const label = item.assignmentId ? assignmentLabel(item.assignmentId, assignments) : "Brief-wide limitation";

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

export function BriefPage({ brief }: { brief: BriefResponse }) {
  const { membership } = useWorkspace();
  const roleConfig = roleViewConfigFor(membership.role);

  if (!roleConfig) {
    throw new Error("Brief rendered for an unsupported role view.");
  }

  return (
    <>
      <title>Morning brief | Orbit</title>
      <SurfaceHeading
        eyebrow={roleConfig.eyebrow}
        title="Your morning decision brief"
        description={roleConfig.description}
        aside={
          <div className="brief-period-card" aria-label="Reporting period">
            <span>Reporting period</span>
            <strong>{periodLabel(brief.period)}</strong>
            <small>As of {formatDateTime(brief.asOf)}</small>
          </div>
        }
      />

      <Disclosure text={brief.disclosure} />

      <section className="brief-summary" aria-label="Brief summary">
        <a href="#act-now" data-tone="danger">
          <span><Icon name="alert" /> Act now</span>
          <strong className="is-illustrative">{brief.actNow.length}</strong>
          <small>Decision-ready exceptions</small>
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

      <section id="act-now" className="workspace-section" aria-labelledby="act-now-title">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">Decide first</p>
            <h2 id="act-now-title">Act now</h2>
          </div>
          <p>Exceptions that need an accountable decision or evidence review.</p>
        </div>
        <div className="exception-list">
          {brief.actNow.length ? (
            brief.actNow.map((item) => <ExceptionCard key={item.exceptionId} item={item} />)
          ) : (
            <p className="workspace-empty">No act-now exceptions were returned for this scope.</p>
          )}
        </div>
      </section>

      <section id="monitor" className="workspace-section" aria-labelledby="monitor-title">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">Keep in view</p>
            <h2 id="monitor-title">Monitor</h2>
          </div>
          <p>Signals that need observation before an operating decision.</p>
        </div>
        <div className="exception-list">
          {brief.monitor.length ? (
            brief.monitor.map((item) => <ExceptionCard key={item.exceptionId} item={item} />)
          ) : (
            <p className="workspace-empty">No monitor items were returned for this scope.</p>
          )}
        </div>
      </section>

      <section id="on-track" className="workspace-section" aria-labelledby="on-track-title">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">Reassurance</p>
            <h2 id="on-track-title">On track</h2>
          </div>
          <p>A concise view of areas without a current exception.</p>
        </div>
        <div className="track-grid">
          {brief.onTrack.length ? (
            brief.onTrack.map((item) => (
              <OnTrackCard key={`${item.assignmentId}:${item.entity.entityId}`} item={item} />
            ))
          ) : (
            <p className="workspace-empty">No on-track summaries were returned for this scope.</p>
          )}
        </div>
      </section>

      <section id="limitations" className="workspace-section brief-limitations" aria-labelledby="limitations-title">
        <div className="workspace-section__heading">
          <div>
            <p className="workspace-kicker">Read before deciding</p>
            <h2 id="limitations-title">Data limitations</h2>
          </div>
          <p>Missing, late, stale, or unreconciled inputs are never filled with plausible values.</p>
        </div>
        {brief.dataLimitations.length ? (
          <ul>
            {brief.dataLimitations.map((item) => (
              <LimitationItem key={`${item.assignmentId ?? "brief"}:${item.issue}:${item.detail}`} item={item} />
            ))}
          </ul>
        ) : (
          <p className="workspace-empty">No additional data limitations were returned.</p>
        )}
      </section>
    </>
  );
}

export function BriefRoute() {
  return <BriefPage brief={useLoaderData<BriefResponse>()} />;
}
