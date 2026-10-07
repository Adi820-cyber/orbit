import type { ConditionWatch, ForecastRun, SurveillanceResponse } from "@orbit/contracts";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { formatDateTime, formatDay, formatNumber } from "../../lib/format";
import { Disclosure, ScrollRegion, SurfaceHeading } from "../workspace/components";
import { withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "../operations/operations.css";

/*
 * Outbreak watch (ADR 0023): presenting conditions recorded on hospital visits,
 * the product owner's surge rule, and the XGBoost forecast of the coming
 * window, with the model's accuracy beside it. Counts only; no patient is
 * named. Group totals for every permitted leader, hospitals only in scope.
 */

export function surveillanceLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<SurveillanceResponse> =>
    withClient(environment, request, (client) => client.surveillance());
}

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });

function chance(value: number) {
  // A forecast probability is never shown as certain or impossible.
  if (value >= 0.995) return "over 99%";
  if (value < 0.01) return "under 1%";
  return percent.format(value);
}

function about(value: number) {
  return formatNumber(Math.round(value * 10) / 10);
}

function Alerts({ alerts, rule }: { alerts: ConditionWatch[]; rule: SurveillanceResponse["rule"] }) {
  if (alerts.length === 0) {
    return (
      <output className="workspace-alert" data-tone="success">
        <strong>No condition meets the surge rule right now.</strong>
        <span>
          No presenting condition has reached {formatNumber(rule.minPatients)} patients across {formatNumber(rule.minHospitals)} hospitals in the last{" "}
          {rule.windowDays} days.
        </span>
      </output>
    );
  }
  return (
    <>
      {alerts.map((condition) => (
        <div className="workspace-alert" key={condition.conditionId}>
          <strong>Prepare for {condition.name}</strong>
          <span>
            {formatNumber(condition.patients)} patients across {formatNumber(condition.hospitals)} hospitals in the last {rule.windowDays} days (usually about{" "}
            {about(condition.usualPatients)}). Review staffing, beds and supplies at your hospitals.
          </span>
          {condition.forecast ? (
            <span>
              Forecast for the next {rule.windowDays} days: about {about(condition.forecast.expectedPatients)} patients; {chance(condition.forecast.pPatients)} chance of{" "}
              {formatNumber(rule.minPatients)} or more.
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function ModelNote({ run }: { run: ForecastRun | null }) {
  if (!run) {
    return <p className="orbit-meta">No forecast has run yet. Counts and the rule above are live; forecasts appear after the daily model run.</p>;
  }
  return (
    <section aria-labelledby="surveillance-model">
      <h2 id="surveillance-model">About the forecast</h2>
      <p className="orbit-meta">
        {run.model}, trained {formatDateTime(run.trainedAt)} on {formatNumber(run.trainingRows)} rows of history through {formatDay(run.dataThrough)}, forecasting{" "}
        {run.horizonDays} days ahead.
      </p>
      <p className="orbit-meta">
        Accuracy on recent weeks held out: off by {run.modelMae.toFixed(2)} patients per hospital and condition on average, against {run.baselineMae.toFixed(2)} for
        simply repeating last week.{" "}
        {run.beatsBaseline ? "The model does better than that baseline, though only slightly." : "The model does not beat that baseline; treat its probabilities with caution."}
      </p>
      <p className="orbit-meta">{run.notes}</p>
    </section>
  );
}

export function SurveillancePage({ data }: { data: SurveillanceResponse }) {
  const { rule } = data;
  const alerts = data.conditions.filter((condition) => condition.alert);
  const local = data.conditions
    .flatMap((condition) =>
      condition.inScope
        .filter((hospital) => hospital.patients > 0 || (hospital.expectedPatients ?? 0) >= 0.5)
        .map((hospital) => ({ condition, hospital })),
    )
    .sort((a, b) => b.hospital.patients - a.hospital.patients || (b.hospital.expectedPatients ?? 0) - (a.hospital.expectedPatients ?? 0))
    .slice(0, 30);

  return (
    <>
      <title>Outbreak watch | Orbit</title>
      <SurfaceHeading
        eyebrow="Hospital operations"
        title="Outbreak watch"
        description={`Patients arriving with the same presenting condition, counted across the group. An alert is raised when ${formatNumber(rule.minPatients)} or more patients with one condition arrive across ${formatNumber(rule.minHospitals)} or more hospitals within ${rule.windowDays} days. Counts only: no patient is named here.`}
      />
      <Disclosure text={data.disclosure} />
      <p className="orbit-meta">As of {formatDateTime(data.asOf)}. Synthetic demonstration data: not a diagnosis, not a public-health notification, not for clinical decisions.</p>

      <section aria-labelledby="surveillance-alerts">
        <h2 id="surveillance-alerts">Alerts</h2>
        <Alerts alerts={alerts} rule={rule} />
      </section>

      {data.conditions.length === 0 ? (
        <p className="workspace-empty">No presenting conditions are recorded yet.</p>
      ) : (
        <section aria-labelledby="surveillance-watch">
          <h2 id="surveillance-watch">All conditions, group-wide</h2>
          <ScrollRegion label="Conditions">
            <table className="workspace-table">
              <caption>
                Last {rule.windowDays} days across the group, and the forecast for the next {rule.windowDays}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Condition</th>
                  <th scope="col">Category</th>
                  <th scope="col" data-numeric="true">Patients</th>
                  <th scope="col" data-numeric="true">Hospitals</th>
                  <th scope="col" data-numeric="true">Usual</th>
                  <th scope="col" data-numeric="true">Forecast</th>
                  <th scope="col" data-numeric="true">Chance of {formatNumber(rule.minPatients)}+ patients</th>
                  <th scope="col" data-numeric="true">Chance of {formatNumber(rule.minHospitals)}+ hospitals</th>
                </tr>
              </thead>
              <tbody>
                {data.conditions.map((condition) => (
                  <tr key={condition.conditionId}>
                    <th scope="row">
                      {condition.name}
                      {condition.alert ? <span className="orbit-status" data-state="critical"> Alert</span> : null}
                    </th>
                    <td>{condition.category}</td>
                    <td data-numeric="true">{formatNumber(condition.patients)}</td>
                    <td data-numeric="true">{formatNumber(condition.hospitals)}</td>
                    <td data-numeric="true">{about(condition.usualPatients)}</td>
                    <td data-numeric="true">{condition.forecast ? about(condition.forecast.expectedPatients) : "No forecast"}</td>
                    <td data-numeric="true">{condition.forecast ? chance(condition.forecast.pPatients) : "—"}</td>
                    <td data-numeric="true">{condition.forecast ? chance(condition.forecast.pHospitals) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      )}

      {local.length > 0 ? (
        <section aria-labelledby="surveillance-hospitals">
          <h2 id="surveillance-hospitals">Hospitals in your scope</h2>
          <ScrollRegion label="Hospitals in your scope">
            <table className="workspace-table">
              <caption>Last {rule.windowDays} days and the forecast for the next, most patients first</caption>
              <thead>
                <tr>
                  <th scope="col">Hospital</th>
                  <th scope="col">Condition</th>
                  <th scope="col" data-numeric="true">Patients</th>
                  <th scope="col" data-numeric="true">Forecast</th>
                </tr>
              </thead>
              <tbody>
                {local.map(({ condition, hospital }) => (
                  <tr key={`${hospital.facilityId}:${condition.conditionId}`}>
                    <th scope="row">{hospital.name}</th>
                    <td>{condition.name}</td>
                    <td data-numeric="true">{formatNumber(hospital.patients)}</td>
                    <td data-numeric="true">{hospital.expectedPatients === null ? "No forecast" : about(hospital.expectedPatients)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      ) : null}

      <ModelNote run={data.forecastRun} />

      <section aria-labelledby="surveillance-limits">
        <h2 id="surveillance-limits">Limitations</h2>
        <ul className="operations-limitations">
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function SurveillanceRoute() {
  return <SurveillancePage data={useLoaderData<SurveillanceResponse>()} />;
}
