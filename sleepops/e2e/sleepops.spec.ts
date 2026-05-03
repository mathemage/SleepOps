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
