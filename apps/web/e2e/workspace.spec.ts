import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createFixtureApi, type PreviewPersona } from "../src/preview/fixture-api";

const AUTH_STORAGE_KEY = "sb-fixture-auth-token";
const CAPACITY = encodeURIComponent("regional-coo:hospital-and-clinic-capacity-utilisation");

async function installFixtureSession(page: Page) {
  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    {
      key: AUTH_STORAGE_KEY,
      session: {
        access_token: "fixture-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: 4_102_444_800,
        refresh_token: "fixture-refresh-token",
        user: {
          id: "10000000-0000-4000-8000-000000000001",
          aud: "authenticated",
          role: "authenticated",
          email: "regional-coo@fixture.invalid",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          confirmed_at: "2026-01-01T00:00:00Z",
          last_sign_in_at: "2026-02-02T06:00:00Z",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          identities: [],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-02T06:00:00Z",
          is_anonymous: false,
        },
      },
    },
  );
}

/** Answers the real HTTP client from the fixture API held in the test process, so state survives reloads. */
async function installApi(page: Page, persona: PreviewPersona = "north") {
  const fixture = createFixtureApi({ persona });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer fixture-access-token");
    const url = new URL(request.url());
    const reply = await fixture.handle({
      method: request.method() === "POST" ? "POST" : "GET",
      path: url.pathname,
      query: url.searchParams,
      body: request.method() === "POST" ? (request.postDataJSON() as unknown) : undefined,
    });
    await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });

  return fixture;
}

async function expectNoOverflowOrAxeViolations(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installFixtureSession(page);
});

const SURFACES = [
  { path: "/", heading: "Your morning decision brief" },
  { path: "/inbox", heading: "Exceptions in your authorized scope" },
  { path: "/explorer", heading: "Your authorized KPI assignments" },
  { path: `/explorer/${CAPACITY}?grain=facility&entityId=fixture-facility-a1`, heading: "Hospital and clinic capacity utilisation" },
  { path: `/explorer/${encodeURIComponent("regional-coo:regional-net-revenue-vs-approved-budget")}?grain=region&entityId=fixture-region-a`, heading: "Regional net revenue vs approved budget" },
  { path: "/ask", heading: "Ask about your authorized evidence" },
  { path: "/actions", heading: "Internal actions" },
  { path: "/audit", heading: "Audit trail" },
  { path: "/operations", heading: "Hospital operations" },
];

for (const surface of SURFACES) {
  test(`renders ${surface.path} without horizontal overflow or axe violations`, async ({ page }, testInfo) => {
    await installApi(page);
    await page.goto(surface.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: surface.heading })).toBeVisible();
    await expect(page.getByText("Fictional demonstration company").first()).toBeVisible();
    await expectNoOverflowOrAxeViolations(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`surface-${SURFACES.indexOf(surface)}.png`) });
  });
}

test("shows hospital operations only to roles that have it, and refuses the rest explicitly (ADR 0018)", async ({ page }) => {
  await installApi(page, "billing-lead");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hospital operations" })).toHaveCount(0);
  await page.goto("/operations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Not permitted")).toBeVisible();
  await expect(page.getByText("On duty now")).toHaveCount(0);
});

test("completes the Regional COO vertical slice from exception to audit (PRD §5.3 steps 1–6)", async ({ page }) => {
  await installApi(page);

  // 1–2. The brief surfaces a labelled capacity exception.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const exception = page.getByRole("article", { name: /Act now: Hospital and clinic capacity utilisation/ });
  await expect(exception.getByText("Sustained capacity constraint (preview fixture)")).toBeVisible();

  // 3. Component evidence, numerator/denominator, scope, and data quality.
  await exception.getByRole("link", { name: "Review evidence" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hospital and clinic capacity utilisation" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Occupied staffed bed days/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Available staffed bed days/ })).toBeVisible();
  await expect(page.getByText("Target not configured").first()).toBeVisible();
  await expectNoOverflowOrAxeViolations(page);

  // 4. Guided Ask explains the evidence in a structured card.
  await page.getByRole("link", { name: "Ask about August 2026" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask about your authorized evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const card = page.getByRole("article", { name: "Evidence card" });
  await expect(card.getByText("Answered")).toBeVisible();
  for (const section of ["Answer", "Relevant records", "Definition and policy basis", "Reasoning from observed evidence", "Possible next action", "Scope, period, and limitations"]) {
    await expect(card.getByRole("heading", { name: section })).toBeVisible();
  }
  await expectNoOverflowOrAxeViolations(page);

  // 5. Record an internal action for the permitted Hospital DHO.
  await card.getByRole("link", { name: "Record action from this evidence" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Record an internal action" })).toBeVisible();
  await page.getByLabel("Title").fill("Review staffed bed availability with the DHO");
  await page.getByRole("radio", { name: /Hospital DHO/ }).check();
  await expectNoOverflowOrAxeViolations(page);
  await page.getByRole("button", { name: "Record action" }).click();
  await expect(page.getByText("Action recorded.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Review staffed bed availability with the DHO" })).toBeVisible();

  // 6. The action and its audit entry survive a refresh.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Review staffed bed availability with the DHO" })).toBeVisible();
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit trail" })).toBeVisible();
  await expect(page.getByText("Action Created").first()).toBeVisible();
  // ADR 0011 §7: Ask outcomes and evidence views are recorded but not readable.
  await expect(page.getByText("Ask Answered")).toHaveCount(0);
  await expect(page.getByText("Evidence Viewed")).toHaveCount(0);
});

test("denies Regional COO South the North facility evidence (PRD §5.3 step 7)", async ({ page }) => {
  await installApi(page, "south");
  await page.goto(`/explorer/${CAPACITY}?grain=facility&entityId=fixture-facility-a1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "This request is outside your authorized scope." })).toBeVisible();
  await expect(page.getByText("Nothing was narrowed or partially shown.", { exact: false })).toBeVisible();
  await expect(page.getByText("Occupied staffed bed days")).toHaveCount(0);
  await expectNoOverflowOrAxeViolations(page);
});

test("keeps evidence, the trend readout, and navigation available by keyboard", async ({ page }) => {
  await installApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const firstEvidence = page.getByText("Evidence and scope").first();
  await firstEvidence.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("fixture-facility-a1").first()).toBeVisible();

  await page.goto(`/explorer/${CAPACITY}?grain=facility&entityId=fixture-facility-a1`, { waitUntil: "domcontentloaded" });
  const chart = page.getByRole("slider", { name: /Capacity utilisation by period/ });
  await chart.focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".orbit-trend__tooltip")).toContainText("Sep 25");
  await page.keyboard.press("End");
  await expect(page.locator(".orbit-trend__tooltip")).toContainText("Aug 26");
});

test("filters the inbox without widening scope and offers only the moves the server allows", async ({ page }) => {
  await installApi(page);
  await page.goto("/inbox", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Priority").selectOption("act_now");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Showing 1 of 3 authorized exceptions/)).toBeVisible();

  // The persona is the assignee of the seeded action: acknowledging is the only
  // move offered; approving or cancelling belongs to the creator and never appears.
  await page.goto("/actions/act-seed-1", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Acknowledge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel action" })).toHaveCount(0);

  await page.getByLabel("Note").fill("Owned by the regional office");
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("Now acknowledged.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start work" })).toBeVisible();
  await expect(page.getByText("Owned by the regional office")).toBeVisible();
});

test("opens Ask Orbit as an accessible chat panel with tabular answers", async ({ page }) => {
  await installApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const launcher = page.getByRole("button", { name: "Ask Orbit" });
  await launcher.click();
  const panel = page.getByRole("region", { name: "Ask Orbit" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Your question")).toBeFocused();
  await expectNoOverflowOrAxeViolations(page);

  const suggestion = panel.locator(".ask-chat__suggestion").first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(panel.locator(".ask-chat__answer").first()).toBeVisible();
  await expectNoOverflowOrAxeViolations(page);

  await panel.getByLabel("Your question").focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask Orbit" })).toBeFocused();
});

test("serves the developer preview without authentication", async ({ page }) => {
  await page.goto("/preview/regional-coo", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Developer preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Your morning decision brief" })).toBeVisible();
  await page.getByRole("link", { name: /Explorer|KPI explorer/ }).first().click();
  await expect(page).toHaveURL(/\/preview\/regional-coo\/explorer$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your authorized KPI assignments" })).toBeVisible();
});
