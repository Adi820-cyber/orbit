/**
 * Reference datasets → Orbit (ADR 0020).
 *
 * Turns two outside synthetic hospital datasets into Orbit's own records:
 *
 *   "hospital": one synthetic hospital (patients, admissions, employees,
 *               doctors, wards, beds, bills, diagnostic tests, prescriptions,
 *               drugs, stock, suppliers, insurers).
 *   "clinic":   a small outpatient dataset (patients, doctors, appointments,
 *               treatments, bills).
 *
 * What goes where (decided by the product owner, 2026-10-05):
 *
 * - People, visits and services become hospital-operations rows, spread over
 *   Kestrion's six hospitals in proportion to staffed beds, the same way every
 *   run. Only what Orbit's model allows is kept: a patient is a fictional name,
 *   sex and birth year. Phone numbers, addresses, cities, emails, blood groups
 *   and insurance numbers are dropped. Names come from Orbit's fictional lists,
 *   never from the source.
 * - Clinical and financial detail (diagnoses, test results, prescriptions,
 *   drugs, bills, insurance) is NOT stored as records: hospital operations hold
 *   no clinical content (ADR 0016). It becomes exact aggregate knowledge for
 *   the chatbot, each topic visible only to the roles it concerns.
 * - Dates move forward by a whole number of weeks so each dataset's history
 *   ends on HISTORY_END. Weekdays and every interval stay exact.
 *
 * Pure: no file or network access. scripts/load-reference-datasets.ts does the I/O.
 */
import { createHash } from "node:crypto";
import { FICTIONAL_GIVEN_NAMES, FICTIONAL_SURNAMES, stableUuid } from "./erp.ts";
import { COMPANY_MANIFEST } from "./manifest.ts";
import { streamFor } from "./rng.ts";

export type Row = Record<string, string>;
export type Table = Row[];

export const HOSPITAL_TABLES = [
  "admission", "bed", "billing", "billing_detail", "department", "diagnostic_test", "disease", "doctor", "drug",
  "drug_inventory", "drug_manufacturer", "employee", "insurance_provider", "patient", "patient_diagnostic",
  "patient_insurance", "prescription", "staff_assignment", "ward",
] as const;
export const CLINIC_TABLES = ["appointments", "billing", "doctors", "patients", "treatments"] as const;

export type HospitalTables = Record<(typeof HOSPITAL_TABLES)[number], Table>;
export type ClinicTables = Record<(typeof CLINIC_TABLES)[number], Table>;

/** Both datasets' history ends here, the day before the live hospital's own records begin. */
export const HISTORY_END = "2026-09-30";

const SEED = COMPANY_MANIFEST.seed;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): Table {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rows] = records.filter((r) => r.length > 1 || (r[0] ?? "") !== "");
  if (!header) return [];
  const names = header.map((h) => h.replace(/^﻿/, "").trim());
  return rows.map((r) => Object.fromEntries(names.map((name, index) => [name, r[index] ?? ""])));
}

// ---------------------------------------------------------------------------
// Dates and helpers
// ---------------------------------------------------------------------------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Whole weeks, so weekdays are kept, that move `latest` as close to `end` as possible without passing it. */
export function weeksShift(latest: string, end: string = HISTORY_END): number {
  return Math.floor(daysBetween(latest, end) / 7) * 7;
}

function at(date: string, minutes: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function clamp(iso: string, from: string, to: string): string {
  if (iso < from) return from;
  if (iso > to) return to;
  return iso;
}

const pad = (n: number | string, width: number) => String(n).padStart(width, "0");
const pct = (part: number, whole: number) => (whole === 0 ? "not applicable" : `${((part / whole) * 100).toFixed(1)} percent`);
const money = (n: number) => String(Math.round(n));

function fictionalName(...label: string[]): string {
  const rng = streamFor(SEED, "ref-name", ...label);
  return `${rng.pick(FICTIONAL_GIVEN_NAMES)} ${rng.pick(FICTIONAL_SURNAMES)}`;
}

function counts<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function listCounts(entries: readonly [string, number][], total: number, limit = entries.length): string {
  return entries
    .slice(0, limit)
    .map(([name, n]) => `${name} ${n} (${pct(n, total)})`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

const FACILITIES = COMPANY_MANIFEST.facilities;
const TOTAL_BEDS = FACILITIES.reduce((sum, f) => sum + f.staffedBeds, 0);

/** A hospital chosen in proportion to staffed beds, the same for the same label every run. */
export function facilityFor(...label: string[]): string {
  let draw = streamFor(SEED, "ref-facility", ...label).unit() * TOTAL_BEDS;
  for (const facility of FACILITIES) {
    draw -= facility.staffedBeds;
    if (draw < 0) return facility.slug;
  }
  return FACILITIES[FACILITIES.length - 1]!.slug;
}

/** The clinic dataset's three branches, matched to three Kestrion hospitals (a mapping, not a claim). */
export const CLINIC_BRANCHES: Readonly<Record<string, string>> = {
  "Central Hospital": "avenhurst",
  "Westside Clinic": "calderwyn",
  "Eastside Clinic": "farrowgate",
};

// ---------------------------------------------------------------------------
// Reference mappings
// ---------------------------------------------------------------------------

/** Departments the datasets need that Orbit's catalogue lacks. Existing ones are reused. */
export const NEW_DEPARTMENTS: ReadonlyArray<[string, string]> = [
  ["IMED", "Internal medicine"],
  ["SURG", "Surgery"],
  ["PAED", "Paediatrics"],
  ["PHARM", "Pharmacy"],
  ["BILL", "Billing"],
  ["HR", "Human resources"],
];

export const NEW_SPECIALTIES: ReadonlyArray<[string, string]> = [
  ["NEURO", "Neurology"],
  ["PULM", "Pulmonology"],
  ["PAED", "Paediatrics"],
  ["NEPH", "Nephrology"],
  ["DERM", "Dermatology"],
];

/** [code, name, category, department, unit] */
export const NEW_SERVICES: ReadonlyArray<[string, string, string, string, string]> = [
  ["SURG-PROC", "Surgical procedure", "procedure", "SURG", "per-procedure"],
];

const HOSPITAL_DEPARTMENT: Readonly<Record<string, string>> = {
  Emergency: "EMER", "Internal Medicine": "IMED", Surgery: "SURG", Pediatrics: "PAED", Orthopedics: "ORTH",
  ICU: "ICU", Radiology: "RAD", Pathology: "LAB", Pharmacy: "PHARM", Billing: "BILL", HR: "HR",
};

const SPECIALTY: Readonly<Record<string, string>> = {
  Neurology: "NEURO", "General Medicine": "GEN", Cardiology: "CARD", ICU: "CRIT", Orthopedics: "ORTH",
  Pulmonology: "PULM", Pediatrics: "PAED", Nephrology: "NEPH", Surgery: "SURG", Dermatology: "DERM", Oncology: "ONCO",
};

/** Which doctors attend a stay in each department; the first one with a doctor at that hospital is used. */
const ATTENDING_SPECIALTIES: Readonly<Record<string, readonly string[]>> = {
  EMER: ["GEN", "CRIT", "CARD"],
  IMED: ["GEN", "NEURO", "PULM", "NEPH", "CARD"],
  SURG: ["SURG"],
  PAED: ["PAED"],
  ORTH: ["ORTH"],
  ICU: ["CRIT", "PULM", "CARD"],
};

const TEST_SERVICE: Readonly<Record<string, string>> = {
  "X-Ray Chest": "IMG-XRAY",
  "CT Scan Brain": "IMG-CT",
  "MRI Spine": "IMG-MRI",
  "Ultrasound Abdomen": "IMG-US",
  "Complete Blood Count": "LAB-BLOOD",
  "Blood Sugar": "LAB-CHEM",
  "Liver Function Test": "LAB-CHEM",
  "Kidney Function Test": "LAB-CHEM",
  "Lipid Profile": "LAB-CHEM",
};

const TREATMENT_SERVICE: Readonly<Record<string, string>> = {
  Chemotherapy: "ONCO-DAY",
  "X-Ray": "IMG-XRAY",
  ECG: "CARD-ECG",
  MRI: "IMG-MRI",
  Physiotherapy: "REHAB-SESS",
};

const CLINIC_DEPARTMENT: Readonly<Record<string, string>> = { Pediatrics: "PAED", Dermatology: "OPD", Oncology: "ONCO" };

type StaffType = "doctor" | "nurse" | "technician" | "administrative" | "support";

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface RefStaff {
  id: string;
  facility: string;
  departmentCode: string;
  employeeCode: string;
  displayName: string;
  staffType: StaffType;
  designation: string;
  joinedOn: string;
  isCriticalRole: boolean;
}
export interface RefDoctor {
  staffId: string;
  specialtyCode: string;
  registrationNumber: string;
  credentialExpiresOn: string;
  employmentType: "employed" | "visiting" | "consultant";
}
export interface RefPatient {
  id: string;
  facility: string;
  mrn: string;
  displayName: string;
  sex: "female" | "male" | "other" | "unknown";
  birthYear: number;
  createdAt: string;
}
export interface RefEncounter {
  id: string;
  patientId: string;
  facility: string;
  departmentCode: string;
  doctorId: string | null;
  type: "outpatient" | "inpatient" | "emergency" | "day-care";
  status: "closed" | "cancelled";
  startedAt: string;
  endedAt: string;
  /** The disease recorded on admission, as a presenting condition (ADR 0023). Admissions only. */
  conditionName?: string;
}
export interface RefDelivery {
  encounterId: string;
  serviceCode: string;
  performerId: string;
  quantity: number;
  performedAt: string;
  key: string;
}
export interface RefChunk {
  key: string;
  source: string;
  domain: string;
  roles: readonly string[];
  grain: "group" | "facility" | null;
  facility: string | null;
  title: string;
  content: string;
}

export interface ReferenceResult {
  staff: RefStaff[];
  doctors: RefDoctor[];
  patients: RefPatient[];
  encounters: RefEncounter[];
  deliveries: RefDelivery[];
  availability: { facility: string; serviceCode: string }[];
  chunks: RefChunk[];
  manifest: {
    historyEnd: string;
    hospitalShiftDays: number;
    clinicShiftDays: number;
    counts: Record<string, number>;
    excluded: Record<string, number>;
    dropped: string[];
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const num = (value: string | undefined) => Number(value ?? "0") || 0;

export function buildReference(hospital: HospitalTables, clinic: ClinicTables): ReferenceResult {
  const excluded: Record<string, number> = {};
  const exclude = (why: string) => {
    excluded[why] = (excluded[why] ?? 0) + 1;
  };

  // ----- Hospital dataset -----------------------------------------------------
  const latestHospital = hospital.admission.reduce((max, a) => (a.discharge_date && a.discharge_date > max ? a.discharge_date : max), "0000");
  const hShift = weeksShift(latestHospital);
  const hDate = (d: string) => addDays(d, hShift);

  const deptName = new Map(hospital.department.map((d) => [d.department_id!, d.department_name!]));
  const admissionDisease = new Map(hospital.disease.map((d) => [d.disease_id!, d.disease_name!]));
  const deptCode = (departmentId: string) => HOSPITAL_DEPARTMENT[deptName.get(departmentId) ?? ""] ?? "WARD";
  const wardType = new Map(hospital.ward.map((w) => [w.ward_id!, w.ward_type!]));

  const staff: RefStaff[] = [];
  const doctors: RefDoctor[] = [];
  const doctorByEmployee = new Map(hospital.doctor.map((d) => [d.employee_id!, d]));
  const staffByEmployee = new Map<string, RefStaff>();
  for (const e of hospital.employee) {
    const doc = doctorByEmployee.get(e.employee_id!);
    const dept = deptCode(e.department_id!);
    const role = e.role!;
    const staffType: StaffType =
      role === "Doctor" ? "doctor" : role === "Nurse" ? "nurse" : role === "Technician" ? "technician" : role === "Admin" ? "administrative" : "support";
    const designation =
      doc ? `${doc.specialization} doctor (${doc.qualification})`
      : role === "Nurse" ? "Staff nurse"
      : role === "Technician" ? (dept === "RAD" ? "Radiology technician" : dept === "LAB" ? "Laboratory technician" : "Technician")
      : role === "Pharmacist" ? "Pharmacist"
      : role === "Admin" ? "Administrator"
      : role;
    const joined = hDate(e.date_of_joining!);
    const person: RefStaff = {
      id: stableUuid("ref-staff", e.employee_id!),
      facility: facilityFor("employee", e.employee_id!),
      departmentCode: dept,
      employeeCode: `HSD-E${pad(e.employee_id!, 5)}`,
      displayName: fictionalName("employee", e.employee_id!),
      staffType,
      designation,
      joinedOn: joined > HISTORY_END ? HISTORY_END : joined,
      isCriticalRole: staffType === "doctor" || (staffType === "nurse" && (dept === "ICU" || dept === "EMER")),
    };
    staff.push(person);
    staffByEmployee.set(e.employee_id!, person);
    if (doc) {
      const rng = streamFor(SEED, "ref-credential", doc.doctor_id!);
      doctors.push({
        staffId: person.id,
        specialtyCode: SPECIALTY[doc.specialization!] ?? "GEN",
        registrationNumber: `DEMO-REG-${500000 + num(doc.doctor_id)}`,
        // Not in the source. Illustrative, and after every recorded service so history stays valid.
        credentialExpiresOn: addDays(HISTORY_END, rng.int(12, 730)),
        employmentType: e.employment_type === "Contract" ? "consultant" : "employed",
      });
    }
  }

  const doctorStaffIds = new Set(doctors.map((d) => d.staffId));
  const specialtyOf = new Map(doctors.map((d) => [d.staffId, d.specialtyCode]));
  const doctorsAt = new Map<string, RefStaff[]>();
  const nursesAt = new Map<string, RefStaff[]>();
  for (const s of staff) {
    if (doctorStaffIds.has(s.id)) doctorsAt.set(s.facility, [...(doctorsAt.get(s.facility) ?? []), s]);
    if (s.staffType === "nurse") nursesAt.set(s.facility, [...(nursesAt.get(s.facility) ?? []), s]);
  }
  const pickFrom = <T>(items: readonly T[] | undefined, ...label: string[]): T | undefined =>
    items && items.length > 0 ? streamFor(SEED, "ref-pick", ...label).pick(items) : undefined;
  const attendingFor = (facility: string, dept: string, label: string): RefStaff | undefined => {
    const here = doctorsAt.get(facility) ?? [];
    for (const spec of ATTENDING_SPECIALTIES[dept] ?? []) {
      const match = here.filter((d) => specialtyOf.get(d.id) === spec);
      if (match.length > 0) return pickFrom(match, "attending", label);
    }
    return pickFrom(here, "attending-any", label);
  };

  const patients: RefPatient[] = [];
  const patientById = new Map<string, RefPatient>();
  for (const p of hospital.patient) {
    const rec: RefPatient = {
      id: stableUuid("ref-patient", p.patient_id!),
      facility: facilityFor("patient", p.patient_id!),
      mrn: `DEMO-MRN-1${pad(p.patient_id!, 6)}`,
      displayName: fictionalName("patient", p.patient_id!),
      sex: p.gender === "Male" ? "male" : p.gender === "Female" ? "female" : p.gender === "Other" ? "other" : "unknown",
      birthYear: Number(hDate(p.date_of_birth!).slice(0, 4)),
      createdAt: "",
    };
    patients.push(rec);
    patientById.set(p.patient_id!, rec);
  }

  const billByAdmission = new Map(hospital.billing.map((b) => [b.admission_id!, b]));
  const detailsByBill = new Map<string, Row[]>();
  for (const d of hospital.billing_detail) detailsByBill.set(d.bill_id!, [...(detailsByBill.get(d.bill_id!) ?? []), d]);
  const diagByAdmission = new Map<string, Row[]>();
  for (const d of hospital.patient_diagnostic) diagByAdmission.set(d.admission_id!, [...(diagByAdmission.get(d.admission_id!) ?? []), d]);
  const testName = new Map(hospital.diagnostic_test.map((t) => [t.test_id!, t.test_name!]));
  const doctorEmployee = new Map(hospital.doctor.map((d) => [d.doctor_id!, d.employee_id!]));

  const encounters: RefEncounter[] = [];
  const deliveries: RefDelivery[] = [];
  /** Admissions actually loaded, with their hospital, for the knowledge summaries. */
  const loadedAdmissions: { row: Row; facility: string; dept: string }[] = [];

  for (const a of hospital.admission) {
    const patient = patientById.get(a.patient_id!);
    if (!patient) {
      exclude("admission without a patient");
      continue;
    }
    const startDate = hDate(a.admission_date!);
    const endDate = hDate(a.discharge_date!);
    if (patient.birthYear > Number(startDate.slice(0, 4))) {
      exclude("admission before the patient's birth year");
      continue;
    }
    const facility = patient.facility;
    const dept = deptCode(a.department_id!);
    const rng = streamFor(SEED, "ref-admission-time", a.admission_id!);
    const startedAt = at(startDate, a.admission_type === "Emergency" ? rng.int(0, 23 * 60 + 30) : rng.int(7 * 60, 11 * 60));
    const endedAt = at(endDate, rng.int(10 * 60, 15 * 60));
    const doctor = attendingFor(facility, dept, a.admission_id!);
    const id = stableUuid("ref-encounter", a.admission_id!);
    const disease = admissionDisease.get(a.disease_id ?? "");
    encounters.push({
      id, patientId: patient.id, facility, departmentCode: dept, doctorId: doctor?.id ?? null, type: "inpatient", status: "closed", startedAt, endedAt,
      ...(disease ? { conditionName: disease } : {}),
    });
    loadedAdmissions.push({ row: a, facility, dept });
    if (!patient.createdAt || startedAt < patient.createdAt) patient.createdAt = startedAt;

    const lo = plusMinutes(startedAt, 30);
    const hi = plusMinutes(endedAt, -30);
    const nurse = pickFrom(nursesAt.get(facility), "room", a.admission_id!);
    const stayDays = Math.max(1, daysBetween(startDate, endDate));
    if (nurse) {
      deliveries.push({
        encounterId: id,
        serviceCode: wardType.get(a.ward_id!) === "ICU" ? "ICU-DAY" : "WARD-DAY",
        performerId: nurse.id,
        quantity: Math.min(100, stayDays),
        performedAt: plusMinutes(startedAt, 15),
        key: stableUuid("ref-delivery", "room", a.admission_id!),
      });
    } else {
      exclude("bed-day without a nurse at the hospital");
    }

    const bill = billByAdmission.get(a.admission_id!);
    const procedures = (bill ? detailsByBill.get(bill.bill_id!) ?? [] : []).filter((d) => d.charge_type === "Procedure");
    procedures.forEach((p, index) => {
      const performer = doctor ?? pickFrom(doctorsAt.get(facility), "procedure", p.billing_detail_id!);
      if (!performer) return exclude("procedure without a doctor at the hospital");
      deliveries.push({
        encounterId: id,
        serviceCode: dept === "SURG" ? "SURG-PROC" : dept === "ORTH" ? "ORTH-PROC" : "PROC-MINOR",
        performerId: performer.id,
        quantity: 1,
        performedAt: clamp(plusMinutes(startedAt, 180 + index * 240), lo, hi),
        key: stableUuid("ref-delivery", "procedure", p.billing_detail_id!),
      });
    });

    for (const t of diagByAdmission.get(a.admission_id!) ?? []) {
      const service = TEST_SERVICE[testName.get(t.test_id!) ?? ""];
      if (!service) {
        exclude("test with no matching service");
        continue;
      }
      const original = staffByEmployee.get(doctorEmployee.get(t.doctor_id!) ?? "");
      const performer = original && original.facility === facility ? original : pickFrom(doctorsAt.get(facility), "test", t.patient_diagnostic_id!);
      if (!performer) {
        exclude("test without a doctor at the hospital");
        continue;
      }
      const testDate = hDate(t.test_date!);
      const tRng = streamFor(SEED, "ref-test-time", t.patient_diagnostic_id!);
      const candidate = testDate === startDate ? plusMinutes(startedAt, tRng.int(60, 240)) : at(testDate, tRng.int(8 * 60, 18 * 60));
      deliveries.push({
        encounterId: id,
        serviceCode: service,
        performerId: performer.id,
        quantity: 1,
        performedAt: clamp(candidate, lo, hi),
        key: stableUuid("ref-delivery", "test", t.patient_diagnostic_id!),
      });
    }
  }
  for (const p of patients) {
    if (!p.createdAt) p.createdAt = at(addDays(HISTORY_END, -streamFor(SEED, "ref-registered", p.id).int(30, 2000)), 9 * 60);
  }

  // ----- Clinic dataset -------------------------------------------------------
  const latestClinic = clinic.appointments.reduce((max, a) => (a.appointment_date! > max ? a.appointment_date! : max), "0000");
  const cShift = weeksShift(latestClinic);
  const cDate = (d: string) => addDays(d, cShift);
  const firstAppointmentDate = clinic.appointments.reduce((min, a) => (a.appointment_date! < min ? a.appointment_date! : min), "9999");

  const clinicDoctor = new Map<string, RefStaff>();
  for (const d of clinic.doctors) {
    const facility = CLINIC_BRANCHES[d.hospital_branch!] ?? "avenhurst";
    const person: RefStaff = {
      id: stableUuid("ref-clinic-staff", d.doctor_id!),
      facility,
      departmentCode: CLINIC_DEPARTMENT[d.specialization!] ?? "OPD",
      employeeCode: `HSA-${d.doctor_id!}`,
      displayName: fictionalName("clinic-doctor", d.doctor_id!),
      staffType: "doctor",
      designation: `${d.specialization} doctor`,
      joinedOn: cDate(firstAppointmentDate),
      isCriticalRole: true,
    };
    staff.push(person);
    clinicDoctor.set(d.doctor_id!, person);
    doctors.push({
      staffId: person.id,
      specialtyCode: SPECIALTY[d.specialization!] ?? "GEN",
      registrationNumber: `DEMO-REG-${600000 + num(d.doctor_id!.replace(/\D/g, ""))}`,
      credentialExpiresOn: addDays(HISTORY_END, streamFor(SEED, "ref-credential-clinic", d.doctor_id!).int(12, 730)),
      employmentType: "employed",
    });
  }

  const appointmentsByPatient = new Map<string, Row[]>();
  for (const a of clinic.appointments) appointmentsByPatient.set(a.patient_id!, [...(appointmentsByPatient.get(a.patient_id!) ?? []), a]);
  const clinicPatient = new Map<string, RefPatient>();
  for (const p of clinic.patients) {
    const first = (appointmentsByPatient.get(p.patient_id!) ?? []).sort((x, y) => x.appointment_date!.localeCompare(y.appointment_date!))[0];
    const rec: RefPatient = {
      id: stableUuid("ref-clinic-patient", p.patient_id!),
      facility: first ? clinicDoctor.get(first.doctor_id!)?.facility ?? "avenhurst" : "avenhurst",
      mrn: `DEMO-MRN-2${pad(p.patient_id!.replace(/\D/g, ""), 6)}`,
      displayName: fictionalName("clinic-patient", p.patient_id!),
      sex: p.gender === "M" ? "male" : p.gender === "F" ? "female" : "unknown",
      birthYear: Number(cDate(p.date_of_birth!).slice(0, 4)),
      createdAt: at(cDate(p.registration_date!), 9 * 60),
    };
    patients.push(rec);
    clinicPatient.set(p.patient_id!, rec);
  }

  const treatmentsByAppointment = new Map<string, Row[]>();
  for (const t of clinic.treatments) treatmentsByAppointment.set(t.appointment_id!, [...(treatmentsByAppointment.get(t.appointment_id!) ?? []), t]);
  for (const a of clinic.appointments) {
    const patient = clinicPatient.get(a.patient_id!);
    const doctor = clinicDoctor.get(a.doctor_id!);
    if (!patient || !doctor) {
      exclude("appointment without its patient or doctor");
      continue;
    }
    if (a.status === "Scheduled") {
      // A booking, not a visit: hospital operations record visits that happened. Counted in the knowledge summary.
      exclude("appointment still scheduled in the source (a booking, not a visit)");
      continue;
    }
    const [hour, minute] = a.appointment_time!.split(":").map(Number);
    const startedAt = at(cDate(a.appointment_date!), (hour ?? 0) * 60 + (minute ?? 0));
    const completed = a.status === "Completed";
    const id = stableUuid("ref-clinic-encounter", a.appointment_id!);
    const endedAt = completed ? plusMinutes(startedAt, 45) : startedAt;
    if (patient.createdAt > startedAt) patient.createdAt = startedAt;
    encounters.push({
      id,
      patientId: patient.id,
      facility: doctor.facility,
      departmentCode: doctor.departmentCode,
      doctorId: doctor.id,
      type: a.reason_for_visit === "Emergency" ? "emergency" : "outpatient",
      status: completed ? "closed" : "cancelled",
      startedAt,
      endedAt,
    });
    if (!completed) {
      // The source also lists treatments for no-shows and cancellations; those never happened.
      for (const _ of treatmentsByAppointment.get(a.appointment_id!) ?? []) exclude("treatment on a no-show or cancelled appointment");
      continue;
    }
    for (const t of treatmentsByAppointment.get(a.appointment_id!) ?? []) {
      const service = TREATMENT_SERVICE[t.treatment_type!];
      if (!service) {
        exclude("treatment with no matching service");
        continue;
      }
      deliveries.push({
        encounterId: id,
        serviceCode: service,
        performerId: doctor.id,
        quantity: 1,
        performedAt: plusMinutes(startedAt, 15),
        key: stableUuid("ref-delivery", "clinic", t.treatment_id!),
      });
    }
  }

  // Every service the records use must be offered where it was given.
  const facilityOfEncounter = new Map(encounters.map((e) => [e.id, e.facility]));
  const availabilityKeys = new Set(deliveries.map((d) => `${facilityOfEncounter.get(d.encounterId)}|${d.serviceCode}`));
  const availability = [...availabilityKeys].sort().map((key) => {
    const [facility, serviceCode] = key.split("|") as [string, string];
    return { facility, serviceCode };
  });

  // ----- Knowledge --------------------------------------------------------------
  const chunks = buildChunks({ hospital, clinic, hShift, cShift, staff, loadedAdmissions, patients: patientById });

  return {
    staff,
    doctors,
    patients,
    encounters,
    deliveries,
    availability,
    chunks,
    manifest: {
      historyEnd: HISTORY_END,
      hospitalShiftDays: hShift,
      clinicShiftDays: cShift,
      counts: {
        staff: staff.length,
        doctors: doctors.length,
        patients: patients.length,
        encounters: encounters.length,
        deliveries: deliveries.length,
        availability: availability.length,
        knowledgeChunks: chunks.length,
      },
      excluded,
      dropped: [
        "patient names, phone numbers, addresses, cities, emails, blood groups and insurance numbers",
        "employee and doctor names (replaced by fictional names), phone numbers and emails",
        "diagnoses, test results and prescriptions as patient records (summarised as knowledge instead)",
        "bill dates (not tied to their admissions in the source); amounts are summarised as knowledge",
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Knowledge: exact summaries, per hospital and for the group
// ---------------------------------------------------------------------------

const ROLE = {
  ops: ["regional-coo", "hospital-dho", "clinical-director"],
  clinical: ["clinical-director", "hospital-dho", "regional-coo"],
  tests: ["clinical-director", "hospital-dho"],
  billing: ["billing-lead", "corporate-revenue-lead", "group-cfo", "hospital-dho", "regional-coo"],
  insurance: ["corporate-revenue-lead", "billing-lead", "group-cfo"],
  medicines: ["clinical-director", "hospital-dho"],
  workforce: ["people-executive", "hr-head", "hospital-dho", "regional-coo"],
  supply: ["procurement-head", "group-cfo"],
  suppliers: ["procurement-head", "group-cfo", "legal-head"],
  beds: ["regional-coo", "hospital-dho", "clinical-director"],
  clinic: ["hospital-dho", "regional-coo", "billing-lead", "bd-lead"],
} as const;

const HOSPITAL_SOURCE = "reference:hospital-dataset";
const CLINIC_SOURCE = "reference:clinic-dataset";
const NOTE = "Reference dataset loaded into Orbit; illustrative, not real hospital data.";

interface ChunkInput {
  hospital: HospitalTables;
  clinic: ClinicTables;
  hShift: number;
  cShift: number;
  staff: RefStaff[];
  loadedAdmissions: { row: Row; facility: string; dept: string }[];
  patients: Map<string, RefPatient>;
}

function buildChunks(input: ChunkInput): RefChunk[] {
  const { hospital, clinic, hShift, cShift, staff, loadedAdmissions, patients } = input;
  const out: RefChunk[] = [];
  const scopes: { slug: string | null; name: string }[] = [
    { slug: null, name: "Kestrion Health Group" },
    ...FACILITIES.map((f) => ({ slug: f.slug, name: f.name })),
  ];
  const push = (key: string, source: string, domain: string, roles: readonly string[], slug: string | null, title: string, content: string) =>
    out.push({ key, source, domain, roles, grain: slug ? "facility" : "group", facility: slug, title, content });
  const deptLabel = new Map([...NEW_DEPARTMENTS, ["EMER", "Emergency"], ["ORTH", "Orthopaedics"], ["ICU", "Critical care"], ["WARD", "Inpatient wards"]] as [string, string][]);
  const diseaseName = new Map(hospital.disease.map((d) => [d.disease_id!, d]));
  const testName = new Map(hospital.diagnostic_test.map((t) => [t.test_id!, t.test_name!]));
  const drugById = new Map(hospital.drug.map((d) => [d.drug_id!, d]));
  const billByAdmission = new Map(hospital.billing.map((b) => [b.admission_id!, b]));
  const detailsByBill = new Map<string, Row[]>();
  for (const d of hospital.billing_detail) detailsByBill.set(d.bill_id!, [...(detailsByBill.get(d.bill_id!) ?? []), d]);
  const diagByAdmission = new Map<string, Row[]>();
  for (const d of hospital.patient_diagnostic) diagByAdmission.set(d.admission_id!, [...(diagByAdmission.get(d.admission_id!) ?? []), d]);
  const rxByAdmission = new Map<string, Row[]>();
  for (const r of hospital.prescription) rxByAdmission.set(r.admission_id!, [...(rxByAdmission.get(r.admission_id!) ?? []), r]);
  const shifted = (d: string) => addDays(d, hShift);

  for (const scope of scopes) {
    const where = scope.slug ? `at ${scope.name}` : "across Kestrion Health Group";
    const adm = loadedAdmissions.filter((a) => !scope.slug || a.facility === scope.slug);
    if (adm.length === 0) continue;
    const suffix = scope.slug ?? "group";

    // Admissions history
    const from = shifted(adm.reduce((m, a) => (a.row.admission_date! < m ? a.row.admission_date! : m), "9999"));
    const to = shifted(adm.reduce((m, a) => (a.row.discharge_date! > m ? a.row.discharge_date! : m), "0000"));
    const stay = adm.reduce((s, a) => s + daysBetween(a.row.admission_date!, a.row.discharge_date!), 0) / adm.length;
    const emergency = adm.filter((a) => a.row.admission_type === "Emergency").length;
    const byDept = counts(adm, (a) => deptLabel.get(a.dept) ?? a.dept);
    const byYear = counts(adm, (a) => shifted(a.row.admission_date!).slice(0, 4)).sort((a, b) => a[0].localeCompare(b[0]));
    push(`ref:admissions:${suffix}`, HOSPITAL_SOURCE, "reference-operations", ROLE.ops, scope.slug, `Admissions history ${where}`,
      `${adm.length} patients were admitted to hospital ${where} from ${from} to ${to}. ${emergency} were emergency admissions, patients admitted as emergencies (${pct(emergency, adm.length)}), and ${adm.length - emergency} were planned admissions. Average length of stay ${stay.toFixed(1)} days. By department: ${listCounts(byDept, adm.length)}. By year: ${byYear.map(([y, n]) => `${y} ${n}`).join(", ")}. All were discharged. ${NOTE}`);

    // Diagnoses (clinical, as counts only)
    const dis = adm.map((a) => diseaseName.get(a.row.disease_id!));
    const byCategory = counts(dis, (d) => d?.disease_category ?? "Unknown");
    const byDisease = counts(dis, (d) => d?.disease_name ?? "Unknown");
    push(`ref:diagnoses:${suffix}`, HOSPITAL_SOURCE, "reference-clinical", ROLE.clinical, scope.slug, `Diagnoses on admission ${where}`,
      `Admitting diagnoses for ${adm.length} admissions ${where}, by category: ${listCounts(byCategory, adm.length)}. Most common diagnoses: ${listCounts(byDisease, adm.length, 6)}. Counts only; no patient is identified. ${NOTE}`);

    // Diagnostic tests
    const tests = adm.flatMap((a) => diagByAdmission.get(a.row.admission_id!) ?? []);
    const byTest = counts(tests, (t) => testName.get(t.test_id!) ?? "Unknown");
    const abnormalLines = byTest.map(([name, n]) => {
      const abnormal = tests.filter((t) => (testName.get(t.test_id!) ?? "Unknown") === name && t.result_status === "Abnormal").length;
      return `${name} ${n} tests, ${pct(abnormal, n)} abnormal`;
    });
    push(`ref:tests:${suffix}`, HOSPITAL_SOURCE, "reference-clinical", ROLE.tests, scope.slug, `Diagnostic tests ${where}`,
      `${tests.length} diagnostic tests during admissions ${where}, ${pct(tests.filter((t) => t.result_status === "Abnormal").length, tests.length)} with an abnormal result. By test: ${abnormalLines.join("; ")}. ${NOTE}`);

    // Billing and collections (amounts in the source's own currency units)
    const bills = adm.map((a) => billByAdmission.get(a.row.admission_id!)).filter((b): b is Row => Boolean(b));
    const total = bills.reduce((s, b) => s + num(b.total_amount), 0);
    const covered = bills.reduce((s, b) => s + num(b.insurance_covered_amount), 0);
    const payable = bills.reduce((s, b) => s + num(b.patient_payable_amount), 0);
    const pending = bills.filter((b) => b.payment_status === "Pending");
    const pendingAmount = pending.reduce((s, b) => s + num(b.total_amount), 0);
    const byMode = counts(bills, (b) => b.payment_mode!);
    const details = bills.flatMap((b) => detailsByBill.get(b.bill_id!) ?? []);
    const detailTotal = details.reduce((s, d) => s + num(d.amount), 0);
    const byCharge = [...new Set(details.map((d) => d.charge_type!))].sort().map((type) => {
      const amount = details.filter((d) => d.charge_type === type).reduce((s, d) => s + num(d.amount), 0);
      return `${type} ${money(amount)} (${pct(amount, detailTotal)})`;
    });
    push(`ref:billing:${suffix}`, HOSPITAL_SOURCE, "reference-finance", ROLE.billing, scope.slug, `Billing and collections ${where}`,
      `${bills.length} admission bills ${where} totalling ${money(total)}, in rupees (INR), as the source dataset records them. Insurance covered ${money(covered)} (${pct(covered, total)}); patients owed ${money(payable)}. Payment status: ${bills.length - pending.length} bills paid and ${pending.length} still unpaid, marked pending (${pct(pending.length, bills.length)}); ${money(pendingAmount)} of billing is still outstanding. Payment modes: ${listCounts(byMode, bills.length)}. Charges by type: ${byCharge.join(", ")}. ${NOTE}`);

    // Medicines prescribed
    const rx = adm.flatMap((a) => rxByAdmission.get(a.row.admission_id!) ?? []);
    const byDrugCategory = counts(rx, (r) => drugById.get(r.drug_id!)?.drug_category ?? "Unknown");
    const avgDuration = rx.length === 0 ? 0 : rx.reduce((s, r) => s + num(r.duration_days), 0) / rx.length;
    push(`ref:prescriptions:${suffix}`, HOSPITAL_SOURCE, "reference-clinical", ROLE.medicines, scope.slug, `Medicines prescribed ${where}`,
      `${rx.length} prescriptions during admissions ${where}, average course ${avgDuration.toFixed(1)} days. By medicine category: ${listCounts(byDrugCategory, rx.length)}. Counts only; no patient is identified. ${NOTE}`);

    // Insurance cover of the patients registered here
    const patientIds = new Set([...patients.entries()].filter(([, p]) => !scope.slug || p.facility === scope.slug).map(([id]) => id));
    const policies = hospital.patient_insurance.filter((p) => patientIds.has(p.patient_id!));
    const insured = new Set(policies.map((p) => p.patient_id!)).size;
    const providerType = new Map(hospital.insurance_provider.map((p) => [p.insurance_provider_id!, p]));
    const byType = counts(policies, (p) => (providerType.get(p.insurance_provider_id!)?.provider_type === "Govt" ? "government" : "private"));
    const avgCover = policies.length === 0 ? 0 : policies.reduce((s, p) => s + num(p.coverage_percentage), 0) / policies.length;
    const firstStart = policies.reduce((m, p) => (p.policy_start_date! < m ? p.policy_start_date! : m), "9999");
    const lastEnd = policies.reduce((m, p) => (p.policy_end_date! > m ? p.policy_end_date! : m), "0000");
    push(`ref:insurance:${suffix}`, HOSPITAL_SOURCE, "reference-finance", ROLE.insurance, scope.slug, `Insurance cover of patients ${where}`,
      `${insured} of ${patientIds.size} registered patients ${where} have at least one insurance policy (${pct(insured, patientIds.size)}); ${policies.length} policies in all, covering ${policies.length === 0 ? "no period" : `${shifted(firstStart)} to ${shifted(lastEnd)}`}. Average coverage ${avgCover.toFixed(1)} percent. By insurer type: ${listCounts(byType, policies.length)}. ${NOTE}`);

    // Workforce from the dataset
    const people = staff.filter((s) => s.employeeCode.startsWith("HSD-") && (!scope.slug || s.facility === scope.slug));
    const employees = new Map(hospital.employee.map((e) => [`HSD-E${pad(e.employee_id!, 5)}`, e]));
    const byRole = counts(people, (s) => employees.get(s.employeeCode)?.role ?? s.staffType);
    const contract = people.filter((s) => employees.get(s.employeeCode)?.employment_type === "Contract").length;
    const tenures = people.map((s) => daysBetween(s.joinedOn, HISTORY_END) / 365.25).sort((a, b) => a - b);
    const median = tenures.length === 0 ? 0 : tenures[Math.floor(tenures.length / 2)]!;
    push(`ref:workforce:${suffix}`, HOSPITAL_SOURCE, "reference-workforce", ROLE.workforce, scope.slug, `Workforce from the reference dataset ${where}`,
      `${people.length} staff ${where} came from the reference hospital dataset. By role: ${listCounts(byRole, people.length)}. ${contract} are on contract (${pct(contract, people.length)}) and ${people.length - contract} full-time. Median time since joining ${median.toFixed(1)} years. ${NOTE}`);
  }

  // Group-only: medicine stock, suppliers, beds and wards
  const inventory = hospital.drug_inventory;
  const low = inventory.filter((i) => num(i.current_stock) < num(i.reorder_level));
  const shortest = [...low]
    .sort((a, b) => num(a.current_stock) / num(a.reorder_level) - num(b.current_stock) / num(b.reorder_level))
    .slice(0, 8)
    .map((i) => {
      const drug = drugById.get(i.drug_id!);
      return `${drug?.drug_name ?? "Unknown"} (${drug?.drug_category ?? "?"}) ${i.current_stock} in stock against a reorder level of ${i.reorder_level}`;
    });
  const lowByCategory = counts(low, (i) => drugById.get(i.drug_id!)?.drug_category ?? "Unknown");
  push("ref:stock:group", HOSPITAL_SOURCE, "reference-supply", ROLE.supply, null, "Medicine stock across Kestrion Health Group",
    `${inventory.length} medicines held in stock; ${low.length} are below their reorder level (${pct(low.length, inventory.length)}) and ${inventory.filter((i) => i.inventory_status === "Low").length} are flagged Low. Below reorder level by category: ${listCounts(lowByCategory, low.length)}. Most short: ${shortest.join("; ")}. ${NOTE}`);

  const makers = hospital.drug_manufacturer;
  const active = makers.filter((m) => m.contract_status === "Active");
  const avgRating = (rows: Row[]) => (rows.length === 0 ? 0 : rows.reduce((s, m) => s + num(m.reliability_rating), 0) / rows.length);
  const weakActive = active.filter((m) => num(m.reliability_rating) < 3);
  const byCountry = counts(makers, (m) => m.country!);
  push("ref:suppliers:group", HOSPITAL_SOURCE, "reference-supply", ROLE.suppliers, null, "Medicine suppliers across Kestrion Health Group",
    `${makers.length} medicine manufacturers: ${active.length} with an active contract and ${makers.length - active.length} expired (${pct(makers.length - active.length, makers.length)}). Average reliability rating ${avgRating(makers).toFixed(2)} out of 5; active suppliers average ${avgRating(active).toFixed(2)}. ${weakActive.length} active suppliers are rated below 3. By country: ${listCounts(byCountry, makers.length)}. ${NOTE}`);

  const beds = hospital.bed;
  const occupied = beds.filter((b) => b.bed_status === "Occupied").length;
  const wardOf = new Map(hospital.ward.map((w) => [w.ward_id!, w]));
  const byWardType = [...new Set(hospital.ward.map((w) => w.ward_type!))].sort().map((type) => {
    const these = beds.filter((b) => wardOf.get(b.ward_id!)?.ward_type === type);
    const busy = these.filter((b) => b.bed_status === "Occupied").length;
    return `${type} ${these.length} beds, ${pct(busy, these.length)} occupied`;
  });
  push("ref:beds:group", HOSPITAL_SOURCE, "reference-operations", ROLE.beds, null, "Beds and wards in the reference hospital",
    `The reference hospital dataset has ${hospital.ward.length} wards and ${beds.length} beds; ${occupied} are occupied (${pct(occupied, beds.length)}). By ward type: ${byWardType.join("; ")}. These describe the single hospital in the source dataset, not Kestrion's own bed counts. ${NOTE}`);

  // Clinic dataset: outpatient appointments
  const clinicScopes: { slug: string | null; name: string }[] = [{ slug: null, name: "Kestrion Health Group" }];
  for (const slug of new Set(Object.values(CLINIC_BRANCHES))) {
    clinicScopes.push({ slug, name: FACILITIES.find((f) => f.slug === slug)?.name ?? slug });
  }
  const branchOfDoctor = new Map(clinic.doctors.map((d) => [d.doctor_id!, CLINIC_BRANCHES[d.hospital_branch!] ?? "avenhurst"]));
  const treatmentByAppointment = new Map(clinic.treatments.map((t) => [t.appointment_id!, t]));
  const billByTreatment = new Map(clinic.billing.map((b) => [b.treatment_id!, b]));
  for (const scope of clinicScopes) {
    const where = scope.slug ? `at ${scope.name}` : "across Kestrion Health Group";
    const appts = clinic.appointments.filter((a) => !scope.slug || branchOfDoctor.get(a.doctor_id!) === scope.slug);
    if (appts.length === 0) continue;
    const byStatus = counts(appts, (a) => a.status!);
    const byReason = counts(appts, (a) => a.reason_for_visit!);
    const completed = appts.filter((a) => a.status === "Completed");
    const byTreatment = counts(
      completed.map((a) => treatmentByAppointment.get(a.appointment_id!)).filter((t): t is Row => Boolean(t)),
      (t) => t.treatment_type!,
    );
    const bills = completed.map((a) => billByTreatment.get(treatmentByAppointment.get(a.appointment_id!)?.treatment_id ?? "")).filter((b): b is Row => Boolean(b));
    const byPay = counts(bills, (b) => b.payment_status!);
    const from = addDays(appts.reduce((m, a) => (a.appointment_date! < m ? a.appointment_date! : m), "9999"), cShift);
    const to = addDays(appts.reduce((m, a) => (a.appointment_date! > m ? a.appointment_date! : m), "0000"), cShift);
    push(`ref:clinic:${scope.slug ?? "group"}`, CLINIC_SOURCE, "reference-operations", ROLE.clinic, scope.slug, `Outpatient appointments ${where}`,
      `${appts.length} outpatient appointments ${where} from ${from} to ${to}. By status: ${listCounts(byStatus, appts.length)}. Patients missed ${appts.filter((x) => x.status === "No-show").length} appointments as no-shows (${pct(appts.filter((x) => x.status === "No-show").length, appts.length)}) and cancelled ${appts.filter((x) => x.status === "Cancelled").length}. By reason: ${listCounts(byReason, appts.length)}. Treatments given at completed appointments: ${listCounts(byTreatment, completed.length)}. Bills for completed appointments by payment status: ${listCounts(byPay, bills.length)}. ${NOTE}`);
  }

  // What these sources are, for everyone
  out.push({
    key: "ref:about",
    source: HOSPITAL_SOURCE,
    domain: "reference-about",
    // Empty = every leadership role (the loader expands it from orbit.role_ids).
    roles: [],
    grain: null,
    facility: null,
    title: "About the reference hospital datasets",
    content: `Two synthetic hospital datasets were loaded into Orbit as reference history: a hospital dataset (${hospital.patient.length} patients, ${hospital.admission.length} admissions, ${hospital.employee.length} employees, ${hospital.doctor.length} doctors) and an outpatient clinic dataset (${clinic.patients.length} patients, ${clinic.doctors.length} doctors, ${clinic.appointments.length} appointments). Their people and visits were spread across Kestrion's six hospitals in proportion to staffed beds, and their dates were moved forward by whole weeks so their history ends on ${HISTORY_END}. Personal details such as names, phone numbers, addresses and insurance numbers were not loaded. Diagnoses, test results, prescriptions, bills and insurance are kept only as summary counts. All of it is illustrative, not real hospital data.`,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Prices (ADR 0022 §2)
// ---------------------------------------------------------------------------

/** A service price derived from the reference hospital dataset, in rupees. */
export interface RefPrice {
  serviceCode: string;
  /** Whole rupees: the median of the matching amounts, rounded. */
  price: number;
  /** How many dataset amounts the median was taken over. */
  sample: number;
  basis: string;
}

function median(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value) && value > 0).toSorted((a, b) => a - b);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 1 ? finite[middle]! : (finite[middle - 1]! + finite[middle]!) / 2;
}

/**
 * The prices the dataset itself supports, one per ERP service:
 * - tests and imaging: the median `standard_cost` of the dataset's tests mapped
 *   to that service (the same map the loader uses for test deliveries);
 * - ward and critical-care days: each Room charge divided by its admission's
 *   length of stay, median by ward type (ICU or not);
 * - procedures: the median Procedure charge, by the admission's department
 *   (Surgery, Orthopedics, other), the same split the loader uses.
 *
 * A service with no matching amounts gets no price: consultation, emergency
 * assessment, ECG, cardiac catheter, oncology day-care and rehabilitation are
 * not priced anywhere in the data, so an admin sets them (none are invented).
 */
export function derivePrices(hospital: HospitalTables): RefPrice[] {
  const prices: RefPrice[] = [];
  const add = (serviceCode: string, values: readonly number[], basis: string) => {
    const value = median(values);
    if (value !== null) prices.push({ serviceCode, price: Math.round(value), sample: values.length, basis });
  };

  const testsByService = new Map<string, number[]>();
  for (const test of hospital.diagnostic_test) {
    const service = TEST_SERVICE[test.test_name ?? ""];
    if (service) testsByService.set(service, [...(testsByService.get(service) ?? []), Number(test.standard_cost)]);
  }
  for (const [service, costs] of [...testsByService].toSorted(([a], [b]) => a.localeCompare(b))) {
    add(service, costs, "median standard cost of the dataset's tests of this kind");
  }

  const admission = new Map(hospital.admission.map((a) => [a.admission_id!, a]));
  const wardType = new Map(hospital.ward.map((w) => [w.ward_id!, w.ward_type!]));
  const deptName = new Map(hospital.department.map((d) => [d.department_id!, d.department_name!]));
  const billAdmission = new Map(hospital.billing.map((b) => [b.bill_id!, b.admission_id!]));
  const perDay = { ward: [] as number[], icu: [] as number[] };
  const procedures = { SURG: [] as number[], ORTH: [] as number[], other: [] as number[] };
  for (const line of hospital.billing_detail) {
    const stay = admission.get(billAdmission.get(line.bill_id!) ?? "");
    if (!stay) continue;
    const amount = Number(line.amount);
    if (line.charge_type === "Room") {
      const days = Math.max(1, daysBetween(stay.admission_date!, stay.discharge_date!));
      (wardType.get(stay.ward_id!) === "ICU" ? perDay.icu : perDay.ward).push(amount / days);
    } else if (line.charge_type === "Procedure") {
      const dept = HOSPITAL_DEPARTMENT[deptName.get(stay.department_id!) ?? ""];
      (dept === "SURG" ? procedures.SURG : dept === "ORTH" ? procedures.ORTH : procedures.other).push(amount);
    }
  }
  add("ICU-DAY", perDay.icu, "median Room charge per day of stay, ICU wards");
  add("ORTH-PROC", procedures.ORTH, "median Procedure charge, Orthopedics admissions");
  add("PROC-MINOR", procedures.other, "median Procedure charge, admissions outside Surgery and Orthopedics");
  add("SURG-PROC", procedures.SURG, "median Procedure charge, Surgery admissions");
  add("WARD-DAY", perDay.ward, "median Room charge per day of stay, non-ICU wards");
  return prices.toSorted((a, b) => a.serviceCode.localeCompare(b.serviceCode));
}

// ---------------------------------------------------------------------------
// Conditions (ADR 0023)
// ---------------------------------------------------------------------------

/** A presenting condition, from the dataset's disease list. */
export interface RefCondition {
  code: string;
  name: string;
  category: string;
}

/** A code from a name: capitals, digits and hyphens, at most 24 characters ("COVID-19", "VIRAL-FEVER"). */
export function conditionCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
}

/** The dataset's diseases as the ERP's fixed list of presenting conditions, in name order. */
export function deriveConditions(hospital: HospitalTables): RefCondition[] {
  const byName = new Map<string, RefCondition>();
  for (const row of hospital.disease) {
    const name = (row.disease_name ?? "").trim();
    if (name) byName.set(name, { code: conditionCode(name), name, category: (row.disease_category ?? "Other").trim() || "Other" });
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Stable checksum of a result, for the manifest. */
export function checksumOf(result: ReferenceResult): string {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}
