import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-05-10T12:00:00Z"));
});

test("compiles the default 9-5 sleep contract", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tonight's shutdown deadline" })).toBeVisible();
  await expect(
    page.getByText(
      "SleepOps turns that into tonight's shutdown time, bedtime, and wake-up plan.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Start shutdown by 21:30")).toBeVisible();
  await expect(page.getByText("Wake time")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "07:15" })).toBeVisible();
  await expect(page.getByText("Latest bedtime")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "22:15" })).toBeVisible();
  await expect(page.getByText("Free time left today")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tonight timeline" })).toBeVisible();
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
  await expect(page.getByText("Overbooked by")).toBeVisible();
  await expect(page.getByText("Overbooked by").locator("..")).toContainText("45m");
  await expect(
    page.getByText("Your shutdown-and-sleep window no longer fits before work."),
  ).toBeVisible();
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

test("shows the updated default morning routine step labels and durations", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByLabel("Step name toilet")).toHaveValue(
    "Commute/Post-morning",
  );
  await expect(page.getByLabel("Minutes wake")).toHaveValue("15");
  await expect(page.getByLabel("Minutes wc")).toHaveValue("15");
  await expect(page.getByLabel("Minutes toilet")).toHaveValue("20");
  await expect(page.getByText("Day total")).toBeVisible();
  await expect(page.getByText("Day total").locator("..")).toContainText(
    "1h 50m",
  );
});

test("does not add default minutes for custom steps before they are recorded", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("New step name").fill("Coffee");
  await page.getByRole("button", { name: "Add step" }).click();

  await expect(page.locator('input[type="text"][value="Coffee"]')).toBeVisible();
  await expect(page.locator('input[aria-label^="Minutes "]').last()).toHaveValue("0");
  await expect(page.getByText("Day total").locator("..")).toContainText(
    "1h 50m",
  );
});

test("compresses classified routine tasks and applies the minimum morning", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Minutes wake").fill("10");
  await page.getByLabel("Minutes wc").fill("5");
  await page.getByLabel("Minutes exercise").fill("20");
  await page.getByLabel("Minutes shower").fill("15");
  await page.getByLabel("Minutes eat").fill("10");
  await page.getByLabel("Minutes brush-teeth").fill("5");
  await page.getByLabel("Minutes toilet").fill("30");

  await page.getByLabel("Classify exercise").selectOption("movable-evening");
  await page.getByLabel("Classify shower").selectOption("movable-evening");
  await page.getByLabel("Classify eat").selectOption("decision-setup");

  const compressor = page.getByRole("region", { name: "Routine compressor" });

  await expect(
    compressor.getByRole("list", { name: "Minimum viable morning tasks" }),
  ).toContainText("Wake (boot up)");
  await expect(
    compressor.getByRole("list", { name: "Moved evening tasks" }),
  ).toContainText("Ex(ercise)");
  await expect(
    compressor.getByRole("list", { name: "Moved evening tasks" }),
  ).toContainText("Shower");
  await expect(
    compressor.getByRole("list", { name: "Tonight's prep tasks" }),
  ).toContainText("Eat");
  await expect(compressor).toContainText(
    "Mark each step as required in the morning, movable to the evening, or something you can prep tonight ahead of time.",
  );
  await expect(page.getByLabel("Classify eat")).toHaveValue("decision-setup");
  await expect(page.getByLabel("Classify eat")).toContainText("Prep tonight");
  await expect(compressor).toContainText("Compressed morning duration");
  await expect(compressor).toContainText("50m");

  await page
    .getByRole("button", {
      name: "Use compressed duration in tonight's schedule",
    })
    .click();

  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveValue("50");
  await expect(page.getByText("Start shutdown by 21:55")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "07:40" }))
    .toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "22:40" }))
    .toBeVisible();
});

test("previews shutdown mode and advances one physical action at a time", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Classify shower").selectOption("movable-evening");
  await page.getByLabel("Classify eat").selectOption("decision-setup");

  await page.getByRole("button", { name: "Preview shutdown mode" }).click();

  const assistant = page.getByRole("region", {
    name: "Evening shutdown assistant",
  });

  await expect(assistant).toBeVisible();
  await expect(assistant).toContainText("Close laptop and put it away.");
  await expect(assistant).not.toContainText("Do evening task: Shower");
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Routine compressor" }),
  ).toHaveCount(0);

  await assistant.getByRole("button", { name: "Done" }).click();

  await expect(assistant).toContainText("Do evening task: Shower");
  await expect(assistant).not.toContainText("Close laptop and put it away.");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Prep for morning: Eat");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Brush teeth.");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Get in bed and turn lights out.");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Lights out");
  await expect(assistant).toContainText("Shutdown complete. Go to bed now.");

  await assistant.getByRole("button", { name: "Back to planning" }).click();

  await expect(
    page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
  ).toBeVisible();
});

test("includes displayed fallback minutes in the day total for older stored days", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const today = new Date();
    const dateKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    window.localStorage.setItem(
      "sleepops.morningRoutineProfiler.v1",
      JSON.stringify({
        steps: [
          { id: "wake", label: "Wake (boot up)" },
          { id: "wc", label: "WC" },
          { id: "exercise", label: "Ex(ercise)" },
          { id: "shower", label: "Shower" },
          { id: "eat", label: "Eat" },
          { id: "brush-teeth", label: "Brush Teeth" },
          { id: "toilet", label: "Commute/Post-morning" },
        ],
        days: [{ date: dateKey, minutesByStepId: { wake: 20 } }],
      }),
    );
  });

  await page.goto("/");

  await expect(page.getByLabel("Minutes wake")).toHaveValue("20");
  await expect(page.getByLabel("Minutes wc")).toHaveValue("15");
  await expect(page.getByLabel("Minutes toilet")).toHaveValue("20");
  await expect(page.getByText("Day total").locator("..")).toContainText(
    "1h 55m",
  );
});

test("records step durations, persists them, and feeds the measured total into the sleep contract", async ({
  page,
}) => {
  await page.goto("/");

  const dayInput = page.getByRole("textbox", { name: "Day" });

  await expect(dayInput).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expect(dayInput).toHaveAttribute("min", /\d{4}-\d{2}-\d{2}/);
  await expect(dayInput).toHaveAttribute("max", /\d{4}-\d{2}-\d{2}/);

  const retainedStartKey = await dayInput.getAttribute("min");
  await dayInput.fill("2000-01-01");
  await expect(dayInput).toHaveValue(retainedStartKey!);

  await page.getByLabel("Minutes wc").fill("0");
  await page.getByLabel("Minutes exercise").fill("0");
  await page.getByLabel("Minutes wake").fill("60");
  await page.getByLabel("Minutes shower").fill("45");
  await page.getByLabel("Minutes eat").fill("15");
  await page.getByLabel("Minutes brush-teeth").fill("0");
  await page.getByLabel("Minutes toilet").fill("0");

  await expect(page.getByRole("list", { name: "Top time leaks" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Top time leaks" })).toContainText(
    "Wake (boot up)",
  );

  await page.reload();

  await expect(page.getByRole("list", { name: "Top time leaks" })).toContainText(
    "Shower",
  );

  await page.getByLabel(/Use measured 7-day average/).check();

  await expect(page.getByText("Start shutdown by 20:45")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "06:30" })).toBeVisible();

  await page.getByRole("textbox", { name: "Day" }).fill(retainedStartKey!);
  await page.getByLabel("Minutes wc").fill("0");
  await page.getByLabel("Minutes exercise").fill("0");
  await page.getByLabel("Minutes wake").fill("0");
  await page.getByLabel("Minutes shower").fill("0");
  await page.getByLabel("Minutes eat").fill("0");
  await page.getByLabel("Minutes brush-teeth").fill("0");
  await page.getByLabel("Minutes toilet").fill("0");

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

  while (await page.getByRole("button", { name: /Remove step/ }).count()) {
    await page.getByRole("button", { name: /Remove step/ }).first().click();
  }

  await expect(page.getByRole("button", { name: /Remove step/ })).toHaveCount(0);

  await page.reload();

  await expect(page.getByRole("button", { name: /Remove step/ })).toHaveCount(0);
});

test("keeps the profiler usable when browser storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tonight's shutdown deadline" })).toBeVisible();

  await page.getByLabel("Minutes wake").fill("20");

  await expect(page.getByRole("list", { name: "Top time leaks" })).toContainText(
    "Wake (boot up)",
  );
});
