import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { regionalCooBriefFixture } from "../src/features/brief/brief.fixture";

const AUTH_STORAGE_KEY = "sb-fixture-auth-token";

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

async function installApiFixtures(page: Page) {
  const fixtures = new Map<string, unknown>([
    ["/api/me", regionalCooBriefFixture.membership],
    ["/api/brief", regionalCooBriefFixture.brief],
    ["/api/kpi", regionalCooBriefFixture.kpis],
  ]);

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = fixtures.get(path);

    if (!body) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "not_found",
            message: "Fixture route not found.",
            requestId: "fixture-request",
          },
        }),
      });
      return;
    }

    expect(route.request().headers().authorization).toBe(
      "Bearer fixture-access-token",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureSession(page);
  await installApiFixtures(page);
});

test("renders the Regional COO brief without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Your morning decision brief" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Act now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On track" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Data limitations" }),
  ).toBeVisible();
  await expect(page.getByText(regionalCooBriefFixture.brief.disclosure)).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("regional-coo-brief.png"),
  });
});

test("keeps evidence, scope, and limitations available by keyboard", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const firstEvidence = page.getByText("Evidence and scope").first();
  await firstEvidence.focus();
  await expect(firstEvidence).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("fixture-facility-a1")).toBeVisible();
  await expect(page.getByText("Unreconciled", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The illustrative financial source is late and has not been reconciled.",
    ),
  ).toBeVisible();
});
