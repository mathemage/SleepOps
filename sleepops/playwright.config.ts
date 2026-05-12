import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3100",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
