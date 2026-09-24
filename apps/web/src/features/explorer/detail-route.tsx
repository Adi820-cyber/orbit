import type { KpiDetailResponse, Observation, Period, ScopeEntity } from "@orbit/contracts";
import { TrendChart, type TrendTarget } from "@orbit/ui-kit";
import { Form, Link, redirect, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import {
  formatNumber,
  humanize,
  measureText,
  monthEnd,
  monthOf,
  monthStart,
  periodLabel,
  shortPeriodLabel,
  targetText,
} from "../../lib/format";
import { sorted } from "../../lib/sorted";
import { Disclosure, Icon, MeasureValue, QualityChips, ScrollRegion, SurfaceHeading } from "../workspace/components";
import {
  useEntityLabel,
  useWorkspace,
  withClient,
  type WorkspaceEnvironment,
  workspacePath,
} from "../workspace/environment";
import { askHref, explorerHref, parseEntity, parseGrain } from "../workspace/links";
import { defaultScope } from "./index-route";
import "./explorer.css";

export interface ExplorerDetailData {
  detail: KpiDetailResponse;
  highlight: string | null;
}

export function explorerDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<ExplorerDetailData | Response> => {
    const assignmentId = params.assignmentId ?? "";
    const search = new URL(request.url).searchParams;
    const entity = parseEntity(search);

    return withClient(environment, request, async (client) => {
      const kpis = await client.kpiList();
      const summary = kpis.assignments.find((row) => row.assignmentId === assignmentId);

      if (!entity) {
        const membership = await client.me();
        const scope = summary ? defaultScope(summary, membership) : null;
        if (!scope) throw redirect(workspacePath(environment.basePath, "/explorer"));
        return redirect(explorerHref(environment.basePath, assignmentId, scope));
      }

      const requested = parseGrain(search.get("breakdown"));
      const automatic =
        search.get("breakdown") === null && entity.grain === "region" && summary?.breakdowns.includes("facility")
          ? "facility"
          : undefined;
      const from = search.get("from");
      const to = search.get("to");

      const detail = await client.kpiDetail(assignmentId, {
        grain: entity.grain,
        entityId: entity.entityId,
        ...(requested ?? automatic ? { breakdown: requested ?? automatic } : {}),
        ...(from ? { from: monthStart(from) } : {}),
        ...(to ? { to: monthEnd(to) } : {}),
      });

      return { detail, highlight: search.get("highlight") };
    });
  };
}

function groupByFamily(observations: readonly Observation[]) {
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const rows = groups.get(observation.definitionFamily) ?? [];
    rows.push(observation);
    groups.set(observation.definitionFamily, rows);
  }
  return [...groups.entries()].map(([family, rows]) => ({
    family,
    rows: sorted(rows, (a, b) => a.period.start.localeCompare(b.period.start)),
  }));
}

function chartTarget(observation: Observation | undefined): TrendTarget | null {
  const target = observation?.target;
  if (!target || target.state === "not_configured") return null;
  if (target.state === "configured") {
    return { kind: "value", value: target.value, label: `Target ${formatNumber(target.value)} · illustrative` };
  }
  return { kind: "range", low: target.low, high: target.high, label: "Target range · illustrative" };
}

function componentColumns(rows: readonly Observation[]) {
  const columns = new Map<string, { label: string; role: string; unit: string }>();
  for (const row of rows) {
    for (const component of row.components) {
      if (!columns.has(component.componentId)) {
        columns.set(component.componentId, { label: component.label, role: component.role, unit: component.unit });
      }
    }
  }
  return [...columns.entries()];
}

function FamilySection({ family, rows }: { family: string; rows: Observation[] }) {
  const latest = rows.at(-1);
  const columns = componentColumns(rows);
  const unit = latest?.unit ?? "";
  const available = rows.filter((row) => row.value.status === "available").length;
  const headingId = `family-${family.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className="workspace-section explorer-family" aria-labelledby={headingId}>
      <div className="workspace-section__heading">
        <div>
          <p className="workspace-kicker">Definition family</p>
          <h2 id={headingId}>{family}</h2>
        </div>
        <p>Value unit: {unit}. Computed from its own numerator and denominator; never averaged across entities.</p>
      </div>

      {latest ? (
        <div className="explorer-latest">
          <div>
            <span>Latest period</span>
            <strong>{periodLabel(latest.period)}</strong>
          </div>
          <div>
            <span>Value</span>
            <strong><MeasureValue value={latest.value} unit={latest.unit} /></strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{targetText(latest.target, latest.unit)}</strong>
          </div>
          <div>
            <span>Data quality</span>
            <QualityChips quality={latest.dataQuality} />
          </div>
        </div>
      ) : (
        <p className="workspace-empty">No observations were returned for this period range.</p>
      )}

      {latest?.dataQuality.limitations.length ? (
        <ul className="explorer-limitations" aria-label={`${family} limitations`}>
          {latest.dataQuality.limitations.map((limitation) => (
            <li key={limitation}><Icon name="quality" /> {limitation}</li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <div className="workspace-panel explorer-chart">
          <TrendChart
            title={`${family} by period`}
            unit={unit}
            points={rows.map((row) => ({
              key: row.observationId,
              label: shortPeriodLabel(row.period),
              value: row.value.status === "available" ? row.value.value : null,
              note: row.value.status === "available" ? undefined : measureText(row.value, row.unit),
            }))}
            target={chartTarget(latest)}
            summary={`${available} of ${rows.length} periods have a reported value. The table below lists every period with its numerator, denominator, and data quality.`}
          />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ScrollRegion label={`${family} components by period`}>
          <table className="workspace-table">
            <caption>Components and lineage by period (latest first)</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" data-numeric="true">
                  Value
                  <span className="explorer-column-role">{unit}</span>
                </th>
                {columns.map(([id, column]) => (
                  <th key={id} scope="col" data-numeric="true">
                    {column.label}
                    <span className="explorer-column-role">{column.role} · {column.unit}</span>
                  </th>
                ))}
                <th scope="col">Quality</th>
              </tr>
            </thead>
            <tbody>
              {sorted(rows, (a, b) => b.period.start.localeCompare(a.period.start)).map((row) => (
                <tr key={row.observationId}>
                  <th scope="row">{periodLabel(row.period)}</th>
                  <td data-numeric="true"><MeasureValue value={row.value} unit={row.unit === unit ? "" : row.unit} /></td>
                  {columns.map(([id]) => {
                    const component = row.components.find((item) => item.componentId === id);
                    return (
                      <td key={id} data-numeric="true">
                        {component ? <MeasureValue value={component.value} unit="" /> : <span className="orbit-status" data-state="empty">Not part of this observation</span>}
                      </td>
                    );
                  })}
                  <td>
                    <span className="orbit-status" data-state={row.dataQuality.freshness === "current" ? "fresh" : row.dataQuality.freshness}>
                      {humanize(row.dataQuality.freshness)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : null}
    </section>
  );
}

function BreakdownSection({ detail, highlight }: { detail: KpiDetailResponse; highlight: string | null }) {
  const entityLabel = useEntityLabel();
  const { environment } = useWorkspace();
  const breakdown = detail.breakdown;
  if (!breakdown) return null;
  const groups = groupByFamily(breakdown.observations);
  const period: Period | undefined = breakdown.observations[0]?.period;
  const canOpen = detail.assignment.grains.includes(breakdown.grain);

  return (
    <section className="workspace-section" aria-labelledby="breakdown-title">
      <div className="workspace-section__heading">
        <div>
          <p className="workspace-kicker">Permitted breakdown</p>
          <h2 id="breakdown-title">{humanize(breakdown.grain)} split{period ? ` · ${periodLabel(period)}` : ""}</h2>
        </div>
        <p>Each row is observed separately. The split shows where the value sits, not why it changed.</p>
      </div>
      {groups.length === 0 ? (
        <p className="workspace-empty">No {breakdown.grain}-level observations were returned for this scope and period.</p>
      ) : (
        groups.map(({ family, rows }) => (
          <ScrollRegion key={family} className="explorer-breakdown" label={`${family} by ${breakdown.grain}`}>
            <table className="workspace-table">
              <caption>{family} by {breakdown.grain}</caption>
              <thead>
                <tr>
                  <th scope="col">{humanize(breakdown.grain)}</th>
                  <th scope="col" data-numeric="true">Value</th>
                  {componentColumns(rows).map(([id, column]) => (
                    <th key={id} scope="col" data-numeric="true">{column.label}</th>
                  ))}
                  <th scope="col">Quality</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.observationId} data-highlight={row.entity.entityId === highlight}>
                    <th scope="row">
                      {canOpen ? (
                        <Link className="workspace-reference" to={explorerHref(environment.basePath, detail.assignment.assignmentId, row.entity)}>
                          {entityLabel(row.entity)}
                        </Link>
                      ) : (
                        <span>{entityLabel(row.entity)}</span>
                      )}
                    </th>
                    <td data-numeric="true"><MeasureValue value={row.value} unit={row.unit} /></td>
                    {row.components.map((component) => (
                      <td key={component.componentId} data-numeric="true"><MeasureValue value={component.value} unit="" /></td>
                    ))}
                    <td><QualityChips quality={row.dataQuality} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ))
      )}
    </section>
  );
}

function scopeText(scope: ScopeEntity) {
  return `${humanize(scope.grain)} · ${scope.entityId}`;
}

export function ExplorerDetailPage({ data }: { data: ExplorerDetailData }) {
  const { detail, highlight } = data;
  const { environment, membership } = useWorkspace();
  const [search] = useSearchParams();
  const groups = groupByFamily(detail.series);
  const latestPeriod = detail.series.at(-1)?.period;
  const assignment = detail.assignment;
  const regionScope = membership.scopes.find((scope) => scope.grain === "region");
  const facilityContext =
    detail.scope.grain === "facility" && regionScope && assignment.breakdowns.includes("facility")
      ? `${explorerHref(environment.basePath, assignment.assignmentId, regionScope, { breakdown: "facility" })}&highlight=${encodeURIComponent(detail.scope.entityId)}`
      : null;
  const firstMonth = detail.series[0]?.period.start;

  return (
    <>
      <title>{`${assignment.kpi} | KPI explorer | Orbit`}</title>
      <nav className="explorer-crumbs" aria-label="Breadcrumb">
        <Link to={workspacePath(environment.basePath, "/explorer")}>KPI explorer</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{assignment.kpi}</span>
      </nav>
      <SurfaceHeading
        eyebrow={assignment.keyDeliverable}
        title={assignment.kpi}
        description={`Scope ${scopeText(detail.scope)}. Every number below is illustrative and carries its own period, unit, and data-quality state.`}
        back="/explorer"
        aside={
          <dl className="explorer-summary" aria-label="Assignment facts">
            <div>
              <dt>Source weight</dt>
              <dd className="is-illustrative">{formatNumber(assignment.weight * 100)}%</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{assignment.review}</dd>
            </div>
          </dl>
        }
      />
      <Disclosure text={detail.disclosure} />

      <div className="explorer-actions">
        {latestPeriod ? (
          <Link
            className="orbit-button"
            data-variant="secondary"
            to={askHref(environment.basePath, {
              intent: "report_performance",
              assignmentId: assignment.assignmentId,
              target: detail.scope,
              period: latestPeriod,
            })}
          >
            Ask about {periodLabel(latestPeriod)}
          </Link>
        ) : null}
        <Link
          className="orbit-button"
          data-variant="secondary"
          to={askHref(environment.basePath, { intent: "explain_definition", assignmentId: assignment.assignmentId })}
        >
          Explain the definition
        </Link>
      </div>
      {latestPeriod ? (
        <p className="explorer-hint">
          To record an action, ask about {periodLabel(latestPeriod)}: the answer carries the server-issued evidence reference
          the action must cite.
        </p>
      ) : null}

      <Form className="explorer-filters" method="get" aria-label="Period range">
        <input type="hidden" name="grain" value={detail.scope.grain} />
        <input type="hidden" name="entityId" value={detail.scope.entityId} />
        {detail.breakdown ? <input type="hidden" name="breakdown" value={detail.breakdown.grain} /> : null}
        <label className="orbit-field">
          <span className="orbit-field-label">From month</span>
          <input className="orbit-input" type="month" name="from" defaultValue={search.get("from") ?? (firstMonth ? monthOf(firstMonth) : "")} />
        </label>
        <label className="orbit-field">
          <span className="orbit-field-label">To month</span>
          <input className="orbit-input" type="month" name="to" defaultValue={search.get("to") ?? (latestPeriod ? monthOf(latestPeriod.start) : "")} />
        </label>
        <button className="orbit-button" data-variant="secondary" type="submit">Apply range</button>
        {assignment.breakdowns.length > 0 && detail.scope.grain === "region" ? (
          detail.breakdown ? (
            <Link className="orbit-button" data-variant="quiet" to={`${explorerHref(environment.basePath, assignment.assignmentId, detail.scope)}&breakdown=none`}>
              Hide {detail.breakdown.grain} split
            </Link>
          ) : (
            <Link className="orbit-button" data-variant="quiet" to={explorerHref(environment.basePath, assignment.assignmentId, detail.scope, { breakdown: "facility" })}>
              Show facility split
            </Link>
          )
        ) : null}
      </Form>

      <section className="workspace-panel explorer-definition" aria-labelledby="definition-title">
        <h2 id="definition-title">Definition and target basis</h2>
        {assignment.unresolved ? (
          <p className="orbit-status" data-state="missing">The mapping from this assignment to a definition family is unresolved.</p>
        ) : null}
        <dl>
          {detail.definitions.map((definition) => (
            <div key={definition.family}>
              <dt>{definition.family}</dt>
              <dd>
                <p>{definition.standardDefinition || "No standard definition text was imported."}</p>
                {definition.numeratorDenominatorControl ? (
                  <p className="explorer-control"><strong>Numerator/denominator control:</strong> {definition.numeratorDenominatorControl}</p>
                ) : null}
              </dd>
            </div>
          ))}
          <div>
            <dt>Target basis</dt>
            <dd>{assignment.targetBasis || "Not stated"} <span className="orbit-meta">(v1 targets are illustrative, not client-approved)</span></dd>
          </div>
          <div>
            <dt>Primary data source</dt>
            <dd>{assignment.primaryDataSource || "Not stated"}</dd>
          </div>
        </dl>
      </section>

      {facilityContext ? (
        <aside className="workspace-panel explorer-context" aria-label="Facility context">
          <div>
            <h2>Facility context</h2>
            <p>Compare this facility with the other facilities in your authorized region, for the same period and definition.</p>
          </div>
          <Link className="orbit-button" data-variant="secondary" to={facilityContext}>
            Open the facility split
          </Link>
        </aside>
      ) : null}

      {groups.length ? (
        groups.map((group) => <FamilySection key={group.family} family={group.family} rows={group.rows} />)
      ) : (
        <p className="workspace-empty">No observations were returned for this scope and period range.</p>
      )}

      <BreakdownSection detail={detail} highlight={highlight} />
    </>
  );
}

export function ExplorerDetailRoute() {
  return <ExplorerDetailPage data={useLoaderData<ExplorerDetailData>()} />;
}
