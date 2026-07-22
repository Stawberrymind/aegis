import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/web",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run api",
    url: "http://127.0.0.1:8787/health",
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
