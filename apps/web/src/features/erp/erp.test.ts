import { describe, expect, it } from "vitest";
import type { AttendanceDay, RecordPunchResponse } from "@orbit/contracts";
import { erpQuery } from "../../lib/erp-api";
import { punchMessage } from "./attendance";
import { clock, duration, instantFromLocal, workedText } from "./shared";

const day = (overrides: Partial<AttendanceDay> = {}): AttendanceDay => ({
  staffId: "50000000-0000-4000-8000-000000000001",
  shiftDate: "2026-10-01",
  rosterId: "60000000-0000-4000-8000-000000000001",
  shiftTemplateId: "70000000-0000-4000-8000-000000000001",
  shiftStart: "2026-10-01T07:00:00.000Z",
  shiftEnd: "2026-10-01T15:00:00.000Z",
  firstIn: null,
  lastOut: null,
  punchCount: 0,
  onDuty: false,
  workedMinutes: null,
  lateMinutes: null,
  earlyExitMinutes: null,
  status: "scheduled",
  corrected: false,
  correctionId: null,
  ...overrides,
});

const response = (dayOverrides: Partial<AttendanceDay>, replayed = false): RecordPunchResponse => ({
  punch: {
    punchId: "80000000-0000-4000-8000-000000000001",
    staffId: "50000000-0000-4000-8000-000000000001",
    facilityId: "90000000-0000-4000-8000-000000000001",
    direction: "in",
    punchedAt: "2026-10-01T07:04:00.000Z",
    source: "desk",
  },
  replayed,
  day: day(dayOverrides),
  provenance: "illustrative",
  disclosure: "Fictional demonstration records.",
});

describe("punchMessage", () => {
  it("confirms a punch that counts toward the shift", () => {
    expect(punchMessage(response({ status: "on-duty", onDuty: true, punchCount: 1 }))).toBe("Punched in at 07:04. Status: on duty.");
  });

  it("says plainly when a punch falls outside every shift window", () => {
    expect(punchMessage(response({ status: "scheduled" }))).toMatch(/outside this person's shift window/);
    expect(punchMessage(response({ status: "absent" }))).toMatch(/does not count/);
  });

  it("treats a punch on an unrostered day as counted work", () => {
    expect(punchMessage(response({ rosterId: null, status: "unrostered" }))).toMatch(/^Punched in/);
  });

  it("reports a replayed request instead of a second punch", () => {
    expect(punchMessage(response({ status: "on-duty" }, true))).toBe("Already recorded at 07:04.");
  });
});

describe("worked time never turns missing into zero", () => {
  it.each([
    ["off", null, "—"],
    ["absent", null, "—"],
    ["scheduled", null, "—"],
    ["on-leave", null, "—"],
    ["missing-punch", null, "Not complete"],
    ["present", 450, "7 h 30 min"],
    ["late", 45, "45 min"],
    ["present", 0, "0 min"],
  ] as const)("%s with %s minutes reads %j", (status, workedMinutes, expected) => {
    expect(workedText({ status, workedMinutes })).toBe(expected);
  });

  it("keeps null distinct from zero in duration()", () => {
    expect(duration(null)).toBe("Not complete");
    expect(duration(0)).toBe("0 min");
  });
});

describe("ERP request helpers", () => {
  it("sends only defined query values", () => {
    expect(erpQuery({ facilityId: "f", q: undefined, page: 2, status: null, type: "" }).toString()).toBe("facilityId=f&page=2");
  });

  it("reads datetime-local input as UTC, the organization's time zone", () => {
    expect(instantFromLocal("2026-09-28T16:00")).toBe("2026-09-28T16:00:00Z");
    expect(instantFromLocal("")).toBeUndefined();
    expect(instantFromLocal("not a time")).toBeUndefined();
  });

  it("shows clock times in UTC and a dash when missing", () => {
    expect(clock("2026-09-28T06:49:00.000Z")).toBe("06:49");
    expect(clock(null)).toBe("—");
  });
});
