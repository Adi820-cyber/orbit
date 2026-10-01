import type { FastifyInstance } from 'fastify';
import type { OperatorClaims } from '@orbit/contracts';
import { buildApp } from '../../src/build.ts';
import type { ErpStore, ErpWrite } from '../../src/modules/erp/ports.ts';
import { fixtureMemberships, MEMBERSHIPS, ORG_A, SUBJECT } from './fixtures.ts';
import { createModuleFixture } from './modules.ts';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from './tokens.ts';

/*
 * ERP route-test fixtures. The store is a recording stand-in that returns
 * contract-valid rows; it proves what the ROUTES do (authorization, facility
 * resolution, parsing, status codes). The SQL, RLS and triggers are proven
 * against a real database in src/db/erp.test.ts.
 */

export const FACILITY_1 = 'f0000000-0000-4000-8000-000000000001';
export const FACILITY_2 = 'f0000000-0000-4000-8000-000000000002';
export const STAFF_ID = '50000000-0000-4000-8000-000000000001';
export const DEPARTMENT_ID = '60000000-0000-4000-8000-000000000001';
export const PATIENT_ID = '70000000-0000-4000-8000-000000000001';
export const ENCOUNTER_ID = '80000000-0000-4000-8000-000000000001';
export const SERVICE_ID = '90000000-0000-4000-8000-000000000001';
export const CORRECTION_ID = 'a0000000-0000-4000-8000-000000000001';

export const OPERATOR_SUBJECT = {
  admin: '30000000-0000-4000-8000-000000000001',
  hospital1: '30000000-0000-4000-8000-000000000002',
  hospital2: '30000000-0000-4000-8000-000000000003',
} as const;

const operatorRow = (index: number, subject: string, operatorRole: 'admin' | 'hospital', scope: { grain: 'group' | 'facility'; entityId: string }) => ({
  membershipId: `40000000-0000-4000-8000-00000000000${index}`,
  subject,
  organizationId: ORG_A,
  role: null,
  operatorRole,
  scopes: [scope],
  status: 'active',
});

export const OPERATOR_MEMBERSHIPS = [
  operatorRow(1, OPERATOR_SUBJECT.admin, 'admin', { grain: 'group', entityId: ORG_A }),
  operatorRow(2, OPERATOR_SUBJECT.hospital1, 'hospital', { grain: 'facility', entityId: FACILITY_1 }),
  operatorRow(3, OPERATOR_SUBJECT.hospital2, 'hospital', { grain: 'facility', entityId: FACILITY_2 }),
];

export const LEADER_SUBJECT = SUBJECT.cooRegionA;

const NOW = '2026-09-28T10:00:00.000Z';

export const staffRow = (overrides: Record<string, unknown> = {}) => ({
  staffId: STAFF_ID,
  facilityId: FACILITY_1,
  departmentId: DEPARTMENT_ID,
  employeeCode: 'AV-N-0001',
  displayName: 'Fixture Person',
  staffType: 'nurse',
  designation: 'Staff nurse',
  employmentStatus: 'active',
  joinedOn: '2025-01-01',
  exitedOn: null,
  isCriticalRole: false,
  version: 1,
  ...overrides,
});

export const dayRow = (overrides: Record<string, unknown> = {}) => ({
  staffId: STAFF_ID,
  shiftDate: '2026-09-28',
  rosterId: null,
  shiftTemplateId: null,
  shiftStart: null,
  shiftEnd: null,
  firstIn: null,
  lastOut: null,
  punchCount: 0,
  onDuty: false,
  workedMinutes: null,
  lateMinutes: null,
  earlyExitMinutes: null,
  status: 'off',
  corrected: false,
  correctionId: null,
  ...overrides,
});

const summaryStaff = {
  staffId: STAFF_ID,
  displayName: 'Fixture Person',
  employeeCode: 'AV-N-0001',
  staffType: 'nurse',
  designation: 'Staff nurse',
  departmentId: DEPARTMENT_ID,
};

export const patientRow = (overrides: Record<string, unknown> = {}) => ({
  patientId: PATIENT_ID,
  mrn: 'DEMO-MRN-000001',
  displayName: 'Fixture Patient',
  sex: 'female',
  birthYear: 1980,
  status: 'active',
  homeFacilityId: FACILITY_1,
  createdAt: NOW,
  version: 1,
  ...overrides,
});

export const encounterRow = (overrides: Record<string, unknown> = {}) => ({
  encounterId: ENCOUNTER_ID,
  patientId: PATIENT_ID,
  facilityId: FACILITY_1,
  departmentId: DEPARTMENT_ID,
  attendingDoctorId: null,
  attendingDoctorName: null,
  encounterType: 'outpatient',
  status: 'open',
  startedAt: NOW,
  endedAt: null,
  version: 1,
  ...overrides,
});

export const correctionRow = (overrides: Record<string, unknown> = {}) => ({
  correctionId: CORRECTION_ID,
  staffId: STAFF_ID,
  staffName: 'Fixture Person',
  facilityId: FACILITY_1,
  shiftDate: '2026-09-27',
  proposedIn: null,
  proposedOut: '2026-09-27T16:00:00.000Z',
  reason: 'Forgot to punch out',
  state: 'submitted',
  requestedByMe: false,
  decisionNote: null,
  createdAt: NOW,
  decidedAt: null,
  version: 1,
  ...overrides,
});

const deliveryRow = {
  deliveryId: 'b0000000-0000-4000-8000-000000000001',
  encounterId: ENCOUNTER_ID,
  serviceId: SERVICE_ID,
  serviceCode: 'CON-GEN',
  serviceName: 'General consultation',
  category: 'consultation',
  unit: 'per-visit',
  performedByStaffId: STAFF_ID,
  performedByName: 'Fixture Person',
  quantity: 1,
  performedAt: NOW,
  status: 'completed',
  illustrativeAmount: null,
  version: 1,
};

export interface StoreCall {
  method: keyof ErpStore;
  operator: OperatorClaims;
  args: unknown[];
}

/** A recording ErpStore. `overrides` replaces individual methods per test. */
export function recordingErpStore(overrides: Partial<ErpStore> = {}) {
  const calls: StoreCall[] = [];
  const ok = (row: unknown): ErpWrite => ({ status: 'ok', row });
  const base: ErpStore = {
    reference: async () => ({
      facilities: [{ facilityId: FACILITY_1, name: 'Fixture hospital 1' }],
      departments: [{ departmentId: DEPARTMENT_ID, code: 'OPD', name: 'Outpatients' }],
      specialties: [],
      shiftTemplates: [],
      settings: null,
    }),
    facility: async (_operator, facilityId) =>
      [FACILITY_1, FACILITY_2].includes(facilityId) ? { facilityId, name: 'Fixture hospital' } : null,
    today: async () => '2026-09-28',
    summary: async () => ({
      active: 1, rostered: 1, onDuty: 0, late: 0, missingPunch: 0, absent: 0,
      openInpatients: 0, openOther: 1, startedToday: 1, servicesDeliveredToday: 1,
      patientsRegisteredToday: 0, pendingCorrections: 1, doctorsNeedingCredentialAttention: 0, asOf: NOW,
    }),
    listStaff: async () => ({ items: [staffRow()], total: 1 }),
    getStaff: async (_operator, staffId) => (staffId === STAFF_ID ? staffRow() : null),
    createStaff: async (_operator, input) => staffRow({ ...input, staffType: input.staffType }),
    updateStaff: async () => ok(staffRow({ version: 2 })),
    listDoctors: async () => ({ items: [], total: 0 }),
    getDoctor: async () => null,
    createDoctor: async () => null,
    updateDoctor: async () => ({ status: 'not_found' }),
    addScheduleSlot: async () => null,
    updateScheduleSlot: async () => null,
    attendanceBoard: async () => ({ asOf: NOW, rows: [{ staff: summaryStaff, day: dayRow({ status: 'present', onDuty: false }) }] }),
    recordPunch: async (_operator, punch) => ({
      punch: { punchId: 'c0000000-0000-4000-8000-000000000001', staffId: punch.staffId, facilityId: FACILITY_1, direction: punch.direction, punchedAt: NOW, source: punch.punchedAt ? 'admin-entry' : 'desk' },
      replayed: false,
      day: dayRow({ status: 'on-duty', onDuty: true, firstIn: NOW, punchCount: 1 }),
    }),
    staffMonth: async () => ({ staff: staffRow(), days: [dayRow({ status: 'present', workedMinutes: 450 }), dayRow({ shiftDate: '2026-09-29', status: 'missing-punch' })], punches: [], corrections: [] }),
    listCorrections: async () => ({ items: [correctionRow()], total: 1 }),
    getCorrection: async () => correctionRow(),
    requestCorrection: async () => correctionRow({ requestedByMe: true }),
    decideCorrection: async () => ok(correctionRow({ state: 'approved', decidedAt: NOW, version: 2 })),
    rosterDay: async () => [{ staff: summaryStaff, assignment: null }],
    setRoster: async () => ok(null),
    catalogue: async () => [],
    createService: async () => null,
    updateService: async () => ({ status: 'stale' }),
    setAvailability: async (_operator, target, input) =>
      ok({ facilityId: target.facilityId, isAvailable: input.isAvailable, illustrativeTariff: null, version: 1 }),
    searchPatients: async () => ({ items: [patientRow()], total: 1 }),
    registerPatient: async () => ({ status: 'created', patient: patientRow() }),
    getPatient: async (_operator, patientId) => (patientId === PATIENT_ID ? { patient: patientRow(), encounters: [encounterRow()] } : null),
    updatePatient: async () => ({ status: 'stale' }),
    listEncounters: async () => ({ items: [], total: 0 }),
    openEncounter: async () => encounterRow(),
    getEncounter: async () => ({ encounter: encounterRow(), patient: patientRow(), deliveries: [deliveryRow] }),
    updateEncounter: async () => ok(encounterRow({ status: 'closed', endedAt: NOW, version: 2 })),
    recordDelivery: async () => ({ delivery: deliveryRow, replayed: false }),
    updateDelivery: async () => ok({ ...deliveryRow, status: 'cancelled', version: 2 }),
    audit: async () => ({ items: [], total: 0 }),
    ...overrides,
  };

  // Wrap every method so tests can assert which calls reached the store.
  const store = Object.fromEntries(
    Object.entries(base).map(([method, fn]) => [
      method,
      (operator: OperatorClaims, ...args: unknown[]) => {
        calls.push({ method: method as keyof ErpStore, operator, args });
        return (fn as (...all: unknown[]) => unknown)(operator, ...args);
      },
    ]),
  ) as unknown as ErpStore;
  return { store, calls };
}

/** The full app with leader and operator memberships and a recording ERP store. */
export async function buildErpApp(overrides: Partial<ErpStore> = {}) {
  const issuer = await createTestIssuer();
  const { store, calls } = recordingErpStore(overrides);
  const fixture = createModuleFixture({ erp: store });
  const app: FastifyInstance = await buildApp({
    allowedOrigins: [],
    modules: fixture.deps,
    auth: {
      getKey: issuer.getKey,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      memberships: fixtureMemberships([...MEMBERSHIPS, ...OPERATOR_MEMBERSHIPS]),
    },
  });

  async function call(subject: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) {
    const token = await issuer.sign(subject);
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  }
  const reached = (method: keyof ErpStore) => calls.filter((entry) => entry.method === method);
  return { app, call, calls, reached };
}
