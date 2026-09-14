import { expect, test, type Locator, type Page } from "playwright/test";

const rail = (page: Page, id: string) => page.locator(`[data-rail-id="${id}"]`);
async function commit(input: Locator, value: string) {
  await input.fill(value);
  await input.blur();
}
async function expectTimes(page: Page, times: Record<string, string>, date = "2026-09-10") {
  for (const [id, time] of Object.entries(times)) {
    await expect(rail(page, id).locator("time")).toHaveAttribute("datetime", `${date}T${time}`);
    await expect(rail(page, id)).toContainText(time);
    await expect(rail(page, id)).toContainText(date);
  }
}
const defaults = {
  "caffeine-cutoff": "13:15", "nap-cutoff": "14:15",
  "shutdown-warning-30": "21:00", "screen-off": "21:15",
  "laptop-off": "21:15", "shutdown-warning-10": "21:20",
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-10T12:00:00Z"));
});

test("shows all six dated defaults with nap-end wording and one primary action", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expectTimes(page, defaults);
  await expect(page.locator("[data-rail-id]")).toHaveCount(6);
  await expect(rail(page, "nap-cutoff")).toContainText("Finish naps by");
  await expect(rail(page, "nap-cutoff")).toHaveAttribute("data-day-offset", "-1");
  await expect(rail(page, "nap-cutoff")).toHaveAttribute("data-minute-offset", "-585");
  await expect(rail(page, "nap-cutoff")).toContainText("Upcoming");
  await expect(page.getByText("Next action", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Start shutdown by 21:30", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tomorrow risk: low" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tonight timeline" })).toBeVisible();
  const section = page.getByRole("region", { name: "Daytime and evening guardrails" });
  await expect(section).toContainText("overnight block stays at 9h");
  await section.getByText("Why these defaults?").click();
  await expect(section).toContainText("product heuristic");
  await expect(section).toContainText("not a proven interval");
  await expect(section).toContainText("not clinically optimized");
  await expect(section).toContainText("about 100 mg");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("recalculates after work, routine and buffer edits and retains results on reload offline", async ({ page, context }) => {
  await page.goto("/");
  await commit(page.getByLabel("Work start time"), "10:00");
  await expectTimes(page, {
    "caffeine-cutoff": "14:15", "nap-cutoff": "15:15", "screen-off": "22:15",
    "laptop-off": "22:15", "shutdown-warning-30": "22:00", "shutdown-warning-10": "22:20",
  });
  await commit(page.getByRole("spinbutton", { name: "Morning routine duration", exact: true }), "90");
  await expectTimes(page, { "caffeine-cutoff": "14:00", "nap-cutoff": "15:00", "screen-off": "22:00" });
  await commit(page.getByRole("spinbutton", { name: "Commute / buffer duration", exact: true }), "45");
  const expected = {
    "caffeine-cutoff": "13:45", "nap-cutoff": "14:45", "screen-off": "21:45",
    "laptop-off": "21:45", "shutdown-warning-30": "21:30", "shutdown-warning-10": "21:50",
  };
  await expectTimes(page, expected);
  // Flush the app's pagehide persistence and wait for its existing offline shell.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expectTimes(page, expected);
  await context.setOffline(true);
  await page.reload();
  await expectTimes(page, expected);
  await expect(page.getByText("Start shutdown by 22:00", { exact: true })).toBeVisible();
});

test("shutdown-only edits keep bedtime rails fixed and switch the laptop bound", async ({ page }) => {
  await page.goto("/");
  await expectTimes(page, defaults);
  await page.getByLabel("Classify shower").selectOption("movable-evening");
  await expect(page.getByText("Start shutdown by 21:15", { exact: true })).toBeVisible();
  await expectTimes(page, { ...defaults, "shutdown-warning-30": "20:45", "shutdown-warning-10": "21:05" });
  await page.getByLabel("Classify exercise").selectOption("movable-evening");
  await expect(page.getByText("Start shutdown by 21:00", { exact: true })).toBeVisible();
  await expectTimes(page, { ...defaults, "laptop-off": "21:00", "shutdown-warning-30": "20:30", "shutdown-warning-10": "20:50" });
  await expect(page.getByRole("definition").filter({ hasText: "22:15" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Morning routine duration", exact: true })).toHaveValue("75");
});

test("uses the applied compressed morning for the rails", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Classify shower").selectOption("movable-evening");
  await page.getByLabel("Classify exercise").selectOption("movable-evening");
  await page.getByRole("button", { name: "Use compressed duration in tonight's schedule" }).click();
  await expect(page.getByRole("spinbutton", { name: "Morning routine duration", exact: true })).toHaveValue("80");
  await expectTimes(page, {
    "caffeine-cutoff": "13:10", "nap-cutoff": "14:10", "screen-off": "21:10",
    "laptop-off": "20:55", "shutdown-warning-30": "20:25", "shutdown-warning-10": "20:45",
  });
  await expect(page.getByText("Start shutdown by 20:55", { exact: true })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "22:10" })).toBeVisible();
});

test("labels midnight crossings and keeps passed cutoffs on the selected night", async ({ page }) => {
  await page.goto("/");
  await commit(page.getByLabel("Work start time"), "11:15");
  await expect(page.getByRole("definition").filter({ hasText: "00:30" })).toBeVisible();
  await expectTimes(page, { "caffeine-cutoff": "15:30", "nap-cutoff": "16:30", "screen-off": "23:30", "laptop-off": "23:30" });
  await commit(page.getByLabel("Work start time"), "11:45");
  await expectTimes(page, { "caffeine-cutoff": "16:00", "nap-cutoff": "17:00", "shutdown-warning-30": "23:45" });
  await expectTimes(page, { "screen-off": "00:00", "laptop-off": "00:00", "shutdown-warning-10": "00:05" }, "2026-09-11");
  await expect(rail(page, "screen-off")).toHaveAttribute("data-day-offset", "0");
  await page.clock.setFixedTime(new Date("2026-09-11T00:10:00Z"));
  await page.reload();
  await expectTimes(page, { "caffeine-cutoff": "16:00", "nap-cutoff": "17:00" });
  await expectTimes(page, { "screen-off": "00:00", "laptop-off": "00:00", "shutdown-warning-10": "00:05" }, "2026-09-11");
  await expect(rail(page, "nap-cutoff")).toContainText("Passed");
  await expect(rail(page, "screen-off")).toContainText("Passed");
  await expect(page.getByText("Start shutdown by 00:15", { exact: true })).toBeVisible();
});

test("warnings leave one next action until the active shutdown assistant takes over", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-10T21:00:00Z"));
  await page.goto("/");
  await expectTimes(page, defaults);
  await expect(rail(page, "shutdown-warning-30")).toContainText("Due now");
  await expect(page.getByText("Next action", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Start shutdown by 21:30", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-10T21:20:00Z"));
  await page.reload();
  await expectTimes(page, defaults);
  await expect(page.getByText("Start shutdown by 21:30", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-10T21:30:00Z"));
  await page.reload();
  const assistant = page.getByRole("region", { name: "Evening shutdown assistant" });
  await expect(assistant).toBeVisible();
  await expect(assistant.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(assistant).toContainText("Action 1 of");
  await expect(page.locator("[data-rail-id]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Tomorrow risk", exact: true })).toHaveCount(0);
});
