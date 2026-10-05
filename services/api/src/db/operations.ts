import type { OperationsSource } from '../modules/ports.ts';
import type { Database } from './client.ts';
import { withMembershipTx } from './rls.ts';

/*
 * Postgres OperationsSource (ADR 0018). orbit_erp.ops_snapshot() and
 * orbit_erp.ops_daily() are security-definer functions that return counts for
 * the caller's own hospitals only (own organization, inside the verified scope,
 * a leader's claims, never an operator's). They are the only door a leader has
 * into the ERP schema. The aliases below are the row shape the route parses.
 */

export const OPERATIONS_SNAPSHOT_SQL = `
select
  s.facility_id::text          as "facilityId",
  s.today::text                as "today",
  to_char(s.as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "asOf",
  s.active_staff               as "activeStaff",
  s.rostered_today             as "rosteredToday",
  s.on_duty_now                as "onDutyNow",
  s.late_today                 as "lateToday",
  s.missing_punch_today        as "missingPunchToday",
  s.absent_today               as "absentToday",
  s.doctors_total              as "doctorsTotal",
  s.doctors_active             as "doctorsActive",
  s.doctors_expiring           as "doctorsExpiring",
  s.doctors_expired            as "doctorsExpired",
  s.doctors_suspended          as "doctorsSuspended",
  s.open_visits                as "openVisits",
  s.open_inpatients            as "openInpatients",
  s.visits_started_today       as "visitsStartedToday",
  s.visits_started_7d          as "visitsStarted7d",
  s.services_today             as "servicesToday",
  s.services_7d                as "services7d",
  s.pending_corrections        as "pendingCorrections",
  to_char(s.last_activity_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "lastActivityAt"
from orbit_erp.ops_snapshot() s
order by s.facility_id`;

export const OPERATIONS_DAILY_SQL = `
select
  d.facility_id::text  as "facilityId",
  d.shift_date::text   as "date",
  d.rostered           as "rostered",
  d.in_progress        as "inProgress",
  d.present            as "onTime",
  d.late               as "late",
  d.early_exit         as "earlyExit",
  d.missing_punch      as "missingPunch",
  d.absent             as "absent",
  d.on_leave           as "onLeave"
from orbit_erp.ops_daily($1::integer) d
order by d.facility_id, d.shift_date`;

export function createDbOperationsSource(db: Database): OperationsSource {
  return {
    snapshot: (membership) => withMembershipTx(db, membership, (tx) => tx.query(OPERATIONS_SNAPSHOT_SQL)),
    daily: (membership, days) => withMembershipTx(db, membership, (tx) => tx.query(OPERATIONS_DAILY_SQL, [days])),
  };
}
