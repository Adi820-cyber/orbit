import type {
  AddScheduleSlotRequest,
  CorrectionListQuery,
  CreateDoctorRequest,
  CreateServiceRequest,
  CreateStaffRequest,
  DecideCorrectionRequest,
  DoctorListQuery,
  EncounterListQuery,
  ErpPageQuery,
  OpenEncounterRequest,
  OperatorClaims,
  PatientSearchQuery,
  PunchDirection,
  RecordDeliveryRequest,
  RegisterPatientRequest,
  RequestCorrectionRequest,
  ServiceCategory,
  SetAvailabilityRequest,
  SetRosterRequest,
  StaffListQuery,
  UpdateDeliveryRequest,
  UpdateDoctorRequest,
  UpdateEncounterRequest,
  UpdatePatientRequest,
  UpdateScheduleSlotRequest,
  UpdateServiceRequest,
  UpdateStaffRequest,
} from '@orbit/contracts';

/*
 * The ERP data port (ADR 0016). Every method takes the verified operator
 * claims so its database implementation runs inside `withOperatorTx` and RLS
 * filters every row. Rows come back unparsed; the routes parse them against
 * `@orbit/contracts` and fail closed on a mismatch.
 *
 * A record the caller cannot see is indistinguishable from one that does not
 * exist (`null` / `not_found`), so ids never reveal records in other
 * facilities. Requests that NAME a facility outside the caller's scope are
 * refused explicitly as `out_of_scope` by the routes before reaching here.
 *
 * Every write records its audit event in the same transaction; reads of a
 * patient or a visit record a `viewed` event (ERP_PLAN §7.3).
 */

export interface ErpPageRows {
  items: readonly unknown[];
  total: number;
}

/** Optimistic-lock outcome for updates. */
export type ErpWrite = { status: 'ok'; row: unknown } | { status: 'stale' } | { status: 'not_found' };

export interface ReferenceRows {
  facilities: readonly unknown[];
  departments: readonly unknown[];
  specialties: readonly unknown[];
  shiftTemplates: readonly unknown[];
  settings: unknown;
}

export interface NewPunch {
  staffId: string;
  direction: PunchDirection;
  idempotencyKey: string;
  /** Absent: the database stamps now() (`desk`). Present: an admin back-dated entry. */
  punchedAt: string | null;
}

export interface ErpStore {
  reference(operator: OperatorClaims): Promise<ReferenceRows>;
  /** The facility, when it exists in the caller's organization and is visible; else null. */
  facility(operator: OperatorClaims, facilityId: string): Promise<unknown>;
  /** Today in the organization's time zone, as YYYY-MM-DD. */
  today(operator: OperatorClaims): Promise<string>;
  summary(operator: OperatorClaims, facilityId: string, date: string): Promise<unknown>;

  listStaff(operator: OperatorClaims, query: StaffListQuery): Promise<ErpPageRows>;
  getStaff(operator: OperatorClaims, staffId: string): Promise<unknown>;
  createStaff(operator: OperatorClaims, input: CreateStaffRequest, requestId: string): Promise<unknown>;
  updateStaff(operator: OperatorClaims, staffId: string, input: UpdateStaffRequest, requestId: string): Promise<ErpWrite>;

  listDoctors(operator: OperatorClaims, query: DoctorListQuery): Promise<ErpPageRows>;
  getDoctor(operator: OperatorClaims, staffId: string): Promise<{ doctor: unknown; schedule: readonly unknown[] } | null>;
  createDoctor(operator: OperatorClaims, input: CreateDoctorRequest, requestId: string): Promise<unknown>;
  updateDoctor(operator: OperatorClaims, staffId: string, input: UpdateDoctorRequest, requestId: string): Promise<ErpWrite>;
  addScheduleSlot(operator: OperatorClaims, staffId: string, input: AddScheduleSlotRequest, requestId: string): Promise<unknown>;
  updateScheduleSlot(operator: OperatorClaims, slotId: string, input: UpdateScheduleSlotRequest, requestId: string): Promise<unknown>;

  attendanceBoard(operator: OperatorClaims, facilityId: string, date: string): Promise<{ asOf: string; rows: readonly unknown[] }>;
  recordPunch(operator: OperatorClaims, punch: NewPunch, requestId: string): Promise<{ punch: unknown; replayed: boolean; day: unknown } | null>;
  staffMonth(
    operator: OperatorClaims,
    staffId: string,
    range: { from: string; to: string },
  ): Promise<{ staff: unknown; days: readonly unknown[]; punches: readonly unknown[]; corrections: readonly unknown[] } | null>;
  listCorrections(operator: OperatorClaims, query: CorrectionListQuery): Promise<ErpPageRows>;
  getCorrection(operator: OperatorClaims, correctionId: string): Promise<unknown>;
  requestCorrection(operator: OperatorClaims, input: RequestCorrectionRequest, requestId: string): Promise<unknown>;
  decideCorrection(operator: OperatorClaims, correctionId: string, input: DecideCorrectionRequest, requestId: string): Promise<ErpWrite>;
  rosterDay(operator: OperatorClaims, facilityId: string, date: string): Promise<readonly unknown[]>;
  setRoster(operator: OperatorClaims, input: SetRosterRequest, requestId: string): Promise<ErpWrite>;

  catalogue(
    operator: OperatorClaims,
    query: { facilityId: string | null; category: ServiceCategory | null; includeInactive: boolean },
  ): Promise<readonly unknown[]>;
  createService(operator: OperatorClaims, input: CreateServiceRequest, requestId: string): Promise<unknown>;
  updateService(operator: OperatorClaims, serviceId: string, input: UpdateServiceRequest, requestId: string): Promise<ErpWrite>;
  setAvailability(
    operator: OperatorClaims,
    target: { facilityId: string; serviceId: string },
    input: SetAvailabilityRequest,
    requestId: string,
  ): Promise<ErpWrite>;

  searchPatients(operator: OperatorClaims, query: PatientSearchQuery): Promise<ErpPageRows>;
  registerPatient(
    operator: OperatorClaims,
    input: RegisterPatientRequest,
    requestId: string,
  ): Promise<{ status: 'created'; patient: unknown } | { status: 'possible_duplicate' }>;
  getPatient(operator: OperatorClaims, patientId: string, requestId: string): Promise<{ patient: unknown; encounters: readonly unknown[] } | null>;
  updatePatient(operator: OperatorClaims, patientId: string, input: UpdatePatientRequest, requestId: string): Promise<ErpWrite>;
  listEncounters(operator: OperatorClaims, query: EncounterListQuery): Promise<ErpPageRows>;
  openEncounter(operator: OperatorClaims, input: OpenEncounterRequest, requestId: string): Promise<unknown>;
  getEncounter(
    operator: OperatorClaims,
    encounterId: string,
    requestId: string,
  ): Promise<{ encounter: unknown; patient: unknown; deliveries: readonly unknown[] } | null>;
  updateEncounter(operator: OperatorClaims, encounterId: string, input: UpdateEncounterRequest, requestId: string): Promise<ErpWrite>;
  recordDelivery(
    operator: OperatorClaims,
    encounterId: string,
    input: RecordDeliveryRequest,
    requestId: string,
  ): Promise<{ delivery: unknown; replayed: boolean } | null>;
  updateDelivery(operator: OperatorClaims, deliveryId: string, input: UpdateDeliveryRequest, requestId: string): Promise<ErpWrite>;

  /** Admins only (RLS returns nothing to anyone else). */
  audit(operator: OperatorClaims, page: ErpPageQuery): Promise<ErpPageRows>;
}
