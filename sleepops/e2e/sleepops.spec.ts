import { expect, test, type Page } from "playwright/test";

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

test("exposes installable PWA manifest metadata and icons", async ({
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);

  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: "SleepOps",
    short_name: "SleepOps",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      }),
      expect.objectContaining({
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      }),
    ]),
  );

  const iconResponse = await request.get("/apple-touch-icon.png");
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()["content-type"]).toContain("image/png");
});

test("persists the sleep contract and compressed routine inputs across reloads", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Work start time").fill("10:00");
  await page
    .getByRole("spinbutton", { name: "Morning routine duration" })
    .fill("60");
  await page
    .getByRole("spinbutton", { name: "Commute / buffer duration" })
    .fill("45");
  await page.getByLabel("Classify shower").selectOption("movable-evening");

  await page.reload();

  await expect(page.getByLabel("Work start time")).toHaveValue("10:00");
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveValue("60");
  await expect(
    page.getByRole("spinbutton", { name: "Commute / buffer duration" }),
  ).toHaveValue("45");
  await expect(page.getByLabel("Classify shower")).toHaveValue(
    "movable-evening",
  );
  await expect(page.getByText("Start shutdown by 22:15")).toBeVisible();
});

test("serves the main app shell after simulated offline cache conditions", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
  ).toBeVisible();

  await prepareOfflineAppShell(page);

  try {
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.clock.runFor(1000);

    await expect(
      page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
    ).toBeVisible();
    await expect(page.getByText("Start shutdown by 21:30")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Routine compressor" }))
      .toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("disables shutdown reminders when notification APIs are unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");

  const reminders = page.getByRole("region", { name: "Shutdown reminders" });
  await expect(reminders).toContainText(
    "Notifications are not supported in this browser.",
  );
  await expect(
    reminders.getByRole("button", { name: "Enable shutdown reminders" }),
  ).toBeDisabled();
});

test("keeps shutdown reminders pending while the service worker is still registering", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MockNotification {
      static permission = "default";
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: MockNotification,
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener() {},
        controller: null,
        getRegistration: () => Promise.resolve(undefined),
        ready: new Promise(() => {}),
        register: () => Promise.reject(new Error("blocked")),
        removeEventListener() {},
      },
    });
  });

  await page.goto("/");

  const reminders = page.getByRole("region", { name: "Shutdown reminders" });
  await expect(reminders).toContainText("Finishing notification setup.");
  await expect(
    reminders.getByRole("button", { name: "Enable shutdown reminders" }),
  ).toBeDisabled();
});

test("requests notification permission only from the reminder enable action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const readPermission = () => {
      try {
        return window.localStorage.getItem("sleepops.test.permission") ??
          "default";
      } catch {
        return "default";
      }
    };
    let permission = readPermission();
    const registration = {
      active: { postMessage() {} },
      installing: null,
      showNotification() {
        return Promise.resolve();
      },
      waiting: null,
    };

    class MockNotification {
      static get permission() {
        return permission;
      }

      static requestPermission() {
        window.__sleepopsPermissionRequests =
          (window.__sleepopsPermissionRequests ?? 0) + 1;
        permission = "granted";
        try {
          window.localStorage.setItem("sleepops.test.permission", permission);
        } catch {}
        return Promise.resolve(permission);
      }
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: MockNotification,
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener() {},
        controller: { postMessage() {} },
        getRegistration: () => Promise.resolve(registration),
        ready: Promise.resolve(registration),
        register: () => Promise.resolve(registration),
        removeEventListener() {},
      },
    });
    window.__sleepopsPermissionRequests = 0;
  });

  await page.goto("/");

  const reminders = page.getByRole("region", { name: "Shutdown reminders" });
  await expect(reminders).toContainText(
    "Enable reminders to be notified at shutdown start while SleepOps is open.",
  );
  await expect
    .poll(() => page.evaluate(() => window.__sleepopsPermissionRequests))
    .toBe(0);

  await reminders
    .getByRole("button", { name: "Enable shutdown reminders" })
    .click();

  await expect
    .poll(() => page.evaluate(() => window.__sleepopsPermissionRequests))
    .toBe(1);
  await expect(reminders).toContainText(
    "Reminder set for 21:30 while SleepOps is open.",
  );
  await expect(
    reminders.getByRole("button", { name: "Turn off reminders" }),
  ).toBeVisible();

  await page.reload();
  await expect(reminders).toContainText(
    "Reminder set for 21:30 while SleepOps is open.",
  );
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

test("shows active shutdown mode during the shutdown window even when overbooked", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-05-10T09:30:00Z"));
  await page.goto("/");

  await page.getByLabel("Work start time").fill("10:00");
  await page
    .getByRole("spinbutton", { name: "Morning routine duration" })
    .fill("840");
  await page
    .getByRole("spinbutton", { name: "Commute / buffer duration" })
    .fill("60");

  const assistant = page.getByRole("region", {
    name: "Evening shutdown assistant",
  });

  await expect(assistant).toBeVisible();
  await expect(assistant).toContainText(
    "Close laptop. Set the phone into Do Not Disturb mode.",
  );
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Routine compressor" }),
  ).toHaveCount(0);
});

test("loads directly into active shutdown mode during the default shutdown window", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-05-10T21:30:00Z"));
  await page.goto("/");

  const assistant = page.getByRole("region", {
    name: "Evening shutdown assistant",
  });

  await expect(assistant).toBeVisible();
  await expect(assistant).toContainText(
    "Close laptop. Set the phone into Do Not Disturb mode.",
  );
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveCount(0);
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
  await expect(page.getByText("Start shutdown by 21:25")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "07:40" }))
    .toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "22:40" }))
    .toBeVisible();
});

test("keeps moved tasks outside shutdown mode when they do not fit", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Minutes exercise").fill("60");
  await page.getByLabel("Classify exercise").selectOption("movable-evening");

  await expect(page.getByText("Shutdown duration").locator("..")).toContainText(
    "45m",
  );

  await page.getByRole("button", { name: "Preview shutdown mode" }).click();

  const assistant = page.getByRole("region", {
    name: "Evening shutdown assistant",
  });

  await assistant.getByRole("button", { name: "Done" }).click();

  await expect(assistant).not.toContainText("Do evening task: Ex(ercise)");
  await expect(assistant).toContainText("Dental care");
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
  await expect(assistant).toContainText(
    "Close laptop. Set the phone into Do Not Disturb mode.",
  );
  await expect(assistant).not.toContainText("Do evening task: Shower");
  await expect(
    page.getByRole("spinbutton", { name: "Morning routine duration" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Routine compressor" }),
  ).toHaveCount(0);

  await assistant.getByRole("button", { name: "Done" }).click();

  await expect(assistant).toContainText("Do evening task: Shower");
  await expect(assistant).not.toContainText(
    "Close laptop. Set the phone into Do Not Disturb mode.",
  );

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Prep for morning: Eat");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Dental care");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText("Toilet (Reading)");

  await assistant.getByRole("button", { name: "Done" }).click();
  await expect(assistant).toContainText(
    "Lights out (Headspace, Audible, podcasts)",
  );

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
  await expect(
    page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
  ).toBeVisible();

  while (await page.getByRole("button", { name: /Remove step/ }).count()) {
    await page.getByRole("button", { name: /Remove step/ }).first().click();
  }

  await expect(page.getByRole("button", { name: /Remove step/ })).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
  ).toBeVisible();

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

async function prepareOfflineAppShell(page: Page) {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are unavailable.");
    }

    await navigator.serviceWorker.ready;
  });

  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.clock.runFor(1000);
  await expect(
    page.getByRole("heading", { name: "Tonight's shutdown deadline" }),
  ).toBeVisible();

  await page.evaluate(async () => {
    const urls = new Set<string>();

    for (const entry of performance.getEntriesByType("resource")) {
      const url = new URL((entry as PerformanceResourceTiming).name);
      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/_next/static/")
      ) {
        urls.add(url.href);
      }
    }

    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active ?? navigator.serviceWorker.controller;
    worker?.postMessage({ urls: Array.from(urls) });

    const cacheName = (await caches.keys()).find((key) =>
      key.startsWith("sleepops-app-shell-"),
    );
    if (!cacheName) {
      throw new Error("SleepOps app shell cache was not created.");
    }

    const cache = await caches.open(cacheName);
    await Promise.all(
      Array.from(urls).map(async (url) => {
        try {
          await cache.add(url);
        } catch {}
      }),
    );
  });
}

declare global {
  interface Window {
    __sleepopsPermissionRequests?: number;
  }
}
