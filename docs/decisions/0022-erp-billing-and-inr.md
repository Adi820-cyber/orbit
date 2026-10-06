# ADR 0022: Billing in the ERP, and one currency (INR)

**Status:** Accepted (2026-10-06, product owner)
**Changes:** ERP_PLAN decision D7 ("billing/invoicing… No") and ADR 0016's non-goals, which said every addition needs its own ADR. This is that ADR.
**Builds on:** ADR 0016 (ERP), ADR 0018 (Orbit uses ERP data), ADR 0019 (knowledge chatbot), ADR 0020 (reference datasets)

## Context

The ERP recorded visits and the services delivered, but nothing turned them into money. Leaders saw KPI revenue, which is monthly synthetic history, but no live revenue from the hospitals. The product owner asked for billing to calculate revenue, and decided three things on 2026-10-06:

1. **Currency: INR for everything.** The reference hospital dataset's amounts are rupees (₹68,483 bills, UPI payments). Converting them to the previous USD would have needed an invented exchange rate.
2. **Scope: full.** Prices, bills, insurance cover, payments, revenue reporting, and revenue flowing to Orbit's leaders and the Assistant.
3. **Permissions:** desk staff issue bills and record payments for their own hospital. Only an admin sets prices or cancels a bill.

## Decisions

### §1 One currency

`orbit.organizations.currency` is INR for Kestrion (migration `20261006000100`). The data generator's manifest is INR. KPI seeds `0005`–`0007` were regenerated: only the currency labels and the dataset checksum change, and every figure is identical (13,800 observations, 80 exceptions, 224 on-track). The opening amounts in the manifest are kept as fictional anchors, not converted.

### §2 Prices come from the data, or from an admin

The price list is `facility_services.illustrative_tariff`, per hospital and service, in the organization currency. The reference loader fills it from the hospital dataset (`derivePrices`, seed `0207_prices.sql`, only where no price is set):

| Service | Source | Price |
|---|---|---|
| Lab and imaging tests | median `standard_cost` of the dataset's tests of that kind | ₹1,328 to ₹4,852 |
| Ward day / ICU day | median Room charge divided by length of stay, by ward type | ₹5,005 / ₹5,051 |
| Minor, orthopaedic, surgical procedure | median Procedure charge, by department | ₹15,111 to ₹15,248 |

Consultation, specialist consultation, emergency assessment, ECG, cardiac catheter, oncology day-care and rehabilitation are **not priced anywhere in the data**, so none is invented. An admin sets them on the Services page. Until then a visit that used one cannot be billed. The bill is refused, naming the services, and the Revenue page lists what is unpriced.

### §3 Bills, cover and payments (migration `20261006000200`)

- **Cover** (`patient_coverage`): one per patient, kept apart from `patients`, which holds no insurance fields by design. It records:
  - the payer type (self-pay, government, private);
  - an optional fictional name;
  - the percentage covered.
- **Bills** (`bills`, `bill_lines`):
  - Only for a **closed** visit. A bill covers its completed services that are not already on a standing bill, priced at issue time.
  - Amounts are **frozen**: the insurer and patient shares come from the cover at that moment.
  - Issuing is idempotent per key and runs as the caller (`issue_bill`, security invoker), so row-level security bounds every row.
  - A service on a standing bill cannot be cancelled.
- **Payments** (`payments`, append-only):
  - A patient pays by cash, card, UPI or bank transfer; an insurer by settlement.
  - A payment is never more than that payer still owes. Payments to one bill are serialised so two at once cannot both fit.
  - Payment state (unpaid, part-paid, paid, cancelled) is derived, never stored.
- **Admin-only:** changing a price (a trigger binding the API's role) and cancelling a bill (only one with no payment). Both are also checked by the API.
- All four tables enable and force row-level security, using the per-statement policy forms of `20261001000500`. Every write is audited (`coverage`, `bill`, `payment`).

### §4 ERP pages

- **Billing:** open, paid and cancelled bills, with search.
- **Bill:** lines, the payer split, payments, separate patient and insurer payment forms, and an admin cancel.
- **Revenue:** 7, 30 or 90 days. Billed, collected, each payer's share, still owed, day by day, by service type and by payment method, and the unpriced services.
- **Visit:** an "Issue bill" button once the visit is closed.
- **Patient:** insurance cover.
- **Services:** the admin edits prices.

### §5 Orbit: leaders and the Assistant

- `GET /api/revenue` returns per-hospital revenue **aggregates** for `REVENUE_FEED_ROLES`: chairman, regional COO, hospital DHO, group CFO, billing lead and corporate revenue lead. `orbit_erp.revenue_feed()` is bounded exactly like the operations feed (`ops_visible_facilities`): a leader's claims, own organization, and hospitals inside the verified scope. Amounts only; no patient or bill is named. Orbit shows it as **Hospital revenue**, apart from the KPI scorecard and never merged with it.
- `orbit.knowledge_refresh_billing()` writes one billing summary per hospital, region and the group (source `erp:billing`, domain `hospital-billing`). Finance and operations leaders are granted that domain; the chairman reads every domain. The knowledge sync runs it after `knowledge_refresh()`.

### §6 The simulator bills too

New patients get the dataset's mix of cover: 60% insured, 59.7% of those government, each covering 50 to 90%. A closed visit is billed. Most patients pay at the desk, by cash, card or UPI as often as each other; others pay within a few days and some leave it owed. Insurers settle after 2 to 10 days. A visit with an unpriced service is counted as `unbillable`, not as a failure.

## Verification (2026-10-06)

- **Database:** all 23 migrations apply to a fresh database. The API's database integration suite runs as `orbit_app` against it, with new billing tests covering:
  - admin-only prices;
  - cover kept within the hospital;
  - the bill's split, replay and "already billed";
  - isolation from another hospital;
  - payments capped at what is owed;
  - no cancelling a paid bill or a billed service;
  - unpriced services named;
  - revenue for the hospital, the leader feed for the chairman, and nothing for an operator's claims.

  **473 API tests pass with none skipped**, including the existing row-level security and source isolation suites run against a seeded copy.
- **Data generation:** `derivePrices` tests: tests from standard cost, stays per day with ICU apart, unpriced services left unpriced.
- **Simulator:** cover mix, bill once with replay, insurer settlement and patient payment never above what is owed, unpriced visits counted as unbillable.

## Limits

- One cover per patient: a change applies to bills issued afterwards. There are no claims workflow, refunds, credit notes, discounts or taxes.
- Revenue counts a bill on the day it is issued and a payment on the day it is received, in the organization's time zone.
- The ERP's live revenue and the KPI scorecard's revenue are different things: the first is the simulated hospitals' bills, the second the synthetic monthly history. They are shown apart.
