import type { SurveillanceSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres SurveillanceSource (ADR 0023). The three functions are security
 * definer and bounded like the operations feed: a leader's claims, own
 * organization; per-hospital rows only inside the verified scope. Counts only.
 */

const num = (column: string) => `${column}::float8`;

export const SURVEILLANCE_FEED_SQL = `
select
  s.condition_id::text            as "conditionId",
  s.code, s.name, s.category,
  s.window_days                   as "windowDays",
  s.min_patients                  as "minPatients",
  s.min_hospitals                 as "minHospitals",
  s.patients, s.hospitals,
  ${num('s.usual_patients')}      as "usualPatients",
  s.alert,
  ${num('s.expected_patients')}   as "expectedPatients",
  ${num('s.p_patients')}          as "pPatients",
  ${num('s.p_hospitals')}         as "pHospitals"
from orbit_erp.surveillance_feed() s`;

export const SURVEILLANCE_HOSPITALS_SQL = `
select h.facility_id::text as "facilityId", h.condition_id::text as "conditionId", h.patients,
       ${num('h.expected_patients')} as "expectedPatients"
from orbit_erp.surveillance_hospitals() h`;

export const SURVEILLANCE_RUN_SQL = `
select r.model,
       to_char(r.trained_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "trainedAt",
       to_char(r.data_through, 'YYYY-MM-DD') as "dataThrough",
       r.horizon_days as "horizonDays", r.training_rows as "trainingRows",
       ${num('r.model_mae')} as "modelMae", ${num('r.baseline_mae')} as "baselineMae", r.notes
from orbit_erp.surveillance_forecast_run() r`;

export function createDbSurveillanceSource(db: Database): SurveillanceSource {
  return {
    feed: (membership) => withMembershipTx(db, membership, (tx) => tx.query(SURVEILLANCE_FEED_SQL)),
    hospitals: (membership) => withMembershipTx(db, membership, (tx) => tx.query(SURVEILLANCE_HOSPITALS_SQL)),
    run: (membership) => withMembershipTx(db, membership, async (tx) => (await tx.query(SURVEILLANCE_RUN_SQL))[0] ?? null),
  };
}
