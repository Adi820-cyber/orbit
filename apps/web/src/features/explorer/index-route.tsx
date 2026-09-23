import { Link } from "react-router";
import type { KpiAssignmentSummary, MeResponse, ScopeEntity } from "@orbit/contracts";
import { formatNumber, humanize } from "../../lib/format";
import { Disclosure, Icon, SurfaceHeading } from "../workspace/components";
import { useWorkspace } from "../workspace/environment";
import { explorerHref } from "../workspace/links";
import "./explorer.css";

/** The first scope the membership holds at a grain this assignment permits; the server still decides. */
export function defaultScope(assignment: KpiAssignmentSummary, membership: MeResponse): ScopeEntity | null {
  return membership.scopes.find((scope) => assignment.grains.includes(scope.grain)) ?? null;
}

function AssignmentCard({ assignment }: { assignment: KpiAssignmentSummary }) {
  const { membership, environment } = useWorkspace();
  const scope = defaultScope(assignment, membership);
  const bundled = assignment.definitionFamilies.length > 1;

  return (
    <article className="explorer-card">
      <div className="explorer-card__top">
        <p className="workspace-scope-line">{assignment.keyDeliverable}</p>
        <span className="chip-illustrative" title="Workbook weight — a source weight, not a performance score">
          Source weight <span className="is-illustrative">{formatNumber(assignment.weight * 100)}%</span>
        </span>
      </div>
      <h2>
        {scope ? (
          <Link to={explorerHref(environment.basePath, assignment.assignmentId, scope)}>{assignment.kpi}</Link>
        ) : (
          assignment.kpi
        )}
      </h2>
      <div className="workspace-chip-row" aria-label="Definition families">
        {assignment.definitionFamilies.map((family) => (
          <span key={family} className="orbit-status" data-state="illustrative">{family}</span>
        ))}
        {bundled ? <span className="orbit-status" data-state="missing">Bundled: {assignment.definitionFamilies.length} measures kept separate</span> : null}
        {assignment.unresolved ? <span className="orbit-status" data-state="missing">Mapping unresolved</span> : null}
      </div>
      <dl className="explorer-card__facts">
        <div>
          <dt>Review cadence</dt>
          <dd>{assignment.review}</dd>
        </div>
        <div>
          <dt>Target basis</dt>
          <dd>{assignment.targetBasis || "Not stated"}</dd>
        </div>
        <div>
          <dt>Primary source</dt>
          <dd>{assignment.primaryDataSource || "Not stated"}</dd>
        </div>
        <div>
          <dt>Permitted grains</dt>
          <dd>
            {assignment.grains.map(humanize).join(", ")}
            {assignment.breakdowns.length ? ` · breakdown by ${assignment.breakdowns.map(humanize).join(", ").toLowerCase()}` : ""}
          </dd>
        </div>
      </dl>
      {scope ? (
        <Link className="workspace-inline-link" to={explorerHref(environment.basePath, assignment.assignmentId, scope)}>
          Explore {humanize(scope.grain).toLowerCase()} evidence <Icon name="arrow" />
        </Link>
      ) : (
        <p className="orbit-field-message">No scope in your membership is at a grain this assignment permits.</p>
      )}
    </article>
  );
}

export function ExplorerIndexRoute() {
  const { kpis } = useWorkspace();
  const totalWeight = kpis.assignments.reduce((total, assignment) => total + assignment.weight, 0);

  return (
    <>
      <title>KPI explorer | Orbit</title>
      <SurfaceHeading
        eyebrow="KPI explorer"
        title="Your authorized KPI assignments"
        description="Every assignment in your role's workbook set, with its definition, target basis, cadence, and the grains your entitlement permits. Weights are source weights, not a health score."
        aside={
          <dl className="explorer-summary" aria-label="Assignment coverage">
            <div>
              <dt>Assignments</dt>
              <dd className="is-illustrative">{kpis.assignments.length}</dd>
            </div>
            <div>
              <dt>Source weights total</dt>
              <dd className="is-illustrative">{formatNumber(totalWeight * 100)}%</dd>
            </div>
          </dl>
        }
      />
      <Disclosure text={kpis.disclosure} />
      <div className="explorer-grid">
        {kpis.assignments.map((assignment) => (
          <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
        ))}
      </div>
    </>
  );
}
