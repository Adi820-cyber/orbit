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
  it("renders primary surfaces and the floating Ask launcher with the verified scope", async () => {
    const markup = render(await open("/"));
    for (const label of ["Morning brief", "Priority inbox", "KPI explorer", "Actions", "Audit"]) {
      expect(markup).toContain(label);
    }
    // The launcher is a button that opens the Ask Orbit chat panel in place.
    expect(markup).toContain('class="workspace-ask-launcher"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Ask Orbit");
    // The verified scope is shown by name from GET /api/entities, not by raw id.
    expect(markup).toContain("Region · Preview North region");
    expect(markup).toContain("Developer preview");
  });

  /**
   * This test previously asserted the opposite: `coe-lead` had no view config,
   * so the shell refused to open. That was correct behaviour for a gap that
   * should not have existed — seven of the fourteen roles could authenticate,
   * hold correct entitlements, and still not reach the product.
   *
   * `roleViewConfigFor` now derives from the framework, so every workbook role
   * has a view. The assertion is inverted to match, and `coe-lead` is kept as
   * the subject precisely because it was one of the locked-out seven.
   *
   * The fail-closed path is not gone, it moved: `RoleViewUnavailableError` still
   * fires for a role the framework does not define. That case is no longer
   * reachable through this route, because `MeResponse` constrains `role` to the
   * fourteen `RoleId` values, so a role reaching here is a role the framework
   * knows. It is now reachable only if `@orbit/contracts` and
   * `@orbit/kpi-framework` drift apart — worth keeping for that reason, and
   * covered directly in `src/roles/config.test.ts`.
   */
  it("opens the workspace for a role whose view is derived from the framework", async () => {
    const fixture = createFixtureApi();
    const transport: ApiTransport = async (request) =>
      request.path === "/api/me"
        ? { status: 200, body: { role: "coe-lead", organizationId: "30000000-0000-4000-8000-000000000001", scopes: [{ grain: "facility", entityId: "fixture-facility-a1" }] } }
        : fixture.handle(request);
    const markup = textOf(render(await open("/", transport)));
    expect(markup).not.toContain("Your role's workspace is not available yet.");
    // The workbook name for coe-lead, surfaced because COPY has no entry for it.
    expect(markup).toContain("COE Lead");
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

  it("renders the Clinical Director role view from workbook assignments and group fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "clinical-director" }).transport)));
    expect(markup).toContain("Clinical Director");
    expect(markup).toContain("Group clinical leadership");
    expect(markup).toContain("Clinical governance review closure movement");
    expect(markup).toContain("Clinical quality scorecard");
    expect(markup).toContain("No approved clinical threshold is configured in this preview");
  });

  it("renders the Hospital DHO role view from workbook assignments and facility fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "hospital-dho" }).transport)));
    expect(markup).toContain("Hospital DHO");
    expect(markup).toContain("Hospital leadership");
    expect(markup).toContain("Facility readiness closure movement");
    expect(markup).toContain("Hospital net revenue vs approved budget");
    expect(markup).toContain("No approved facility readiness threshold is configured in this preview");
  });

  it("renders the People Executive role view from workbook assignments and facility fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "people-executive" }).transport)));
    expect(markup).toContain("People Executive");
    expect(markup).toContain("Hospital functional leadership");
    expect(markup).toContain("Mandatory training completion movement");
    expect(markup).toContain("Approved position fill rate and time to fill");
    expect(markup).toContain("No approved workforce capability threshold is configured in this preview");
  });

  it("renders the Business Development Lead role view from workbook assignments and facility fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "bd-lead" }).transport)));
    expect(markup).toContain("Business Development Lead");
    expect(markup).toContain("Hospital functional leadership");
    expect(markup).toContain("CRM completeness and forecast accuracy movement");
    expect(markup).toContain("New business revenue vs plan");
    expect(markup).toContain("No approved CRM data-quality threshold is configured in this preview");
  });

  it("renders the Billing & Revenue Lead role view from workbook assignments and facility fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "billing-lead" }).transport)));
    expect(markup).toContain("Billing & Revenue Lead");
    expect(markup).toContain("Hospital functional leadership");
    expect(markup).toContain("Rejected or denied claim value movement");
    expect(markup).toContain("Claim first-pass acceptance rate");
    expect(markup).toContain("The approved DSO day convention and ageing threshold are not configured in this preview");
  });

  it("renders the COE Lead role view from workbook assignments and COE fixtures", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "coe-lead" }).transport)));
    expect(markup).toContain("COE Lead");
    expect(markup).toContain("Clinical growth");
    expect(markup).toContain("COE programme milestone movement");
    expect(markup).toContain("COE net revenue vs plan");
    expect(markup).toContain("No approved COE roadmap threshold is configured in this preview");
  });

  it("renders the Corporate Revenue & Insurance Lead role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "corporate-revenue-lead" }).transport)));
    expect(markup).toContain("Corporate Revenue & Insurance Lead");
    expect(markup).toContain("Commercial growth");
    expect(markup).toContain("Payer issue closure movement");
    expect(markup).toContain("Corporate and insurer net revenue and margin vs plan");
  });

  it("renders the Group CFO role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "group-cfo" }).transport)));
    expect(markup).toContain("Group CFO");
    expect(markup).toContain("Group finance leadership");
    expect(markup).toContain("Financial control and leakage action closure movement");
    expect(markup).toContain("Group EBITDA vs approved budget");
  });

  it("renders the Procurement Head role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "procurement-head" }).transport)));
    expect(markup).toContain("Procurement Head");
    expect(markup).toContain("Group supply leadership");
    expect(markup).toContain("Critical supply-continuity controls moved");
    expect(markup).toContain("Finance-validated procurement savings vs plan");
  });

  it("renders the HR Head role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "hr-head" }).transport)));
    expect(markup).toContain("HR Head");
    expect(markup).toContain("Group people leadership");
    expect(markup).toContain("Critical-role staffing moved");
    expect(markup).toContain("Group workforce cost and productivity vs plan");
  });

  it("renders the Legal Head role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "legal-head" }).transport)));
    expect(markup).toContain("Legal Head");
    expect(markup).toContain("Group legal leadership");
    expect(markup).toContain("License, filing and regulatory-calendar compliance moved");
    expect(markup).toContain("Contract turnaround time");
  });

  it("renders the Analytics Head role view", async () => {
    const markup = textOf(render(await open("/", createFixtureApi({ persona: "analytics-head" }).transport)));
    expect(markup).toContain("Head of Analytics & Digital Transformation");
    expect(markup).toContain("Group analytics leadership");
    expect(markup).toContain("Critical KPI data-quality checks moved");
    expect(markup).toContain("KPI dashboard availability and refresh on time");
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
    expect(markup).toContain("Back");
  });

  it("renders the permitted facility split and keeps a late value unreported, never zero", async () => {
    const markup = textOf(render(await open(`/explorer/${encodeURIComponent(ASSIGNMENTS.revenue)}?grain=region&entityId=fixture-region-a`)));
    expect(markup).toContain("Facility split");
    // Facilities are shown by name from GET /api/entities, not by raw id.
    for (const facility of ["Preview facility A1", "Preview facility A2", "Preview facility A3"]) expect(markup).toContain(facility);
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
    expect(markup).toContain("Back");
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
    expect(markup).toContain("Now acknowledged.");
    expect(markup).toContain("Action acknowledged");
  });
});

describe("hospital operations", () => {
  it("shows the link and the live counts to a leader whose role includes them", async () => {
    const markup = textOf(render(await open("/operations", createFixtureApi({ persona: "north" }).transport)));
    expect(markup).toContain("Hospital operations");
    expect(markup).toContain("Counts only: no person or patient is named here.");
    expect(markup).toContain("On duty now");
    expect(markup).toContain("Preview facility A1");
    expect(markup).toContain("Illustrative");
    expect(markup).toContain("Preview placeholder counts");
  });

  it("offers the navigation entry only to roles on the allow-list", async () => {
    const allowed = textOf(render(await open("/", createFixtureApi({ persona: "chairman" }).transport)));
    expect(allowed).toContain("Hospital operations");
    const denied = textOf(render(await open("/", createFixtureApi({ persona: "billing-lead" }).transport)));
    expect(denied).not.toContain("Hospital operations");
  });

  it("refuses a role outside the allow-list explicitly instead of showing an empty page", async () => {
    const markup = textOf(render(await open("/operations", createFixtureApi({ persona: "billing-lead" }).transport)));
    expect(markup).toContain("Not permitted");
    expect(markup).not.toContain("On duty now");
  });
});
