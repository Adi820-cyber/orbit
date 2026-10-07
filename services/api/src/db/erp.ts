import type { OperatorClaims } from '@orbit/contracts';
import type { ErpStore } from '../modules/erp/ports.ts';
import { ApiError } from '../plugins/errors.ts';
import type { Database, Tx } from './client.ts';
import { audit, day, hhmm, iso, likePattern, one, page, staleOrMissing } from './erp-sql.ts';

export { likePattern } from './erp-sql.ts';
import { createBillingMethods } from './erp-billing.ts';
import { withOperatorTx } from './rls.ts';

/*
 * Postgres ErpStore (migration 20261001000100, ADR 0016).
 *
 * Every statement runs inside `withOperatorTx`, so the `orbit_erp` RLS
 * policies decide what each operator can read and write; this file adds no
 * authorization of its own beyond what the routes already checked. Column
 * aliases are the `@orbit/contracts` keys and the routes parse every row.
 *
 * Writes and their audit rows commit together. A database rule (trigger,
 * CHECK, unique index, RLS) refusing a write is mapped to a typed ApiError by
 * `mapDbError`, never surfaced as a 500.
 */



// ---------------------------------------------------------------------------
// Database errors -> typed API errors
// ---------------------------------------------------------------------------

/** Trigger codes raised as `erp:<code>` (migration §10). */
const RULE_MESSAGES: Record<string, string> = {
  staff_not_at_facility: 'That person does not work at this facility.',
  staff_not_employed_on_date: 'That person was not employed on that date.',
  punch_in_future: 'A punch cannot be recorded in the future.',
  punch_too_old: 'Punches older than 31 days need an attendance correction instead.',
  doctor_not_at_facility: 'The attending doctor must be an active doctor at this facility.',
  doctor_credential_invalid: "This doctor's credential is expired or suspended for that date.",
  services_after_close: 'Services were recorded after that closing time. Choose a later closing time.',
  encounter_not_at_facility: 'That visit is not at this facility.',
  encounter_cancelled: 'Services cannot be added to a cancelled visit.',
  outside_encounter_window: 'The service time must fall within the visit.',
  service_not_available: 'This service is not offered at this facility.',
  performer_not_at_facility: 'The person performing the service must be active staff at this facility.',
  schedule_overlap: 'This slot overlaps another active slot for the same doctor and day.',
  staff_is_not_a_doctor: 'That person is not a doctor.',
  doctor_has_profile: 'A doctor with a doctor profile cannot change staff type.',
  // Billing (migration 20261006000200)
  price_admin_only: 'Only an admin account can change a price.',
  delivery_billed: 'This service is on a bill. Cancel the bill before cancelling the service.',
  bill_cancelled: 'This bill is cancelled.',
  bill_immutable: "A bill's amounts cannot change once it is issued.",
  bill_has_payments: 'A bill with a payment cannot be cancelled.',
  bill_not_at_facility: 'That bill is not at this facility.',
  payment_before_bill: 'A payment cannot be dated before its bill.',
  payment_exceeds_balance: 'That is more than this payer still owes on the bill.',
  bill_needs_closed_visit: 'Close the visit before billing it.',
  nothing_to_bill: 'This visit has no services left to bill.',
  price_missing: 'No price is set for some services on this visit. An admin sets prices on the Services page.',
  revenue_range_invalid: 'Choose a period of 1 to 92 days.',
  // Outbreak watch (migration 20261007000100)
  condition_unknown: 'Choose a presenting condition from the list.',
};

/** Rules that refuse the caller rather than conflict with the data. */
const FORBIDDEN_RULES = new Set(['price_admin_only']);

/** Unique constraints whose violation is an ordinary, explainable conflict. */
const UNIQUE_MESSAGES: Record<string, string> = {
  staff_organization_id_employee_code_key: 'That employee code is already in use.',
  doctor_profiles_organization_id_registration_number_key: 'That registration number is already in use.',
  services_organization_id_service_code_key: 'That service code is already in use.',
  departments_organization_id_code_key: 'That department code is already in use.',
  encounters_one_open_inpatient: 'This patient already has an open inpatient admission.',
  corrections_one_pending: 'A correction for this person and date is already waiting for review.',
  roster_one_planned_per_day: 'That person already has a shift on that day.',
  facility_services_facility_id_service_id_key: 'This service is already configured for this facility.',
};

const CHECK_MESSAGES: Record<string, [ApiError['code'], string]> = {
  corrections_not_self_decided: ['forbidden', 'You cannot decide a correction you requested.'],
  encounters_ordered: ['invalid_request', 'A visit cannot end before it starts.'],
  staff_exit_after_join: ['invalid_request', 'The exit date cannot be before the joining date.'],
  staff_exit_consistent: ['invalid_request', 'An exited person needs an exit date, and only an exited person has one.'],
};

interface PgErrorLike {
  code?: unknown;
  message?: unknown;
  constraint_name?: unknown;
}

export function mapDbError(error: unknown): unknown {
  if (error instanceof ApiError || typeof error !== 'object' || error === null) return error;
  const pg = error as PgErrorLike;
  const code = typeof pg.code === 'string' ? pg.code : '';
  const message = typeof pg.message === 'string' ? pg.message : '';
  const constraint = typeof pg.constraint_name === 'string' ? pg.constraint_name : '';

  if (code === 'P0001' && message.startsWith('erp:')) {
    // A rule may carry a detail after a second colon (`erp:price_missing:General consultation`).
    const [rule = '', ...rest] = message.slice('erp:'.length).split(':');
    const detail = rest.join(':').trim();
    const text = RULE_MESSAGES[rule] ?? 'That change breaks a hospital operations rule.';
    const full = rule === 'price_missing' && detail ? `No price is set for: ${detail}. An admin sets prices on the Services page.` : text;
    return new ApiError(FORBIDDEN_RULES.has(rule) ? 'forbidden' : 'conflict', full, `erp_rule:${rule}`);
  }
  if (code === '23505') {
    return new ApiError('conflict', UNIQUE_MESSAGES[constraint] ?? 'That record already exists.', `unique:${constraint}`);
  }
  if (code === '23514') {
    const [errorCode, text] = CHECK_MESSAGES[constraint] ?? ['invalid_request', 'The request is invalid.'];
    return new ApiError(errorCode, text, `check:${constraint}`);
  }
  if (code === '23503') {
    return new ApiError('invalid_request', 'A referenced record does not exist.', `foreign_key:${constraint}`);
  }
  if (code === '42501') {
    // RLS refused a write the route already allowed: defense in depth held.
    return new ApiError('forbidden', 'Your account cannot make this change.', 'rls_refused_write');
  }
  return error;
}

// ---------------------------------------------------------------------------
// Column lists (aliases = contract keys)
// ---------------------------------------------------------------------------
const STAFF_COLUMNS = `
  s.id::text as "staffId",
  s.facility_id::text as "facilityId",
  s.department_id::text as "departmentId",
  s.employee_code as "employeeCode",
  s.display_name as "displayName",
  s.staff_type as "staffType",
  s.designation as "designation",
  s.employment_status as "employmentStatus",
  ${day('s.joined_on')} as "joinedOn",
  ${day('s.exited_on')} as "exitedOn",
  s.is_critical_role as "isCriticalRole",
  s.version as "version"`;

const STAFF_SUMMARY_JSON = `jsonb_build_object(
  'staffId', s.id::text, 'displayName', s.display_name, 'employeeCode', s.employee_code,
  'staffType', s.staff_type, 'designation', s.designation, 'departmentId', s.department_id::text)`;

/** Doctor rows: staff joined to profile, with credential status as of the organization's today. */
const DOCTOR_FROM = `
from orbit_erp.staff s
join orbit_erp.doctor_profiles d on d.staff_id = s.id
join orbit.organizations o on o.id = s.organization_id
left join orbit_erp.erp_settings st on st.organization_id = s.organization_id`;

const DOCTOR_COLUMNS = `
  s.id::text as "staffId",
  s.facility_id::text as "facilityId",
  s.department_id::text as "departmentId",
  s.employee_code as "employeeCode",
  s.display_name as "displayName",
  s.designation as "designation",
  s.employment_status as "employmentStatus",
  d.specialty_id::text as "specialtyId",
  d.registration_number as "registrationNumber",
  ${day('d.credential_expires_on')} as "credentialExpiresOn",
  d.credential_suspended as "credentialSuspended",
  orbit_erp.credential_status(d.credential_expires_on, d.credential_suspended,
    (now() at time zone o.timezone)::date, coalesce(st.credential_warning_days, 0)) as "credentialStatus",
  d.employment_type as "employmentType",
  d.version as "version"`;

const SLOT_COLUMNS = `
  ds.id::text as "slotId",
  ds.facility_id::text as "facilityId",
  ds.weekday::int as "weekday",
  ${hhmm('ds.start_time')} as "startTime",
  ${hhmm('ds.end_time')} as "endTime",
  ds.is_active as "isActive"`;

/** One derived attendance day from `orbit_erp.attendance_days()`, aliased `a`. */
const DAY_JSON = `jsonb_build_object(
  'staffId', a.staff_id::text,
  'shiftDate', ${day('a.shift_date')},
  'rosterId', a.roster_id::text,
  'shiftTemplateId', a.shift_template_id::text,
  'shiftStart', ${iso('a.shift_start')},
  'shiftEnd', ${iso('a.shift_end')},
  'firstIn', ${iso('a.first_in')},
  'lastOut', ${iso('a.last_out')},
  'punchCount', a.punch_count,
  'onDuty', a.on_duty,
  'workedMinutes', a.worked_minutes,
  'lateMinutes', a.late_minutes,
  'earlyExitMinutes', a.early_exit_minutes,
  'status', a.status,
  'corrected', a.corrected,
  'correctionId', a.correction_id::text)`;

const PUNCH_COLUMNS = `
  p.id::text as "punchId",
  p.staff_id::text as "staffId",
  p.facility_id::text as "facilityId",
  p.direction as "direction",
  ${iso('p.punched_at')} as "punchedAt",
  p.source as "source"`;

const CORRECTION_COLUMNS = `
  c.id::text as "correctionId",
  c.staff_id::text as "staffId",
  s.display_name as "staffName",
  c.facility_id::text as "facilityId",
  ${day('c.shift_date')} as "shiftDate",
  ${iso('c.proposed_in')} as "proposedIn",
  ${iso('c.proposed_out')} as "proposedOut",
  c.reason as "reason",
  c.state as "state",
  (c.requested_by_membership_id = orbit.current_membership_id()) as "requestedByMe",
  c.decision_note as "decisionNote",
  ${iso('c.created_at')} as "createdAt",
  ${iso('c.decided_at')} as "decidedAt",
  c.version as "version"`;

const SERVICE_COLUMNS = `
  sv.id::text as "serviceId",
  sv.service_code as "serviceCode",
  sv.name as "name",
  sv.category as "category",
  sv.department_id::text as "departmentId",
  sv.unit as "unit",
  sv.is_active as "isActive",
  sv.version as "version"`;

const AVAILABILITY_JSON = (alias: string) => `case when ${alias}.id is null then null else jsonb_build_object(
  'facilityId', ${alias}.facility_id::text,
  'isAvailable', ${alias}.is_available,
  'illustrativeTariff', ${alias}.illustrative_tariff::float8,
  'version', ${alias}.version) end`;

const PATIENT_COLUMNS = `
  p.id::text as "patientId",
  p.mrn as "mrn",
  p.display_name as "displayName",
  p.sex as "sex",
  p.birth_year as "birthYear",
  p.status as "status",
  p.home_facility_id::text as "homeFacilityId",
  ${iso('p.created_at')} as "createdAt",
  p.version as "version"`;

const ENCOUNTER_COLUMNS = `
  e.id::text as "encounterId",
  e.patient_id::text as "patientId",
  e.facility_id::text as "facilityId",
  e.department_id::text as "departmentId",
  e.attending_doctor_id::text as "attendingDoctorId",
  doc.display_name as "attendingDoctorName",
  e.encounter_type as "encounterType",
  e.status as "status",
  ${iso('e.started_at')} as "startedAt",
  ${iso('e.ended_at')} as "endedAt",
  e.presenting_condition_id::text as "presentingConditionId",
  cond.name as "presentingConditionName",
  e.version as "version"`;

const ENCOUNTER_FROM = `
from orbit_erp.encounters e
left join orbit_erp.staff doc on doc.id = e.attending_doctor_id
left join orbit_erp.conditions cond on cond.id = e.presenting_condition_id`;

const DELIVERY_SELECT = `
select
  sd.id::text as "deliveryId",
  sd.encounter_id::text as "encounterId",
  sd.service_id::text as "serviceId",
  sv.service_code as "serviceCode",
  sv.name as "serviceName",
  sv.category as "category",
  sv.unit as "unit",
  sd.performed_by_staff_id::text as "performedByStaffId",
  coalesce(pf.display_name, 'Not visible') as "performedByName",
  sd.quantity as "quantity",
  ${iso('sd.performed_at')} as "performedAt",
  sd.status as "status",
  (sd.quantity * fs.illustrative_tariff)::float8 as "illustrativeAmount",
  sd.version as "version"
from orbit_erp.service_deliveries sd
join orbit_erp.services sv on sv.id = sd.service_id
left join orbit_erp.staff pf on pf.id = sd.performed_by_staff_id
left join orbit_erp.facility_services fs on fs.facility_id = sd.facility_id and fs.service_id = sd.service_id`;


// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
export function createDbErpStore(db: Database): ErpStore {
  /** Runs one operator transaction and maps refused writes to typed errors. */
  async function run<T>(operator: OperatorClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await withOperatorTx(db, operator, fn);
    } catch (error: unknown) {
      throw mapDbError(error);
    }
  }

  const selectStaff = (tx: Tx, staffId: string) =>
    one(tx, `select ${STAFF_COLUMNS} from orbit_erp.staff s where s.id = $1::uuid`, [staffId]);
  const selectDoctor = (tx: Tx, staffId: string) =>
    one(tx, `select ${DOCTOR_COLUMNS} ${DOCTOR_FROM} where s.id = $1::uuid`, [staffId]);
  const selectService = (tx: Tx, serviceId: string) =>
    one(tx, `select ${SERVICE_COLUMNS} from orbit_erp.services sv where sv.id = $1::uuid`, [serviceId]);
  const selectPatient = (tx: Tx, patientId: string) =>
    one(tx, `select ${PATIENT_COLUMNS} from orbit_erp.patients p where p.id = $1::uuid`, [patientId]);
  const selectEncounter = (tx: Tx, encounterId: string) =>
    one(tx, `select ${ENCOUNTER_COLUMNS} ${ENCOUNTER_FROM} where e.id = $1::uuid`, [encounterId]);
  const selectCorrection = (tx: Tx, correctionId: string) =>
    one(
      tx,
      `select ${CORRECTION_COLUMNS} from orbit_erp.attendance_corrections c
       join orbit_erp.staff s on s.id = c.staff_id where c.id = $1::uuid`,
      [correctionId],
    );
  const selectDelivery = (tx: Tx, deliveryId: string) => one(tx, `${DELIVERY_SELECT} where sd.id = $1::uuid`, [deliveryId]);

  /** The derived day a punch belongs to, by the same nearest-shift rule as attendance_days(). */
  const punchDay = (tx: Tx, staffId: string, facilityId: string, punchedAt: string) =>
    one(
      tx,
      `with cfg as (
         select make_interval(mins => st.punch_window_before_minutes) as before_w,
                make_interval(mins => st.punch_window_after_minutes) as after_w,
                o.timezone as tz
         from orbit_erp.erp_settings st join orbit.organizations o on o.id = st.organization_id
         where st.organization_id = orbit.current_org()
       ),
       local as (select ($3::timestamptz at time zone cfg.tz)::date as d from cfg)
       select ${DAY_JSON} as "day"
       from local, cfg, orbit_erp.attendance_days($2::uuid, local.d - 1, local.d, $1::uuid) a
       order by
         case when a.shift_start is not null
                   and $3::timestamptz between a.shift_start - cfg.before_w and a.shift_end + cfg.after_w then 0
              when a.shift_date = local.d then 1
              else 2 end,
         greatest(a.shift_start - $3::timestamptz, $3::timestamptz - a.shift_end, interval '0') nulls last
       limit 1`,
      [staffId, facilityId, punchedAt],
    );

  return {
    ...createBillingMethods(run),
    reference: (operator) =>
      run(operator, async (tx) => {
        const [facilities, departments, specialties, shiftTemplates, conditions, settings] = await Promise.all([
          tx.query(`select f.id::text as "facilityId", f.name as "name" from orbit.facilities f
                    where f.organization_id = orbit.current_org() order by f.name`),
          tx.query(`select d.id::text as "departmentId", d.code, d.name from orbit_erp.departments d order by d.name`),
          tx.query(`select sp.id::text as "specialtyId", sp.code, sp.name from orbit_erp.specialties sp order by sp.name`),
          tx.query(`select t.id::text as "shiftTemplateId", t.code, t.name, ${hhmm('t.start_time')} as "startTime",
                      ${hhmm('t.end_time')} as "endTime", t.break_minutes as "breakMinutes",
                      t.crosses_midnight as "crossesMidnight"
                    from orbit_erp.shift_templates t order by t.start_time, t.code`),
          tx.query(`select c.id::text as "conditionId", c.code, c.name, c.category
                    from orbit_erp.conditions c where c.is_active order by c.name`),
          one(
            tx,
            `select st.late_grace_minutes as "lateGraceMinutes", st.early_exit_grace_minutes as "earlyExitGraceMinutes",
                    st.punch_window_before_minutes as "punchWindowBeforeMinutes",
                    st.punch_window_after_minutes as "punchWindowAfterMinutes",
                    st.credential_warning_days as "credentialWarningDays", o.timezone as "timeZone", st.version
             from orbit_erp.erp_settings st join orbit.organizations o on o.id = st.organization_id
             where st.organization_id = orbit.current_org()`,
          ),
        ]);
        return { facilities, departments, specialties, shiftTemplates, conditions, settings };
      }),

    facility: (operator, facilityId) =>
      run(operator, (tx) =>
        one(
          tx,
          `select f.id::text as "facilityId", f.name as "name" from orbit.facilities f
           where f.id = $1::uuid and f.organization_id = orbit.current_org() and orbit_erp.facility_visible(f.id)`,
          [facilityId],
        ),
      ),

    today: (operator) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `select ${day('(now() at time zone o.timezone)::date')} as "today"
           from orbit.organizations o where o.id = orbit.current_org()`,
        );
        const today = row?.['today'];
        if (typeof today !== 'string') throw new ApiError('internal', 'An internal error occurred.', 'organization_not_visible');
        return today;
      }),

    summary: (operator, facilityId, date) =>
      run(operator, (tx) =>
        one(
          tx,
          `with days as (select * from orbit_erp.attendance_days($1::uuid, $2::date, $2::date)),
                tz as (select o.timezone from orbit.organizations o where o.id = orbit.current_org())
           select
             (select count(*) from orbit_erp.staff s where s.facility_id = $1::uuid and s.employment_status <> 'exited')::int as "active",
             (select count(*) from days where roster_id is not null)::int as "rostered",
             (select count(*) from days where on_duty)::int as "onDuty",
             (select count(*) from days where status = 'late')::int as "late",
             (select count(*) from days where status = 'missing-punch')::int as "missingPunch",
             (select count(*) from days where status = 'absent')::int as "absent",
             (select count(*) from orbit_erp.encounters e where e.facility_id = $1::uuid and e.status = 'open'
                and e.encounter_type = 'inpatient')::int as "openInpatients",
             (select count(*) from orbit_erp.encounters e where e.facility_id = $1::uuid and e.status = 'open'
                and e.encounter_type <> 'inpatient')::int as "openOther",
             (select count(*) from orbit_erp.encounters e, tz where e.facility_id = $1::uuid
                and (e.started_at at time zone tz.timezone)::date = $2::date)::int as "startedToday",
             (select count(*) from orbit_erp.service_deliveries sd, tz where sd.facility_id = $1::uuid
                and sd.status = 'completed' and (sd.performed_at at time zone tz.timezone)::date = $2::date)::int as "servicesDeliveredToday",
             (select count(*) from orbit_erp.patients p, tz where p.home_facility_id = $1::uuid
                and (p.created_at at time zone tz.timezone)::date = $2::date)::int as "patientsRegisteredToday",
             (select count(*) from orbit_erp.attendance_corrections c where c.facility_id = $1::uuid
                and c.state = 'submitted')::int as "pendingCorrections",
             (select count(*) ${DOCTOR_FROM} where s.facility_id = $1::uuid and s.employment_status <> 'exited'
                and orbit_erp.credential_status(d.credential_expires_on, d.credential_suspended,
                    (now() at time zone o.timezone)::date, coalesce(st.credential_warning_days, 0)) <> 'active')::int
               as "doctorsNeedingCredentialAttention",
             ${iso('now()')} as "asOf"`,
          [facilityId, date],
        ),
      ),

    // ---- Staff -------------------------------------------------------------
    listStaff: (operator, query) =>
      run(operator, (tx) => {
        const where = `from orbit_erp.staff s
          where ($1::uuid is null or s.facility_id = $1::uuid)
            and ($2::uuid is null or s.department_id = $2::uuid)
            and ($3::text is null or s.staff_type = $3)
            and ($4::text is null or s.employment_status = $4)
            and ($5::text is null or s.display_name ilike $5 or s.employee_code ilike $5)`;
        return page(
          tx,
          `select count(*)::int as total ${where}`,
          `select ${STAFF_COLUMNS} ${where} order by s.display_name, s.id limit $6 offset $7`,
          [
            query.facilityId ?? null,
            query.departmentId ?? null,
            query.staffType ?? null,
            query.employmentStatus ?? null,
            query.q ? likePattern(query.q) : null,
          ],
          query,
        );
      }),

    getStaff: (operator, staffId) => run(operator, (tx) => selectStaff(tx, staffId)),

    createStaff: (operator, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `insert into orbit_erp.staff
             (facility_id, department_id, employee_code, display_name, staff_type, designation, joined_on, is_critical_role)
           values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::boolean)
           returning id::text as id`,
          [
            input.facilityId,
            input.departmentId,
            input.employeeCode,
            input.displayName,
            input.staffType,
            input.designation,
            input.joinedOn,
            input.isCriticalRole,
          ],
        );
        const id = String(row?.['id']);
        await audit(tx, 'created', 'staff', id, requestId);
        return selectStaff(tx, id);
      }),

    updateStaff: (operator, staffId, input, requestId) =>
      run(operator, async (tx) => {
        const exiting = input.employmentStatus !== undefined;
        const row = await one(
          tx,
          `update orbit_erp.staff s set
             department_id = coalesce($3::uuid, s.department_id),
             designation = coalesce($4, s.designation),
             employment_status = coalesce($5, s.employment_status),
             exited_on = case when $6::boolean then $7::date else s.exited_on end,
             is_critical_role = coalesce($8::boolean, s.is_critical_role),
             version = s.version + 1,
             updated_at = now()
           where s.id = $1::uuid and s.version = $2::int
           returning s.id::text as id`,
          [
            staffId,
            input.version,
            input.departmentId ?? null,
            input.designation ?? null,
            input.employmentStatus ?? null,
            exiting,
            input.exitedOn ?? null,
            input.isCriticalRole ?? null,
          ],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.staff', 'id', staffId);
        await audit(tx, 'updated', 'staff', staffId, requestId);
        return { status: 'ok', row: await selectStaff(tx, staffId) };
      }),

    // ---- Doctors ----------------------------------------------------------
    listDoctors: (operator, query) =>
      run(operator, (tx) => {
        const inner = `select ${DOCTOR_COLUMNS} ${DOCTOR_FROM}
          where ($1::uuid is null or s.facility_id = $1::uuid)
            and ($2::uuid is null or d.specialty_id = $2::uuid)
            and ($4::text is null or s.display_name ilike $4 or s.employee_code ilike $4 or d.registration_number ilike $4)`;
        const where = `from (${inner}) doc where ($3::text is null or doc."credentialStatus" = $3)`;
        return page(
          tx,
          `select count(*)::int as total ${where}`,
          `select doc.* ${where} order by doc."displayName", doc."staffId" limit $5 offset $6`,
          [query.facilityId ?? null, query.specialtyId ?? null, query.credentialStatus ?? null, query.q ? likePattern(query.q) : null],
          query,
        );
      }),

    getDoctor: (operator, staffId) =>
      run(operator, async (tx) => {
        const doctor = await selectDoctor(tx, staffId);
        if (!doctor) return null;
        const schedule = await tx.query(
          `select ${SLOT_COLUMNS} from orbit_erp.doctor_schedules ds where ds.staff_id = $1::uuid
           order by ds.is_active desc, ds.weekday, ds.start_time`,
          [staffId],
        );
        return { doctor, schedule };
      }),

    createDoctor: (operator, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `insert into orbit_erp.staff
             (facility_id, department_id, employee_code, display_name, staff_type, designation, joined_on, is_critical_role)
           values ($1::uuid, $2::uuid, $3, $4, 'doctor', $5, $6::date, $7::boolean)
           returning id::text as id`,
          [
            input.facilityId,
            input.departmentId,
            input.employeeCode,
            input.displayName,
            input.designation,
            input.joinedOn,
            input.isCriticalRole,
          ],
        );
        const id = String(row?.['id']);
        await tx.query(
          `insert into orbit_erp.doctor_profiles (staff_id, specialty_id, registration_number, credential_expires_on, employment_type)
           values ($1::uuid, $2::uuid, $3, $4::date, $5)`,
          [id, input.specialtyId, input.registrationNumber, input.credentialExpiresOn, input.employmentType],
        );
        await audit(tx, 'created', 'doctor', id, requestId);
        return selectDoctor(tx, id);
      }),

    updateDoctor: (operator, staffId, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `update orbit_erp.doctor_profiles d set
             specialty_id = coalesce($3::uuid, d.specialty_id),
             credential_expires_on = coalesce($4::date, d.credential_expires_on),
             credential_suspended = coalesce($5::boolean, d.credential_suspended),
             employment_type = coalesce($6, d.employment_type),
             version = d.version + 1,
             updated_at = now()
           where d.staff_id = $1::uuid and d.version = $2::int
           returning d.staff_id::text as id`,
          [
            staffId,
            input.version,
            input.specialtyId ?? null,
            input.credentialExpiresOn ?? null,
            input.credentialSuspended ?? null,
            input.employmentType ?? null,
          ],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.doctor_profiles', 'staff_id', staffId);
        await audit(tx, 'updated', 'doctor', staffId, requestId);
        return { status: 'ok', row: await selectDoctor(tx, staffId) };
      }),

    addScheduleSlot: (operator, staffId, input, requestId) =>
      run(operator, async (tx) => {
        if (!(await selectDoctor(tx, staffId))) return null;
        const row = await one(
          tx,
          `insert into orbit_erp.doctor_schedules (staff_id, facility_id, weekday, start_time, end_time)
           values ($1::uuid, $2::uuid, $3::smallint, $4::time, $5::time)
           returning id::text as id`,
          [staffId, input.facilityId, input.weekday, input.startTime, input.endTime],
        );
        const id = String(row?.['id']);
        await audit(tx, 'updated', 'doctor', staffId, requestId);
        return one(tx, `select ${SLOT_COLUMNS} from orbit_erp.doctor_schedules ds where ds.id = $1::uuid`, [id]);
      }),

    updateScheduleSlot: (operator, slotId, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `update orbit_erp.doctor_schedules ds set is_active = $2::boolean where ds.id = $1::uuid
           returning ds.staff_id::text as "staffId"`,
          [slotId, input.isActive],
        );
        if (!row) return null;
        await audit(tx, 'updated', 'doctor', String(row['staffId']), requestId);
        return one(tx, `select ${SLOT_COLUMNS} from orbit_erp.doctor_schedules ds where ds.id = $1::uuid`, [slotId]);
      }),

    // ---- Attendance -------------------------------------------------------
    attendanceBoard: (operator, facilityId, date) =>
      run(operator, async (tx) => {
        const rows = await tx.query(
          `select ${STAFF_SUMMARY_JSON} as "staff", ${DAY_JSON} as "day"
           from orbit_erp.attendance_days($1::uuid, $2::date, $2::date) a
           join orbit_erp.staff s on s.id = a.staff_id
           order by s.display_name, s.id`,
          [facilityId, date],
        );
        const asOf = await one(tx, `select ${iso('now()')} as "asOf"`);
        return { asOf: String(asOf?.['asOf']), rows };
      }),

    recordPunch: (operator, punch, requestId) =>
      run(operator, async (tx) => {
        const staff = await one(tx, `select s.facility_id::text as "facilityId" from orbit_erp.staff s where s.id = $1::uuid`, [
          punch.staffId,
        ]);
        if (!staff) return null;
        const facilityId = String(staff['facilityId']);

        const inserted = await one(
          tx,
          `insert into orbit_erp.attendance_punches (staff_id, facility_id, direction, punched_at, source, idempotency_key)
           values ($1::uuid, $2::uuid, $3, coalesce($4::timestamptz, now()), $5, $6::uuid)
           on conflict (organization_id, idempotency_key) do nothing
           returning id::text as id`,
          [punch.staffId, facilityId, punch.direction, punch.punchedAt, punch.punchedAt ? 'admin-entry' : 'desk', punch.idempotencyKey],
        );

        let row: Record<string, unknown> | null;
        let replayed = false;
        if (inserted) {
          row = await one(tx, `select ${PUNCH_COLUMNS} from orbit_erp.attendance_punches p where p.id = $1::uuid`, [
            String(inserted['id']),
          ]);
          await audit(tx, 'punched', 'punch', String(inserted['id']), requestId);
        } else {
          row = await one(tx, `select ${PUNCH_COLUMNS} from orbit_erp.attendance_punches p where p.idempotency_key = $1::uuid`, [
            punch.idempotencyKey,
          ]);
          replayed = true;
          if (!row || row['staffId'] !== punch.staffId || row['direction'] !== punch.direction) {
            throw new ApiError('conflict', 'That request key was already used for a different punch.', 'punch_idempotency_mismatch');
          }
        }
        const dayRow = await punchDay(tx, punch.staffId, facilityId, String(row?.['punchedAt']));
        return { punch: row, replayed, day: dayRow?.['day'] ?? null };
      }),

    staffMonth: (operator, staffId, range) =>
      run(operator, async (tx) => {
        const staff = await selectStaff(tx, staffId);
        if (!staff) return null;
        const facilityId = String(staff['facilityId']);
        const [days, punches, corrections] = await Promise.all([
          tx.query(
            `select ${DAY_JSON} as "day" from orbit_erp.attendance_days($1::uuid, $2::date, $3::date, $4::uuid) a order by a.shift_date`,
            [facilityId, range.from, range.to, staffId],
          ),
          tx.query(
            `select ${PUNCH_COLUMNS} from orbit_erp.attendance_punches p
             where p.staff_id = $1::uuid and p.punched_at >= ($2::date - 1) and p.punched_at < ($3::date + 2)
             order by p.punched_at`,
            [staffId, range.from, range.to],
          ),
          tx.query(
            `select ${CORRECTION_COLUMNS} from orbit_erp.attendance_corrections c join orbit_erp.staff s on s.id = c.staff_id
             where c.staff_id = $1::uuid and c.shift_date between $2::date and $3::date order by c.shift_date, c.created_at`,
            [staffId, range.from, range.to],
          ),
        ]);
        return { staff, days: days.map((row) => row['day']), punches, corrections };
      }),

    listCorrections: (operator, query) =>
      run(operator, (tx) => {
        const where = `from orbit_erp.attendance_corrections c join orbit_erp.staff s on s.id = c.staff_id
          where ($1::uuid is null or c.facility_id = $1::uuid) and ($2::text is null or c.state = $2)`;
        return page(
          tx,
          `select count(*)::int as total ${where}`,
          `select ${CORRECTION_COLUMNS} ${where}
           order by (c.state = 'submitted') desc, c.created_at desc, c.id limit $3 offset $4`,
          [query.facilityId ?? null, query.state ?? null],
          query,
        );
      }),

    getCorrection: (operator, correctionId) => run(operator, (tx) => selectCorrection(tx, correctionId)),

    requestCorrection: (operator, input, requestId) =>
      run(operator, async (tx) => {
        const staff = await one(tx, `select s.facility_id::text as "facilityId" from orbit_erp.staff s where s.id = $1::uuid`, [
          input.staffId,
        ]);
        if (!staff) return null;
        const row = await one(
          tx,
          `insert into orbit_erp.attendance_corrections (staff_id, facility_id, shift_date, proposed_in, proposed_out, reason)
           values ($1::uuid, $2::uuid, $3::date, $4::timestamptz, $5::timestamptz, $6)
           returning id::text as id`,
          [input.staffId, String(staff['facilityId']), input.shiftDate, input.proposedIn ?? null, input.proposedOut ?? null, input.reason],
        );
        const id = String(row?.['id']);
        await audit(tx, 'created', 'correction', id, requestId);
        return selectCorrection(tx, id);
      }),

    decideCorrection: (operator, correctionId, input, requestId) =>
      run(operator, async (tx) => {
        const current = await selectCorrection(tx, correctionId);
        if (!current) return { status: 'not_found' };
        if (current['state'] !== 'submitted') {
          throw new ApiError('conflict', 'This correction has already been decided.', 'correction_already_decided');
        }
        if (current['requestedByMe'] === true) {
          throw new ApiError('forbidden', 'You cannot decide a correction you requested.', 'self_decision');
        }
        const row = await one(
          tx,
          `update orbit_erp.attendance_corrections c set
             state = $3, decision_note = $4, decided_by_membership_id = orbit.current_membership_id(),
             decided_at = now(), version = c.version + 1
           where c.id = $1::uuid and c.version = $2::int and c.state = 'submitted'
           returning c.id::text as id`,
          [correctionId, input.version, input.decision, input.note ?? null],
        );
        if (!row) return { status: 'stale' };
        await audit(tx, 'decided', 'correction', correctionId, requestId);
        return { status: 'ok', row: await selectCorrection(tx, correctionId) };
      }),

    rosterDay: (operator, facilityId, date) =>
      run(operator, (tx) =>
        tx.query(
          `select ${STAFF_SUMMARY_JSON} as "staff",
                  case when r.id is null then null else jsonb_build_object(
                    'rosterId', r.id::text, 'shiftTemplateId', r.shift_template_id::text, 'version', r.version) end as "assignment"
           from orbit_erp.staff s
           left join orbit_erp.roster_assignments r
             on r.staff_id = s.id and r.shift_date = $2::date and r.status = 'planned'
           where s.facility_id = $1::uuid
             and s.joined_on <= $2::date and (s.exited_on is null or s.exited_on >= $2::date)
           order by s.display_name, s.id`,
          [facilityId, date],
        ),
      ),

    setRoster: (operator, input, requestId) =>
      run(operator, async (tx) => {
        const staff = await one(tx, `select s.facility_id::text as "facilityId" from orbit_erp.staff s where s.id = $1::uuid`, [
          input.staffId,
        ]);
        if (!staff) return { status: 'not_found' };
        const existing = await one(
          tx,
          `select r.id::text as id, r.version from orbit_erp.roster_assignments r
           where r.staff_id = $1::uuid and r.shift_date = $2::date and r.status = 'planned'`,
          [input.staffId, input.date],
        );
        const assignment = (id: string) =>
          one(
            tx,
            `select r.id::text as "rosterId", r.shift_template_id::text as "shiftTemplateId", r.version
             from orbit_erp.roster_assignments r where r.id = $1::uuid`,
            [id],
          );

        if (existing && input.version !== Number(existing['version'])) return { status: 'stale' };
        const existingId = existing ? String(existing['id']) : null;

        if (input.shiftTemplateId === null) {
          if (!existingId) return { status: 'ok', row: null };
          await tx.query(
            `update orbit_erp.roster_assignments set status = 'cancelled', version = version + 1, updated_at = now()
             where id = $1::uuid`,
            [existingId],
          );
          await audit(tx, 'updated', 'roster', existingId, requestId);
          return { status: 'ok', row: null };
        }
        if (existingId) {
          await tx.query(
            `update orbit_erp.roster_assignments set shift_template_id = $2::uuid, version = version + 1, updated_at = now()
             where id = $1::uuid`,
            [existingId, input.shiftTemplateId],
          );
          await audit(tx, 'updated', 'roster', existingId, requestId);
          return { status: 'ok', row: await assignment(existingId) };
        }
        const created = await one(
          tx,
          `insert into orbit_erp.roster_assignments (staff_id, facility_id, shift_template_id, shift_date)
           values ($1::uuid, $2::uuid, $3::uuid, $4::date) returning id::text as id`,
          [input.staffId, String(staff['facilityId']), input.shiftTemplateId, input.date],
        );
        const id = String(created?.['id']);
        await audit(tx, 'created', 'roster', id, requestId);
        return { status: 'ok', row: await assignment(id) };
      }),

    // ---- Services ---------------------------------------------------------
    catalogue: (operator, query) =>
      run(operator, (tx) =>
        tx.query(
          `select jsonb_build_object(
                    'serviceId', sv.id::text, 'serviceCode', sv.service_code, 'name', sv.name, 'category', sv.category,
                    'departmentId', sv.department_id::text, 'unit', sv.unit, 'isActive', sv.is_active, 'version', sv.version
                  ) as "service",
                  ${AVAILABILITY_JSON('fs')} as "availability"
           from orbit_erp.services sv
           left join orbit_erp.facility_services fs on fs.service_id = sv.id and fs.facility_id = $1::uuid
           where ($2::text is null or sv.category = $2) and ($3::boolean or sv.is_active)
           order by sv.category, sv.name`,
          [query.facilityId, query.category, query.includeInactive],
        ),
      ),

    createService: (operator, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `insert into orbit_erp.services (service_code, name, category, department_id, unit)
           values ($1, $2, $3, $4::uuid, $5) returning id::text as id`,
          [input.serviceCode, input.name, input.category, input.departmentId, input.unit],
        );
        const id = String(row?.['id']);
        await audit(tx, 'created', 'service', id, requestId);
        return selectService(tx, id);
      }),

    updateService: (operator, serviceId, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `update orbit_erp.services sv set
             name = coalesce($3, sv.name),
             category = coalesce($4, sv.category),
             department_id = coalesce($5::uuid, sv.department_id),
             unit = coalesce($6, sv.unit),
             is_active = coalesce($7::boolean, sv.is_active),
             version = sv.version + 1,
             updated_at = now()
           where sv.id = $1::uuid and sv.version = $2::int
           returning sv.id::text as id`,
          [
            serviceId,
            input.version,
            input.name ?? null,
            input.category ?? null,
            input.departmentId ?? null,
            input.unit ?? null,
            input.isActive ?? null,
          ],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.services', 'id', serviceId);
        await audit(tx, 'updated', 'service', serviceId, requestId);
        return { status: 'ok', row: await selectService(tx, serviceId) };
      }),

    setAvailability: (operator, target, input, requestId) =>
      run(operator, async (tx) => {
        if (!(await selectService(tx, target.serviceId))) return { status: 'not_found' };
        const existing = await one(
          tx,
          `select fs.id::text as id, fs.version from orbit_erp.facility_services fs
           where fs.facility_id = $1::uuid and fs.service_id = $2::uuid`,
          [target.facilityId, target.serviceId],
        );
        const tariffGiven = input.illustrativeTariff !== undefined;
        let id: string;
        if (existing) {
          if (input.version !== Number(existing['version'])) return { status: 'stale' };
          id = String(existing['id']);
          await tx.query(
            `update orbit_erp.facility_services fs set
               is_available = $2::boolean,
               illustrative_tariff = case when $3::boolean then $4::numeric else fs.illustrative_tariff end,
               version = fs.version + 1, updated_at = now()
             where fs.id = $1::uuid`,
            [id, input.isAvailable, tariffGiven, input.illustrativeTariff ?? null],
          );
          await audit(tx, 'updated', 'facility_service', id, requestId);
        } else {
          const row = await one(
            tx,
            `insert into orbit_erp.facility_services (facility_id, service_id, is_available, illustrative_tariff)
             values ($1::uuid, $2::uuid, $3::boolean, $4::numeric) returning id::text as id`,
            [target.facilityId, target.serviceId, input.isAvailable, input.illustrativeTariff ?? null],
          );
          id = String(row?.['id']);
          await audit(tx, 'created', 'facility_service', id, requestId);
        }
        const row = await one(tx, `select ${AVAILABILITY_JSON('fs')} as "availability" from orbit_erp.facility_services fs where fs.id = $1::uuid`, [id]);
        return { status: 'ok', row: row?.['availability'] ?? null };
      }),

    // ---- Patients and visits ---------------------------------------------
    searchPatients: (operator, query) =>
      run(operator, (tx) => {
        const where = `from orbit_erp.patients p where p.display_name ilike $1 or p.mrn ilike $1`;
        return page(
          tx,
          `select count(*)::int as total ${where}`,
          `select ${PATIENT_COLUMNS} ${where} order by p.display_name, p.mrn limit $2 offset $3`,
          [likePattern(query.q)],
          query,
        );
      }),

    registerPatient: (operator, input, requestId) =>
      run(operator, async (tx) => {
        if (!input.confirmNotDuplicate) {
          const duplicate = await one(
            tx,
            `select 1 as found from orbit_erp.patients p
             where lower(p.display_name) = lower($1) and p.birth_year = $2::int limit 1`,
            [input.displayName, input.birthYear],
          );
          if (duplicate) return { status: 'possible_duplicate' };
        }
        const row = await one(
          tx,
          `insert into orbit_erp.patients (home_facility_id, display_name, sex, birth_year)
           values ($1::uuid, $2, $3, $4::int) returning id::text as id`,
          [input.homeFacilityId, input.displayName, input.sex, input.birthYear],
        );
        const id = String(row?.['id']);
        await audit(tx, 'created', 'patient', id, requestId);
        return { status: 'created', patient: await selectPatient(tx, id) };
      }),

    getPatient: (operator, patientId, requestId) =>
      run(operator, async (tx) => {
        const patient = await selectPatient(tx, patientId);
        if (!patient) return null;
        const encounters = await tx.query(
          `select ${ENCOUNTER_COLUMNS} ${ENCOUNTER_FROM} where e.patient_id = $1::uuid order by e.started_at desc, e.id`,
          [patientId],
        );
        await audit(tx, 'viewed', 'patient', patientId, requestId);
        return { patient, encounters };
      }),

    updatePatient: (operator, patientId, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `update orbit_erp.patients p set
             display_name = coalesce($3, p.display_name),
             sex = coalesce($4, p.sex),
             birth_year = coalesce($5::int, p.birth_year),
             status = coalesce($6, p.status),
             version = p.version + 1,
             updated_at = now()
           where p.id = $1::uuid and p.version = $2::int
           returning p.id::text as id`,
          [patientId, input.version, input.displayName ?? null, input.sex ?? null, input.birthYear ?? null, input.status ?? null],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.patients', 'id', patientId);
        await audit(tx, 'updated', 'patient', patientId, requestId);
        return { status: 'ok', row: await selectPatient(tx, patientId) };
      }),

    listEncounters: (operator, query) =>
      run(operator, (tx) => {
        const where = `${ENCOUNTER_FROM}
          join orbit_erp.patients p on p.id = e.patient_id
          join orbit.organizations o on o.id = e.organization_id
          where ($1::uuid is null or e.facility_id = $1::uuid)
            and ($2::text is null or e.status = $2)
            and ($3::text is null or e.encounter_type = $3)
            and ($4::date is null or (e.started_at at time zone o.timezone)::date = $4::date)`;
        return page(
          tx,
          `select count(*)::int as total ${where}`,
          `select jsonb_build_object(
                    'encounterId', e.id::text, 'patientId', e.patient_id::text, 'facilityId', e.facility_id::text,
                    'departmentId', e.department_id::text, 'attendingDoctorId', e.attending_doctor_id::text,
                    'attendingDoctorName', doc.display_name, 'encounterType', e.encounter_type, 'status', e.status,
                    'startedAt', ${iso('e.started_at')}, 'endedAt', ${iso('e.ended_at')}, 'version', e.version
                  ) as "encounter",
                  p.display_name as "patientName", p.mrn as "mrn"
           ${where}
           order by (e.status = 'open') desc, e.started_at desc, e.id limit $5 offset $6`,
          [query.facilityId ?? null, query.status ?? null, query.encounterType ?? null, query.date ?? null],
          query,
        );
      }),

    openEncounter: (operator, input, requestId) =>
      run(operator, async (tx) => {
        if (!(await selectPatient(tx, input.patientId))) return null;
        const row = await one(
          tx,
          `insert into orbit_erp.encounters (patient_id, facility_id, department_id, attending_doctor_id, encounter_type, started_at, presenting_condition_id)
           values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, coalesce($6::timestamptz, now()), $7::uuid)
           returning id::text as id`,
          [
            input.patientId,
            input.facilityId,
            input.departmentId,
            input.attendingDoctorId ?? null,
            input.encounterType,
            input.startedAt ?? null,
            input.presentingConditionId ?? null,
          ],
        );
        const id = String(row?.['id']);
        await audit(tx, 'created', 'encounter', id, requestId);
        return selectEncounter(tx, id);
      }),

    getEncounter: (operator, encounterId, requestId) =>
      run(operator, async (tx) => {
        const encounter = await selectEncounter(tx, encounterId);
        if (!encounter) return null;
        const [patient, deliveries] = await Promise.all([
          selectPatient(tx, String(encounter['patientId'])),
          tx.query(`${DELIVERY_SELECT} where sd.encounter_id = $1::uuid order by sd.performed_at, sd.id`, [encounterId]),
        ]);
        await audit(tx, 'viewed', 'encounter', encounterId, requestId);
        return { encounter, patient, deliveries };
      }),

    updateEncounter: (operator, encounterId, input, requestId) =>
      run(operator, async (tx) => {
        const current = await one(
          tx,
          `select e.status, e.version from orbit_erp.encounters e where e.id = $1::uuid`,
          [encounterId],
        );
        if (!current) return { status: 'not_found' };
        if (Number(current['version']) !== input.version) return { status: 'stale' };
        if (current['status'] !== 'open') {
          throw new ApiError('conflict', 'Only an open visit can be changed.', 'encounter_not_open');
        }
        if (input.status === 'cancelled') {
          const delivered = await one(
            tx,
            `select 1 as found from orbit_erp.service_deliveries sd where sd.encounter_id = $1::uuid and sd.status = 'completed' limit 1`,
            [encounterId],
          );
          if (delivered) {
            throw new ApiError('conflict', 'A visit with recorded services cannot be cancelled; close it instead.', 'cancel_with_services');
          }
        }
        const doctorGiven = input.attendingDoctorId !== undefined;
        await tx.query(
          `update orbit_erp.encounters e set
             status = coalesce($3, e.status),
             ended_at = case when $3::text is null then e.ended_at else coalesce($4::timestamptz, now()) end,
             attending_doctor_id = case when $5::boolean then $6::uuid else e.attending_doctor_id end,
             presenting_condition_id = case when $7::boolean then $8::uuid else e.presenting_condition_id end,
             version = e.version + 1,
             updated_at = now()
           where e.id = $1::uuid and e.version = $2::int`,
          [
            encounterId, input.version, input.status ?? null, input.endedAt ?? null, doctorGiven, input.attendingDoctorId ?? null,
            input.presentingConditionId !== undefined, input.presentingConditionId ?? null,
          ],
        );
        await audit(tx, 'updated', 'encounter', encounterId, requestId);
        return { status: 'ok', row: await selectEncounter(tx, encounterId) };
      }),

    recordDelivery: (operator, encounterId, input, requestId) =>
      run(operator, async (tx) => {
        const encounter = await one(tx, `select e.facility_id::text as "facilityId" from orbit_erp.encounters e where e.id = $1::uuid`, [
          encounterId,
        ]);
        if (!encounter) return null;
        const inserted = await one(
          tx,
          `insert into orbit_erp.service_deliveries
             (encounter_id, facility_id, service_id, performed_by_staff_id, quantity, performed_at, idempotency_key)
           values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, coalesce($6::timestamptz, now()), $7::uuid)
           on conflict (organization_id, idempotency_key) do nothing
           returning id::text as id`,
          [
            encounterId,
            String(encounter['facilityId']),
            input.serviceId,
            input.performedByStaffId,
            input.quantity,
            input.performedAt ?? null,
            input.idempotencyKey,
          ],
        );
        if (inserted) {
          const id = String(inserted['id']);
          await audit(tx, 'created', 'service_delivery', id, requestId);
          return { delivery: await selectDelivery(tx, id), replayed: false };
        }
        const existing = await one(tx, `${DELIVERY_SELECT} where sd.idempotency_key = $1::uuid`, [input.idempotencyKey]);
        if (!existing || existing['encounterId'] !== encounterId || existing['serviceId'] !== input.serviceId) {
          throw new ApiError('conflict', 'That request key was already used for a different service.', 'delivery_idempotency_mismatch');
        }
        return { delivery: existing, replayed: true };
      }),

    updateDelivery: (operator, deliveryId, input, requestId) =>
      run(operator, async (tx) => {
        const row = await one(
          tx,
          `update orbit_erp.service_deliveries sd set status = $3, version = sd.version + 1, updated_at = now()
           where sd.id = $1::uuid and sd.version = $2::int and sd.status = 'completed'
           returning sd.id::text as id`,
          [deliveryId, input.version, input.status],
        );
        if (!row) return staleOrMissing(tx, 'orbit_erp.service_deliveries', 'id', deliveryId);
        await audit(tx, 'updated', 'service_delivery', deliveryId, requestId);
        return { status: 'ok', row: await selectDelivery(tx, deliveryId) };
      }),

    audit: (operator, paging) =>
      run(operator, (tx) =>
        page(
          tx,
          `select count(*)::int as total from orbit_erp.audit_events`,
          `select ev.id::text as "eventId", ${iso('ev.occurred_at')} as "occurredAt",
                  ev.actor_operator_role as "actorRole", ev.action, ev.target_type as "targetType",
                  ev.target_id::text as "targetId", ev.request_id as "requestId"
           from orbit_erp.audit_events ev order by ev.occurred_at desc, ev.id desc limit $1 offset $2`,
          [],
          paging,
        ),
      ),
  };
}
