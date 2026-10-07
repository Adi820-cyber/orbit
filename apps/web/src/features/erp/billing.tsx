import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useSearchParams, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import type { BillableVisit, BillableVisitListResponse, BillListResponse, BillResponse, Coverage, PaymentState, RevenueResponse } from "@orbit/contracts";
import { formText } from "../../lib/form";
import { ScrollRegion, SurfaceHeading } from "../workspace/components";
import { mutate, withClient, type WorkspaceEnvironment } from "../workspace/environment";
import { ErpBack } from "./back";
import { erpMutation, type ErpActionResult } from "./home";
import { day, ErpDisclosure, facilityFromUrl, Field, FormMessage, label, money, Pager, todayUtc, useErp, useErpHref, when } from "./shared";

/*
 * Billing (ADR 0022): the bill list, one bill with its payments, and revenue.
 * Every amount is illustrative; the server re-checks every rule (who may
 * cancel, how much a payer still owes) and the database again.
 */

const STATE_CHIP: Record<PaymentState, { text: string; state: string }> = {
  unpaid: { text: "Unpaid", state: "late" },
  "part-paid": { text: "Part paid", state: "missing" },
  paid: { text: "Paid", state: "ready" },
  cancelled: { text: "Cancelled", state: "unavailable" },
};

export function PaymentChip({ state }: { state: PaymentState }) {
  const chip = STATE_CHIP[state];
  return <span className="orbit-status" data-state={chip.state}>{chip.text}</span>;
}

function payerText(bill: { payerType: string; payerName: string | null; coveragePercent: number }) {
  if (bill.payerType === "self-pay") return "Self-pay";
  return `${label(bill.payerType)} cover${bill.payerName ? `, ${bill.payerName}` : ""} (${bill.coveragePercent}%)`;
}

// ---------------------------------------------------------------------------
// Bill list
// ---------------------------------------------------------------------------

const STATES = [
  { value: "open", text: "Open" },
  { value: "paid", text: "Paid" },
  { value: "cancelled", text: "Cancelled" },
  { value: "all", text: "All" },
] as const;

export function billsLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<BillListResponse> => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "open";
    return withClient(environment, request, (client) =>
      client.erp.bills({
        facilityId: facilityFromUrl(request),
        state: state === "all" ? undefined : state,
        q: url.searchParams.get("q")?.trim() || undefined,
        page: url.searchParams.get("page") ?? undefined,
      }),
    );
  };
}

export function BillsRoute() {
  const data = useLoaderData<BillListResponse>();
  const { facilityName, facilityId } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const state = search.get("state") ?? "open";
  const q = search.get("q") ?? "";

  return (
    <>
      <title>Billing | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="Billing"
        description="Bills for closed visits, what each payer owes, and payments received."
        aside={<Link className="orbit-button" to={href("/billing/new")}>New bill</Link>}
      />
      <ErpDisclosure />
      <nav className="erp-toolbar" aria-label="Bill status">
        {STATES.map((option) => (
          <Link
            key={option.value}
            className="orbit-button"
            data-variant={state === option.value ? undefined : "secondary"}
            aria-current={state === option.value ? "page" : undefined}
            to={href("/billing", { state: option.value, q: q || undefined })}
          >
            {option.text}
          </Link>
        ))}
      </nav>
      <Form method="get" className="erp-toolbar">
        {search.get("facility") ? <input type="hidden" name="facility" value={search.get("facility") ?? ""} /> : null}
        <input type="hidden" name="state" value={state} />
        <Field label="Bill number or patient name">
          <input className="orbit-input" type="search" name="q" defaultValue={q} maxLength={80} />
        </Field>
        <button className="orbit-button" data-variant="secondary" type="submit">Search</button>
      </Form>

      {data.items.length ? (
        <ScrollRegion label="Bills">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Bill</th>
                <th scope="col">Patient</th>
                <th scope="col">Issued</th>
                <th scope="col">Payer</th>
                <th scope="col" data-numeric="true">Amount</th>
                <th scope="col" data-numeric="true">Still owed</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((bill) => (
                <tr key={bill.billId}>
                  <th scope="row">
                    <Link className="workspace-inline-link" to={href(`/billing/${bill.billId}`)}>{bill.billNumber}</Link>
                  </th>
                  <td>
                    {bill.patientName}
                    <span className="erp-sub">{bill.mrn}</span>
                  </td>
                  <td>{when(bill.issuedAt)}</td>
                  <td>{payerText(bill)}</td>
                  <td data-numeric="true"><span className="is-illustrative">{money(bill.grossAmount, data.currency)}</span></td>
                  <td data-numeric="true"><span className="is-illustrative">{money(bill.balance, data.currency)}</span></td>
                  <td><PaymentChip state={bill.paymentState} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">{q ? "No bill matches that search." : "No bills here yet."}</p>
      )}
      <Pager
        page={data.page.page}
        pageSize={data.page.pageSize}
        total={data.page.total}
        href={(page) => href("/billing", { state, q: q || undefined, page: String(page) })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// New bill: closed visits with services still to bill
// ---------------------------------------------------------------------------

export function billableLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<BillableVisitListResponse> =>
    withClient(environment, request, (client) =>
      client.erp.billableVisits({
        facilityId: facilityFromUrl(request),
        page: new URL(request.url).searchParams.get("page") ?? undefined,
      }),
    );
}

/** Generates the bill for one visit, then opens it. */
export function billableAction(environment: WorkspaceEnvironment) {
  return async ({ request }: ActionFunctionArgs): Promise<ErpActionResult | Response> => {
    const form = await request.formData();
    const issued = await mutate(environment, request, (client) =>
      client.erp.issueBill(formText(form, "encounterId"), { idempotencyKey: formText(form, "idempotencyKey") }),
    );
    if (!issued.ok) return issued;
    const facility = facilityFromUrl(request);
    return redirect(`/erp/billing/${encodeURIComponent(issued.value.bill.billId)}${facility ? `?facility=${encodeURIComponent(facility)}` : ""}`);
  };
}

function GenerateButton({ visit, currency }: { visit: BillableVisit; currency: string }) {
  // Fixed per render: a double click replays the same bill instead of issuing two.
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Form method="post" className="erp-inline-form">
      <input type="hidden" name="encounterId" value={visit.encounterId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <button className="orbit-button" type="submit" aria-label={`Generate bill for ${visit.patientName}, ${money(visit.amount ?? 0, currency)}`}>
        <span aria-hidden="true">Generate bill</span>
      </button>
    </Form>
  );
}

export function BillableRoute() {
  const data = useLoaderData<BillableVisitListResponse>();
  const result = useActionData<ErpActionResult>();
  const { facilityName, facilityId, isAdmin } = useErp();
  const href = useErpHref();

  return (
    <>
      <title>New bill | Orbit hospital operations</title>
      <ErpBack to={href("/billing")} />
      <SurfaceHeading
        eyebrow={facilityName(facilityId)}
        title="New bill"
        description={`Closed visits from the last ${data.days} days with services still to bill. Generating a bill prices them from this hospital's price list and splits the amount by the patient's insurance cover.`}
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      {data.items.length ? (
        <ScrollRegion label="Visits ready to bill">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Visit</th>
                <th scope="col">Closed</th>
                <th scope="col" data-numeric="true">Services</th>
                <th scope="col" data-numeric="true">Amount</th>
                <th scope="col"><span className="orbit-visually-hidden">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((visit) => (
                <tr key={visit.encounterId}>
                  <th scope="row">
                    <Link className="workspace-inline-link" to={href(`/visits/${visit.encounterId}`)}>{visit.patientName}</Link>
                    <span className="erp-sub">{visit.mrn}</span>
                  </th>
                  <td>{label(visit.encounterType)}</td>
                  <td>{when(visit.endedAt)}</td>
                  <td data-numeric="true">{visit.items}</td>
                  <td data-numeric="true">
                    {visit.amount === null ? "—" : <span className="is-illustrative">{money(visit.amount, data.currency)}</span>}
                  </td>
                  <td>
                    {visit.amount === null ? (
                      <span className="erp-sub">
                        No price set for {visit.unpricedServices.join(", ")}.{" "}
                        {isAdmin ? <Link className="workspace-inline-link" to={href("/services")}>Set a price</Link> : "An admin sets prices."}
                      </span>
                    ) : (
                      <GenerateButton visit={visit} currency={data.currency} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <p className="workspace-empty">Every visit closed in the last {data.days} days is billed. A visit appears here once it is closed with services on it.</p>
      )}
      <Pager page={data.page.page} pageSize={data.page.pageSize} total={data.page.total} href={(page) => href("/billing/new", { page: String(page) })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One bill
// ---------------------------------------------------------------------------

export function billDetailLoader(environment: WorkspaceEnvironment) {
  return async ({ request, params }: LoaderFunctionArgs): Promise<BillResponse> =>
    withClient(environment, request, (client) => client.erp.bill(params["billId"] ?? ""));
}

export function billDetailAction(environment: WorkspaceEnvironment) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ErpActionResult> => {
    const form = await request.formData();
    const billId = params["billId"] ?? "";
    switch (formText(form, "intent")) {
      case "pay": {
        const payer = formText(form, "payer");
        const reference = formText(form, "reference").trim();
        return erpMutation(
          environment,
          request,
          (client) =>
            client.erp.recordPayment(billId, {
              payer,
              method: payer === "insurer" ? "insurance-settlement" : formText(form, "method"),
              amount: Math.round(Number(formText(form, "amount")) * 100) / 100,
              idempotencyKey: formText(form, "idempotencyKey"),
              ...(reference ? { reference } : {}),
            }),
          payer === "insurer" ? "Insurer settlement recorded." : "Patient payment recorded.",
        );
      }
      case "cancel":
        return erpMutation(
          environment,
          request,
          (client) => client.erp.cancelBill(billId, { version: Number(formText(form, "version")), reason: formText(form, "reason") }),
          "Bill cancelled.",
        );
      default:
        return { ok: false, code: "invalid_request", message: "Unknown request." };
    }
  };
}

function PaymentForm({
  payer,
  owed,
  currency,
}: {
  payer: "patient" | "insurer";
  owed: number;
  currency: string;
}) {
  // Fixed per render: a double submit replays instead of paying twice.
  const [key] = useState(() => crypto.randomUUID());
  const headingId = `${payer}-payment-heading`;
  return (
    <section className="workspace-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{payer === "insurer" ? "Insurer settlement" : "Patient payment"}</h2>
      <p className="erp-sub">Still owed: <span className="is-illustrative">{money(owed, currency)}</span></p>
      <Form method="post" className="erp-form-grid">
        <input type="hidden" name="intent" value="pay" />
        <input type="hidden" name="payer" value={payer} />
        <input type="hidden" name="idempotencyKey" value={key} />
        {payer === "patient" ? (
          <Field label="Method">
            <select className="orbit-select" name="method" defaultValue="upi">
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank-transfer">Bank transfer</option>
            </select>
          </Field>
        ) : null}
        <Field label={`Amount (${currency})`} hint="Up to what this payer still owes.">
          <input className="orbit-input" type="number" name="amount" min={0.01} max={owed} step="0.01" defaultValue={owed.toFixed(2)} required />
        </Field>
        <Field label="Reference (optional)" hint={payer === "insurer" ? "Claim or settlement reference." : "Receipt or transaction reference."}>
          <input className="orbit-input" type="text" name="reference" maxLength={60} />
        </Field>
        <button className="orbit-button" type="submit">Record payment</button>
      </Form>
    </section>
  );
}

export function BillDetailRoute() {
  const { bill, currency } = useLoaderData<BillResponse>();
  const result = useActionData<ErpActionResult>();
  const { facilityName, isAdmin } = useErp();
  const href = useErpHref();
  const standing = bill.status === "issued";
  const owedByPatient = Math.max(0, Math.round((bill.patientAmount - bill.paidByPatient) * 100) / 100);
  const owedByInsurer = Math.max(0, Math.round((bill.insuranceAmount - bill.paidByInsurer) * 100) / 100);

  return (
    <>
      <title>{`Bill ${bill.billNumber} | Orbit hospital operations`}</title>
      <ErpBack to={href("/billing")} />
      <SurfaceHeading
        eyebrow={`Bill · ${facilityName(bill.facilityId)}`}
        title={bill.billNumber}
        description={`${bill.patientName} (${bill.mrn}). Issued ${when(bill.issuedAt)}${bill.cancelledAt ? `, cancelled ${when(bill.cancelledAt)}` : ""}.`}
        aside={<PaymentChip state={bill.paymentState} />}
      />
      <ErpDisclosure />
      <FormMessage result={result} />
      <p className="erp-links">
        <Link className="workspace-inline-link" to={href(`/visits/${bill.encounterId}`)}>Visit</Link>
        <Link className="workspace-inline-link" to={href(`/patients/${bill.patientId}`)}>Patient record</Link>
      </p>
      {bill.cancelReason ? <p className="workspace-empty">Cancelled: {bill.cancelReason}</p> : null}

      <section className="workspace-section" aria-labelledby="amounts-heading">
        <div className="workspace-section__heading">
          <h2 id="amounts-heading">Amounts</h2>
          <p>{payerText(bill)}. Fixed when the bill was issued.</p>
        </div>
        <div className="erp-tiles">
          <div className="erp-tile"><span className="erp-tile__value is-illustrative">{money(bill.grossAmount, currency)}</span><span className="erp-tile__label">Total</span></div>
          <div className="erp-tile"><span className="erp-tile__value is-illustrative">{money(bill.insuranceAmount, currency)}</span><span className="erp-tile__label">Insurer share</span></div>
          <div className="erp-tile"><span className="erp-tile__value is-illustrative">{money(bill.patientAmount, currency)}</span><span className="erp-tile__label">Patient share</span></div>
          <div className="erp-tile" data-tone={bill.balance > 0 ? "attention" : undefined}>
            <span className="erp-tile__value is-illustrative">{money(bill.balance, currency)}</span>
            <span className="erp-tile__label">Still owed</span>
          </div>
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="lines-heading">
        <div className="workspace-section__heading">
          <h2 id="lines-heading">Services billed</h2>
        </div>
        <ScrollRegion label="Services billed">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col" data-numeric="true">Qty</th>
                <th scope="col" data-numeric="true">Price</th>
                <th scope="col" data-numeric="true">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.lineId}>
                  <th scope="row">{line.description}</th>
                  <td data-numeric="true">{line.quantity}</td>
                  <td data-numeric="true"><span className="is-illustrative">{money(line.unitPrice, currency)}</span></td>
                  <td data-numeric="true"><span className="is-illustrative">{money(line.lineAmount, currency)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section className="workspace-section" aria-labelledby="payments-heading">
        <div className="workspace-section__heading">
          <h2 id="payments-heading">Payments</h2>
          <p>
            Patient paid <span className="is-illustrative">{money(bill.paidByPatient, currency)}</span>; insurer paid{" "}
            <span className="is-illustrative">{money(bill.paidByInsurer, currency)}</span>.
          </p>
        </div>
        {bill.payments.length ? (
          <ScrollRegion label="Payments">
            <table className="workspace-table erp-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">From</th>
                  <th scope="col">Method</th>
                  <th scope="col">Reference</th>
                  <th scope="col" data-numeric="true">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bill.payments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <td>{when(payment.receivedAt)}</td>
                    <td>{label(payment.payer)}</td>
                    <td>{payment.method === "upi" ? "UPI" : label(payment.method)}</td>
                    <td>{payment.reference ?? "—"}</td>
                    <td data-numeric="true"><span className="is-illustrative">{money(payment.amount, currency)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          <p className="workspace-empty">No payment recorded yet.</p>
        )}
      </section>

      {standing && (owedByPatient > 0 || owedByInsurer > 0) ? (
        <div className="erp-two-column">
          {owedByPatient > 0 ? <PaymentForm payer="patient" owed={owedByPatient} currency={currency} /> : null}
          {owedByInsurer > 0 ? <PaymentForm payer="insurer" owed={owedByInsurer} currency={currency} /> : null}
        </div>
      ) : null}

      {standing && isAdmin && bill.payments.length === 0 ? (
        <section className="workspace-panel" aria-labelledby="cancel-heading">
          <h2 id="cancel-heading">Cancel this bill</h2>
          <p className="erp-sub">Only a bill with no payment can be cancelled. Its services can then be billed again.</p>
          <Form method="post" className="erp-form-grid">
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="version" value={bill.version} />
            <Field label="Reason">
              <input className="orbit-input" type="text" name="reason" minLength={3} maxLength={500} required />
            </Field>
            <button className="orbit-button" data-variant="danger" type="submit">Cancel bill</button>
          </Form>
        </section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

const PERIODS = [7, 30, 90] as const;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function revenueLoader(environment: WorkspaceEnvironment) {
  return async ({ request }: LoaderFunctionArgs): Promise<RevenueResponse> => {
    const requested = Number(new URL(request.url).searchParams.get("days"));
    const days = (PERIODS as readonly number[]).includes(requested) ? requested : 30;
    const to = todayUtc();
    return withClient(environment, request, (client) =>
      client.erp.revenue({ facilityId: facilityFromUrl(request), from: addDays(to, -(days - 1)), to }),
    );
  };
}

function Figure({ value, text, tone }: { value: string; text: string; tone?: "attention" }) {
  return (
    <div className="erp-tile" data-tone={tone}>
      <span className="erp-tile__value is-illustrative">{value}</span>
      <span className="erp-tile__label">{text}</span>
    </div>
  );
}

export function RevenueRoute() {
  const report = useLoaderData<RevenueResponse>();
  const { facilityName, isAdmin } = useErp();
  const href = useErpHref();
  const [search] = useSearchParams();
  const days = Number(search.get("days")) || 30;
  const { totals, currency } = report;
  const peak = Math.max(1, ...report.daily.map((row) => Math.max(row.gross, row.collected)));
  const scopeName = report.facilityId ? facilityName(report.facilityId) : "All hospitals";

  return (
    <>
      <title>Revenue | Orbit hospital operations</title>
      <SurfaceHeading
        eyebrow={scopeName}
        title="Revenue"
        description={`Billed and collected from ${day(report.from)} to ${day(report.to)}, and what is still owed on every bill. Illustrative amounts in ${currency}.`}
      />
      <ErpDisclosure />
      <nav className="erp-toolbar" aria-label="Period">
        {PERIODS.map((period) => (
          <Link
            key={period}
            className="orbit-button"
            data-variant={days === period ? undefined : "secondary"}
            aria-current={days === period ? "page" : undefined}
            to={href("/revenue", { days: String(period) })}
          >
            Last {period} days
          </Link>
        ))}
      </nav>

      {report.unpricedServices.length ? (
        <p className="erp-note" role="note">
          {report.unpricedServices.length} offered {report.unpricedServices.length === 1 ? "service has" : "services have"} no price yet (
          {report.unpricedServices.map((service) => service.name).join(", ")}). Visits using them cannot be billed until{" "}
          {isAdmin ? <Link className="workspace-inline-link" to={href("/services")}>you set a price</Link> : "an admin sets a price"}.
        </p>
      ) : null}

      <section className="workspace-section" aria-labelledby="totals-heading">
        <div className="workspace-section__heading">
          <h2 id="totals-heading">In this period</h2>
        </div>
        <div className="erp-tiles">
          <Figure value={money(totals.gross, currency)} text={`Billed (${totals.bills} ${totals.bills === 1 ? "bill" : "bills"})`} />
          <Figure value={money(totals.collected, currency)} text="Collected" />
          <Figure value={money(totals.insurance, currency)} text="Insurer share billed" />
          <Figure value={money(totals.patient, currency)} text="Patient share billed" />
          <Figure value={money(totals.collectedFromPatients, currency)} text="Collected from patients" />
          <Figure value={money(totals.collectedFromInsurers, currency)} text="Collected from insurers" />
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="owed-heading">
        <div className="workspace-section__heading">
          <h2 id="owed-heading">Still owed now</h2>
          <p>On every standing bill, whenever it was issued.</p>
        </div>
        <div className="erp-tiles">
          <Figure value={money(totals.outstandingPatient, currency)} text="By patients" tone={totals.outstandingPatient > 0 ? "attention" : undefined} />
          <Figure value={money(totals.outstandingInsurer, currency)} text="By insurers" tone={totals.outstandingInsurer > 0 ? "attention" : undefined} />
          <Link className="erp-tile" to={href("/billing", { state: "open" })}>
            <span className="erp-tile__value is-illustrative">{totals.openBills}</span>
            <span className="erp-tile__label">Bills not fully paid</span>
          </Link>
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="daily-heading">
        <div className="workspace-section__heading">
          <h2 id="daily-heading">Day by day</h2>
        </div>
        <ScrollRegion label="Revenue day by day">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" data-numeric="true">Bills</th>
                <th scope="col" data-numeric="true">Billed</th>
                <th scope="col" data-numeric="true">Collected</th>
                <th scope="col"><span className="orbit-visually-hidden">Billed and collected, relative</span></th>
              </tr>
            </thead>
            <tbody>
              {[...report.daily].reverse().map((row) => (
                <tr key={row.day}>
                  <th scope="row">{day(row.day)}</th>
                  <td data-numeric="true">{row.bills}</td>
                  <td data-numeric="true"><span className="is-illustrative">{money(row.gross, currency)}</span></td>
                  <td data-numeric="true"><span className="is-illustrative">{money(row.collected, currency)}</span></td>
                  <td aria-hidden="true" className="erp-bars">
                    <span className="erp-bar" data-kind="billed" style={{ width: `${(row.gross / peak) * 100}%` }} />
                    <span className="erp-bar" data-kind="collected" style={{ width: `${(row.collected / peak) * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <div className="erp-two-column">
        <section className="workspace-panel" aria-labelledby="category-heading">
          <h2 id="category-heading">Billed by service type</h2>
          {report.byCategory.length ? (
            <table className="workspace-table erp-table">
              <thead>
                <tr><th scope="col">Type</th><th scope="col" data-numeric="true">Lines</th><th scope="col" data-numeric="true">Amount</th></tr>
              </thead>
              <tbody>
                {report.byCategory.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{label(row.category)}</th>
                    <td data-numeric="true">{row.lines}</td>
                    <td data-numeric="true"><span className="is-illustrative">{money(row.amount, currency)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="workspace-empty">Nothing billed in this period.</p>
          )}
        </section>
        <section className="workspace-panel" aria-labelledby="method-heading">
          <h2 id="method-heading">Collected by method</h2>
          {report.byMethod.length ? (
            <table className="workspace-table erp-table">
              <thead>
                <tr><th scope="col">Method</th><th scope="col" data-numeric="true">Payments</th><th scope="col" data-numeric="true">Amount</th></tr>
              </thead>
              <tbody>
                {report.byMethod.map((row) => (
                  <tr key={row.method}>
                    <th scope="row">{row.method === "upi" ? "UPI" : label(row.method)}</th>
                    <td data-numeric="true">{row.payments}</td>
                    <td data-numeric="true"><span className="is-illustrative">{money(row.amount, currency)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="workspace-empty">Nothing collected in this period.</p>
          )}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces used on the patient and visit pages
// ---------------------------------------------------------------------------

/** The patient's insurance cover, with a form to change it (intent `coverage`). */
export function CoveragePanel({ coverage }: { coverage: Coverage }) {
  const [payerType, setPayerType] = useState(coverage.payerType);
  const selfPay = payerType === "self-pay";
  return (
    <section className="workspace-panel" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">Insurance cover</h2>
      <p className="erp-sub">
        {coverage.version === null ? "No cover recorded: bills are self-pay." : `Now: ${payerText(coverage)}.`} A bill keeps the cover it was issued with.
      </p>
      <Form method="post" className="erp-form-grid">
        <input type="hidden" name="intent" value="coverage" />
        {coverage.version === null ? null : <input type="hidden" name="version" value={coverage.version} />}
        <Field label="Payer">
          <select className="orbit-select" name="payerType" value={payerType} onChange={(event) => setPayerType(event.target.value as Coverage["payerType"])}>
            <option value="self-pay">Self-pay</option>
            <option value="government">Government scheme</option>
            <option value="private">Private insurer</option>
          </select>
        </Field>
        {selfPay ? null : (
          <>
            <Field label="Insurer or scheme name (optional)" hint="Fictional name only.">
              <input className="orbit-input" name="payerName" maxLength={120} defaultValue={coverage.payerName ?? ""} />
            </Field>
            <Field label="Share covered (%)">
              <input className="orbit-input" type="number" name="coveragePercent" min={1} max={100} step="0.01" defaultValue={coverage.coveragePercent || 60} required />
            </Field>
          </>
        )}
        <button className="orbit-button" data-variant="secondary" type="submit">Save cover</button>
      </Form>
    </section>
  );
}

/** The visit's bills, and issuing one once the visit is closed (intent `issue-bill`). */
export function VisitBilling({ bills, visitStatus, completedServices }: { bills: BillListResponse; visitStatus: string; completedServices: number }) {
  const href = useErpHref();
  const [key] = useState(() => crypto.randomUUID());
  const standing = bills.items.filter((bill) => bill.status === "issued");
  const canBill = visitStatus === "closed" && completedServices > 0;
  return (
    <section className="workspace-section" aria-labelledby="billing-heading">
      <div className="workspace-section__heading">
        <h2 id="billing-heading">Billing</h2>
        <p>
          {visitStatus === "open"
            ? "Close the visit to bill it. Prices come from this hospital's price list."
            : visitStatus === "cancelled"
              ? "A cancelled visit is not billed."
              : "Prices come from this hospital's price list; the patient's cover splits the amount."}
        </p>
      </div>
      {bills.items.length ? (
        <ScrollRegion label="Bills for this visit">
          <table className="workspace-table erp-table">
            <thead>
              <tr>
                <th scope="col">Bill</th>
                <th scope="col">Issued</th>
                <th scope="col" data-numeric="true">Amount</th>
                <th scope="col" data-numeric="true">Still owed</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.items.map((bill) => (
                <tr key={bill.billId}>
                  <th scope="row"><Link className="workspace-inline-link" to={href(`/billing/${bill.billId}`)}>{bill.billNumber}</Link></th>
                  <td>{when(bill.issuedAt)}</td>
                  <td data-numeric="true"><span className="is-illustrative">{money(bill.grossAmount, bills.currency)}</span></td>
                  <td data-numeric="true"><span className="is-illustrative">{money(bill.balance, bills.currency)}</span></td>
                  <td><PaymentChip state={bill.paymentState} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      ) : null}
      {canBill ? (
        <Form method="post" className="erp-inline-form">
          <input type="hidden" name="intent" value="issue-bill" />
          <input type="hidden" name="idempotencyKey" value={key} />
          <button className="orbit-button" data-variant={standing.length ? "secondary" : undefined} type="submit">
            {standing.length ? "Bill services added since" : "Issue bill"}
          </button>
        </Form>
      ) : null}
    </section>
  );
}
