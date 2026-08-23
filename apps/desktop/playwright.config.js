import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.e2e.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: process.env.KOMYAKU_PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
