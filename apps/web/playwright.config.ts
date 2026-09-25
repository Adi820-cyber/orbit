import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/login",
  fullyParallel: true,
  workers: 3,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    // Optional: run on an installed browser instead of Playwright's bundled
    // Chromium, e.g. PW_CHANNEL=msedge on Windows machines without it.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5174",
    env: {
      VITE_API_BASE_URL: "http://127.0.0.1:5174",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_SUPABASE_URL: "https://fixture.supabase.co",
    },
    url: "http://127.0.0.1:5174/login",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "mobile-390",
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-768",
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
