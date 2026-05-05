import { expect, test } from "playwright/test";

test("compiles the default 9-5 sleep contract", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tonight's shutdown deadline" })).toBeVisible();
  await expect(page.getByText("Start shutdown by 21:30")).toBeVisible();
  await expect(page.getByText("Wake time")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "07:15" })).toBeVisible();
  await expect(page.getByText("Latest bedtime")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "22:15" })).toBeVisible();
});

test("recalculates for a 10-6 day and warns on impossible input", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Work start time").fill("10:00");

  await expect(page.getByText("Start shutdown by 22:30")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "08:15" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "23:15" })).toBeVisible();

  await page
    .getByRole("spinbutton", { name: "Morning routine duration" })
    .fill("840");
  await page
    .getByRole("spinbutton", { name: "Commute / buffer duration" })
    .fill("60");

  const constraintAlert = page.locator("main").getByRole("alert");

  await expect(constraintAlert).toContainText("Constraint violated");
  await expect(constraintAlert).toContainText("Reduce the plan by 45m");
});

test("normalizes typed duration values to the allowed range and step", async ({
  page,
}) => {
  await page.goto("/");

  const morningRoutine = page.getByRole("spinbutton", {
    name: "Morning routine duration",
  });
  const commuteBuffer = page.getByRole("spinbutton", {
    name: "Commute / buffer duration",
  });

  await morningRoutine.fill("842");
  await commuteBuffer.fill("999");

  await expect(morningRoutine).toHaveValue("840");
  await expect(commuteBuffer).toHaveValue("240");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Reduce the plan by 3h 45m",
  );
});

test("records step durations, persists them, and feeds the measured total into the sleep contract", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("textbox", { name: "Day" })).toHaveValue(
    /\d{4}-\d{2}-\d{2}/,
  );

  await page.getByLabel("Minutes wake").fill("60");
  await page.getByLabel("Minutes hygiene").fill("45");
  await page.getByLabel("Minutes out").fill("15");

  await expect(page.getByRole("list", { name: "Top time leaks" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Top time leaks" })).toContainText(
    "Wake + bathroom",
  );

  await page.reload();

  await expect(page.getByRole("list", { name: "Top time leaks" })).toContainText(
    "Hygiene",
  );

  await page.getByLabel(/Use measured 7-day average/).check();

  await expect(page.getByText("Start shutdown by 20:45")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "06:30" })).toBeVisible();

  await page.getByLabel("Minutes wake").fill("0");
  await page.getByLabel("Minutes hygiene").fill("0");
  await page.getByLabel("Minutes out").fill("0");

  const measuredAverage = page.getByLabel(/Use measured 7-day average/);
  await expect(measuredAverage).not.toBeChecked();
  await expect(measuredAverage).toBeDisabled();
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toBeEnabled();
});

test("keeps an intentionally empty routine step list across reloads", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Remove step wake" }).click();
  await page.getByRole("button", { name: "Remove step meds" }).click();
  await page.getByRole("button", { name: "Remove step hygiene" }).click();
  await page.getByRole("button", { name: "Remove step clothes" }).click();
  await page.getByRole("button", { name: "Remove step out" }).click();

  await expect(page.getByRole("button", { name: /Remove step/ })).toHaveCount(0);

  await page.reload();

  await expect(page.getByRole("button", { name: /Remove step/ })).toHaveCount(0);
});
