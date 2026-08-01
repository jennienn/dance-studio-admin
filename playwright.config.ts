import { defineConfig } from "@playwright/test";
import { hasTestEnvironmentFile, loadAndValidateTestEnvironment } from "./tests/support/test-env";

const hasTestEnv = hasTestEnvironmentFile();
if (hasTestEnv) loadAndValidateTestEnvironment({ requireServiceRole: true });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure"
  },
  webServer: hasTestEnv
    ? {
        command: "next dev -p 3100",
        url: "http://127.0.0.1:3100/login",
        reuseExistingServer: false,
        env: { ...process.env, TEST_MODE: "true", BOOKING_SESSION_SECRET: "test-only-booking-session-secret-32-chars" },
        timeout: 120_000
      }
    : undefined
});
