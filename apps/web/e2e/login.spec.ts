import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("renders the provisioned-account login without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.getByText("Need access?", { exact: false })).toBeVisible();
  await expect(page.getByText("Contact your administrator.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);

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
    path: testInfo.outputPath("login.png"),
  });
});

test("supports keyboard navigation and clear required-field errors", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Work email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Password" })).toBeFocused();

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your work email or sign-in ID.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("textbox", { name: "Password" })).toHaveAttribute("aria-invalid", "true");
});
