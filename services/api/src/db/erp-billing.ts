import { CurrencyCodeSchema, type OperatorClaims } from '@orbit/contracts';
import type { BillingStore, ErpWrite } from '../modules/erp/ports.ts';
import { ApiError } from '../plugins/errors.ts';
import type { SqlParam, Tx } from './client.ts';
import { audit, iso, one, page, staleOrMissing } from './erp-sql.ts';

/*
 * Postgres BillingStore (migration 20261006000200, ADR 0022).
 *
 * Runs inside the same operator transaction as the rest of the ERP store
 * (`run` from createDbErpStore), so RLS decides what each operator sees and
 * the database rules (issue_bill, payment and bill triggers) decide what is
 * allowed. Writes and their audit rows commit together. Money leaves the
 * database as float8 with two decimals.
 */

type Run = <T>(operator: OperatorClaims, fn: (tx: Tx) => Promise<T>) => Promise<T>;

const money = (column: string) => `round(coalesce(${column}, 0), 2)::float8`;

/** One row per bill, with what each payer has paid and the derived payment state. */
const BILL_SELECT = `
select
  b.id::text as "billId",
  b.bill_number as "billNumber",
  b.facility_id::text as "facilityId",
  b.encounter_id::text as "encounterId",
  b.patient_id::text as "patientId",
  coalesce(p.display_name, 'Not visible') as "patientName",
  coalesce(p.mrn, 'Not visible') as "mrn",
  b.status as "status",
  case
    when b.status = 'cancelled' then 'cancelled'
    when coalesce(pp.patient_paid, 0) + coalesce(pp.insurer_paid, 0) >= b.gross_amount then 'paid'
    when coalesce(pp.patient_paid, 0) + coalesce(pp.insurer_paid, 0) > 0 then 'part-paid'
    else 'unpaid'
  end as "paymentState",
  b.payer_type as "payerType",
  b.payer_name as "payerName",
  b.coverage_percent::float8 as "coveragePercent",
  ${money('b.gross_amount')} as "grossAmount",
  ${money('b.insurance_amount')} as "insuranceAmount",
  ${money('b.patient_amount')} as "patientAmount",
  ${money('pp.patient_paid')} as "paidByPatient",
  ${money('pp.insurer_paid')} as "paidByInsurer",
  case when b.status = 'cancelled' then 0
       else ${money('b.gross_amount - coalesce(pp.patient_paid, 0) - coalesce(pp.insurer_paid, 0)')} end as "balance",
  ${iso('b.issued_at')} as "issuedAt",
  ${iso('b.cancelled_at')} as "cancelledAt",
  b.version as "version",
  b.cancel_reason as "cancelReason"
from orbit_erp.bills b
left join orbit_erp.patients p on p.id = b.patient_id
left join lateral (
  select sum(py.amount) filter (where py.payer = 'patient') as patient_paid,
         sum(py.amount) filter (where py.payer = 'insurer') as insurer_paid
  from orbit_erp.payments py where py.bill_id = b.id
) pp on true`;

const COVERAGE_COLUMNS = `
  c.patient_id::text as "patientId",
  c.payer_type as "payerType",
  c.payer_name as "payerName",
  c.coverage_percent::float8 as "coveragePercent",
  c.version as "version"`;

async function selectBillDetail(tx: Tx, billId: string): Promise<Record<string, unknown> | null> {
  const bill = await one(tx, `${BILL_SELECT} where b.id = $1::uuid`, [billId]);
  if (!bill) return null;
  const lines = await tx.query(
    `select bl.id::text as "lineId", bl.service_delivery_id::text as "serviceDeliveryId", bl.service_id::text as "serviceId",
            bl.description, bl.quantity, ${money('bl.unit_price')} as "unitPrice", ${money('bl.line_amount')} as "lineAmount"
     from orbit_erp.bill_lines bl where bl.bill_id = $1::uuid order by bl.description, bl.id`,
    [billId],
  );
  const payments = await tx.query(
    `select py.id::text as "paymentId", py.payer, py.method, ${money('py.amount')} as amount,
            ${iso('py.received_at')} as "receivedAt", py.reference
     from orbit_erp.payments py where py.bill_id = $1::uuid order by py.received_at, py.id`,
    [billId],
  );
  return { ...bill, lines, payments };
}

/** A bill summary row without the detail-only field. */
function summary(row: unknown): unknown {
  const { cancelReason: _omit, ...rest } = row as Record<string, unknown>;
  return rest;
}

const STATE_FILTER: Record<string, string> = {
  open: `x."paymentState" in ('unpaid', 'part-paid')`,
  unpaid: `x."paymentState" = 'unpaid'`,
  'part-paid': `x."paymentState" = 'part-paid'`,
  paid: `x."paymentState" = 'paid'`,
  cancelled: `x."paymentState" = 'cancelled'`,
};

export function createBillingMethods(run: Run): BillingStore {
  return {
    currency: (operator) =>
      run(operator, async (tx) => {
        const row = await one(tx, `select o.currency from orbit.organizations o where o.id = orbit.current_org()`);
        // A missing or malformed currency is a defect to surface, not a value to guess.
        return CurrencyCodeSchema.parse(row?.['currency']);
      }),

    getCoverage: (operator, patientId) =>
      run(operator, async (tx) => {
        const patient = await one(tx, `select 1 as found from orbit_erp.patients p where p.id = $1::uuid`, [patientId]);
        if (!patient) return null;
        const row = await one(tx, `select ${COVERAGE_COLUMNS} from orbit_erp.patient_coverage c where c.patient_id = $1::uuid`, [patientId]);
        return row ?? { patientId, payerType: 'self-pay', payerName: null, coveragePercent: 0, version: null };
      }),

    setCoverage: (operator, patientId, input, requestId) =>
      run(operator, async (tx): Promise<ErpWrite> => {
        const patient = await one(tx, `select 1 as found from orbit_erp.patients p where p.id = $1::uuid`, [patientId]);
        if (!patient) return { status: 'not_found' };
        const name = input.payerType === 'self-pay' ? null : (input.payerName ?? null);
        let row: Record<string, unknown> | null;
        if (input.version === undefined) {
          row = await one(
            tx,
            `insert into orbit_erp.patient_coverage (patient_id, payer_type, payer_name, coverage_percent)
             values ($1::uuid, $2, $3, $4::numeric)
             on conflict (patient_id) do nothing
             returning id::text as id`,
            [patientId, input.payerType, name, input.coveragePercent],
          );
          // Someone set a cover since this page was read: the caller must reload.
          if (!row) return { status: 'stale' };
        } else {
          row = await one(
            tx,
            `update orbit_erp.patient_coverage c
                set payer_type = $3, payer_name = $4, coverage_percent = $5::numeric,
                    updated_by_membership_id = orbit.current_membership_id(), version = c.version + 1, updated_at = now()
              where c.patient_id = $1::uuid and c.version = $2::int
              returning c.id::text as id`,
            [patientId, input.version, input.payerType, name, input.coveragePercent],
          );
          if (!row) return { status: 'stale' };
        }
        await audit(tx, 'updated', 'coverage', String(row['id']), requestId);
        return {
          status: 'ok',
          row: await one(tx, `select ${COVERAGE_COLUMNS} from orbit_erp.patient_coverage c where c.patient_id = $1::uuid`, [patientId]),
        };
      }),

    issueBill: (operator, encounterId, idempotencyKey, requestId) =>
      run(operator, async (tx) => {
        const existing = await one(
          tx,
          `select b.id::text as id, b.encounter_id::text as "encounterId" from orbit_erp.bills b where b.idempotency_key = $1::uuid`,
          [idempotencyKey],
        );
        if (existing) {
          if (existing['encounterId'] !== encounterId) {
            throw new ApiError('conflict', 'That request key was already used for a different bill.', 'bill_idempotency_mismatch');
          }
          return { bill: await selectBillDetail(tx, String(existing['id'])), replayed: true };
        }
        const issued = await one(tx, `select orbit_erp.issue_bill($1::uuid, $2::uuid)::text as id`, [encounterId, idempotencyKey]);
        const billId = issued?.['id'];
        if (typeof billId !== 'string') return null;
        await audit(tx, 'created', 'bill', billId, requestId);
        return { bill: await selectBillDetail(tx, billId), replayed: false };
      }),

    listBills: (operator, query) =>
      run(operator, (tx) => {
        const where: string[] = [];
        const params: SqlParam[] = [];
        if (query.facilityId) {
          params.push(query.facilityId);
          where.push(`x."facilityId" = $${params.length}`);
        }
        if (query.encounterId) {
          params.push(query.encounterId);
          where.push(`x."encounterId" = $${params.length}`);
        }
        if (query.state) where.push(STATE_FILTER[query.state]!);
        if (query.q) {
          params.push(`%${query.q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
          where.push(`(x."billNumber" ilike $${params.length} or x."patientName" ilike $${params.length})`);
        }
        const filtered = `from (${BILL_SELECT}) x ${where.length ? `where ${where.join(' and ')}` : ''}`;
        return page(
          tx,
          `select count(*)::int as total ${filtered}`,
          `select x.* ${filtered} order by x."issuedAt" desc, x."billId" limit $${params.length + 1} offset $${params.length + 2}`,
          params,
          query,
        ).then((rows) => ({ items: rows.items.map(summary), total: rows.total }));
      }),

    billableVisits: (operator, query) =>
      run(operator, (tx) => {
        // Starts from recently closed visits (indexed by facility, status, start), so
        // the thousands of closed historical visits are never aggregated.
        const filtered = `
          from orbit_erp.encounters e
          join lateral (
            select count(*)::int as items,
                   sum(sd.quantity * fs.illustrative_tariff) as amount,
                   coalesce(array_agg(distinct sv.name order by sv.name) filter (where fs.illustrative_tariff is null), '{}') as unpriced
            from orbit_erp.service_deliveries sd
            join orbit_erp.services sv on sv.id = sd.service_id
            left join orbit_erp.facility_services fs on fs.facility_id = sd.facility_id and fs.service_id = sd.service_id
            where sd.encounter_id = e.id and sd.status = 'completed'
              and not exists (
                select 1 from orbit_erp.bill_lines bl join orbit_erp.bills b on b.id = bl.bill_id
                where bl.service_delivery_id = sd.id and b.status = 'issued'
              )
          ) u on u.items > 0
          where e.status = 'closed'
            and e.ended_at >= now() - make_interval(days => $1::int)
            and ($2::uuid is null or e.facility_id = $2::uuid)`;
        return page(
          tx,
          `select count(*)::int as total ${filtered}`,
          `select e.id::text as "encounterId", e.facility_id::text as "facilityId", e.patient_id::text as "patientId",
                  coalesce(p.display_name, 'Not visible') as "patientName", coalesce(p.mrn, 'Not visible') as "mrn",
                  e.encounter_type as "encounterType", ${iso('e.ended_at')} as "endedAt", u.items,
                  case when cardinality(u.unpriced) > 0 then null else round(u.amount, 2)::float8 end as amount,
                  u.unpriced as "unpricedServices"
           ${filtered.replace('from orbit_erp.encounters e', 'from orbit_erp.encounters e left join orbit_erp.patients p on p.id = e.patient_id')}
           order by e.ended_at desc, e.id limit $3 offset $4`,
          [query.days, query.facilityId ?? null],
          query,
        );
      }),

    getBill: (operator, billId, requestId) =>
      run(operator, async (tx) => {
        const bill = await selectBillDetail(tx, billId);
        if (bill) await audit(tx, 'viewed', 'bill', billId, requestId);
        return bill;
      }),

    recordPayment: (operator, billId, input, requestId) =>
      run(operator, async (tx) => {
        const bill = await one(tx, `select b.facility_id::text as "facilityId" from orbit_erp.bills b where b.id = $1::uuid`, [billId]);
        if (!bill) return null;
        const inserted = await one(
          tx,
          `insert into orbit_erp.payments (bill_id, facility_id, payer, method, amount, received_at, reference, idempotency_key)
           values ($1::uuid, $2::uuid, $3, $4, $5::numeric, coalesce($6::timestamptz, now()), $7, $8::uuid)
           on conflict (organization_id, idempotency_key) do nothing
           returning id::text as id`,
          [billId, String(bill['facilityId']), input.payer, input.method, input.amount, input.receivedAt ?? null, input.reference ?? null, input.idempotencyKey],
        );
        if (inserted) {
          await audit(tx, 'created', 'payment', String(inserted['id']), requestId);
          return { bill: await selectBillDetail(tx, billId), replayed: false };
        }
        const existing = await one(tx, `select py.bill_id::text as "billId" from orbit_erp.payments py where py.idempotency_key = $1::uuid`, [
          input.idempotencyKey,
        ]);
        if (!existing || existing['billId'] !== billId) {
          throw new ApiError('conflict', 'That request key was already used for a different payment.', 'payment_idempotency_mismatch');
        }
        return { bill: await selectBillDetail(tx, billId), replayed: true };
      }),

    cancelBill: (operator, billId, input, requestId) =>
      run(operator, async (tx): Promise<ErpWrite> => {
        const row = await one(
          tx,
          `update orbit_erp.bills b
              set status = 'cancelled', cancelled_at = now(), cancelled_by_membership_id = orbit.current_membership_id(),
                  cancel_reason = $3, version = b.version + 1, updated_at = now()
            where b.id = $1::uuid and b.version = $2::int and b.status = 'issued'
            returning b.id::text as id`,
          [billId, input.version, input.reason],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.bills', 'id', billId);
        await audit(tx, 'updated', 'bill', billId, requestId);
        return { status: 'ok', row: await selectBillDetail(tx, billId) };
      }),

    revenue: (operator, range) =>
      run(operator, async (tx) => {
        const params: SqlParam[] = [range.facilityId, range.from, range.to];
        const base = `
          with tz as (select o.timezone as zone from orbit.organizations o where o.id = orbit.current_org()),
          b as (
            select bl.*, (bl.issued_at at time zone tz.zone)::date as issued_day
            from orbit_erp.bills bl, tz
            where bl.status = 'issued' and ($1::uuid is null or bl.facility_id = $1::uuid)
          ),
          py as (
            select p.*, (p.received_at at time zone tz.zone)::date as received_day
            from orbit_erp.payments p join b on b.id = p.bill_id, tz
          ),
          paid as (select py.bill_id, py.payer, sum(py.amount) as amount from py group by py.bill_id, py.payer)`;
        const totals = await one(
          tx,
          `${base}
           select
             (select count(*) from b where b.issued_day between $2::date and $3::date)::int as bills,
             ${money('(select sum(b.gross_amount) from b where b.issued_day between $2::date and $3::date)')} as gross,
             ${money('(select sum(b.insurance_amount) from b where b.issued_day between $2::date and $3::date)')} as insurance,
             ${money('(select sum(b.patient_amount) from b where b.issued_day between $2::date and $3::date)')} as patient,
             ${money('(select sum(py.amount) from py where py.received_day between $2::date and $3::date)')} as collected,
             ${money(`(select sum(py.amount) from py where py.payer = 'patient' and py.received_day between $2::date and $3::date)`)} as "collectedFromPatients",
             ${money(`(select sum(py.amount) from py where py.payer = 'insurer' and py.received_day between $2::date and $3::date)`)} as "collectedFromInsurers",
             ${money(`(select sum(b.patient_amount - coalesce((select pd.amount from paid pd where pd.bill_id = b.id and pd.payer = 'patient'), 0)) from b)`)} as "outstandingPatient",
             ${money(`(select sum(b.insurance_amount - coalesce((select pd.amount from paid pd where pd.bill_id = b.id and pd.payer = 'insurer'), 0)) from b)`)} as "outstandingInsurer",
             (select count(*) from b where b.gross_amount > coalesce((select sum(pd.amount) from paid pd where pd.bill_id = b.id), 0))::int as "openBills"`,
          params,
        );
        const daily = await tx.query(
          `${base}
           select to_char(d::date, 'YYYY-MM-DD') as day,
                  (select count(*) from b where b.issued_day = d::date)::int as bills,
                  ${money('(select sum(b.gross_amount) from b where b.issued_day = d::date)')} as gross,
                  ${money('(select sum(py.amount) from py where py.received_day = d::date)')} as collected
           from generate_series($2::date, $3::date, interval '1 day') d
           order by d`,
          params,
        );
        const byCategory = await tx.query(
          `${base}
           select s.category, count(*)::int as lines, ${money('sum(l.line_amount)')} as amount
           from orbit_erp.bill_lines l
           join b on b.id = l.bill_id and b.issued_day between $2::date and $3::date
           join orbit_erp.services s on s.id = l.service_id
           group by s.category order by sum(l.line_amount) desc`,
          params,
        );
        const byMethod = await tx.query(
          `${base}
           select py.method, count(*)::int as payments, ${money('sum(py.amount)')} as amount
           from py where py.received_day between $2::date and $3::date
           group by py.method order by sum(py.amount) desc`,
          params,
        );
        const unpricedServices = await tx.query(
          `select distinct s.id::text as "serviceId", s.name
           from orbit_erp.facility_services fs join orbit_erp.services s on s.id = fs.service_id
           where fs.is_available and s.is_active and fs.illustrative_tariff is null
             and ($1::uuid is null or fs.facility_id = $1::uuid)
           order by s.name`,
          [range.facilityId],
        );
        return { totals, daily, byCategory, byMethod, unpricedServices };
      }),
  };
}
