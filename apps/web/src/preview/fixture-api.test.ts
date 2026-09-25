import {
  EntityDirectoryResponseSchema,
  ActionDetailResponseSchema,
  ActionResponseSchema,
  AskPromptsResponseSchema,
  AskResponseSchema,
  AuditListResponseSchema,
  BriefResponseSchema,
  ErrorEnvelopeSchema,
  InboxResponseSchema,
  KpiDetailResponseSchema,
  KpiListResponseSchema,
  MeResponseSchema,
  ObservationSchema,
  PermittedAssigneesResponseSchema,
  type Observation,
} from "@orbit/contracts";
import { describe, expect, it } from "vitest";
import type { ApiRequest } from "../lib/api";
import { CLINICAL_ASSIGNMENTS } from "./clinical-dataset";
import { DHO_ASSIGNMENTS, DHO_FACILITY } from "./dho-dataset";
import { PEOPLE_ASSIGNMENTS } from "./people-dataset";
import { BD_ASSIGNMENTS } from "./bd-dataset";
import { BILLING_ASSIGNMENTS } from "./billing-dataset";
import { COE_ASSIGNMENTS } from "./coe-dataset";
import { CORPORATE_ASSIGNMENTS } from "./corporate-revenue-dataset";
import { GROUP_CFO_ASSIGNMENTS } from "./group-cfo-dataset";
import { PROCUREMENT_ASSIGNMENTS } from "./procurement-dataset";
import { HR_ASSIGNMENTS } from "./hr-dataset";
import { LEGAL_ASSIGNMENTS } from "./legal-dataset";
import { ANALYTICS_ASSIGNMENTS } from "./analytics-dataset";
import { ASSIGNMENTS, CHAIRMAN_ASSIGNMENTS, CURRENT_PERIOD, GROUP, OBSERVATIONS, REGION_NORTH, facilitiesIn } from "./dataset";
import { createFixtureApi, type StateStorage } from "./fixture-api";

function get(path: string, query: Record<string, string> = {}): ApiRequest {
  return { method: "GET", path, query: new URLSearchParams(query) };
}

function post(path: string, body: unknown): ApiRequest {
  return { method: "POST", path, body };
}

function memoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function component(observation: Observation, role: "numerator" | "denominator") {
  const found = observation.components.find((item) => item.role === role);
  return found?.value.status === "available" ? found.value.value : null;
}

const FACILITY_A1 = { grain: "facility", entityId: "fixture-facility-a1" } as const;

async function capacityEvidence(api: ReturnType<typeof createFixtureApi>) {
  const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
  const exception = brief.actNow[0];
  if (!exception) throw new Error("expected an act-now exception");
  return exception;
}

describe("preview dataset", () => {
  it("parses every observation against the shared contract", () => {
    for (const observation of OBSERVATIONS) {
      expect(ObservationSchema.safeParse(observation).success).toBe(true);
    }
  });

  it("rolls region ratios up from summed numerators and denominators, never averaged percentages", () => {
    const period = CURRENT_PERIOD.start;
    const region = OBSERVATIONS.find(
      (row) => row.assignmentId === ASSIGNMENTS.capacity && row.entity.entityId === REGION_NORTH.entityId && row.period.start === period,
    );
    const children = OBSERVATIONS.filter(
      (row) =>
        row.assignmentId === ASSIGNMENTS.capacity &&
        row.period.start === period &&
        facilitiesIn(REGION_NORTH).some((facility) => facility.entityId === row.entity.entityId),
    );
    if (!region) throw new Error("missing region observation");

    const numerator = children.reduce((total, row) => total + (component(row, "numerator") ?? 0), 0);
    const denominator = children.reduce((total, row) => total + (component(row, "denominator") ?? 0), 0);
    expect(component(region, "numerator")).toBe(numerator);
    expect(component(region, "denominator")).toBe(denominator);
    expect(region.value).toEqual({ status: "available", value: Math.round((numerator / denominator) * 1000) / 10 });
  });

  it("keeps a late source missing instead of zero, and a zero denominator not applicable", () => {
    const lateRevenue = OBSERVATIONS.find(
      (row) => row.assignmentId === ASSIGNMENTS.revenue && row.entity.entityId === REGION_NORTH.entityId && row.period.start === CURRENT_PERIOD.start,
    );
    expect(lateRevenue?.value).toEqual({ status: "missing", reason: "not_reported" });
    expect(lateRevenue?.dataQuality).toMatchObject({ freshness: "late", reconciliation: "unreconciled" });

    const zeroDenominator = OBSERVATIONS.filter((row) => row.value.status === "not_applicable");
    expect(zeroDenominator.length).toBeGreaterThan(0);
    expect(zeroDenominator.every((row) => component(row, "denominator") === 0)).toBe(true);
  });

  it("scopes the late management-accounts close to the finance families sourced from it", () => {
    const latest = OBSERVATIONS.filter(
      (row) => row.entity.entityId === "fixture-facility-a1" && row.period.start === CURRENT_PERIOD.start,
    );
    const late = latest.filter((row) => row.dataQuality.freshness === "late").map((row) => row.definitionFamily);
    expect(late.sort()).toEqual(["EBITDA", "Net revenue"]);
    const capacity = latest.find((row) => row.definitionFamily === "Capacity utilisation");
    expect(capacity?.dataQuality).toMatchObject({ freshness: "current", reconciliation: "reconciled" });
    expect(capacity?.value.status).toBe("available");
  });

  it("keeps bundled assignments as separate definition families", () => {
    const families = new Set(
      OBSERVATIONS.filter((row) => row.assignmentId === ASSIGNMENTS.claims).map((row) => row.definitionFamily),
    );
    expect([...families].sort()).toEqual(["Denied or rejected claim value", "First-pass claim acceptance"]);
  });
});

describe("preview fixture API", () => {
  it("serves the Clinical Director's eight workbook assignments with group and COE scope", async () => {
    const api = createFixtureApi({ persona: "clinical-director" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership.role).toBe("clinical-director");
    expect(membership.scopes.map((scope) => scope.grain)).toEqual(["group", "coe"]);

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "clinical-director")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.owner.role).toBe("clinical-director");
    expect(brief.disclosure).toContain("not validated clinical or financial guidance");

    InboxResponseSchema.parse((await api.handle(get("/api/inbox"))).body);
    AskPromptsResponseSchema.parse((await api.handle(get("/api/ask/prompts"))).body);
    AuditListResponseSchema.parse((await api.handle(get("/api/audit"))).body);
    const detail = await api.handle(get(`/api/kpi/${CLINICAL_ASSIGNMENTS.quality}`, { grain: "group", entityId: "fixture-group", breakdown: "coe" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.grain).toBe("coe");
  });

  it("serves every read surface as contract-valid payloads", async () => {
    const api = createFixtureApi();
    MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    InboxResponseSchema.parse((await api.handle(get("/api/inbox"))).body);
    AskPromptsResponseSchema.parse((await api.handle(get("/api/ask/prompts"))).body);
    AuditListResponseSchema.parse((await api.handle(get("/api/audit"))).body);

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(9);
    expect(kpis.assignments.reduce((total, row) => total + row.weight, 0)).toBeCloseTo(1, 10);

    for (const assignment of kpis.assignments) {
      const reply = await api.handle(get(`/api/kpi/${assignment.assignmentId}`, { grain: "region", entityId: REGION_NORTH.entityId, breakdown: "facility" }));
      expect(reply.status).toBe(200);
      KpiDetailResponseSchema.parse(reply.body);
    }
  });

  it("serves the Chairman preview as group-scoped contract-valid payloads", async () => {
    const api = createFixtureApi({ persona: "chairman" });
    const me = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(me).toMatchObject({ role: "chairman", scopes: [GROUP] });

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(CHAIRMAN_ASSIGNMENTS.governance);

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(7);
    expect(kpis.assignments.reduce((total, row) => total + row.weight, 0)).toBeCloseTo(1, 10);

    const detail = await api.handle(get(`/api/kpi/${CHAIRMAN_ASSIGNMENTS.revenue}`, { grain: GROUP.grain, entityId: GROUP.entityId, breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.grain).toBe("region");

    const directRegion = await api.handle(get(`/api/kpi/${CHAIRMAN_ASSIGNMENTS.revenue}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(directRegion.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(directRegion.body).error.code).toBe("out_of_scope");
  });

  it("serves the Hospital DHO's nine workbook assignments with one facility scope", async () => {
    const api = createFixtureApi({ persona: "hospital-dho" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "hospital-dho", scopes: [DHO_FACILITY] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(9);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "hospital-dho")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(DHO_ASSIGNMENTS.readiness);
    const detail = await api.handle(get(`/api/kpi/${DHO_ASSIGNMENTS.revenue}`, { grain: DHO_FACILITY.grain, entityId: DHO_FACILITY.entityId }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).series.length).toBeGreaterThan(0);

    const outside = await api.handle(get(`/api/kpi/${DHO_ASSIGNMENTS.revenue}`, { grain: "facility", entityId: "fixture-facility-b1" }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the People Executive's eight workbook assignments with one facility scope", async () => {
    const api = createFixtureApi({ persona: "people-executive" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership.role).toBe("people-executive");
    expect(membership.scopes[0]?.grain).toBe("facility");

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "people-executive")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(PEOPLE_ASSIGNMENTS.training);
    const detail = await api.handle(get(`/api/kpi/${PEOPLE_ASSIGNMENTS.fillRate}`, { grain: "facility", entityId: "fixture-facility-a1" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).series.length).toBeGreaterThan(0);
  });

  it("serves the Business Development Lead's eight workbook assignments with one facility scope", async () => {
    const api = createFixtureApi({ persona: "bd-lead" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership.role).toBe("bd-lead");
    expect(membership.scopes[0]?.grain).toBe("facility");

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "bd-lead")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(BD_ASSIGNMENTS.crm);
    const detail = await api.handle(get(`/api/kpi/${BD_ASSIGNMENTS.revenue}`, { grain: "facility", entityId: "fixture-facility-a1" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).series.length).toBeGreaterThan(0);
  });

  it("serves the Billing & Revenue Lead's eight workbook assignments with one facility scope", async () => {
    const api = createFixtureApi({ persona: "billing-lead" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership.role).toBe("billing-lead");
    expect(membership.scopes[0]?.grain).toBe("facility");

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "billing-lead")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(BILLING_ASSIGNMENTS.denied);
    const detail = await api.handle(get(`/api/kpi/${BILLING_ASSIGNMENTS.acceptance}`, { grain: "facility", entityId: "fixture-facility-a1" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).series.length).toBeGreaterThan(0);
  });

  it("serves the COE Lead's eight workbook assignments with one COE scope", async () => {
    const api = createFixtureApi({ persona: "coe-lead" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "coe-lead", scopes: [{ grain: "coe", entityId: "fixture-coe-clinical" }] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "coe-lead")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "coe")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(COE_ASSIGNMENTS.milestones);
    expect(brief.dataLimitations.some((item) => item.detail.includes("No approved COE roadmap threshold"))).toBe(true);
    const detail = await api.handle(get(`/api/kpi/${COE_ASSIGNMENTS.revenue}`, { grain: "coe", entityId: "fixture-coe-clinical" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).series.length).toBeGreaterThan(0);
    const assignees = PermittedAssigneesResponseSchema.parse(
      (await api.handle(get("/api/actions/assignees", { assignmentId: COE_ASSIGNMENTS.milestones, grain: "coe", entityId: "fixture-coe-clinical" }))).body,
    );
    expect(assignees.assignees).toEqual([{ assigneeId: "fixture-assignee-clinical-group", role: "clinical-director", scopes: [GROUP] }]);

    const outside = await api.handle(get(`/api/kpi/${COE_ASSIGNMENTS.revenue}`, { grain: "group", entityId: "fixture-group" }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the Corporate Revenue & Insurance Lead's eight workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "corporate-revenue-lead" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "corporate-revenue-lead", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "corporate-revenue-lead")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(CORPORATE_ASSIGNMENTS.issues);
    const detail = await api.handle(get(`/api/kpi/${CORPORATE_ASSIGNMENTS.revenue}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${CORPORATE_ASSIGNMENTS.revenue}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the Group CFO's seven workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "group-cfo" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "group-cfo", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(7);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "group-cfo")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(GROUP_CFO_ASSIGNMENTS.controls);
    const detail = await api.handle(get(`/api/kpi/${GROUP_CFO_ASSIGNMENTS.ebitda}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${GROUP_CFO_ASSIGNMENTS.ebitda}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the Procurement Head's eight workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "procurement-head" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "procurement-head", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(8);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "procurement-head")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(PROCUREMENT_ASSIGNMENTS.stockouts);
    const detail = await api.handle(get(`/api/kpi/${PROCUREMENT_ASSIGNMENTS.savings}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${PROCUREMENT_ASSIGNMENTS.savings}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the HR Head's seven workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "hr-head" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "hr-head", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(7);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "hr-head")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(HR_ASSIGNMENTS.staffing);
    const detail = await api.handle(get(`/api/kpi/${HR_ASSIGNMENTS.workforce}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${HR_ASSIGNMENTS.workforce}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the Legal Head's seven workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "legal-head" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "legal-head", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(7);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "legal-head")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(LEGAL_ASSIGNMENTS.regulatory);
    const detail = await api.handle(get(`/api/kpi/${LEGAL_ASSIGNMENTS.contracts}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${LEGAL_ASSIGNMENTS.contracts}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("serves the Analytics Head's seven workbook assignments with group scope", async () => {
    const api = createFixtureApi({ persona: "analytics-head" });
    const membership = MeResponseSchema.parse((await api.handle(get("/api/me"))).body);
    expect(membership).toMatchObject({ role: "analytics-head", scopes: [GROUP] });

    const kpis = KpiListResponseSchema.parse((await api.handle(get("/api/kpi"))).body);
    expect(kpis.assignments).toHaveLength(7);
    expect(kpis.assignments.every((assignment) => assignment.roleId === "analytics-head")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.grains.length === 1 && assignment.grains[0] === "group")).toBe(true);
    expect(kpis.assignments.every((assignment) => assignment.breakdowns.length === 1 && assignment.breakdowns[0] === "region")).toBe(true);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.assignmentId).toBe(ANALYTICS_ASSIGNMENTS.quality);
    const detail = await api.handle(get(`/api/kpi/${ANALYTICS_ASSIGNMENTS.availability}`, { grain: "group", entityId: "fixture-group", breakdown: "region" }));
    expect(detail.status).toBe(200);
    expect(KpiDetailResponseSchema.parse(detail.body).breakdown?.observations).toHaveLength(2);

    const outside = await api.handle(get(`/api/kpi/${ANALYTICS_ASSIGNMENTS.availability}`, { grain: "region", entityId: REGION_NORTH.entityId }));
    expect(outside.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(outside.body).error.code).toBe("out_of_scope");
  });

  it("refuses other regions, ungranted grains, and ungranted breakdowns with an explicit out_of_scope", async () => {
    const api = createFixtureApi();
    const probes = [
      get(`/api/kpi/${ASSIGNMENTS.capacity}`, { grain: "region", entityId: "fixture-region-b" }),
      get(`/api/kpi/${ASSIGNMENTS.capacity}`, { grain: "facility", entityId: "fixture-facility-b1" }),
      get(`/api/kpi/${ASSIGNMENTS.revenue}`, { grain: "facility", entityId: "fixture-facility-a1" }),
      get(`/api/kpi/${ASSIGNMENTS.revenue}`, { grain: "region", entityId: REGION_NORTH.entityId, breakdown: "coe" }),
      get("/api/kpi/chairman:group-net-revenue-vs-approved-budget", { grain: "region", entityId: REGION_NORTH.entityId }),
    ];

    for (const probe of probes) {
      const reply = await api.handle(probe);
      expect(reply.status).toBe(403);
      expect(ErrorEnvelopeSchema.parse(reply.body).error.code).toBe("out_of_scope");
    }

    // Denials are recorded but, per ADR 0011 §7, never readable through the audit route.
    const audit = AuditListResponseSchema.parse((await api.handle(get("/api/audit"))).body);
    expect(audit.items.every((event) => event.target?.type === "action")).toBe(true);
    expect(audit.items.some((event) => event.kind === "access_denied")).toBe(false);
  });

  it("denies Regional COO South the North facility request from the vertical slice (PRD §5.3 step 7)", async () => {
    const south = createFixtureApi({ persona: "south" });
    const reply = await south.handle(get(`/api/kpi/${ASSIGNMENTS.capacity}`, FACILITY_A1));
    expect(reply.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(reply.body).error.code).toBe("out_of_scope");

    const answer = AskResponseSchema.parse(
      (await south.handle(post("/api/ask", { intent: "report_performance", assignmentId: ASSIGNMENTS.capacity, target: FACILITY_A1, period: CURRENT_PERIOD }))).body,
    );
    expect(answer.outcome).toBe("out_of_scope");
    expect(answer.card.relevantRecords.observations).toHaveLength(0);
  });

  it("answers Ask from authorized evidence, and refuses or reports no data without inventing values", async () => {
    const api = createFixtureApi();
    const answered = AskResponseSchema.parse(
      (await api.handle(post("/api/ask", { intent: "report_performance", assignmentId: ASSIGNMENTS.capacity, target: FACILITY_A1, period: CURRENT_PERIOD }))).body,
    );
    expect(answered.outcome).toBe("answered");
    expect(answered.outcome === "answered" && answered.card.nextAction?.evidence.observationIds).toHaveLength(1);

    const lateSource = AskResponseSchema.parse(
      (await api.handle(post("/api/ask", { intent: "report_performance", assignmentId: ASSIGNMENTS.revenue, target: REGION_NORTH, period: CURRENT_PERIOD }))).body,
    );
    expect(lateSource.outcome).toBe("no_data");
    expect(lateSource.card.answer).toContain("not reported");

    const malformed = AskResponseSchema.parse((await api.handle(post("/api/ask", { intent: "free_text", text: "show me everything" }))).body);
    expect(malformed.outcome).toBe("clarification_needed");
  });

  it("creates actions idempotently, verifies evidence, and rejects stale or reused requests", async () => {
    const api = createFixtureApi();
    const exception = await capacityEvidence(api);
    const assignees = PermittedAssigneesResponseSchema.parse(
      (await api.handle(get("/api/actions/assignees", { assignmentId: exception.assignmentId, ...exception.entity }))).body,
    );
    const assignee = assignees.assignees[0];
    if (!assignee) throw new Error("expected a permitted assignee");

    const request = {
      idempotencyKey: "4a0f9d2e-2b8c-4a6f-9d1e-0c5b7a3e1f22",
      title: "Review staffed bed availability",
      assignmentId: exception.assignmentId,
      entity: exception.entity,
      evidence: exception.evidence,
      assigneeId: assignee.assigneeId,
      dueDate: "2026-09-30",
    };

    const created = await api.handle(post("/api/actions", request));
    expect(created.status).toBe(201);
    const action = ActionResponseSchema.parse(created.body).action;

    const retried = await api.handle(post("/api/actions", request));
    expect(retried.status).toBe(200);
    expect(ActionResponseSchema.parse(retried.body)).toMatchObject({ replayed: true, action: { actionId: action.actionId } });

    const reused = await api.handle(post("/api/actions", { ...request, title: "Something else" }));
    expect(reused.status).toBe(409);

    const tampered = await api.handle(post("/api/actions", { ...request, idempotencyKey: "6b1e2d3c-4f5a-4b6c-8d7e-9f0a1b2c3d4e", evidence: { ...request.evidence, datasetChecksum: "older" } }));
    expect(tampered.status).toBe(409);

    const brief = BriefResponseSchema.parse((await api.handle(get("/api/brief"))).body);
    expect(brief.actNow[0]?.actionState).toBe("open");

    const stale = await api.handle(post(`/api/actions/${action.actionId}/transitions`, { toState: "cancelled", expectedVersion: 7, reason: "Duplicate" }));
    expect(stale.status).toBe(409);
  });

  it("applies the proposed transition matrix by relation", async () => {
    const api = createFixtureApi();
    const exception = await capacityEvidence(api);
    const created = ActionResponseSchema.parse(
      (
        await api.handle(
          post("/api/actions", {
            idempotencyKey: "0d3c2b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
            title: "Review staffed bed availability",
            assignmentId: exception.assignmentId,
            entity: exception.entity,
            evidence: exception.evidence,
            assigneeId: "fixture-assignee-dho-fixture-facility-a1",
            dueDate: "2026-09-30",
          }),
        )
      ).body,
    ).action;

    const acknowledgeAsCreator = await api.handle(post(`/api/actions/${created.actionId}/transitions`, { toState: "acknowledged", expectedVersion: 1, reason: "Seen" }));
    expect(ErrorEnvelopeSchema.parse(acknowledgeAsCreator.body).error.code).toBe("forbidden");

    const skip = await api.handle(post(`/api/actions/${created.actionId}/transitions`, { toState: "completed", expectedVersion: 1, reason: "Done" }));
    expect(ErrorEnvelopeSchema.parse(skip.body).error.code).toBe("conflict");

    const cancel = await api.handle(post(`/api/actions/${created.actionId}/transitions`, { toState: "cancelled", expectedVersion: 1, reason: "Raised in error" }));
    expect(ActionResponseSchema.parse(cancel.body).action).toMatchObject({ state: "cancelled", version: 2 });

    const acknowledgeAsAssignee = await api.handle(post("/api/actions/act-seed-1/transitions", { toState: "acknowledged", expectedVersion: 1, reason: "Seen" }));
    expect(ActionResponseSchema.parse(acknowledgeAsAssignee.body).action.state).toBe("acknowledged");
  });

  it("persists actions and audit across a reload of the same tab", async () => {
    const storage = memoryStorage();
    const first = createFixtureApi({ storage });
    await first.handle(post("/api/actions/act-seed-1/transitions", { toState: "acknowledged", expectedVersion: 1, reason: "Seen" }));

    const reloaded = createFixtureApi({ storage });
    const action = ActionDetailResponseSchema.parse((await reloaded.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(action).toMatchObject({ state: "acknowledged", version: 2 });

    reloaded.reset();
    const reset = ActionDetailResponseSchema.parse((await reloaded.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(reset.state).toBe("open");
  });

  it("falls back to seed state when stored preview data is malformed", async () => {
    const storage = memoryStorage();
    storage.setItem("orbit-preview-state:north:v1", JSON.stringify({ version: 1, actions: [{ action: { title: "forged" }, relation: "creator" }], audit: [], counter: 0 }));
    const api = createFixtureApi({ storage });
    const action = ActionDetailResponseSchema.parse((await api.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(action.state).toBe("open");
  });
});

async function labels(persona?: "chairman" | "hospital-dho") {
  const api = createFixtureApi(persona ? { persona } : {});
  const reply = await api.handle(get("/api/entities"));
  expect(reply.status).toBe(200);
  return EntityDirectoryResponseSchema.parse(reply.body).entities;
}

describe("preview entity directory (mirrors GET /api/entities)", () => {
  it("gives the Regional COO its own region and hospitals only", async () => {
    const entities = await labels();
    expect(entities.map((entity) => entity.entityId).sort()).toEqual(
      [REGION_NORTH.entityId, ...facilitiesIn(REGION_NORTH).map((facility) => facility.entityId)].sort(),
    );
    expect(entities.every((entity) => entity.entityId !== "fixture-region-b")).toBe(true);
  });

  it("gives a group-scoped role the whole organization, as RLS does", async () => {
    const entities = await labels("chairman");
    expect(entities.some((entity) => entity.entityId === GROUP.entityId && entity.parent === null)).toBe(true);
    expect(entities.filter((entity) => entity.grain === "facility")).toHaveLength(6);
  });

  it("gives a Hospital DHO its one hospital", async () => {
    expect((await labels("hospital-dho")).map((entity) => entity.entityId)).toEqual([DHO_FACILITY.entityId]);
  });
});
