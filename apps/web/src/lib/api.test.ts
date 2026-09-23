import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureApi } from "../preview/fixture-api";
import { ApiConfigurationError, ApiRequestError, createApiClient, httpTransport, type ApiRequest } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function requestUrl(input: string | URL | Request) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

/** Serves the fixture API over a stubbed `fetch`, so the real HTTP transport is exercised. */
function stubFetchWithFixture() {
  const fixture = createFixtureApi();
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-access-token");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const request: ApiRequest = {
      method: init?.method === "POST" ? "POST" : "GET",
      path: url.pathname,
      query: url.searchParams,
      body,
    };
    const reply = await fixture.handle(request);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createApiClient over HTTP", () => {
  it("parses every read boundary and sends only the bearer token", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test/");
    const fetchMock = stubFetchWithFixture();
    const client = createApiClient(httpTransport("fixture-access-token"));

    const [me, brief, kpis, inbox, prompts, audit, actions] = await Promise.all([
      client.me(),
      client.brief(),
      client.kpiList(),
      client.inbox(),
      client.askPrompts(),
      client.audit(),
      client.actions(),
    ]);

    expect(me.role).toBe("regional-coo");
    expect(brief.actNow.length).toBeGreaterThan(0);
    expect(kpis.assignments).toHaveLength(9);
    expect(inbox.orderingBasis).not.toHaveLength(0);
    expect(prompts.prompts.length).toBeGreaterThanOrEqual(3);
    expect(audit.items.length).toBeGreaterThan(0);
    expect(actions.items.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? "").origin).toBe("https://api.orbit.test");
  });

  it("encodes the assignment id and KPI query, and posts JSON bodies", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    const fetchMock = stubFetchWithFixture();
    const client = createApiClient(httpTransport("fixture-access-token"));

    const detail = await client.kpiDetail("regional-coo:hospital-and-clinic-capacity-utilisation", {
      grain: "region",
      entityId: "fixture-region-a",
      breakdown: "facility",
      from: "2026-03-01",
    });
    expect(detail.breakdown?.observations.length).toBe(3);

    const detailUrl = requestUrl(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(detailUrl.pathname).toBe("/api/kpi/regional-coo%3Ahospital-and-clinic-capacity-utilisation");
    expect(Object.fromEntries(detailUrl.searchParams)).toEqual({
      grain: "region",
      entityId: "fixture-region-a",
      breakdown: "facility",
      from: "2026-03-01",
    });

    const answer = await client.ask({ intent: "summarize_exceptions" });
    expect(answer.outcome).toBe("answered");
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("preserves typed out-of-scope refusals instead of narrowing them", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    stubFetchWithFixture();
    const client = createApiClient(httpTransport("fixture-access-token"));

    await expect(
      client.kpiDetail("regional-coo:hospital-and-clinic-capacity-utilisation", { grain: "region", entityId: "fixture-region-b" }),
    ).rejects.toMatchObject({ code: "out_of_scope", status: 403 });
  });

  it("rejects a successful response that breaks the shared contract", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ unexpected: true }), { status: 200 }))),
    );

    await expect(createApiClient(httpTransport("token")).brief()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps an unreachable service and a missing configuration to typed failures", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.orbit.test");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network down"))));
    await expect(createApiClient(httpTransport("token")).me()).rejects.toMatchObject({ code: "unavailable", status: 503 });

    vi.stubEnv("VITE_API_BASE_URL", "");
    await expect(createApiClient(httpTransport("token")).me()).rejects.toBeInstanceOf(ApiConfigurationError);
  });
});

describe("createApiClient outgoing parsing", () => {
  it("refuses to send a request the contract rejects", async () => {
    const transport = vi.fn();
    const client = createApiClient(transport);

    await expect(
      client.createAction({
        idempotencyKey: "not-a-uuid",
        title: "",
        assignmentId: "x",
        entity: { grain: "region", entityId: "fixture-region-a" },
        evidence: { observationIds: [], definitionVersion: "v1", datasetChecksum: "c" },
        assigneeId: "a",
        dueDate: "2026-09-30",
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(transport).not.toHaveBeenCalled();
  });
});
