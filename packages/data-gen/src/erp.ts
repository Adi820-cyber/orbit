/**
 * Synthetic hospital-operations (ERP) dataset for Kestrion (ADR 0016,
 * docs/orbit/ERP_PLAN.md §6.6).
 *
 * ── What this produces ─────────────────────────────────────────────────────
 * Reference data (departments, specialties, shift patterns, settings, service
 * catalogue and where each service is offered), staff and doctors with
 * schedules, rosters and in/out punches, and patients with visits and the
 * services delivered in them.
 *
 * ── Rules it follows ──────────────────────────────────────────────────────
 * - Deterministic: one `streamFor` stream per (fact family, entity), so the
 *   same seed gives byte-identical output and adding a family does not shift
 *   another's values (rng.ts).
 * - Fictional: names are composed only from the invented lists below; codes,
 *   registration numbers and MRNs carry a visible DEMO marker. No real person,
 *   record or tariff is represented. Tariffs are deliberately NOT generated.
 * - Plausible, not clinical: volumes are anchored to each facility's staffed
 *   beds from the company manifest. Nothing here is a clinical rule.
 * - Valid by construction: every row satisfies the migration's CHECKs and
 *   triggers (a service is delivered only where offered, by active staff at
 *   the facility, by a doctor whose credential is valid that day, inside the
 *   visit). `__tests__/erp.test.ts` asserts these invariants, and applying the
 *   seed re-checks them in the database.
 * - Thresholds are illustrative demo configuration (ERP_PLAN D4), recorded in
 *   ERP_DEMO_CONFIG so a reviewer can change them in one place.
 */

import { COMPANY_MANIFEST } from "./manifest.ts";
import { streamFor, type Rng } from "./rng.ts";

// ---------------------------------------------------------------------------
// Configuration (illustrative; Maruti to review per ERP_PLAN D3–D5)
// ---------------------------------------------------------------------------

export const ERP_DEMO_CONFIG = {
  /** Rosters cover this whole window. */
  rosterFrom: "2026-09-01",
  rosterTo: "2026-10-31",
  /** Punches, visits and services exist up to and including this date (the dataset's as-of). */
  activityTo: "2026-09-30",
  settings: {
    lateGraceMinutes: 10,
    earlyExitGraceMinutes: 10,
    punchWindowBeforeMinutes: 120,
    punchWindowAfterMinutes: 240,
    credentialWarningDays: 30,
  },
  /** Staff per 100 staffed beds, by type. Kept small so the seed stays reviewable. */
  staffPer100Beds: { nurse: 6, doctor: 2.5, technician: 1.5, administrative: 1, support: 1.5 },
  /** Registered patients per 100 staffed beds. */
  patientsPer100Beds: 60,
  /** Outpatient visits per 100 staffed beds per day. */
  outpatientVisitsPer100BedsPerDay: 4,
  /** Probabilities per rostered day (illustrative). */
  attendance: { absent: 0.03, late: 0.05, missingOut: 0.02, earlyExit: 0.02 },
} as const;

export const ERP_SCENARIOS = [
  {
    slug: "avenhurst-late-arrivals",
    facility: "avenhurst",
    description: "Three Avenhurst nurses arrive late on about a third of their shifts.",
  },
  {
    slug: "brackmoor-missing-punches",
    facility: "brackmoor",
    description: "Brackmoor's last week of September has a cluster of missing out-punches.",
  },
  {
    slug: "credential-renewals",
    facility: "dunmarrow",
    description: "Two Dunmarrow doctors' credentials expire within the warning window; one expired mid-September.",
  },
] as const;

/** Invented given names and surnames. Reviewed: none is drawn from a real record. */
export const FICTIONAL_GIVEN_NAMES = [
  "Aelin", "Anwen", "Bexa", "Bram", "Calder", "Corin", "Daria", "Deshi", "Elowen", "Emrys",
  "Faris", "Fenna", "Galen", "Gideon", "Halia", "Hollis", "Ilsa", "Isen", "Joren", "Juno",
  "Kaia", "Kestrel", "Linnea", "Lumen", "Maren", "Mirela", "Navid", "Niall", "Orla", "Oswin",
  "Perrin", "Quilla", "Rowan", "Ruvan", "Sable", "Saoirse", "Tamsin", "Teodor", "Ulric", "Una",
  "Vesna", "Vidar", "Wren", "Wystan", "Yara", "Yorick", "Zarek", "Zinnia",
] as const;

export const FICTIONAL_SURNAMES = [
  "Ambervale", "Ashcombe", "Brackenwold", "Brightmere", "Carrowby", "Coldwell", "Dunleigh", "Eastmarch",
  "Elderholt", "Fairhollow", "Fernsby", "Glenmorrow", "Greywater", "Hallowend", "Harrowgate", "Ivybridge",
  "Kettleby", "Larkmoor", "Lindenshaw", "Marrowfield", "Merriwether", "Northwold", "Oakhurst", "Pennywhistle",
  "Quarrington", "Ravensby", "Rookwood", "Saltmarsh", "Silverdale", "Stonebrook", "Thistlewood", "Underhill",
  "Valemont", "Westerley", "Whitlowe", "Willowmere", "Yarrowby", "Zennor",
] as const;

// ---------------------------------------------------------------------------
// Types (snake_case-free, SQL-ready values)
// ---------------------------------------------------------------------------

export type StaffType = "doctor" | "nurse" | "technician" | "administrative" | "support";

export interface ErpDepartment { id: string; code: string; name: string }
export interface ErpSpecialty { id: string; code: string; name: string }
export interface ErpShift { id: string; code: string; name: string; start: string; end: string; breakMinutes: number }
export interface ErpService {
  id: string;
  code: string;
  name: string;
  category: string;
  departmentCode: string;
  unit: string;
}
export interface ErpAvailability { facility: string; serviceId: string }

export interface ErpStaff {
  id: string;
  facility: string;
  departmentId: string;
  employeeCode: string;
  displayName: string;
  staffType: StaffType;
  designation: string;
  employmentStatus: "active" | "on-leave";
  joinedOn: string;
  isCriticalRole: boolean;
  /** The shift pattern this person usually works. */
  shiftCode: string;
}
export interface ErpDoctor {
  staffId: string;
  specialtyId: string;
  registrationNumber: string;
  credentialExpiresOn: string;
  employmentType: "employed" | "visiting" | "consultant";
}
export interface ErpScheduleSlot { id: string; staffId: string; facility: string; weekday: number; start: string; end: string }
export interface ErpRoster { id: string; staffId: string; facility: string; shiftId: string; date: string }
export interface ErpPunch { id: string; staffId: string; facility: string; direction: "in" | "out"; at: string; key: string }
export interface ErpPatient {
  id: string;
  facility: string;
  mrn: string;
  displayName: string;
  sex: "female" | "male" | "other" | "unknown";
  birthYear: number;
  createdAt: string;
}
export interface ErpEncounter {
  id: string;
  patientId: string;
  facility: string;
  departmentId: string;
  doctorId: string | null;
  type: "outpatient" | "inpatient" | "emergency" | "day-care";
  startedAt: string;
  /** Null while still open at the as-of date. */
  endedAt: string | null;
}
export interface ErpDelivery {
  id: string;
  encounterId: string;
  facility: string;
  serviceId: string;
  performerId: string;
  quantity: number;
  performedAt: string;
  key: string;
}

export interface ErpDataset {
  organizationSlug: string;
  departments: ErpDepartment[];
  specialties: ErpSpecialty[];
  shifts: ErpShift[];
  services: ErpService[];
  availability: ErpAvailability[];
  staff: ErpStaff[];
  doctors: ErpDoctor[];
  schedule: ErpScheduleSlot[];
  rosters: ErpRoster[];
  punches: ErpPunch[];
  patients: ErpPatient[];
  encounters: ErpEncounter[];
  deliveries: ErpDelivery[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A v4-shaped uuid from a dedicated stream: stable across runs, unique per label. */
export function stableUuid(...label: string[]): string {
  const rng = streamFor(COMPANY_MANIFEST.seed, "erp-uuid", ...label);
  const bytes = Array.from({ length: 16 }, () => rng.int(0, 255));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO weekday, 1 = Monday. */
function weekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** UTC instant for a date plus minutes after its midnight (may roll into the next day). */
function instant(date: string, minutes: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

function name(rng: Rng): string {
  return `${rng.pick(FICTIONAL_GIVEN_NAMES)} ${rng.pick(FICTIONAL_SURNAMES)}`;
}

function code(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const DEPARTMENTS: ReadonlyArray<[string, string]> = [
  ["OPD", "Outpatients"],
  ["WARD", "Inpatient wards"],
  ["EMER", "Emergency"],
  ["ICU", "Critical care"],
  ["LAB", "Laboratory"],
  ["RAD", "Radiology"],
  ["CARD", "Cardiac sciences"],
  ["ORTH", "Orthopaedics"],
  ["ONCO", "Oncology"],
  ["REHAB", "Rehabilitation"],
  ["ADMIN", "Administration"],
  ["SUPP", "Support services"],
];

const SPECIALTIES: ReadonlyArray<[string, string, string]> = [
  ["GEN", "General medicine", "OPD"],
  ["EMER", "Emergency medicine", "EMER"],
  ["CRIT", "Critical care", "ICU"],
  ["CARD", "Cardiology", "CARD"],
  ["ORTH", "Orthopaedics", "ORTH"],
  ["ONCO", "Oncology", "ONCO"],
  ["SURG", "General surgery", "WARD"],
  ["RAD", "Radiology", "RAD"],
];

const SHIFTS: ReadonlyArray<[string, string, string, string, number]> = [
  ["M", "Morning", "07:00", "15:00", 30],
  ["A", "Afternoon", "15:00", "23:00", 30],
  ["N", "Night", "23:00", "07:00", 30],
  ["G", "General", "09:00", "17:00", 45],
];

/** [code, name, category, department, unit, where offered] */
const SERVICES: ReadonlyArray<[string, string, string, string, string, "all" | "large" | readonly string[]]> = [
  ["CON-GEN", "General consultation", "consultation", "OPD", "per-visit", "all"],
  ["CON-SPEC", "Specialist consultation", "consultation", "OPD", "per-visit", "all"],
  ["EMR-TRIAGE", "Emergency assessment", "emergency", "EMER", "per-visit", "all"],
  ["LAB-BLOOD", "Blood count panel", "diagnostics-lab", "LAB", "per-test", "all"],
  ["LAB-CHEM", "Chemistry panel", "diagnostics-lab", "LAB", "per-test", "all"],
  ["IMG-XRAY", "X-ray imaging", "diagnostics-imaging", "RAD", "per-test", "all"],
  ["IMG-US", "Ultrasound imaging", "diagnostics-imaging", "RAD", "per-test", "all"],
  ["IMG-CT", "CT imaging", "diagnostics-imaging", "RAD", "per-test", "large"],
  ["IMG-MRI", "MRI imaging", "diagnostics-imaging", "RAD", "per-test", "large"],
  ["CARD-ECG", "Electrocardiogram", "diagnostics-lab", "CARD", "per-test", "all"],
  ["CARD-ANGIO", "Cardiac catheter procedure", "procedure", "CARD", "per-procedure", ["avenhurst"]],
  ["ORTH-PROC", "Orthopaedic procedure", "procedure", "ORTH", "per-procedure", ["calderwyn", "avenhurst"]],
  ["ONCO-DAY", "Oncology day-care session", "day-care", "ONCO", "per-session", ["dunmarrow", "elverton"]],
  ["PROC-MINOR", "Minor procedure", "procedure", "OPD", "per-procedure", "all"],
  ["WARD-DAY", "Ward stay", "inpatient-stay", "WARD", "per-day", "all"],
  ["ICU-DAY", "Critical care stay", "inpatient-stay", "ICU", "per-day", "large"],
  ["REHAB-SESS", "Rehabilitation session", "therapy", "REHAB", "per-session", "all"],
];

/** Facilities with at least this many staffed beds offer the "large" services. */
const LARGE_FACILITY_BEDS = 300;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateErpDataset(): ErpDataset {
  const seed = COMPANY_MANIFEST.seed;
  const org = COMPANY_MANIFEST.organizations.find((o) => o.kind === "demo");
  if (!org) throw new Error("company manifest has no demo organization");
  const cfg = ERP_DEMO_CONFIG;

  const departments = DEPARTMENTS.map(([c, n]) => ({ id: stableUuid("department", c), code: c, name: n }));
  const deptId = (c: string) => {
    const found = departments.find((d) => d.code === c);
    if (!found) throw new Error(`unknown department ${c}`);
    return found.id;
  };
  const specialties = SPECIALTIES.map(([c, n]) => ({ id: stableUuid("specialty", c), code: c, name: n }));
  const shifts = SHIFTS.map(([c, n, start, end, breakMinutes]) => ({ id: stableUuid("shift", c), code: c, name: n, start, end, breakMinutes }));
  const shift = (c: string) => shifts.find((s) => s.code === c)!;

  const services = SERVICES.map(([c, n, category, dept, unit]) => ({
    id: stableUuid("service", c),
    code: c,
    name: n,
    category,
    departmentCode: dept,
    unit,
  }));
  const availability: ErpAvailability[] = [];
  for (const facility of COMPANY_MANIFEST.facilities) {
    for (const [c, , , , , where] of SERVICES) {
      const offered =
        where === "all" || (where === "large" ? facility.staffedBeds >= LARGE_FACILITY_BEDS : where.includes(facility.slug));
      if (offered) availability.push({ facility: facility.slug, serviceId: stableUuid("service", c) });
    }
  }
  const offeredAt = (facility: string, serviceCode: string) =>
    availability.some((a) => a.facility === facility && a.serviceId === stableUuid("service", serviceCode));

  // ---- Staff ---------------------------------------------------------------
  const staff: ErpStaff[] = [];
  const doctors: ErpDoctor[] = [];
  const schedule: ErpScheduleSlot[] = [];
  let registration = 1000;

  for (const facility of COMPANY_MANIFEST.facilities) {
    const rng = streamFor(seed, "erp-staff", facility.slug);
    const prefix = facility.slug.slice(0, 3).toUpperCase();
    let n = 0;
    for (const [type, per100] of Object.entries(cfg.staffPer100Beds) as Array<[StaffType, number]>) {
      const count = Math.max(2, Math.round((facility.staffedBeds / 100) * per100));
      for (let i = 0; i < count; i++) {
        n += 1;
        const id = stableUuid("staff", facility.slug, String(n));
        const plan = staffPlan(type, i, rng);
        staff.push({
          id,
          facility: facility.slug,
          departmentId: deptId(plan.department),
          employeeCode: code(`${prefix}-${plan.codeLetter}`, n),
          displayName: name(rng),
          staffType: type,
          designation: plan.designation,
          employmentStatus: rng.chance(0.02) ? "on-leave" : "active",
          joinedOn: addDays("2019-01-07", rng.int(0, 2400)),
          isCriticalRole: plan.critical,
          shiftCode: plan.shift,
        });
        if (type === "doctor") {
          registration += 1;
          const specialty = specialties.find((s) => s.code === plan.specialty)!;
          doctors.push({
            staffId: id,
            specialtyId: specialty.id,
            registrationNumber: `DEMO-REG-${String(registration).padStart(6, "0")}`,
            credentialExpiresOn: addDays("2027-01-15", rng.int(0, 900)),
            employmentType: rng.chance(0.15) ? "visiting" : rng.chance(0.1) ? "consultant" : "employed",
          });
          // Two or three weekday consultation slots at their facility.
          const days = [1, 2, 3, 4, 5].filter(() => rng.chance(0.55)).slice(0, 3);
          for (const wd of days.length ? days : [rng.int(1, 5)]) {
            const startHour = rng.pick([9, 10, 14]);
            schedule.push({
              id: stableUuid("slot", id, String(wd)),
              staffId: id,
              facility: facility.slug,
              weekday: wd,
              start: `${String(startHour).padStart(2, "0")}:00`,
              end: `${String(startHour + 3).padStart(2, "0")}:00`,
            });
          }
        }
      }
    }
  }

  // Scenario: credential renewals at Dunmarrow (warning window and one expiry).
  const dunmarrowDoctors = doctors.filter((d) => staff.find((s) => s.id === d.staffId)?.facility === "dunmarrow");
  if (dunmarrowDoctors.length >= 3) {
    dunmarrowDoctors[0]!.credentialExpiresOn = "2026-10-20";
    dunmarrowDoctors[1]!.credentialExpiresOn = "2026-10-27";
    dunmarrowDoctors[2]!.credentialExpiresOn = "2026-09-15";
  }
  const credentialOf = new Map(doctors.map((d) => [d.staffId, d.credentialExpiresOn]));
  const mayPractise = (staffId: string, date: string) => {
    const expires = credentialOf.get(staffId);
    return expires === undefined || expires >= date;
  };

  // ---- Rosters and punches -------------------------------------------------
  const rosters: ErpRoster[] = [];
  const punches: ErpPunch[] = [];
  const lateNurses = new Set(
    staff.filter((s) => s.facility === "avenhurst" && s.staffType === "nurse").slice(0, 3).map((s) => s.id),
  );

  staff.forEach((person, index) => {
    const rng = streamFor(seed, "erp-attendance", person.id);
    for (const date of datesBetween(cfg.rosterFrom, cfg.rosterTo)) {
      if (date < person.joinedOn) continue;
      // Two rest days a week, staggered by person so the facility is always covered.
      const wd = weekday(date);
      const restA = ((index % 7) + 1);
      const restB = (restA % 7) + 1;
      if (person.shiftCode === "G" ? wd >= 6 : wd === restA || wd === restB) continue;
      // Nurses rotate morning/afternoon/night by week.
      const week = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${cfg.rosterFrom}T00:00:00Z`)) / (7 * 86_400_000));
      const shiftCode =
        person.staffType === "nurse" ? (["M", "A", "N"] as const)[(week + index) % 3]! : person.shiftCode;
      const s = shift(shiftCode);
      rosters.push({ id: stableUuid("roster", person.id, date), staffId: person.id, facility: person.facility, shiftId: s.id, date });

      if (date > cfg.activityTo || person.employmentStatus === "on-leave") continue;
      const start = minutesOf(s.start);
      const end = minutesOf(s.end) + (minutesOf(s.end) <= start ? 24 * 60 : 0);
      const lateScenario = lateNurses.has(person.id) && rng.chance(0.33);
      const missingScenario = person.facility === "brackmoor" && date >= "2026-09-24" && rng.chance(0.2);
      if (rng.chance(cfg.attendance.absent)) continue;
      const inAt = start + (lateScenario || rng.chance(cfg.attendance.late) ? rng.int(15, 45) : rng.int(-12, 5));
      punches.push({
        id: stableUuid("punch", person.id, date, "in"),
        staffId: person.id,
        facility: person.facility,
        direction: "in",
        at: instant(date, inAt),
        key: stableUuid("punch-key", person.id, date, "in"),
      });
      if (missingScenario || rng.chance(cfg.attendance.missingOut)) continue;
      const outAt = end + (rng.chance(cfg.attendance.earlyExit) ? -rng.int(25, 70) : rng.int(0, 20));
      punches.push({
        id: stableUuid("punch", person.id, date, "out"),
        staffId: person.id,
        facility: person.facility,
        direction: "out",
        at: instant(date, outAt),
        key: stableUuid("punch-key", person.id, date, "out"),
      });
    }
  });

  // ---- Patients, visits and services ----------------------------------------
  const patients: ErpPatient[] = [];
  const encounters: ErpEncounter[] = [];
  const deliveries: ErpDelivery[] = [];
  let mrn = 0;
  const activityDays = datesBetween(cfg.rosterFrom, cfg.activityTo);

  for (const facility of COMPANY_MANIFEST.facilities) {
    const rng = streamFor(seed, "erp-care", facility.slug);
    const here = staff.filter((s) => s.facility === facility.slug && s.employmentStatus === "active");
    const docs = here.filter((s) => s.staffType === "doctor");
    const techs = here.filter((s) => s.staffType === "technician");
    const nurses = here.filter((s) => s.staffType === "nurse");

    const facilityPatients: ErpPatient[] = [];
    const patientCount = Math.round((facility.staffedBeds / 100) * cfg.patientsPer100Beds);
    for (let i = 0; i < patientCount; i++) {
      mrn += 1;
      const roll = rng.unit();
      const patient: ErpPatient = {
        id: stableUuid("patient", facility.slug, String(i)),
        facility: facility.slug,
        mrn: `DEMO-MRN-${String(mrn).padStart(6, "0")}`,
        displayName: name(rng),
        sex: roll < 0.49 ? "female" : roll < 0.97 ? "male" : roll < 0.99 ? "other" : "unknown",
        birthYear: rng.int(1935, 2024),
        createdAt: instant(addDays("2024-01-01", rng.int(0, 600)), rng.int(8 * 60, 18 * 60)),
      };
      facilityPatients.push(patient);
      patients.push(patient);
    }

    const performerFor = (serviceCode: string, date: string): ErpStaff | undefined => {
      const pool = serviceCode.startsWith("LAB") || serviceCode.startsWith("IMG") || serviceCode === "CARD-ECG"
        ? techs
        : serviceCode.endsWith("-DAY") || serviceCode === "REHAB-SESS"
          ? nurses
          : docs.filter((d) => mayPractise(d.id, date));
      return pool.length ? rng.pick(pool) : undefined;
    };

    const addDelivery = (encounter: ErpEncounter, serviceCode: string, minutesAfterStart: number, quantity = 1) => {
      if (!offeredAt(facility.slug, serviceCode)) return;
      const performedAt = new Date(Date.parse(encounter.startedAt) + minutesAfterStart * 60_000).toISOString();
      if (encounter.endedAt && performedAt > encounter.endedAt) return;
      // The credential must be valid on the day the service is performed, not the day the visit began.
      const performer = performerFor(serviceCode, performedAt.slice(0, 10));
      if (!performer) return;
      const n = deliveries.length;
      deliveries.push({
        id: stableUuid("delivery", encounter.id, String(n)),
        encounterId: encounter.id,
        facility: facility.slug,
        serviceId: stableUuid("service", serviceCode),
        performerId: performer.id,
        quantity,
        performedAt,
        key: stableUuid("delivery-key", encounter.id, String(n)),
      });
    };

    const openInpatient = new Set<string>();
    for (const date of activityDays) {
      const dayDocs = docs.filter((d) => mayPractise(d.id, date));
      if (!dayDocs.length) continue;
      const visits = Math.round((facility.staffedBeds / 100) * cfg.outpatientVisitsPer100BedsPerDay * rng.jitter(0.25));
      for (let v = 0; v < visits; v++) {
        const patient = rng.pick(facilityPatients);
        const roll = rng.unit();
        const type: ErpEncounter["type"] = roll < 0.7 ? "outpatient" : roll < 0.85 ? "emergency" : roll < 0.93 ? "day-care" : "inpatient";
        if (type === "inpatient" && openInpatient.has(patient.id)) continue;
        const startMinute = type === "emergency" ? rng.int(0, 23 * 60) : rng.int(8 * 60, 17 * 60);
        const startedAt = instant(date, startMinute);
        const lengthMinutes =
          type === "inpatient" ? rng.int(2, 6) * 24 * 60 : type === "emergency" ? rng.int(90, 360) : rng.int(30, 240);
        const endInstant = new Date(Date.parse(startedAt) + lengthMinutes * 60_000).toISOString();
        const stillOpen = endInstant.slice(0, 10) > cfg.activityTo;
        if (type === "inpatient" && stillOpen) openInpatient.add(patient.id);
        const doctor = rng.pick(dayDocs);
        const encounter: ErpEncounter = {
          id: stableUuid("encounter", facility.slug, date, String(v)),
          patientId: patient.id,
          facility: facility.slug,
          departmentId: deptId(type === "inpatient" ? "WARD" : type === "emergency" ? "EMER" : type === "day-care" && offeredAt(facility.slug, "ONCO-DAY") ? "ONCO" : "OPD"),
          doctorId: doctor.id,
          type,
          startedAt,
          endedAt: stillOpen ? null : endInstant,
        };
        encounters.push(encounter);

        // Services consistent with the visit type.
        if (type === "emergency") {
          addDelivery(encounter, "EMR-TRIAGE", 10);
          if (rng.chance(0.6)) addDelivery(encounter, "LAB-BLOOD", 40);
          if (rng.chance(0.4)) addDelivery(encounter, rng.chance(0.3) ? "IMG-CT" : "IMG-XRAY", 70);
        } else if (type === "outpatient") {
          addDelivery(encounter, rng.chance(0.6) ? "CON-GEN" : "CON-SPEC", 5);
          if (rng.chance(0.35)) addDelivery(encounter, rng.pick(["LAB-BLOOD", "LAB-CHEM", "CARD-ECG"]), 20);
          if (rng.chance(0.15)) addDelivery(encounter, rng.pick(["IMG-XRAY", "IMG-US", "IMG-MRI"]), 25);
          if (rng.chance(0.08)) addDelivery(encounter, "REHAB-SESS", 28);
        } else if (type === "day-care") {
          addDelivery(encounter, offeredAt(facility.slug, "ONCO-DAY") ? "ONCO-DAY" : "PROC-MINOR", 15);
          addDelivery(encounter, "LAB-BLOOD", 10);
        } else {
          addDelivery(encounter, "CON-SPEC", 30);
          addDelivery(encounter, "LAB-CHEM", 90);
          const days = Math.max(1, Math.round(lengthMinutes / (24 * 60)));
          addDelivery(encounter, rng.chance(0.15) && offeredAt(facility.slug, "ICU-DAY") ? "ICU-DAY" : "WARD-DAY", 120, days);
          if (rng.chance(0.25)) addDelivery(encounter, rng.pick(["CARD-ANGIO", "ORTH-PROC", "PROC-MINOR"]), 24 * 60);
        }
      }
    }
  }

  // Services recorded after the as-of date do not exist yet (activity stops there).
  const asOfEnd = `${addDays(cfg.activityTo, 1)}T00:00:00.000Z`;
  const delivered = deliveries.filter((d) => d.performedAt < asOfEnd);

  return {
    organizationSlug: org.slug,
    departments,
    specialties,
    shifts,
    services,
    availability,
    staff,
    doctors,
    schedule,
    rosters,
    punches,
    patients,
    encounters,
    deliveries: delivered,
  };
}

function staffPlan(type: StaffType, index: number, rng: Rng) {
  switch (type) {
    case "doctor": {
      const specialty = SPECIALTIES[index % SPECIALTIES.length]!;
      return {
        department: specialty[2],
        designation: index % 4 === 0 ? "Consultant" : "Attending physician",
        codeLetter: "D",
        shift: rng.chance(0.5) ? "M" : "G",
        critical: index % 3 === 0,
        specialty: specialty[0],
      };
    }
    case "nurse":
      return {
        department: rng.pick(["WARD", "WARD", "OPD", "EMER", "ICU"]),
        designation: index % 6 === 0 ? "Charge nurse" : "Staff nurse",
        codeLetter: "N",
        shift: "M",
        critical: index % 6 === 0,
        specialty: "",
      };
    case "technician":
      return {
        department: rng.pick(["LAB", "RAD", "CARD"]),
        designation: "Technician",
        codeLetter: "T",
        shift: rng.chance(0.5) ? "M" : "A",
        critical: false,
        specialty: "",
      };
    case "administrative":
      return { department: "ADMIN", designation: "Administrator", codeLetter: "A", shift: "G", critical: false, specialty: "" };
    case "support":
      return {
        department: "SUPP",
        designation: rng.pick(["Porter", "Facilities assistant", "Housekeeping assistant"]),
        codeLetter: "S",
        shift: rng.chance(0.5) ? "M" : "A",
        critical: false,
        specialty: "",
      };
  }
}
