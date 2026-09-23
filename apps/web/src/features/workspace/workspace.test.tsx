import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createApiClient, type ApiTransport } from "../../lib/api";
import { ASSIGNMENTS, CURRENT_PERIOD } from "../../preview/dataset";
import { createFixtureApi, type FixtureApi } from "../../preview/fixture-api";
import { requestFromForm } from "../ask/route";
import type { WorkspaceEnvironment } from "./environment";
import { workspaceRoutes } from "./routes";

type Router = ReturnType<typeof createMemoryRouter>;

function environmentFor(transport: ApiTransport): WorkspaceEnvironment {
  return { kind: "preview", basePath: "", routeId: "test-workspace", client: async () => createApiClient(transport) };
}

function settled(router: Router) {
  return new Promise<void>((resolve) => {
    const done = () => router.state.initialized && router.state.navigation.state === "idle" && router.state.revalidation === "idle";
    if (done()) return resolve();
    const unsubscribe = router.subscribe(() => {
      if (done()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function open(path: string, transport: ApiTransport = createFixtureApi().transport) {
  const router = createMemoryRouter([workspaceRoutes(environmentFor(transport))], { initialEntries: [path] });
  await settled(router);
  return router;
}

function render(router: Router) {
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

async function submit(router: Router, path: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  await router.navigate(path, { formMethod: "post", formData });
  await settled(router);
}

function textOf(markup: string) {
  return markup
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/g, " ");
}

describe("workspace shell", () => {
  it("renders all six surfaces in the navigation with the verified scope", async () => {
    const markup = render(await open("/"));
    for (const label of ["Morning brief", "Priority inbox", "KPI explorer", "Guided Ask", "Actions", "Audit"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("fixture-region-a");
    expect(markup).toContain("Developer preview");
  });

  it("fails closed when a verified membership has no built role view", async () => {
    const fixture = createFixtureApi();
    const transport: ApiTransport = async (request) =>
      request.path === "/api/me"
        ? { status: 200, body: { role: "clinical-director", organizationId: "30000000-0000-4000-8000-000000000001", scopes: [{ grain: "group", entityId: "fixture-group" }] } }
        : fixture.handle(request);
    const markup = textOf(render(await open("/", transport)));
    expect(markup).toContain("Your role's workspace is not available yet.");
    expect(markup).not.toContain("Act now");
  });

  it("shows a trust failure instead of fabricated content when a payload breaks the contract", async () => {
    const fixture = createFixtureApi();
    const transport: ApiTransport = async (request) =>
      request.path === "/api/brief" ? { status: 200, body: { actNow: "everything is fine" } } : fixture.handle(request);
    const markup = textOf(render(await open("/", transport)));
    expect(markup).toContain("Orbit received data it could not trust.");
    expect(markup).toContain("Priority inbox");
  });

  it("renders the Chairman role view from the shared workspace surfaces", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "chairman" }).transport)));
    expect(markup).toContain("Chairman");
    expect(markup).toContain("Group governance");
    expect(markup).toContain("fixture-group");
    expect(markup).toContain("Critical governance, legal and audit actions closed");
  });
});

describe("morning brief", () => {
  it("renders the FR-02 sections in order with generated labels and the disclosure", async () => {
    const markup = render(await open("/"));
    const positions = ['id="act-now"', 'id="monitor"', 'id="on-track"', 'id="limitations"'].map((id) => markup.indexOf(id));
    expect(positions.every((position, index) => position > 0 && (index === 0 || position > (positions[index - 1] ?? 0)))).toBe(true);
    expect(markup).toContain("Hospital and clinic capacity utilisation");
    expect(markup).toContain("Fictional demonstration company. All figures and targets are illustrative");
    expect(markup).toContain("Sustained capacity constraint (preview fixture)");
  });

  it("links each exception to its evidence, a scoped question, and an evidence-bound action", async () => {
    const markup = render(await open("/"));
    expect(markup).toContain(`/explorer/${encodeURIComponent(ASSIGNMENTS.capacity)}?grain=facility&amp;entityId=fixture-facility-a1`);
    expect(markup).toContain("/ask?intent=report_performance");
    expect(markup).toContain("/actions/new?assignmentId=");
    expect(markup).toContain("observationId=obs%3Acapacity-utilisation%3Afixture-facility-a1");
  });
});

describe("priority inbox", () => {
  it("states its ordering basis and narrows only what is authorized when filtered", async () => {
    const all = textOf(render(await open("/inbox")));
    expect(all).toContain("How this list is ordered");
    expect(all).toContain("Act-now before monitor");

    const filtered = textOf(render(await open("/inbox?priority=monitor")));
    expect(filtered).toMatch(/Showing 2 of 3 authorized exceptions/);
  });
});

describe("KPI explorer", () => {
  it("lists all nine assignments and flags bundled measures", async () => {
    const markup = textOf(render(await open("/explorer")));
    expect(markup.match(/Source weight/g)?.length).toBeGreaterThanOrEqual(9);
    expect(markup).toContain("Bundled: 2 measures kept separate");
  });

  it("shows components, definition, target state, and facility context for the capacity exception", async () => {
    const markup = textOf(render(await open(`/explorer/${encodeURIComponent(ASSIGNMENTS.capacity)}?grain=facility&entityId=fixture-facility-a1`)));
    expect(markup).toContain("Occupied staffed bed days");
    expect(markup).toContain("Available staffed bed days");
    expect(markup).toContain("Target not configured");
    expect(markup).toContain("Numerator/denominator control");
    expect(markup).toContain("Open the facility split");
  });

  it("renders the permitted facility split and keeps a late value unreported, never zero", async () => {
    const markup = textOf(render(await open(`/explorer/${encodeURIComponent(ASSIGNMENTS.revenue)}?grain=region&entityId=fixture-region-a`)));
    expect(markup).toContain("Facility split");
    for (const facility of ["fixture-facility-a1", "fixture-facility-a2", "fixture-facility-a3"]) expect(markup).toContain(facility);
    expect(markup).toContain("Not reported");
    expect(markup).toContain("The management-accounts close for August 2026 is late and unreconciled");
  });

  it("refuses another region explicitly while keeping the workspace navigation", async () => {
    const markup = textOf(render(await open(`/explorer/${encodeURIComponent(ASSIGNMENTS.capacity)}?grain=region&entityId=fixture-region-b`)));
    expect(markup).toContain("This request is outside your authorized scope.");
    expect(markup).toContain("Nothing was narrowed or partially shown.");
    expect(markup).toContain("Priority inbox");
    expect(markup).not.toContain("fixture-facility-b1");
  });
});

describe("guided Ask", () => {
  it("offers at least three guided prompts and discloses deterministic mode", async () => {
    const markup = textOf(render(await open("/ask")));
    expect(markup.match(/Explain how .+? is defined/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(markup).toContain("Summarize my open exceptions");
    expect(markup).toContain("Deterministic mode");
    expect(markup).toContain("No free-text AI model is used");
  });

  it("builds typed requests from the form and rejects incomplete ones", () => {
    const complete = new FormData();
    complete.set("intent", "report_performance");
    complete.set("assignmentId", ASSIGNMENTS.capacity);
    complete.set("scope", "facility|fixture-facility-a1");
    complete.set("month", CURRENT_PERIOD.start.slice(0, 7));
    expect(requestFromForm(complete)).toEqual({
      intent: "report_performance",
      assignmentId: ASSIGNMENTS.capacity,
      target: { grain: "facility", entityId: "fixture-facility-a1" },
      period: CURRENT_PERIOD,
    });

    const incomplete = new FormData();
    incomplete.set("intent", "compare_periods");
    incomplete.set("assignmentId", ASSIGNMENTS.capacity);
    expect(typeof requestFromForm(incomplete)).toBe("string");
  });

  it("renders every Evidence Card section for an answer, with a next action bound to its evidence", async () => {
    const router = await open("/ask");
    await submit(router, "/ask", {
      intent: "report_performance",
      assignmentId: ASSIGNMENTS.capacity,
      scope: "facility|fixture-facility-a1",
      month: CURRENT_PERIOD.start.slice(0, 7),
    });
    const markup = textOf(render(router));
    for (const section of ["Answer", "Relevant records", "Definition and policy basis", "Reasoning from observed evidence", "Possible next action", "Scope, period, and limitations"]) {
      expect(markup).toContain(section);
    }
    expect(markup).toContain("Record action from this evidence");
  });

  it("returns an explicit refusal for a breakdown the role does not hold", async () => {
    const router = await open("/ask");
    await submit(router, "/ask", {
      intent: "explain_contributors",
      assignmentId: ASSIGNMENTS.revenue,
      scope: "region|fixture-region-a",
      month: CURRENT_PERIOD.start.slice(0, 7),
      breakdown: "coe",
    });
    const markup = textOf(render(router));
    expect(markup).toContain("Out of scope");
    expect(markup).toContain("No records were used for this answer.");
  });
});

describe("actions and audit", () => {
  async function createFromBrief(fixture: FixtureApi) {
    const router = await open("/", fixture.transport);
    const markup = render(router);
    const href = /href="(\/actions\/new\?[^"]+)"/.exec(markup)?.[1]?.replaceAll("&amp;", "&");
    if (!href) throw new Error("expected a record-action link on the brief");
    await router.navigate(href);
    await settled(router);
    return { router, href };
  }

  it("requires evidence before an action can be recorded", async () => {
    const markup = textOf(render(await open("/actions/new")));
    expect(markup).toContain("An action must cite evidence.");
  });

  it("records an action from the brief evidence and shows it in actions and audit", async () => {
    const fixture = createFixtureApi();
    const { router, href } = await createFromBrief(fixture);
    const form = textOf(render(router));
    expect(form).toContain("Hospital DHO");
    expect(form).toContain("nothing is emailed or sent to an external tool");

    const key = /name="idempotencyKey" value="([^"]+)"/.exec(render(router))?.[1] ?? "";
    await submit(router, href, {
      idempotencyKey: key,
      title: "Review staffed bed availability",
      assigneeId: "fixture-assignee-dho-fixture-facility-a1",
      dueDate: "2026-09-30",
    });
    expect(router.state.location.pathname).toMatch(/^\/actions\/act-/);
    expect(textOf(render(router))).toContain("Action recorded.");

    await router.navigate("/actions");
    await settled(router);
    expect(textOf(render(router))).toContain("Review staffed bed availability");

    await router.navigate("/audit");
    await settled(router);
    expect(textOf(render(router))).toContain("Action Created");
  });

  it("explains a refused transition inline and applies a permitted one", async () => {
    const router = await open("/actions/act-seed-1");
    await submit(router, "/actions/act-seed-1", { toState: "completed", expectedVersion: "1", reason: "Done" });
    expect(textOf(render(router))).toContain("This action cannot move to that state.");

    await submit(router, "/actions/act-seed-1", { toState: "acknowledged", expectedVersion: "1", reason: "Seen and owned" });
    const markup = textOf(render(router));
    expect(markup).toContain("State updated to acknowledged.");
    expect(markup).toContain("Action acknowledged");
  });
});
