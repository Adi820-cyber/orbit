import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AttendanceBoardResponseSchema,
  BillListResponseSchema,
  BillResponseSchema,
  CoverageResponseSchema,
  CorrectionListResponseSchema,
  CorrectionResponseSchema,
  DeliveryResponseSchema,
  DoctorListResponseSchema,
  DoctorResponseSchema,
  EncounterListResponseSchema,
  EncounterResponseSchema,
  ErpReferenceResponseSchema,
  PatientResponseSchema,
  PatientSearchResponseSchema,
  RecordPunchResponseSchema,
  RosterDayResponseSchema,
  ScheduleSlotResponseSchema,
  ServiceCatalogueResponseSchema,
  ServiceResponseSchema,
  AvailabilityResponseSchema,
  SetRosterResponseSchema,
  StaffListResponseSchema,
  StaffResponseSchema,
} from '@orbit/contracts';
import type { Clock } from '../src/clock.ts';
import { SimApiError, type ErpApi, type Query } from '../src/erp-client.ts';

/*
 * A small in-memory ERP with the behaviours the simulator relies on: punches
 * are idempotent by key, the attendance board is derived from the roster and
 * the punches, visits and services follow the API's rules closely enough to
 * test the engine without a network. Responses are typed from the real
 * contracts, so if a contract changes this stops compiling.
 */

type Out<S extends z.ZodType> = z.infer<S>;
const disclosure = { provenance: 'illustrative' as const, disclosure: 'Fictional demonstration records.' };

export const ORG_FACILITY_A = 'a0000000-0000-4000-8000-00000000000a';
export const ORG_FACILITY_B = 'b0000000-0000-4000-8000-00000000000b';
export const SHIFT_MORNING = 'c0000000-0000-4000-8000-0000000000c1';
export const SHIFT_AFTERNOON = 'c0000000-0000-4000-8000-0000000000c2';
export const SHIFT_NIGHT = 'c0000000-0000-4000-8000-0000000000c3';
export const SHIFT_GENERAL = 'c0000000-0000-4000-8000-0000000000c4';
export const DEPT = {
  OPD: 'd0000000-0000-4000-8000-000000000001',
  WARD: 'd0000000-0000-4000-8000-000000000002',
  EMER: 'd0000000-0000-4000-8000-000000000003',
  LAB: 'd0000000-0000-4000-8000-000000000004',
} as const;
const SPECIALTY = 'e0000000-0000-4000-8000-000000000001';

type StaffType = 'doctor' | 'nurse' | 'technician' | 'administrative' | 'support';

export interface FakeStaff {
  staffId: string;
  facilityId: string;
  type: StaffType;
  name: string;
  /** Shift on a date (`YYYY-MM-DD`), or none. */
  roster: Map<string, { rosterId: string; shiftTemplateId: string; start: string; end: string }>;
  credentialStatus: 'active' | 'expiring' | 'expired' | 'suspended';
}

interface StoredPunch {
  id: string;
  staffId: string;
  facilityId: string;
  direction: 'in' | 'out';
  at: string;
  key: string;
  shiftDate: string | null;
  source: 'desk' | 'admin-entry';
}

export interface StoredCorrection {
  id: string;
  staffId: string;
  facilityId: string;
  shiftDate: string;
  proposedOut: string | null;
  reason: string;
  state: 'submitted' | 'approved' | 'rejected';
  /** Label of the account that asked for it, so `requestedByMe` is relative to the caller. */
  requestedBy: string;
  createdAt: string;
  version: number;
}

interface StoredEncounter {
  encounterId: string;
  patientId: string;
  facilityId: string;
  departmentId: string;
  doctorId: string | null;
  type: 'outpatient' | 'inpatient' | 'emergency' | 'day-care';
  status: 'open' | 'closed' | 'cancelled';
  startedAt: string;
  endedAt: string | null;
  version: number;
}

/** A bill, in the shape the simulator reads (ADR 0022). */
export interface StoredBill {
  billId: string;
  key: string;
  encounterId: string;
  patientId: string;
  facilityId: string;
  deliveryIds: string[];
  gross: number;
  insurance: number;
  patient: number;
  coverage: { payerType: 'self-pay' | 'government' | 'private'; coveragePercent: number };
  issuedAt: string;
  payments: { key: string; payer: 'patient' | 'insurer'; method: string; amount: number; at: string }[];
}

/** Price of a service at every hospital, unless a test lists it in `unpriced`. */
export const FAKE_PRICE = 1000;

interface StoredDelivery {
  deliveryId: string;
  encounterId: string;
  serviceId: string;
  staffId: string;
  quantity: number;
  at: string;
  key: string;
}

const SHIFTS = [
  { shiftTemplateId: SHIFT_MORNING, code: 'M', name: 'Morning', startTime: '07:00', endTime: '15:00', breakMinutes: 30, crossesMidnight: false },
  { shiftTemplateId: SHIFT_AFTERNOON, code: 'A', name: 'Afternoon', startTime: '15:00', endTime: '23:00', breakMinutes: 30, crossesMidnight: false },
  { shiftTemplateId: SHIFT_NIGHT, code: 'N', name: 'Night', startTime: '23:00', endTime: '07:00', breakMinutes: 30, crossesMidnight: true },
  { shiftTemplateId: SHIFT_GENERAL, code: 'G', name: 'General', startTime: '09:00', endTime: '17:00', breakMinutes: 45, crossesMidnight: false },
] as const;

export interface FakeCall {
  api: string;
  method: string;
  args: unknown[];
}

export class FakeErp implements ErpApi {
  readonly calls: FakeCall[] = [];
  readonly staffList: FakeStaff[] = [];
  readonly punches: StoredPunch[] = [];
  readonly correctionRecords: StoredCorrection[] = [];
  readonly encounterRecords: StoredEncounter[] = [];
  readonly deliveries: StoredDelivery[] = [];
  readonly patientRecords: { patientId: string; name: string; facilityId: string; status: 'active' }[] = [];
  readonly serviceRecords: { serviceId: string; code: string; category: 'consultation' | 'diagnostics-lab' | 'emergency' | 'inpatient-stay' | 'day-care' | 'therapy' | 'procedure' | 'diagnostics-imaging'; active: boolean; offeredAt: Set<string> }[] = [];
  readonly slots: { staffId: string; weekday: number }[] = [];
  readonly coverRecords = new Map<string, { payerType: 'self-pay' | 'government' | 'private'; coveragePercent: number }>();
  readonly billRecords: StoredBill[] = [];
  /** Service codes with no price: a visit using one cannot be billed. */
  readonly unpriced = new Set<string>();
  readonly facilities = [
    { facilityId: ORG_FACILITY_A, name: 'Kestrion Avenhurst Hospital' },
    { facilityId: ORG_FACILITY_B, name: 'Kestrion Brackmoor Hospital' },
  ];
  /** Methods that throw, for failure-isolation tests: `${api}.${method}:${facilityId}`. */
  readonly failing = new Set<string>();
  /** Methods a business rule refuses with a 409, for permanent-refusal tests: `${method}:*`. */
  readonly refusing = new Set<string>();
  /** The account this fake stands for: admins may do more than desks. */
  readonly isAdmin: boolean;
  readonly label: string;
  private readonly clock: Clock;
  /** When set, this account reads and writes the shared fake's records (a desk and the admin see one hospital). */
  private readonly shared: FakeErp | null;

  constructor(label: string, clock: Clock, options: { isAdmin?: boolean; shared?: FakeErp } = {}) {
    this.label = label;
    this.isAdmin = options.isAdmin ?? true;
    this.shared = options.shared ?? null;
    this.clock = clock;
  }

  /** The record store: this fake, or the one it shares data with (desk and admin see one world). */
  private get db(): FakeErp {
    return this.shared ?? this;
  }

  private log(method: string, ...args: unknown[]) {
    this.db.calls.push({ api: this.label, method, args });
  }

  private guard(method: string, facilityId = '') {
    if (this.db.refusing.has(`${method}:*`)) throw new SimApiError('A hospital operations rule refused this.', 409, 'conflict', null);
    if (this.db.failing.has(`${method}:${facilityId}`) || this.db.failing.has(`${method}:*`)) {
      throw new SimApiError('injected failure', 500, 'internal', null);
    }
  }

  // --- setup helpers ------------------------------------------------------------------------------------------------

  addStaff(facilityId: string, type: StaffType, name: string, credentialStatus: FakeStaff['credentialStatus'] = 'active', staffId: string = randomUUID()): FakeStaff {
    const person: FakeStaff = { staffId, facilityId, type, name, roster: new Map(), credentialStatus };
    this.db.staffList.push(person);
    return person;
  }

  assignShift(person: FakeStaff, date: string, shiftTemplateId: string): void {
    const shift = SHIFTS.find((candidate) => candidate.shiftTemplateId === shiftTemplateId);
    if (!shift) throw new Error('unknown shift');
    const start = `${date}T${shift.startTime}:00.000Z`;
    const endDate = shift.crossesMidnight ? new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : date;
    person.roster.set(date, { rosterId: randomUUID(), shiftTemplateId, start, end: `${endDate}T${shift.endTime}:00.000Z` });
  }

  addService(code: string, category: FakeErp['serviceRecords'][number]['category'], offeredAt: string[] = [ORG_FACILITY_A, ORG_FACILITY_B]): void {
    this.db.serviceRecords.push({ serviceId: randomUUID(), code, category, active: true, offeredAt: new Set(offeredAt) });
  }

  // --- derivation -----------------------------------------------------------------------------------------------------

  private now(): number {
    return this.clock.now().getTime();
  }

  private dayFor(person: FakeStaff, date: string): Out<typeof AttendanceBoardResponseSchema>['rows'][number]['day'] {
    const db = this.db;
    const slot = person.roster.get(date);
    const mine = db.punches.filter((punch) => punch.staffId === person.staffId && punch.shiftDate === date).sort((a, b) => a.at.localeCompare(b.at));
    const ins = mine.filter((punch) => punch.direction === 'in');
    const outs = mine.filter((punch) => punch.direction === 'out');
    const fixed = db.correctionRecords.find((c) => c.staffId === person.staffId && c.shiftDate === date && c.state === 'approved');
    const firstIn = ins[0]?.at ?? null;
    const lastOut = fixed?.proposedOut ?? outs.at(-1)?.at ?? null;
    const onDuty = mine.at(-1)?.direction === 'in' && slot !== undefined && this.now() < Date.parse(slot.end) + 4 * 3_600_000 && !fixed;
    return {
      staffId: person.staffId,
      shiftDate: date,
      rosterId: slot?.rosterId ?? null,
      shiftTemplateId: slot?.shiftTemplateId ?? null,
      shiftStart: slot?.start ?? null,
      shiftEnd: slot?.end ?? null,
      firstIn,
      lastOut,
      punchCount: mine.length,
      onDuty,
      workedMinutes: firstIn && lastOut ? Math.round((Date.parse(lastOut) - Date.parse(firstIn)) / 60_000) : null,
      lateMinutes: null,
      earlyExitMinutes: null,
      status: !slot ? 'off' : firstIn && lastOut ? 'present' : firstIn ? (onDuty ? 'on-duty' : 'missing-punch') : this.now() < Date.parse(slot.start) ? 'scheduled' : 'absent',
      corrected: fixed !== undefined,
      correctionId: fixed?.id ?? null,
    };
  }

  // --- ErpApi ---------------------------------------------------------------------------------------------------------

  async reference(): Promise<Out<typeof ErpReferenceResponseSchema>> {
    this.log('reference');
    return {
      operatorRole: 'admin',
      facilities: this.db.facilities,
      departments: [
        { departmentId: DEPT.OPD, code: 'OPD', name: 'Outpatients' },
        { departmentId: DEPT.WARD, code: 'WARD', name: 'Wards' },
        { departmentId: DEPT.EMER, code: 'EMER', name: 'Emergency' },
        { departmentId: DEPT.LAB, code: 'LAB', name: 'Laboratory' },
      ],
      specialties: [{ specialtyId: SPECIALTY, code: 'GEN', name: 'General medicine' }],
      shiftTemplates: [...SHIFTS],
      settings: { lateGraceMinutes: 10, earlyExitGraceMinutes: 10, punchWindowBeforeMinutes: 120, punchWindowAfterMinutes: 240, credentialWarningDays: 30, timeZone: 'UTC', version: 1 },
      ...disclosure,
    };
  }

  async board(query: { facilityId: string; date: string }): Promise<Out<typeof AttendanceBoardResponseSchema>> {
    this.log('board', query);
    this.guard('board', query.facilityId);
    const rows = this.db.staffList
      .filter((person) => person.facilityId === query.facilityId)
      .map((person) => ({
        staff: { staffId: person.staffId, displayName: person.name, employeeCode: `E-${person.staffId.slice(0, 6)}`, staffType: person.type, designation: person.type, departmentId: DEPT.OPD },
        day: this.dayFor(person, query.date),
      }));
    const zero = { scheduled: 0, 'on-duty': 0, present: 0, late: 0, 'early-exit': 0, 'missing-punch': 0, absent: 0, 'on-leave': 0, off: 0, unrostered: 0 } as const;
    return { facilityId: query.facilityId, date: query.date, asOf: this.clock.now().toISOString(), counts: { ...zero }, onDuty: rows.filter((row) => row.day.onDuty).length, rows, ...disclosure };
  }

  async roster(query: { facilityId: string; date: string }): Promise<Out<typeof RosterDayResponseSchema>> {
    this.log('roster', query);
    this.guard('roster', query.facilityId);
    return {
      facilityId: query.facilityId,
      date: query.date,
      shiftTemplates: [...SHIFTS],
      rows: this.db.staffList
        .filter((person) => person.facilityId === query.facilityId)
        .map((person) => {
          const slot = person.roster.get(query.date);
          return {
            staff: { staffId: person.staffId, displayName: person.name, employeeCode: 'E', staffType: person.type, designation: person.type, departmentId: DEPT.OPD },
            assignment: slot ? { rosterId: slot.rosterId, shiftTemplateId: slot.shiftTemplateId, version: 1 } : null,
          };
        }),
      ...disclosure,
    };
  }

  async setRoster(body: { staffId: string; date: string; shiftTemplateId: string | null }): Promise<Out<typeof SetRosterResponseSchema>> {
    this.log('setRoster', body);
    const person = this.db.staffList.find((candidate) => candidate.staffId === body.staffId);
    if (!person) throw new SimApiError('not found', 404, 'not_found', null);
    if (body.shiftTemplateId) this.assignShift(person, body.date, body.shiftTemplateId);
    return { assignment: body.shiftTemplateId ? { rosterId: randomUUID(), shiftTemplateId: body.shiftTemplateId, version: 1 } : null, ...disclosure };
  }

  async punch(body: { staffId: string; direction: 'in' | 'out'; idempotencyKey: string; punchedAt?: string | undefined }): Promise<Out<typeof RecordPunchResponseSchema>> {
    this.log('punch', body);
    const db = this.db;
    const person = db.staffList.find((candidate) => candidate.staffId === body.staffId);
    if (!person) throw new SimApiError('not found', 404, 'not_found', null);
    if (body.punchedAt !== undefined && !this.isAdmin) throw new SimApiError('Only an admin account can make this change.', 403, 'forbidden', null);
    const existing = db.punches.find((punch) => punch.key === body.idempotencyKey);
    const at = body.punchedAt ?? this.clock.now().toISOString();
    let stored = existing;
    if (!stored) {
      // Attribute to the rostered shift whose window contains the punch.
      let shiftDate: string | null = null;
      for (const [date, slot] of person.roster) {
        if (Date.parse(at) >= Date.parse(slot.start) - 2 * 3_600_000 && Date.parse(at) <= Date.parse(slot.end) + 4 * 3_600_000) shiftDate = date;
      }
      stored = { id: randomUUID(), staffId: person.staffId, facilityId: person.facilityId, direction: body.direction, at, key: body.idempotencyKey, shiftDate, source: body.punchedAt ? 'admin-entry' : 'desk' };
      db.punches.push(stored);
    }
    return {
      punch: { punchId: stored.id, staffId: stored.staffId, facilityId: stored.facilityId, direction: stored.direction, punchedAt: stored.at, source: stored.source },
      replayed: existing !== undefined,
      day: this.dayFor(person, stored.shiftDate ?? stored.at.slice(0, 10)),
      ...disclosure,
    };
  }

  async corrections(query: Query): Promise<Out<typeof CorrectionListResponseSchema>> {
    this.log('corrections', query);
    const items = this.db.correctionRecords
      .filter((c) => (!query['facilityId'] || c.facilityId === query['facilityId']) && (!query['state'] || c.state === query['state']))
      .map((c) => this.correctionOut(c));
    return { items, page: { page: 1, pageSize: 100, total: items.length }, ...disclosure };
  }

  private correctionOut(c: StoredCorrection): Out<typeof CorrectionResponseSchema>['correction'] {
    const person = this.db.staffList.find((candidate) => candidate.staffId === c.staffId);
    return {
      correctionId: c.id,
      staffId: c.staffId,
      staffName: person?.name ?? 'Unknown',
      facilityId: c.facilityId,
      shiftDate: c.shiftDate,
      proposedIn: null,
      proposedOut: c.proposedOut,
      reason: c.reason,
      state: c.state,
      requestedByMe: c.requestedBy === this.label,
      decisionNote: null,
      createdAt: c.createdAt,
      decidedAt: null,
      version: c.version,
    };
  }

  async requestCorrection(body: { staffId: string; shiftDate: string; proposedOut?: string | undefined; reason: string }): Promise<Out<typeof CorrectionResponseSchema>> {
    this.log('requestCorrection', body);
    const person = this.db.staffList.find((candidate) => candidate.staffId === body.staffId);
    if (!person) throw new SimApiError('not found', 404, 'not_found', null);
    if (this.db.correctionRecords.some((c) => c.staffId === body.staffId && c.shiftDate === body.shiftDate && c.state === 'submitted')) {
      throw new SimApiError('A correction for this person and date is already waiting for review.', 409, 'conflict', null);
    }
    const stored: StoredCorrection = {
      id: randomUUID(),
      staffId: body.staffId,
      facilityId: person.facilityId,
      shiftDate: body.shiftDate,
      proposedOut: body.proposedOut ?? null,
      reason: body.reason,
      state: 'submitted',
      requestedBy: this.label,
      createdAt: this.clock.now().toISOString(),
      version: 1,
    };
    this.db.correctionRecords.push(stored);
    return { correction: this.correctionOut(stored), ...disclosure };
  }

  async decideCorrection(correctionId: string, body: { version: number; decision: 'approved' | 'rejected'; note?: string | undefined }): Promise<Out<typeof CorrectionResponseSchema>> {
    this.log('decideCorrection', correctionId, body);
    const stored = this.db.correctionRecords.find((c) => c.id === correctionId);
    if (!stored) throw new SimApiError('not found', 404, 'not_found', null);
    if (!this.isAdmin) throw new SimApiError('Only an admin account can make this change.', 403, 'forbidden', null);
    stored.state = body.decision;
    stored.version += 1;
    return { correction: this.correctionOut(stored), ...disclosure };
  }

  async doctors(query: Query): Promise<Out<typeof DoctorListResponseSchema>> {
    this.log('doctors', query);
    const items = this.db.staffList
      .filter((person) => person.type === 'doctor' && (!query['facilityId'] || person.facilityId === query['facilityId']) && (!query['credentialStatus'] || person.credentialStatus === query['credentialStatus']))
      .map((person) => this.doctorOut(person));
    return { items, page: { page: 1, pageSize: 100, total: items.length }, ...disclosure };
  }

  private doctorOut(person: FakeStaff): Out<typeof DoctorResponseSchema>['doctor'] {
    return {
      staffId: person.staffId,
      facilityId: person.facilityId,
      departmentId: DEPT.OPD,
      employeeCode: 'E',
      displayName: person.name,
      designation: 'Doctor',
      employmentStatus: 'active',
      specialtyId: SPECIALTY,
      registrationNumber: 'DEMO-REG-1000',
      credentialExpiresOn: person.credentialStatus === 'expired' ? '2026-09-15' : person.credentialStatus === 'expiring' ? '2026-10-08' : '2027-01-01',
      credentialSuspended: person.credentialStatus === 'suspended',
      credentialStatus: person.credentialStatus,
      employmentType: 'employed',
      version: 1,
    };
  }

  async updateDoctor(staffId: string, body: { version: number; credentialExpiresOn?: string | undefined; credentialSuspended?: boolean | undefined }): Promise<Out<typeof DoctorResponseSchema>> {
    this.log('updateDoctor', staffId, body);
    const person = this.db.staffList.find((candidate) => candidate.staffId === staffId);
    if (!person) throw new SimApiError('not found', 404, 'not_found', null);
    person.credentialStatus = 'active';
    return { doctor: this.doctorOut(person), ...disclosure };
  }

  async services(query: Query): Promise<Out<typeof ServiceCatalogueResponseSchema>> {
    this.log('services', query);
    const facilityId = typeof query['facilityId'] === 'string' ? query['facilityId'] : null;
    return {
      facilityId,
      items: this.db.serviceRecords.map((service) => ({
        service: { serviceId: service.serviceId, serviceCode: service.code, name: service.code, category: service.category, departmentId: DEPT.OPD, unit: 'per-visit' as const, isActive: service.active, version: 1 },
        availability:
          facilityId && service.offeredAt.has(facilityId)
            ? { facilityId, isAvailable: true, illustrativeTariff: this.db.unpriced.has(service.code) ? null : FAKE_PRICE, version: 1 }
            : null,
      })),
      currency: 'INR',
      ...disclosure,
    };
  }

  async patients(query: Query): Promise<Out<typeof PatientSearchResponseSchema>> {
    this.log('patients', query);
    const q = String(query['q'] ?? '').toLowerCase();
    const items = this.db.patientRecords
      .filter((patient) => patient.name.toLowerCase().includes(q))
      .map((patient) => ({ patientId: patient.patientId, mrn: 'DEMO-MRN-000001', displayName: patient.name, sex: 'female' as const, birthYear: 1980, status: patient.status, homeFacilityId: patient.facilityId, createdAt: '2026-01-01T00:00:00.000Z', version: 1 }));
    return { items, page: { page: 1, pageSize: 20, total: items.length }, ...disclosure };
  }

  async registerPatient(body: { homeFacilityId: string; displayName: string; sex: 'female' | 'male' | 'other' | 'unknown'; birthYear: number }): Promise<Out<typeof PatientResponseSchema>> {
    this.log('registerPatient', body);
    this.guard('registerPatient', body.homeFacilityId);
    const stored = { patientId: randomUUID(), name: body.displayName, facilityId: body.homeFacilityId, status: 'active' as const };
    this.db.patientRecords.push(stored);
    return { patient: { patientId: stored.patientId, mrn: `DEMO-MRN-${String(this.db.patientRecords.length).padStart(6, '0')}`, displayName: body.displayName, sex: body.sex, birthYear: body.birthYear, status: 'active', homeFacilityId: body.homeFacilityId, createdAt: this.clock.now().toISOString(), version: 1 }, ...disclosure };
  }

  private encounterOut(e: StoredEncounter): Out<typeof EncounterResponseSchema>['encounter'] {
    return { encounterId: e.encounterId, patientId: e.patientId, facilityId: e.facilityId, departmentId: e.departmentId, attendingDoctorId: e.doctorId, attendingDoctorName: null, encounterType: e.type, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt, version: e.version };
  }

  async openEncounter(body: { patientId: string; facilityId: string; departmentId: string; encounterType: StoredEncounter['type']; attendingDoctorId?: string | undefined }): Promise<Out<typeof EncounterResponseSchema>> {
    this.log('openEncounter', body);
    const stored: StoredEncounter = {
      encounterId: randomUUID(),
      patientId: body.patientId,
      facilityId: body.facilityId,
      departmentId: body.departmentId,
      doctorId: body.attendingDoctorId ?? null,
      type: body.encounterType,
      status: 'open',
      startedAt: this.clock.now().toISOString(),
      endedAt: null,
      version: 1,
    };
    this.db.encounterRecords.push(stored);
    return { encounter: this.encounterOut(stored), ...disclosure };
  }

  /** Test helper: a visit that started at a given time. */
  seedEncounter(facilityId: string, type: StoredEncounter['type'], startedAt: string): StoredEncounter {
    const patient = { patientId: randomUUID(), name: 'Seed Patient', facilityId, status: 'active' as const };
    this.db.patientRecords.push(patient);
    const stored: StoredEncounter = { encounterId: randomUUID(), patientId: patient.patientId, facilityId, departmentId: DEPT.OPD, doctorId: null, type, status: 'open', startedAt, endedAt: null, version: 1 };
    this.db.encounterRecords.push(stored);
    return stored;
  }

  async encounters(query: Query): Promise<Out<typeof EncounterListResponseSchema>> {
    this.log('encounters', query);
    this.guard('encounters', String(query['facilityId'] ?? ''));
    const items = this.db.encounterRecords
      .filter((e) => (!query['facilityId'] || e.facilityId === query['facilityId']) && (!query['status'] || e.status === query['status']))
      .map((e) => ({ encounter: this.encounterOut(e), patientName: this.db.patientRecords.find((p) => p.patientId === e.patientId)?.name ?? 'Patient', mrn: 'DEMO-MRN-000001' }));
    return { items, page: { page: 1, pageSize: 100, total: items.length }, ...disclosure };
  }

  async updateEncounter(encounterId: string, body: { version: number; status?: 'closed' | 'cancelled' | undefined; endedAt?: string | undefined }): Promise<Out<typeof EncounterResponseSchema>> {
    this.log('updateEncounter', encounterId, body);
    const stored = this.db.encounterRecords.find((e) => e.encounterId === encounterId);
    if (!stored) throw new SimApiError('not found', 404, 'not_found', null);
    if (stored.version !== body.version) throw new SimApiError('This record changed since you opened it.', 409, 'conflict', null);
    if (body.status) {
      const endedAt = body.endedAt ?? this.clock.now().toISOString();
      const late = this.db.deliveries.find((d) => d.encounterId === encounterId && d.at > endedAt);
      if (late) throw new SimApiError('Services were recorded after that closing time. Choose a later closing time.', 409, 'conflict', null);
      stored.status = body.status;
      stored.endedAt = endedAt;
    }
    stored.version += 1;
    return { encounter: this.encounterOut(stored), ...disclosure };
  }

  async recordDelivery(encounterId: string, body: { serviceId: string; performedByStaffId: string; quantity: number; idempotencyKey: string; performedAt?: string | undefined }): Promise<Out<typeof DeliveryResponseSchema>> {
    this.log('recordDelivery', encounterId, body);
    const db = this.db;
    const encounter = db.encounterRecords.find((e) => e.encounterId === encounterId);
    if (!encounter) throw new SimApiError('not found', 404, 'not_found', null);
    this.guard('recordDelivery', encounter.facilityId);
    const service = db.serviceRecords.find((s) => s.serviceId === body.serviceId);
    if (!service || !service.offeredAt.has(encounter.facilityId)) throw new SimApiError('This service is not offered at this facility.', 409, 'conflict', null);
    const existing = db.deliveries.find((d) => d.key === body.idempotencyKey);
    const stored: StoredDelivery = existing ?? { deliveryId: randomUUID(), encounterId, serviceId: body.serviceId, staffId: body.performedByStaffId, quantity: body.quantity, at: body.performedAt ?? this.clock.now().toISOString(), key: body.idempotencyKey };
    if (!existing) db.deliveries.push(stored);
    return {
      delivery: { deliveryId: stored.deliveryId, encounterId, serviceId: service.serviceId, serviceCode: service.code, serviceName: service.code, category: service.category, unit: 'per-visit', performedByStaffId: stored.staffId, performedByName: 'Staff', quantity: stored.quantity, performedAt: stored.at, status: 'completed', illustrativeAmount: null, version: 1 },
      replayed: existing !== undefined,
      ...disclosure,
    };
  }

  // --- Billing -------------------------------------------------------------------------------------------------------
  private billOut(bill: StoredBill) {
    const paidByPatient = bill.payments.filter((p) => p.payer === 'patient').reduce((sum, p) => sum + p.amount, 0);
    const paidByInsurer = bill.payments.filter((p) => p.payer === 'insurer').reduce((sum, p) => sum + p.amount, 0);
    const paid = paidByPatient + paidByInsurer;
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      billId: bill.billId,
      billNumber: `DEMO-BILL-${String(100001 + this.db.billRecords.indexOf(bill))}`,
      facilityId: bill.facilityId,
      encounterId: bill.encounterId,
      patientId: bill.patientId,
      patientName: 'Fake Patient',
      mrn: 'DEMO-MRN-100001',
      status: 'issued' as const,
      paymentState: paid >= bill.gross ? ('paid' as const) : paid > 0 ? ('part-paid' as const) : ('unpaid' as const),
      payerType: bill.coverage.payerType,
      payerName: null,
      coveragePercent: bill.coverage.coveragePercent,
      grossAmount: bill.gross,
      insuranceAmount: bill.insurance,
      patientAmount: bill.patient,
      paidByPatient: round(paidByPatient),
      paidByInsurer: round(paidByInsurer),
      balance: round(bill.gross - paid),
      issuedAt: bill.issuedAt,
      cancelledAt: null,
      version: 1,
    };
  }

  async setCoverage(patientId: string, body: { payerType: 'self-pay' | 'government' | 'private'; coveragePercent: number }): Promise<Out<typeof CoverageResponseSchema>> {
    this.log('setCoverage', patientId, body);
    this.db.coverRecords.set(patientId, { payerType: body.payerType, coveragePercent: body.coveragePercent });
    return { coverage: { patientId, payerType: body.payerType, payerName: null, coveragePercent: body.coveragePercent, version: 1 }, ...disclosure };
  }

  async issueBill(encounterId: string, body: { idempotencyKey: string }): Promise<Out<typeof BillResponseSchema>> {
    this.log('issueBill', encounterId, body);
    const db = this.db;
    const replay = db.billRecords.find((b) => b.key === body.idempotencyKey);
    const detail = (bill: StoredBill) => ({ bill: { ...this.billOut(bill), cancelReason: null, lines: [], payments: [] }, currency: 'INR', ...disclosure });
    if (replay) return detail(replay);
    const encounter = db.encounterRecords.find((e) => e.encounterId === encounterId);
    if (!encounter) throw new SimApiError('not found', 404, 'not_found', null);
    if (encounter.status !== 'closed') throw new SimApiError('Close the visit before billing it.', 409, 'conflict', null);
    const billed = new Set(db.billRecords.flatMap((b) => b.deliveryIds));
    const lines = db.deliveries.filter((d) => d.encounterId === encounterId && !billed.has(d.deliveryId));
    const missing = lines.map((d) => db.serviceRecords.find((s) => s.serviceId === d.serviceId)).filter((s) => s && db.unpriced.has(s.code));
    if (missing.length) throw new SimApiError(`No price is set for: ${missing.map((s) => s?.code).join(', ')}. An admin sets prices on the Services page.`, 409, 'conflict', null);
    if (!lines.length) throw new SimApiError('This visit has no services left to bill.', 409, 'conflict', null);
    const coverage = db.coverRecords.get(encounter.patientId) ?? { payerType: 'self-pay' as const, coveragePercent: 0 };
    const gross = lines.reduce((sum, d) => sum + d.quantity * FAKE_PRICE, 0);
    const insurance = Math.round((gross * coverage.coveragePercent) / 100 * 100) / 100;
    const bill: StoredBill = {
      billId: randomUUID(), key: body.idempotencyKey, encounterId, patientId: encounter.patientId, facilityId: encounter.facilityId,
      deliveryIds: lines.map((d) => d.deliveryId), gross, insurance, patient: gross - insurance, coverage, issuedAt: this.clock.now().toISOString(), payments: [],
    };
    db.billRecords.push(bill);
    return detail(bill);
  }

  async bills(query: Query): Promise<Out<typeof BillListResponseSchema>> {
    this.log('bills', query);
    const facilityId = typeof query['facilityId'] === 'string' ? query['facilityId'] : null;
    const items = this.db.billRecords
      .filter((b) => !facilityId || b.facilityId === facilityId)
      .map((b) => this.billOut(b))
      .filter((b) => query['state'] !== 'open' || b.paymentState === 'unpaid' || b.paymentState === 'part-paid');
    return { items, page: { page: 1, pageSize: 100, total: items.length }, currency: 'INR', ...disclosure };
  }

  async recordPayment(billId: string, body: { payer: 'patient' | 'insurer'; method: string; amount: number; idempotencyKey: string }): Promise<Out<typeof BillResponseSchema>> {
    this.log('recordPayment', billId, body);
    const bill = this.db.billRecords.find((b) => b.billId === billId);
    if (!bill) throw new SimApiError('not found', 404, 'not_found', null);
    if (!bill.payments.some((p) => p.key === body.idempotencyKey)) {
      const due = body.payer === 'patient' ? bill.patient : bill.insurance;
      const paid = bill.payments.filter((p) => p.payer === body.payer).reduce((sum, p) => sum + p.amount, 0);
      if (body.amount > due - paid + 0.001) throw new SimApiError('That is more than this payer still owes on the bill.', 409, 'conflict', null);
      bill.payments.push({ key: body.idempotencyKey, payer: body.payer, method: body.method, amount: body.amount, at: this.clock.now().toISOString() });
    }
    return { bill: { ...this.billOut(bill), cancelReason: null, lines: [], payments: [] }, currency: 'INR', ...disclosure };
  }

  async staff(query: Query): Promise<Out<typeof StaffListResponseSchema>> {
    this.log('staff', query);
    const matching = this.db.staffList.filter((person) => (!query['facilityId'] || person.facilityId === query['facilityId']) && (!query['staffType'] || person.type === query['staffType']));
    return { items: [], page: { page: 1, pageSize: Number(query['pageSize'] ?? 25), total: matching.length }, ...disclosure };
  }

  async createStaff(body: { facilityId: string; staffType: Exclude<StaffType, 'doctor'>; displayName: string }): Promise<Out<typeof StaffResponseSchema>> {
    this.log('createStaff', body);
    this.guard('createStaff', body.facilityId);
    const person = this.addStaff(body.facilityId, body.staffType, body.displayName);
    return { staff: this.staffOut(person), ...disclosure };
  }

  private staffOut(person: FakeStaff): Out<typeof StaffResponseSchema>['staff'] {
    return { staffId: person.staffId, facilityId: person.facilityId, departmentId: DEPT.OPD, employeeCode: 'E', displayName: person.name, staffType: person.type, designation: person.type, employmentStatus: 'active', joinedOn: '2024-01-01', exitedOn: null, isCriticalRole: false, version: 1 };
  }

  async createDoctor(body: { facilityId: string; displayName: string }): Promise<Out<typeof DoctorResponseSchema>> {
    this.log('createDoctor', body);
    const person = this.addStaff(body.facilityId, 'doctor', body.displayName);
    return { doctor: this.doctorOut(person), ...disclosure };
  }

  async addScheduleSlot(staffId: string, body: { weekday: number }): Promise<Out<typeof ScheduleSlotResponseSchema>> {
    this.log('addScheduleSlot', staffId, body);
    this.db.slots.push({ staffId, weekday: body.weekday });
    return { slot: { slotId: randomUUID(), facilityId: ORG_FACILITY_A, weekday: body.weekday, startTime: '09:00', endTime: '12:00', isActive: true }, ...disclosure };
  }

  async createService(body: { serviceCode: string; category: FakeErp['serviceRecords'][number]['category'] }): Promise<Out<typeof ServiceResponseSchema>> {
    this.log('createService', body);
    this.db.serviceRecords.push({ serviceId: randomUUID(), code: body.serviceCode, category: body.category, active: true, offeredAt: new Set() });
    const stored = this.db.serviceRecords.at(-1);
    if (!stored) throw new Error('unreachable');
    return { service: { serviceId: stored.serviceId, serviceCode: stored.code, name: stored.code, category: stored.category, departmentId: DEPT.OPD, unit: 'per-visit', isActive: true, version: 1 }, ...disclosure };
  }

  async setAvailability(facilityId: string, serviceId: string): Promise<Out<typeof AvailabilityResponseSchema>> {
    this.log('setAvailability', facilityId, serviceId);
    this.db.serviceRecords.find((service) => service.serviceId === serviceId)?.offeredAt.add(facilityId);
    return { serviceId, availability: { facilityId, isAvailable: true, illustrativeTariff: null, version: 1 }, ...disclosure };
  }

  /** How many times a method was called on an account. */
  count(method: string, label?: string): number {
    return this.db.calls.filter((call) => call.method === method && (label === undefined || call.api === label)).length;
  }

  callsTo(method: string, label?: string): FakeCall[] {
    return this.db.calls.filter((call) => call.method === method && (label === undefined || call.api === label));
  }
}
