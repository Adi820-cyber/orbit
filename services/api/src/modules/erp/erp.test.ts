import { afterEach, describe, expect, it } from 'vitest';
import { ERP_DISCLOSURE } from '@orbit/contracts';
import {
  buildErpApp,
  CORRECTION_ID,

  DEPARTMENT_ID,
  ENCOUNTER_ID,
  FACILITY_1,
  FACILITY_2,
  LEADER_SUBJECT,
  OPERATOR_SUBJECT,
  PATIENT_ID,
  SERVICE_ID,
  STAFF_ID,
} from '../../../test/helpers/erp.ts';
import { ORG_A } from '../../../test/helpers/fixtures.ts';
import { buildApp } from '../../build.ts';
import { pendingModuleDeps } from '../pending.ts';
import { fixtureMemberships } from '../../../test/helpers/fixtures.ts';
import { OPERATOR_MEMBERSHIPS } from '../../../test/helpers/erp.ts';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from '../../../test/helpers/tokens.ts';
import { monthRange } from './access.ts';

const { admin, hospital1, hospital2 } = OPERATOR_SUBJECT;
const KEY = 'd0000000-0000-4000-8000-000000000001';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(...args: Parameters<typeof buildErpApp>) {
  const built = await buildErpApp(...args);
  close = () => built.app.close();
  return built;
}

describe('who may use the ERP (ADR 0016)', () => {
  it('refuses a leader account on every ERP route, before any data is read', async () => {
    const { call, calls } = await setup();
    for (const url of ['/api/erp/reference', '/api/erp/attendance/board', `/api/erp/patients/${PATIENT_ID}`]) {
      const response = await call(LEADER_SUBJECT, 'GET', url);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses an operator account on the leader workspace', async () => {
    const { call } = await setup();
    for (const url of ['/api/brief', '/api/kpi', '/api/actions', '/api/audit']) {
      const response = await call(hospital1, 'GET', url);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
  });

  it('answers /api/me with the operator role and scope', async () => {
    const { call } = await setup();
    const response = await call(hospital1, 'GET', '/api/me');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      operatorRole: 'hospital',
      organizationId: ORG_A,
      scopes: [{ grain: 'facility', entityId: FACILITY_1 }],
    });
    const leader = await call(LEADER_SUBJECT, 'GET', '/api/me');
    expect(leader.json().role).toBe('regional-coo');
  });

  it('fails closed with 503 while the ERP source is not live', async () => {
    const issuer = await createTestIssuer();
    const app = await buildApp({
      allowedOrigins: [],
      modules: pendingModuleDeps(),
      auth: { getKey: issuer.getKey, issuer: TEST_ISSUER, audience: TEST_AUDIENCE, memberships: fixtureMemberships(OPERATOR_MEMBERSHIPS) },
    });
    close = () => app.close();
    const response = await app.inject({
      method: 'GET',
      url: '/api/erp/reference',
      headers: { authorization: `Bearer ${await issuer.sign(hospital1)}` },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('facility scope', () => {
  it('defaults a hospital account to its own facility', async () => {
    const { call, reached } = await setup();
    const response = await call(hospital1, 'GET', '/api/erp/attendance/board');
    expect(response.statusCode).toBe(200);
    expect(reached('attendanceBoard')[0]?.args).toEqual([FACILITY_1, '2026-09-28']);
  });

  it('refuses a hospital account another facility explicitly, never with an empty answer', async () => {
    const { call, reached } = await setup();
    for (const url of [
      `/api/erp/attendance/board?facilityId=${FACILITY_2}`,
      `/api/erp/summary?facilityId=${FACILITY_2}`,
      `/api/erp/staff?facilityId=${FACILITY_2}`,
      `/api/erp/rosters?facilityId=${FACILITY_2}`,
    ]) {
      const response = await call(hospital1, 'GET', url);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('out_of_scope');
    }
    expect(reached('attendanceBoard')).toHaveLength(0);
    expect(reached('listStaff')).toHaveLength(0);

    const register = await call(hospital1, 'POST', '/api/erp/patients', {
      homeFacilityId: FACILITY_2,
      displayName: 'Someone Else',
      sex: 'male',
      birthYear: 1970,
    });
    expect(register.json().error.code).toBe('out_of_scope');
    expect(reached('registerPatient')).toHaveLength(0);
  });

  it('makes an admin name a facility, and refuses one outside the organization', async () => {
    const { call } = await setup();
    expect((await call(admin, 'GET', '/api/erp/attendance/board')).statusCode).toBe(400);
    expect((await call(admin, 'GET', `/api/erp/attendance/board?facilityId=${FACILITY_2}`)).statusCode).toBe(200);
    const unknown = await call(admin, 'GET', '/api/erp/attendance/board?facilityId=f0000000-0000-4000-8000-0000000000ff');
    expect(unknown.statusCode).toBe(404);
  });
});

describe('admin-only operations', () => {
  const newStaff = {
    facilityId: FACILITY_1,
    departmentId: DEPARTMENT_ID,
    employeeCode: 'AV-N-0099',
    displayName: 'New Person',
    staffType: 'nurse',
    designation: 'Staff nurse',
    joinedOn: '2026-09-01',
  };

  it('lets only an admin add or change staff, doctors and the catalogue', async () => {
    const { call, reached } = await setup();
    const attempts: Array<['POST' | 'PATCH', string, object]> = [
      ['POST', '/api/erp/staff', newStaff],
      ['PATCH', `/api/erp/staff/${STAFF_ID}`, { version: 1, designation: 'Senior nurse' }],
      ['PATCH', `/api/erp/doctors/${STAFF_ID}`, { version: 1, credentialSuspended: true }],
      ['POST', '/api/erp/services', { serviceCode: 'LAB-NEW', name: 'New test', category: 'diagnostics-lab', departmentId: DEPARTMENT_ID, unit: 'per-test' }],
      ['POST', `/api/erp/attendance/corrections/${CORRECTION_ID}/decision`, { version: 1, decision: 'approved' }],
    ];
    for (const [method, url, body] of attempts) {
      const response = await call(hospital1, method, url, body);
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
    expect(reached('createStaff')).toHaveLength(0);
    expect(reached('decideCorrection')).toHaveLength(0);

    const created = await call(admin, 'POST', '/api/erp/staff', newStaff);
    expect(created.statusCode).toBe(201);
    expect(created.json().staff.employeeCode).toBe('AV-N-0099');
  });

  it('never creates a doctor through the staff endpoint', async () => {
    const { call } = await setup();
    const response = await call(admin, 'POST', '/api/erp/staff', { ...newStaff, staffType: 'doctor' });
    expect(response.statusCode).toBe(400);
  });

  it('lets only an admin back-date a punch, and never into the future', async () => {
    const { call, reached } = await setup();
    const backdated = { staffId: STAFF_ID, direction: 'in', idempotencyKey: KEY, punchedAt: '2026-09-27T08:00:00Z' };
    expect((await call(hospital1, 'POST', '/api/erp/attendance/punches', backdated)).statusCode).toBe(403);
    expect(reached('recordPunch')).toHaveLength(0);

    const future = { ...backdated, punchedAt: new Date(Date.now() + 3_600_000).toISOString() };
    expect((await call(admin, 'POST', '/api/erp/attendance/punches', future)).statusCode).toBe(400);

    expect((await call(admin, 'POST', '/api/erp/attendance/punches', backdated)).statusCode).toBe(201);
  });

  it('keeps first-time service availability with admins, but lets the hospital switch it', async () => {
    const { call } = await setup();
    const url = `/api/erp/facilities/${FACILITY_1}/services/${SERVICE_ID}`;
    expect((await call(hospital1, 'PUT', url, { isAvailable: true })).statusCode).toBe(403);
    expect((await call(hospital1, 'PUT', url, { isAvailable: false, version: 1 })).statusCode).toBe(200);
    expect((await call(admin, 'PUT', url, { isAvailable: true })).statusCode).toBe(200);
  });

  it('keeps past rosters with admins', async () => {
    const { call } = await setup();
    const body = { staffId: STAFF_ID, date: '2026-09-01', shiftTemplateId: null };
    expect((await call(hospital1, 'PUT', '/api/erp/rosters', body)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', '/api/erp/rosters', body)).statusCode).toBe(200);
    expect((await call(hospital1, 'PUT', '/api/erp/rosters', { ...body, date: '2026-09-30' })).statusCode).toBe(200);
  });

  it('reads the ERP audit trail for admins only', async () => {
    const { call } = await setup();
    expect((await call(hospital1, 'GET', '/api/erp/audit')).statusCode).toBe(403);
    expect((await call(admin, 'GET', '/api/erp/audit')).statusCode).toBe(200);
  });
});

describe('attendance', () => {
  it('records a desk punch, stamps the day, and answers a retry with 200', async () => {
    const { call, reached } = await setup();
    const body = { staffId: STAFF_ID, direction: 'in', idempotencyKey: KEY };
    const first = await call(hospital1, 'POST', '/api/erp/attendance/punches', body);
    expect(first.statusCode).toBe(201);
    expect(first.json().day).toMatchObject({ status: 'on-duty', onDuty: true });
    expect(reached('recordPunch')[0]?.args[0]).toMatchObject({ punchedAt: null });
    expect(first.json().provenance).toBe('illustrative');
    expect(first.json().disclosure).toBe(ERP_DISCLOSURE);

    const replay = await setup({
      recordPunch: async () => ({
        punch: { punchId: 'c0000000-0000-4000-8000-000000000001', staffId: STAFF_ID, facilityId: FACILITY_1, direction: 'in', punchedAt: '2026-09-28T08:00:00.000Z', source: 'desk' },
        replayed: true,
        day: { staffId: STAFF_ID, shiftDate: '2026-09-28', rosterId: null, shiftTemplateId: null, shiftStart: null, shiftEnd: null, firstIn: null, lastOut: null, punchCount: 1, onDuty: true, workedMinutes: null, lateMinutes: null, earlyExitMinutes: null, status: 'unrostered', corrected: false, correctionId: null },
      }),
    });
    expect((await replay.call(hospital1, 'POST', '/api/erp/attendance/punches', body)).statusCode).toBe(200);
  });

  it('answers 503, not a broken day, when attendance rules are not configured', async () => {
    const { call } = await setup({
      recordPunch: async () => ({ punch: null, replayed: false, day: null }),
    });
    const response = await call(hospital1, 'POST', '/api/erp/attendance/punches', { staffId: STAFF_ID, direction: 'in', idempotencyKey: KEY });
    expect(response.statusCode).toBe(503);
  });

  it('counts the board by status and on-duty', async () => {
    const { call } = await setup();
    const board = (await call(hospital1, 'GET', '/api/erp/attendance/board')).json();
    expect(board.counts.present).toBe(1);
    expect(board.counts.absent).toBe(0);
    expect(board.onDuty).toBe(0);
  });

  it('never counts a missing punch as zero worked minutes', async () => {
    const { call, reached } = await setup();
    const response = await call(hospital1, 'GET', `/api/erp/attendance/staff/${STAFF_ID}?month=2026-09`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.workedMinutes).toBe(450);
    expect(body.counts['missing-punch']).toBe(1);
    expect(reached('staffMonth')[0]?.args[1]).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('answers a stale decision with 409 (self-approval is refused by the store and database: src/db/erp.test.ts)', async () => {
    const { call } = await setup({ decideCorrection: async () => ({ status: 'stale' }) });
    const stale = await call(admin, 'POST', `/api/erp/attendance/corrections/${CORRECTION_ID}/decision`, { version: 1, decision: 'approved' });
    expect(stale.statusCode).toBe(409);
  });

  it('requires a proposed time, in order, for a correction', async () => {
    const { call } = await setup();
    const base = { staffId: STAFF_ID, shiftDate: '2026-09-27', reason: 'Forgot' };
    expect((await call(hospital1, 'POST', '/api/erp/attendance/corrections', base)).statusCode).toBe(400);
    expect(
      (await call(hospital1, 'POST', '/api/erp/attendance/corrections', { ...base, proposedOut: '2026-09-27T16:00:00Z' })).statusCode,
    ).toBe(201);
  });
});

describe('patients and visits', () => {
  it('refuses to list patients without a search term', async () => {
    const { call, reached } = await setup();
    expect((await call(hospital1, 'GET', '/api/erp/patients')).statusCode).toBe(400);
    expect((await call(hospital1, 'GET', '/api/erp/patients?q=a')).statusCode).toBe(400);
    expect((await call(hospital1, 'GET', '/api/erp/patients?q=fix')).statusCode).toBe(200);
    expect(reached('searchPatients')).toHaveLength(1);
  });

  it('surfaces a possible duplicate as a conflict instead of registering it', async () => {
    const { call } = await setup({ registerPatient: async () => ({ status: 'possible_duplicate' }) });
    const response = await call(hospital1, 'POST', '/api/erp/patients', {
      homeFacilityId: FACILITY_1,
      displayName: 'Fixture Patient',
      sex: 'female',
      birthYear: 1980,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/already registered/);
  });

  it('passes the request id to the store so the view is audited with the response', async () => {
    const { call, reached } = await setup();
    const response = await call(hospital1, 'GET', `/api/erp/patients/${PATIENT_ID}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().encounters).toHaveLength(1);
    expect(typeof reached('getPatient')[0]?.args[1]).toBe('string');
  });

  it('answers 404 for a record the caller cannot see, and 409 for a stale write', async () => {
    const { call } = await setup();
    expect((await call(hospital2, 'GET', '/api/erp/patients/70000000-0000-4000-8000-0000000000ff')).statusCode).toBe(404);
    const stale = await call(hospital1, 'PATCH', `/api/erp/patients/${PATIENT_ID}`, { version: 1, displayName: 'Renamed' });
    expect(stale.statusCode).toBe(409);
  });

  it('opens, reads and closes a visit, and records a service in it', async () => {
    const { call } = await setup();
    const opened = await call(hospital1, 'POST', '/api/erp/encounters', {
      patientId: PATIENT_ID,
      facilityId: FACILITY_1,
      departmentId: DEPARTMENT_ID,
      encounterType: 'outpatient',
    });
    expect(opened.statusCode).toBe(201);
    const detail = await call(hospital1, 'GET', `/api/erp/encounters/${ENCOUNTER_ID}`);
    expect(detail.json().deliveries[0].serviceName).toBe('General consultation');
    const delivered = await call(hospital1, 'POST', `/api/erp/encounters/${ENCOUNTER_ID}/services`, {
      serviceId: SERVICE_ID,
      performedByStaffId: STAFF_ID,
      idempotencyKey: KEY,
    });
    expect(delivered.statusCode).toBe(201);
    const closed = await call(hospital1, 'PATCH', `/api/erp/encounters/${ENCOUNTER_ID}`, { version: 1, status: 'closed' });
    expect(closed.json().encounter.status).toBe('closed');
  });

  it('refuses a visit that starts in the future', async () => {
    const { call } = await setup();
    const response = await call(hospital1, 'POST', '/api/erp/encounters', {
      patientId: PATIENT_ID,
      facilityId: FACILITY_1,
      departmentId: DEPARTMENT_ID,
      encounterType: 'outpatient',
      startedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('responses fail closed', () => {
  it('turns a store row that breaks the contract into a 500, never a partial answer', async () => {
    const { call } = await setup({ getStaff: async () => ({ staffId: 'not-a-uuid' }) });
    expect((await call(hospital1, 'GET', `/api/erp/staff/${STAFF_ID}`)).statusCode).toBe(500);
  });
});

describe('monthRange', () => {
  it.each([
    ['2026-02', '2026-02-28'],
    ['2028-02', '2028-02-29'],
    ['2026-09', '2026-09-30'],
    ['2026-12', '2026-12-31'],
  ])('%s ends on %s', (month, last) => {
    expect(monthRange(month)).toEqual({ from: `${month}-01`, to: last });
  });
});
