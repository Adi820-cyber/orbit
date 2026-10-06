import {
  AddScheduleSlotRequestSchema,
  BillListResponseSchema,
  BillResponseSchema,
  CancelBillRequestSchema,
  CoverageResponseSchema,
  IssueBillRequestSchema,
  RecordPaymentRequestSchema,
  RevenueResponseSchema,
  SetCoverageRequestSchema,
  AttendanceBoardResponseSchema,
  AvailabilityResponseSchema,
  CorrectionListResponseSchema,
  CorrectionResponseSchema,
  CreateDoctorRequestSchema,
  CreateServiceRequestSchema,
  CreateStaffRequestSchema,
  DecideCorrectionRequestSchema,
  DeliveryResponseSchema,
  DoctorDetailResponseSchema,
  DoctorListResponseSchema,
  DoctorResponseSchema,
  EncounterDetailResponseSchema,
  EncounterListResponseSchema,
  EncounterResponseSchema,
  ErpAuditResponseSchema,
  ErpReferenceResponseSchema,
  ErpSummaryResponseSchema,
  OpenEncounterRequestSchema,
  PatientDetailResponseSchema,
  PatientResponseSchema,
  PatientSearchResponseSchema,
  RecordDeliveryRequestSchema,
  RecordPunchRequestSchema,
  RecordPunchResponseSchema,
  RegisterPatientRequestSchema,
  RequestCorrectionRequestSchema,
  RosterDayResponseSchema,
  ScheduleSlotResponseSchema,
  ServiceCatalogueResponseSchema,
  ServiceResponseSchema,
  SetAvailabilityRequestSchema,
  SetRosterRequestSchema,
  SetRosterResponseSchema,
  StaffAttendanceResponseSchema,
  StaffListResponseSchema,
  StaffResponseSchema,
  UpdateDeliveryRequestSchema,
  UpdateDoctorRequestSchema,
  UpdateEncounterRequestSchema,
  UpdatePatientRequestSchema,
  UpdateScheduleSlotRequestSchema,
  UpdateServiceRequestSchema,
  UpdateStaffRequestSchema,
} from "@orbit/contracts";
import { outgoing, type ApiRequest, type ContractParser } from "./api";

/*
 * Hospital operations (ERP) client (ADR 0016). Every request body is parsed
 * against `@orbit/contracts` before it is sent, and every response after it
 * arrives, exactly like the leader client. Facility, role and scope are never
 * sent as authorization inputs: the API derives them from the verified login,
 * and `facilityId` here only chooses among facilities the caller may see.
 */

type Call = <T>(request: ApiRequest, schema: ContractParser<T>) => Promise<T>;
type Query = Record<string, string | number | boolean | null | undefined>;

/** Only defined values become query parameters. */
export function erpQuery(values: Query): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  return query;
}

const id = (value: string) => encodeURIComponent(value);

export function createErpClient(call: Call) {
  const get = <T>(path: string, schema: ContractParser<T>, query?: Query) =>
    call({ method: "GET", path, ...(query ? { query: erpQuery(query) } : {}) }, schema);
  const send = <B, T>(method: "POST" | "PATCH" | "PUT", path: string, bodySchema: ContractParser<B>, body: unknown, schema: ContractParser<T>) =>
    call({ method, path, body: outgoing(bodySchema, body) }, schema);

  return {
    reference: () => get("/api/erp/reference", ErpReferenceResponseSchema),
    summary: (query: { facilityId?: string; date?: string }) => get("/api/erp/summary", ErpSummaryResponseSchema, query),
    audit: (query: { page?: number }) => get("/api/erp/audit", ErpAuditResponseSchema, query),

    staff: (query: Query) => get("/api/erp/staff", StaffListResponseSchema, query),
    staffMember: (staffId: string) => get(`/api/erp/staff/${id(staffId)}`, StaffResponseSchema),
    createStaff: (body: unknown) => send("POST", "/api/erp/staff", CreateStaffRequestSchema, body, StaffResponseSchema),
    updateStaff: (staffId: string, body: unknown) =>
      send("PATCH", `/api/erp/staff/${id(staffId)}`, UpdateStaffRequestSchema, body, StaffResponseSchema),

    doctors: (query: Query) => get("/api/erp/doctors", DoctorListResponseSchema, query),
    doctor: (staffId: string) => get(`/api/erp/doctors/${id(staffId)}`, DoctorDetailResponseSchema),
    createDoctor: (body: unknown) => send("POST", "/api/erp/doctors", CreateDoctorRequestSchema, body, DoctorResponseSchema),
    updateDoctor: (staffId: string, body: unknown) =>
      send("PATCH", `/api/erp/doctors/${id(staffId)}`, UpdateDoctorRequestSchema, body, DoctorResponseSchema),
    addScheduleSlot: (staffId: string, body: unknown) =>
      send("POST", `/api/erp/doctors/${id(staffId)}/schedule`, AddScheduleSlotRequestSchema, body, ScheduleSlotResponseSchema),
    updateScheduleSlot: (slotId: string, body: unknown) =>
      send("PATCH", `/api/erp/schedule-slots/${id(slotId)}`, UpdateScheduleSlotRequestSchema, body, ScheduleSlotResponseSchema),

    board: (query: { facilityId?: string; date?: string }) => get("/api/erp/attendance/board", AttendanceBoardResponseSchema, query),
    punch: (body: unknown) => send("POST", "/api/erp/attendance/punches", RecordPunchRequestSchema, body, RecordPunchResponseSchema),
    staffAttendance: (staffId: string, month: string) =>
      get(`/api/erp/attendance/staff/${id(staffId)}`, StaffAttendanceResponseSchema, { month }),
    corrections: (query: Query) => get("/api/erp/attendance/corrections", CorrectionListResponseSchema, query),
    requestCorrection: (body: unknown) =>
      send("POST", "/api/erp/attendance/corrections", RequestCorrectionRequestSchema, body, CorrectionResponseSchema),
    decideCorrection: (correctionId: string, body: unknown) =>
      send("POST", `/api/erp/attendance/corrections/${id(correctionId)}/decision`, DecideCorrectionRequestSchema, body, CorrectionResponseSchema),
    roster: (query: { facilityId?: string; date?: string }) => get("/api/erp/rosters", RosterDayResponseSchema, query),
    setRoster: (body: unknown) => send("PUT", "/api/erp/rosters", SetRosterRequestSchema, body, SetRosterResponseSchema),

    services: (query: Query) => get("/api/erp/services", ServiceCatalogueResponseSchema, query),
    createService: (body: unknown) => send("POST", "/api/erp/services", CreateServiceRequestSchema, body, ServiceResponseSchema),
    updateService: (serviceId: string, body: unknown) =>
      send("PATCH", `/api/erp/services/${id(serviceId)}`, UpdateServiceRequestSchema, body, ServiceResponseSchema),
    setAvailability: (facilityId: string, serviceId: string, body: unknown) =>
      send("PUT", `/api/erp/facilities/${id(facilityId)}/services/${id(serviceId)}`, SetAvailabilityRequestSchema, body, AvailabilityResponseSchema),

    patients: (query: Query) => get("/api/erp/patients", PatientSearchResponseSchema, query),
    patient: (patientId: string) => get(`/api/erp/patients/${id(patientId)}`, PatientDetailResponseSchema),
    registerPatient: (body: unknown) => send("POST", "/api/erp/patients", RegisterPatientRequestSchema, body, PatientResponseSchema),
    updatePatient: (patientId: string, body: unknown) =>
      send("PATCH", `/api/erp/patients/${id(patientId)}`, UpdatePatientRequestSchema, body, PatientResponseSchema),
    encounters: (query: Query) => get("/api/erp/encounters", EncounterListResponseSchema, query),
    encounter: (encounterId: string) => get(`/api/erp/encounters/${id(encounterId)}`, EncounterDetailResponseSchema),
    openEncounter: (body: unknown) => send("POST", "/api/erp/encounters", OpenEncounterRequestSchema, body, EncounterResponseSchema),
    updateEncounter: (encounterId: string, body: unknown) =>
      send("PATCH", `/api/erp/encounters/${id(encounterId)}`, UpdateEncounterRequestSchema, body, EncounterResponseSchema),
    recordDelivery: (encounterId: string, body: unknown) =>
      send("POST", `/api/erp/encounters/${id(encounterId)}/services`, RecordDeliveryRequestSchema, body, DeliveryResponseSchema),
    updateDelivery: (deliveryId: string, body: unknown) =>
      send("PATCH", `/api/erp/service-deliveries/${id(deliveryId)}`, UpdateDeliveryRequestSchema, body, DeliveryResponseSchema),

    // Billing (ADR 0022)
    coverage: (patientId: string) => get(`/api/erp/patients/${id(patientId)}/coverage`, CoverageResponseSchema),
    setCoverage: (patientId: string, body: unknown) =>
      send("PUT", `/api/erp/patients/${id(patientId)}/coverage`, SetCoverageRequestSchema, body, CoverageResponseSchema),
    issueBill: (encounterId: string, body: unknown) =>
      send("POST", `/api/erp/encounters/${id(encounterId)}/bills`, IssueBillRequestSchema, body, BillResponseSchema),
    bills: (query: Query) => get("/api/erp/bills", BillListResponseSchema, query),
    bill: (billId: string) => get(`/api/erp/bills/${id(billId)}`, BillResponseSchema),
    recordPayment: (billId: string, body: unknown) =>
      send("POST", `/api/erp/bills/${id(billId)}/payments`, RecordPaymentRequestSchema, body, BillResponseSchema),
    cancelBill: (billId: string, body: unknown) =>
      send("POST", `/api/erp/bills/${id(billId)}/cancel`, CancelBillRequestSchema, body, BillResponseSchema),
    revenue: (query: Query) => get("/api/erp/revenue", RevenueResponseSchema, query),
  };
}

export type ErpClient = ReturnType<typeof createErpClient>;
