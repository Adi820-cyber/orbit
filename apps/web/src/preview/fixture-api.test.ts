import {
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
import { ASSIGNMENTS, CURRENT_PERIOD, OBSERVATIONS, REGION_NORTH, facilitiesIn } from "./dataset";
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
    const action = ActionResponseSchema.parse((await reloaded.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(action).toMatchObject({ state: "acknowledged", version: 2 });

    reloaded.reset();
    const reset = ActionResponseSchema.parse((await reloaded.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(reset.state).toBe("open");
  });

  it("falls back to seed state when stored preview data is malformed", async () => {
    const storage = memoryStorage();
    storage.setItem("orbit-preview-state:north:v1", JSON.stringify({ version: 1, actions: [{ action: { title: "forged" }, relation: "creator" }], audit: [], counter: 0 }));
    const api = createFixtureApi({ storage });
    const action = ActionResponseSchema.parse((await api.handle(get("/api/actions/act-seed-1"))).body).action;
    expect(action.state).toBe("open");
  });
});
