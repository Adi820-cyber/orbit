import type { RevenueFeedResponse, RevenueFigure } from "@orbit/contracts";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { formatDateTime, formatDay, formatNumber } from "../../lib/format";
import { Disclosure, ScrollRegion, SurfaceHeading } from "../workspace/components";
import { withClient, type WorkspaceEnvironment } from "../workspace/environment";
import "../operations/operations.css";

/*
 * Hospital revenue for leaders (ADR 0022 §5): what the hospital operations
 * system billed and collected, per hospital in the caller's scope. Amounts
 * only; no patient or bill is named. Not the KPI scorecard: the two are shown
 * apart and never merged.
 */

export function revenueLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<RevenueFeedResponse> =>
    withClient(environment, request, (client) => client.revenue());
}

function amount(value: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="operations-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <dd className="operations-tile__note">{note}</dd> : null}
    </div>
  );
}

function Figures({ figures, currency, days }: { figures: RevenueFigure; currency: string; days: number }) {
  const owed = figures.outstandingPatient + figures.outstandingInsurer;
  return (
    <dl className="operations-tiles">
      <Tile label={`Billed, last ${days} days`} value={amount(figures.gross, currency)} note={`${formatNumber(figures.bills)} bills`} />
      <Tile label={`Collected, last ${days} days`} value={amount(figures.collected, currency)} />
      <Tile label="Insurer share billed" value={amount(figures.insurance, currency)} />
      <Tile label="Patient share billed" value={amount(figures.patient, currency)} />
      <Tile label="Billed today" value={amount(figures.grossToday, currency)} note={`${amount(figures.collectedToday, currency)} collected today`} />
      <Tile
        label="Still owed"
        value={amount(owed, currency)}
        note={`${amount(figures.outstandingInsurer, currency)} by insurers, ${amount(figures.outstandingPatient, currency)} by patients; ${formatNumber(figures.openBills)} bills not fully paid`}
      />
    </dl>
  );
}

export function RevenuePage({ data }: { data: RevenueFeedResponse }) {
  const { currency, days } = data;
  const daily = new Map<string, { gross: number; collected: number }>();
  for (const hospital of data.hospitals) {
    for (const row of hospital.daily) {
      const total = daily.get(row.day) ?? { gross: 0, collected: 0 };
      daily.set(row.day, { gross: total.gross + row.gross, collected: total.collected + row.collected });
    }
  }
  const recent = [...daily.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);

  return (
    <>
      <title>Hospital revenue | Orbit</title>
      <SurfaceHeading
        eyebrow="Hospital operations"
        title="Hospital revenue"
        description={`What the hospital operations system billed and collected, for the hospitals in your scope. Amounts in ${currency} only: no patient or bill is named here. This is the live billing system, shown apart from the KPI scorecard.`}
      />
      <Disclosure text={data.disclosure} />
      <p className="orbit-meta">As of {formatDateTime(data.asOf)}. Billing is simulated: bills come from the demonstration's own visits, priced from the reference dataset.</p>

      {data.hospitals.length === 0 ? (
        <p className="workspace-empty">Your scope covers no hospital with billing data.</p>
      ) : (
        <>
          <section aria-labelledby="revenue-total">
            <h2 id="revenue-total">
              {data.hospitals.length === 1 ? data.hospitals[0]?.name : `All ${data.hospitals.length} hospitals in your scope`}
            </h2>
            <Figures figures={data.totals} currency={currency} days={days} />
          </section>

          <section aria-labelledby="revenue-daily">
            <h2 id="revenue-daily">Last 14 days</h2>
            <ScrollRegion label="Revenue by day">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col" data-numeric="true">Billed</th>
                    <th scope="col" data-numeric="true">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(([day, row]) => (
                    <tr key={day}>
                      <th scope="row">{formatDay(day)}</th>
                      <td data-numeric="true">{amount(row.gross, currency)}</td>
                      <td data-numeric="true">{amount(row.collected, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          {data.hospitals.length > 1 ? (
            <section aria-labelledby="revenue-by-hospital">
              <h2 id="revenue-by-hospital">By hospital</h2>
              <ScrollRegion label="Hospitals">
                <table className="workspace-table">
                  <caption>Last {days} days, and what is still owed on every bill</caption>
                  <thead>
                    <tr>
                      <th scope="col">Hospital</th>
                      <th scope="col" data-numeric="true">Bills</th>
                      <th scope="col" data-numeric="true">Billed</th>
                      <th scope="col" data-numeric="true">Collected</th>
                      <th scope="col" data-numeric="true">Owed by insurers</th>
                      <th scope="col" data-numeric="true">Owed by patients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hospitals.map((hospital) => (
                      <tr key={hospital.facilityId}>
                        <th scope="row">{hospital.name}</th>
                        <td data-numeric="true">{formatNumber(hospital.figures.bills)}</td>
                        <td data-numeric="true">{amount(hospital.figures.gross, currency)}</td>
                        <td data-numeric="true">{amount(hospital.figures.collected, currency)}</td>
                        <td data-numeric="true">{amount(hospital.figures.outstandingInsurer, currency)}</td>
                        <td data-numeric="true">{amount(hospital.figures.outstandingPatient, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

export function RevenueRoute() {
  return <RevenuePage data={useLoaderData<RevenueFeedResponse>()} />;
}
