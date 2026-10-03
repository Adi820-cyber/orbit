import { describe, expect, it } from "vitest";
import {
  EmployeeCodeSchema,
  RegistrationNumberSchema,
  ServiceCodeSchema,
} from "@orbit/contracts";
import {
  datesBetween,
  ERP_DEMO_CONFIG,
  FICTIONAL_GIVEN_NAMES,
  FICTIONAL_SURNAMES,
  generateErpDataset,
  stableUuid,
} from "../erp.ts";
import { COMPANY_MANIFEST } from "../manifest.ts";

const data = generateErpDataset();
const staffById = new Map(data.staff.map((s) => [s.id, s]));
const doctorById = new Map(data.doctors.map((d) => [d.staffId, d]));
const encounterById = new Map(data.encounters.map((e) => [e.id, e]));
const serviceById = new Map(data.services.map((s) => [s.id, s]));

describe("ERP dataset: determinism and fiction", () => {
  it("is identical on every run", () => {
    expect(JSON.stringify(generateErpDataset())).toBe(JSON.stringify(data));
  });

  it("derives stable, unique, v4-shaped ids", () => {
    expect(stableUuid("a", "b")).toBe(stableUuid("a", "b"));
    expect(stableUuid("a", "b")).not.toBe(stableUuid("a", "c"));
    const ids = [...data.staff, ...data.patients, ...data.encounters, ...data.deliveries].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 50)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("names every person only from the invented lists", () => {
    for (const person of [...data.staff, ...data.patients]) {
      const [given, surname, ...rest] = person.displayName.split(" ");
      expect(rest).toHaveLength(0);
      expect(FICTIONAL_GIVEN_NAMES).toContain(given);
      expect(FICTIONAL_SURNAMES).toContain(surname);
    }
  });

  it("uses visibly fictional codes the contracts accept", () => {
    for (const s of data.staff) expect(EmployeeCodeSchema.safeParse(s.employeeCode).success, s.employeeCode).toBe(true);
    for (const d of data.doctors) expect(RegistrationNumberSchema.safeParse(d.registrationNumber).success).toBe(true);
    for (const s of data.services) expect(ServiceCodeSchema.safeParse(s.code).success).toBe(true);
    const mrns = data.patients.map((p) => p.mrn);
    expect(new Set(mrns).size).toBe(mrns.length);
    for (const mrn of mrns) expect(mrn).toMatch(/^DEMO-MRN-\d{6}$/);
    // Runtime registrations start at 100001 (migration sequence); the seed stays below.
    expect(data.patients.length).toBeLessThan(100_000);
    expect(new Set(data.staff.map((s) => s.employeeCode)).size).toBe(data.staff.length);
  });

  it("generates no tariffs (illustrative prices are a reviewed decision, ERP_PLAN D5)", () => {
    expect(JSON.stringify(data)).not.toMatch(/tariff/i);
  });
});

describe("ERP dataset: anchored to the company manifest", () => {
  it("staffs every facility in proportion to its staffed beds", () => {
    for (const facility of COMPANY_MANIFEST.facilities) {
      const here = data.staff.filter((s) => s.facility === facility.slug);
      const expected = Object.values(ERP_DEMO_CONFIG.staffPer100Beds).reduce(
        (sum, per100) => sum + Math.max(2, Math.round((facility.staffedBeds / 100) * per100)),
        0,
      );
      expect(here).toHaveLength(expected);
      expect(here.some((s) => s.staffType === "doctor")).toBe(true);
    }
  });

  it("never has more open inpatient stays than staffed beds, and one open stay per patient", () => {
    const open = data.encounters.filter((e) => e.type === "inpatient" && e.endedAt === null);
    for (const facility of COMPANY_MANIFEST.facilities) {
      expect(open.filter((e) => e.facility === facility.slug).length).toBeLessThanOrEqual(facility.staffedBeds);
    }
    const patients = open.map((e) => e.patientId);
    expect(new Set(patients).size).toBe(patients.length);
  });
});

describe("ERP dataset: rosters and punches", () => {
  it("rosters at most one shift per person per day, only after joining", () => {
    const seen = new Set<string>();
    for (const roster of data.rosters) {
      const key = `${roster.staffId}/${roster.date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const person = staffById.get(roster.staffId)!;
      expect(roster.facility).toBe(person.facility);
      expect(roster.date >= person.joinedOn).toBe(true);
    }
  });

  it("punches only rostered, active people up to the as-of date, with the out after the in", () => {
    const pairs = new Map<string, { in?: string; out?: string }>();
    const keyIndex = new Map(data.punches.map((p) => [p.key, p]));
    for (const roster of data.rosters) {
      const inPunch = keyIndex.get(stableUuid("punch-key", roster.staffId, roster.date, "in"));
      const outPunch = keyIndex.get(stableUuid("punch-key", roster.staffId, roster.date, "out"));
      if (!inPunch && !outPunch) continue;
      expect(roster.date <= ERP_DEMO_CONFIG.activityTo).toBe(true);
      expect(staffById.get(roster.staffId)?.employmentStatus).toBe("active");
      pairs.set(`${roster.staffId}/${roster.date}`, { in: inPunch?.at, out: outPunch?.at });
    }
    // Every punch belongs to a rostered day; none is unaccounted for.
    expect([...pairs.values()].reduce((n, pair) => n + (pair.in ? 1 : 0) + (pair.out ? 1 : 0), 0)).toBe(data.punches.length);
    for (const pair of pairs.values()) {
      expect(pair.in, "an out is never seeded without its in").toBeDefined();
      if (pair.in && pair.out) expect(pair.out > pair.in).toBe(true);
    }
  });

  it("shows the labelled scenarios", () => {
    const keys = new Set(data.punches.map((p) => p.key));
    const missingShare = (from: string, to: string) => {
      const days = data.rosters.filter(
        (r) => r.facility === "brackmoor" && r.date >= from && r.date <= to && staffById.get(r.staffId)?.employmentStatus === "active",
      );
      const inOnly = days.filter(
        (r) => keys.has(stableUuid("punch-key", r.staffId, r.date, "in")) && !keys.has(stableUuid("punch-key", r.staffId, r.date, "out")),
      );
      return inOnly.length / days.length;
    };
    expect(missingShare("2026-09-24", "2026-09-30")).toBeGreaterThan(missingShare("2026-09-01", "2026-09-23") * 2);

    const dunmarrow = data.doctors.filter((d) => staffById.get(d.staffId)?.facility === "dunmarrow").map((d) => d.credentialExpiresOn);
    expect(dunmarrow).toContain("2026-09-15");
    expect(dunmarrow.filter((date) => date > "2026-10-01" && date <= "2026-10-31")).toHaveLength(2);
  });

  it("covers the whole roster window", () => {
    const dates = new Set(data.rosters.map((r) => r.date));
    for (const date of datesBetween(ERP_DEMO_CONFIG.rosterFrom, ERP_DEMO_CONFIG.rosterTo)) expect(dates.has(date)).toBe(true);
  });
});

describe("ERP dataset: services delivered satisfy the database rules", () => {
  it("delivers a service only where offered, by active staff at that facility, inside the visit", () => {
    const offered = new Set(data.availability.map((a) => `${a.facility}/${a.serviceId}`));
    for (const delivery of data.deliveries) {
      const encounter = encounterById.get(delivery.encounterId)!;
      const performer = staffById.get(delivery.performerId)!;
      expect(delivery.facility).toBe(encounter.facility);
      expect(offered.has(`${delivery.facility}/${delivery.serviceId}`)).toBe(true);
      expect(serviceById.has(delivery.serviceId)).toBe(true);
      expect(performer.facility).toBe(delivery.facility);
      expect(performer.employmentStatus).toBe("active");
      expect(delivery.performedAt >= encounter.startedAt).toBe(true);
      if (encounter.endedAt) expect(delivery.performedAt <= encounter.endedAt).toBe(true);
      expect(delivery.performedAt < `${ERP_DEMO_CONFIG.activityTo}T23:59:59.999Z`).toBe(true);
    }
  });

  it("never lets a doctor practise after their credential expires", () => {
    for (const delivery of data.deliveries) {
      const credential = doctorById.get(delivery.performerId);
      if (credential) expect(credential.credentialExpiresOn >= delivery.performedAt.slice(0, 10)).toBe(true);
    }
    for (const encounter of data.encounters) {
      const doctor = encounter.doctorId ? staffById.get(encounter.doctorId) : undefined;
      expect(doctor?.staffType).toBe("doctor");
      expect(doctor?.facility).toBe(encounter.facility);
      expect(doctorById.get(encounter.doctorId!)!.credentialExpiresOn >= encounter.startedAt.slice(0, 10)).toBe(true);
    }
  });
});
