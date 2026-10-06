import { CurrencyCodeSchema } from '@orbit/contracts';
import type { RevenueSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres RevenueSource (ADR 0022 §5). orbit_erp.revenue_feed() and
 * revenue_feed_daily() are security-definer functions bounded exactly like the
 * operations feed: a leader's claims, own organization, hospitals inside the
 * verified scope (ops_visible_facilities). Amounts only. The aliases below are
 * the row shape the route parses.
 */

const money = (column: string) => `round(${column}, 2)::float8`;

export const REVENUE_SUMMARY_SQL = `
select
  r.facility_id::text                  as "facilityId",
  r.bills_period                       as "bills",
  ${money('r.gross_period')}           as "gross",
  ${money('r.insurance_period')}       as "insurance",
  ${money('r.patient_period')}         as "patient",
  ${money('r.collected_period')}       as "collected",
  ${money('r.gross_today')}            as "grossToday",
  ${money('r.collected_today')}        as "collectedToday",
  r.open_bills                         as "openBills",
  ${money('r.outstanding_patient')}    as "outstandingPatient",
  ${money('r.outstanding_insurer')}    as "outstandingInsurer"
from orbit_erp.revenue_feed($1::integer) r
order by r.facility_id`;

export const REVENUE_DAILY_SQL = `
select
  d.facility_id::text        as "facilityId",
  to_char(d.day, 'YYYY-MM-DD') as "day",
  ${money('d.gross')}        as "gross",
  ${money('d.collected')}    as "collected"
from orbit_erp.revenue_feed_daily($1::integer) d
order by d.facility_id, d.day`;

export function createDbRevenueSource(db: Database): RevenueSource {
  return {
    summary: (membership, days) => withMembershipTx(db, membership, (tx) => tx.query(REVENUE_SUMMARY_SQL, [days])),
    daily: (membership, days) => withMembershipTx(db, membership, (tx) => tx.query(REVENUE_DAILY_SQL, [days])),
    currency: (membership) =>
      withMembershipTx(db, membership, async (tx) => {
        const [row] = await tx.query('select o.currency from orbit.organizations o where o.id = orbit.current_org()');
        return CurrencyCodeSchema.parse(row?.['currency']);
      }),
  };
}
