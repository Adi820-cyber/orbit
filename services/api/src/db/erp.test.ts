import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import type { OperatorClaims } from '@orbit/contracts';
import { ApiError } from '../plugins/errors.ts';
import { connect, type Database, type Tx } from './client.ts';
import { createDbErpStore, likePattern, mapDbError } from './erp.ts';

describe('likePattern', () => {
  it('escapes LIKE wildcards so user text is literal', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('mapDbError', () => {
  it('maps database refusals to typed API errors', () => {
    const rule = mapDbError({ code: 'P0001', message: 'erp:service_not_available' });
    expect(rule).toBeInstanceOf(ApiError);
    expect((rule as ApiError).code).toBe('conflict');
    expect((mapDbError({ code: '23505', constraint_name: 'encounters_one_open_inpatient' }) as ApiError).message).toMatch(/open inpatient/);
    expect((mapDbError({ code: '23514', constraint_name: 'corrections_not_self_decided' }) as ApiError).code).toBe('forbidden');
    expect((mapDbError({ code: '42501' }) as ApiError).code).toBe('forbidden');
  });

  it('leaves unknown errors alone, so they surface as 500s', () => {
    const error = new Error('connection reset');
    expect(mapDbError(error)).toBe(error);
  });
});

/*
 * Integration: the real SQL, RLS policies and triggers of migration
 * 20261001000100 against Postgres.
 *
 * Needs ORBIT_TEST_OWNER_DATABASE_URL: a connection as the database OWNER to a
 * THROWAWAY database with all migrations applied (for example the scratch
 * database supabase/validate-local.ps1 creates). It inserts fixtures, so never
 * point it at a shared project. Each run creates its own organization. Every
 * store call runs as `orbit_app` (`set local role`), exactly the role the API
 * connects as, so the policies are what is being tested — the owner bypasses
 * nothing here. Skipped otherwise; a skip is "not verified", never "passed".
 */
const ownerUrl = process.env.ORBIT_TEST_OWNER_DATABASE_URL;

/** Each transaction drops to orbit_app before the store's statements run. */
function appRoleDatabase(sql: Sql): Database {
  return {
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const box: { value?: T } = {};
      await sql.begin(async (transaction) => {
        await transaction.unsafe('set local role orbit_app');
        box.value = await fn({ query: async (text, params = []) => [...(await transaction.unsafe(text, params))] });
      });
      return box.value as T;
    },
  };
}

function utcDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!ownerUrl)('ERP store against Postgres (integration)', { timeout: 60_000 }, () => {
  let sql: Sql;
  const store = () => createDbErpStore(appRoleDatabase(sql));
  const ids = {
    org: randomUUID(),
    region: randomUUID(),
    facility1: randomUUID(),
    facility2: randomUUID(),
    department: randomUUID(),
    specialty: randomUUID(),
    dayShift: randomUUID(),
  };
  const claims: Record<'admin' | 'admin2' | 'hospital1' | 'hospital2', OperatorClaims> = {
    admin: { membershipId: randomUUID(), subject: randomUUID(), organizationId: ids.org, operatorRole: 'admin', scopes: [{ grain: 'group', entityId: ids.org }] },
    admin2: { membershipId: randomUUID(), subject: randomUUID(), organizationId: ids.org, operatorRole: 'admin', scopes: [{ grain: 'group', entityId: ids.org }] },
    hospital1: { membershipId: randomUUID(), subject: randomUUID(), organizationId: ids.org, operatorRole: 'hospital', scopes: [{ grain: 'facility', entityId: ids.facility1 }] },
    hospital2: { membershipId: randomUUID(), subject: randomUUID(), organizationId: ids.org, operatorRole: 'hospital', scopes: [{ grain: 'facility', entityId: ids.facility2 }] },
  };
  const suffix = ids.org.slice(0, 8);
  const day = utcDate(2);
  let nurse = '';
  let nurse2 = '';
  let doctor = '';
  let service = '';
  let patient = '';
  let encounter = '';

  beforeAll(async () => {
    sql = connect({ url: ownerUrl ?? '', ssl: process.env.ORBIT_TEST_DATABASE_SSL !== 'false', max: 2 });
    // Fixtures as the owner: an organization, two facilities, operator memberships, reference data.
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `insert into orbit.organizations (id, slug, name, kind, currency, fiscal_year_start_month, timezone)
         values ($1, $2, 'ERP integration test org', 'test-fixture', 'USD', 1, 'UTC')`,
        [ids.org, `erp-test-${suffix}`],
      );
      await tx.unsafe(`insert into orbit.regions (id, organization_id, slug, name, short_name) values ($1, $2, 'r', 'Region', 'R')`, [ids.region, ids.org]);
      await tx.unsafe(
        `insert into orbit.facilities (id, organization_id, region_id, slug, name, staffed_beds, revenue_weight)
         values ($1, $3, $4, 'f1', 'Facility one', 100, 0.5), ($2, $3, $4, 'f2', 'Facility two', 100, 0.5)`,
        [ids.facility1, ids.facility2, ids.org, ids.region],
      );
      for (const [name, member] of Object.entries(claims)) {
        await tx.unsafe(`insert into orbit.org_memberships (id, subject, organization_id, operator_role) values ($1, $2, $3, $4)`, [
          member.membershipId,
          member.subject,
          ids.org,
          member.operatorRole,
        ]);
        const scope = member.scopes[0];
        await tx.unsafe(
          `insert into orbit.org_membership_scopes (membership_id, organization_id, grain, facility_id) values ($1, $2, $3, $4)`,
          [member.membershipId, ids.org, scope?.grain ?? 'group', scope?.grain === 'facility' ? scope.entityId : null],
        );
        expect(name).toBeTruthy();
      }
      await tx.unsafe(
        `insert into orbit_erp.erp_settings (organization_id, late_grace_minutes, early_exit_grace_minutes,
           punch_window_before_minutes, punch_window_after_minutes, credential_warning_days)
         values ($1, 10, 10, 120, 240, 30)`,
        [ids.org],
      );
      await tx.unsafe(`insert into orbit_erp.departments (id, organization_id, code, name) values ($1, $2, 'OPD', 'Outpatients')`, [ids.department, ids.org]);
      await tx.unsafe(`insert into orbit_erp.specialties (id, organization_id, code, name) values ($1, $2, 'GEN', 'General medicine')`, [ids.specialty, ids.org]);
      await tx.unsafe(
        `insert into orbit_erp.shift_templates (id, organization_id, code, name, start_time, end_time, break_minutes)
         values ($1, $2, 'D', 'Day', '08:00', '16:00', 30)`,
        [ids.dayShift, ids.org],
      );
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const staffInput = (code: string, facilityId: string) => ({
    facilityId,
    departmentId: ids.department,
    employeeCode: code,
    displayName: `Person ${code}`,
    staffType: 'nurse' as const,
    designation: 'Staff nurse',
    joinedOn: '2025-01-01',
    isCriticalRole: false,
  });

  it('lets an admin create staff and doctors, and refuses a hospital account at the database', async () => {
    const created = (await store().createStaff(claims.admin, staffInput('T-N-0001', ids.facility1), 'req-1')) as Record<string, unknown>;
    nurse = String(created['staffId']);
    nurse2 = String(((await store().createStaff(claims.admin, staffInput('T-N-0002', ids.facility1), 'req-2')) as Record<string, unknown>)['staffId']);
    const doc = (await store().createDoctor(
      claims.admin,
      {
        ...staffInput('T-D-0001', ids.facility1),
        designation: 'Consultant',
        specialtyId: ids.specialty,
        registrationNumber: `DEMO-REG-${String(Date.now()).slice(-6)}`,
        credentialExpiresOn: utcDate(-400),
        employmentType: 'employed',
      },
      'req-3',
    )) as Record<string, unknown>;
    doctor = String(doc['staffId']);
    expect(doc['credentialStatus']).toBe('active');

    await expect(store().createStaff(claims.hospital1, staffInput('T-N-0003', ids.facility1), 'req-4')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(store().createStaff(claims.admin, staffInput('T-N-0001', ids.facility1), 'req-5')).rejects.toMatchObject({
      code: 'conflict',
      message: 'That employee code is already in use.',
    });
  });

  it('isolates facilities: a hospital account sees only its own people', async () => {
    expect(await store().getStaff(claims.hospital1, nurse)).not.toBeNull();
    expect(await store().getStaff(claims.hospital2, nurse)).toBeNull();
    const list = await store().listStaff(claims.hospital2, { page: 1, pageSize: 25 });
    expect(list.total).toBe(0);
    const adminList = await store().listStaff(claims.admin, { page: 1, pageSize: 25 });
    expect(adminList.total).toBe(3);
  });

  it('derives late, missing-punch and absent from roster and punches, and never counts missing as zero', async () => {
    for (const staffId of [nurse, nurse2, doctor]) {
      expect((await store().setRoster(claims.admin, { staffId, date: day, shiftTemplateId: ids.dayShift }, 'req-r')).status).toBe('ok');
    }
    const punch = (staffId: string, direction: 'in' | 'out', time: string) =>
      store().recordPunch(claims.admin, { staffId, direction, idempotencyKey: randomUUID(), punchedAt: `${day}T${time}:00Z` }, 'req-p');
    await punch(nurse, 'in', '08:25');
    const out = await punch(nurse, 'out', '16:05');
    expect(out?.day).toMatchObject({ status: 'late', lateMinutes: 25, workedMinutes: 430 });
    await punch(nurse2, 'in', '07:58');

    const board = await store().attendanceBoard(claims.hospital1, ids.facility1, day);
    const status = Object.fromEntries(
      board.rows.map((row) => {
        const { staff, day: derived } = row as { staff: { staffId: string }; day: { status: string; workedMinutes: number | null } };
        return [staff.staffId, derived];
      }),
    );
    expect(status[nurse]).toMatchObject({ status: 'late', workedMinutes: 430 });
    expect(status[nurse2]).toMatchObject({ status: 'missing-punch', workedMinutes: null });
    expect(status[doctor]).toMatchObject({ status: 'absent', workedMinutes: null });

    const elsewhere = await store().attendanceBoard(claims.hospital2, ids.facility1, day);
    expect(elsewhere.rows).toHaveLength(0);
  });

  it('shows an upcoming rostered shift as scheduled and off duty, never with a null flag', async () => {
    const tomorrow = utcDate(-1);
    expect((await store().setRoster(claims.hospital1, { staffId: nurse, date: tomorrow, shiftTemplateId: ids.dayShift }, 'req-t')).status).toBe('ok');
    const board = await store().attendanceBoard(claims.hospital1, ids.facility1, tomorrow);
    const upcoming = board.rows.map((row) => (row as { day: Record<string, unknown> }).day).find((derived) => derived['staffId'] === nurse);
    expect(upcoming).toMatchObject({ status: 'scheduled', onDuty: false, workedMinutes: null, punchCount: 0 });
  });

  it('replays a punch by its key instead of recording it twice', async () => {
    const key = randomUUID();
    const first = await store().recordPunch(claims.hospital1, { staffId: doctor, direction: 'in', idempotencyKey: key, punchedAt: null }, 'req-a');
    const again = await store().recordPunch(claims.hospital1, { staffId: doctor, direction: 'in', idempotencyKey: key, punchedAt: null }, 'req-b');
    if (!first || !again) throw new Error('both punches must be visible to their recorder');
    expect(again.replayed).toBe(true);
    expect((again.punch as { punchId: string }).punchId).toBe((first.punch as { punchId: string }).punchId);
    expect(await store().recordPunch(claims.hospital2, { staffId: doctor, direction: 'out', idempotencyKey: randomUUID(), punchedAt: null }, 'req-c')).toBeNull();
  });

  it('applies four-eyes corrections: the requester cannot decide, another admin can', async () => {
    const requested = (await store().requestCorrection(
      claims.admin,
      { staffId: nurse2, shiftDate: day, proposedOut: `${day}T16:00:00Z`, reason: 'Forgot to punch out' },
      'req-c1',
    )) as Record<string, unknown>;
    const correctionId = String(requested['correctionId']);
    await expect(store().decideCorrection(claims.admin, correctionId, { version: 1, decision: 'approved' }, 'req-c2')).rejects.toMatchObject({
      code: 'forbidden',
    });
    const decided = await store().decideCorrection(claims.admin2, correctionId, { version: 1, decision: 'approved' }, 'req-c3');
    expect(decided.status).toBe('ok');
    const board = await store().attendanceBoard(claims.hospital1, ids.facility1, day);
    const corrected = board.rows.map((row) => (row as { day: { staffId: string } }).day).find((derived) => derived.staffId === nurse2);
    expect(corrected).toMatchObject({ status: 'present', corrected: true, workedMinutes: 452 });
  });

  it('records services only where they are offered, by credentialed staff, within an open visit', async () => {
    service = String(
      ((await store().createService(
        claims.admin,
        { serviceCode: `CON-${suffix.slice(0, 4).toUpperCase()}`, name: 'General consultation', category: 'consultation', departmentId: ids.department, unit: 'per-visit' },
        'req-s1',
      )) as Record<string, unknown>)['serviceId'],
    );
    const registered = await store().registerPatient(
      claims.hospital1,
      { homeFacilityId: ids.facility1, displayName: 'Integration Patient', sex: 'female', birthYear: 1985, confirmNotDuplicate: false },
      'req-p1',
    );
    expect(registered.status).toBe('created');
    patient = String((registered as { patient: Record<string, unknown> }).patient['patientId']);
    expect(
      (await store().registerPatient(
        claims.hospital1,
        { homeFacilityId: ids.facility1, displayName: 'integration patient', sex: 'female', birthYear: 1985, confirmNotDuplicate: false },
        'req-p2',
      )).status,
    ).toBe('possible_duplicate');

    encounter = String(
      ((await store().openEncounter(
        claims.hospital1,
        { patientId: patient, facilityId: ids.facility1, departmentId: ids.department, encounterType: 'inpatient', attendingDoctorId: doctor },
        'req-e1',
      )) as Record<string, unknown>)['encounterId'],
    );
    await expect(
      store().openEncounter(claims.hospital1, { patientId: patient, facilityId: ids.facility1, departmentId: ids.department, encounterType: 'inpatient' }, 'req-e2'),
    ).rejects.toMatchObject({ code: 'conflict', message: 'This patient already has an open inpatient admission.' });

    const deliver = () =>
      store().recordDelivery(claims.hospital1, encounter, { serviceId: service, performedByStaffId: doctor, quantity: 1, idempotencyKey: randomUUID() }, 'req-d');
    await expect(deliver()).rejects.toMatchObject({ code: 'conflict', message: 'This service is not offered at this facility.' });

    // Offering a service at a facility for the first time is an admin decision, at the database too.
    await expect(
      store().setAvailability(claims.hospital1, { facilityId: ids.facility1, serviceId: service }, { isAvailable: true }, 'req-a1'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await store().setAvailability(claims.admin, { facilityId: ids.facility1, serviceId: service }, { isAvailable: true, illustrativeTariff: 40 }, 'req-a2')).status).toBe('ok');

    const delivered = await deliver();
    expect(delivered?.delivery).toMatchObject({ serviceName: 'General consultation', illustrativeAmount: 40 });

    // A suspended credential blocks the doctor from further services.
    const current = (await store().getDoctor(claims.admin, doctor))?.doctor as Record<string, unknown>;
    expect((await store().updateDoctor(claims.admin, doctor, { version: Number(current['version']), credentialSuspended: true }, 'req-u')).status).toBe('ok');
    await expect(deliver()).rejects.toMatchObject({ code: 'conflict', message: "This doctor's credential is expired or suspended for that date." });
  });

  it('keeps patients inside their facilities and audits every view', async () => {
    expect(await store().getPatient(claims.hospital2, patient, 'req-v0')).toBeNull();
    expect((await store().searchPatients(claims.hospital2, { q: 'Integration', page: 1, pageSize: 25 })).total).toBe(0);
    const seen = await store().getPatient(claims.hospital1, patient, 'req-view-1');
    expect(seen?.encounters).toHaveLength(1);

    const trail = await store().audit(claims.admin, { page: 1, pageSize: 100 });
    const views = trail.items.filter((event) => (event as { action: string; requestId: string }).requestId === 'req-view-1');
    expect(views).toMatchObject([{ action: 'viewed', targetType: 'patient', targetId: patient, actorRole: 'hospital' }]);
    expect((await store().audit(claims.hospital1, { page: 1, pageSize: 100 })).total).toBe(0);
  });

  it('refuses to close a visit before its recorded services', async () => {
    const detail = await store().getEncounter(claims.hospital1, encounter, 'req-g');
    if (!detail) throw new Error('the visit must be visible to its facility');
    const version = Number((detail.encounter as Record<string, unknown>)['version']);
    await expect(
      store().updateEncounter(claims.hospital1, encounter, { version, status: 'closed', endedAt: '2000-01-01T00:00:00Z' }, 'req-x'),
    ).rejects.toMatchObject({ code: 'conflict', message: 'Services were recorded after that closing time. Choose a later closing time.' });
    const closed = await store().updateEncounter(claims.hospital1, encounter, { version, status: 'closed' }, 'req-y');
    expect(closed).toMatchObject({ status: 'ok', row: { status: 'closed' } });
    expect(await store().updateEncounter(claims.hospital1, encounter, { version, status: 'closed' }, 'req-z')).toEqual({ status: 'stale' });
  });

  it('shows a leader transaction no ERP rows at all', async () => {
    const counts = await sql.begin(async (tx) => {
      await tx.unsafe('set local role orbit_app');
      await tx.unsafe(`select set_config('orbit.membership', $1, true)`, [
        JSON.stringify({ membershipId: randomUUID(), subject: randomUUID(), organizationId: ids.org, role: 'chairman', scopes: [{ grain: 'group', entityId: ids.org }] }),
      ]);
      const [row] = await tx.unsafe(
        `select (select count(*) from orbit_erp.staff)::int as staff, (select count(*) from orbit_erp.patients)::int as patients,
                (select count(*) from orbit_erp.services)::int as services`,
      );
      return row;
    });
    expect(counts).toEqual({ staff: 0, patients: 0, services: 0 });
  });
});
