import { expect, test, type Locator, type Page } from "playwright/test";

test.use({ locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-05-10T12:00:00Z") });
  await page.goto("/");
  await expect(page.getByLabel("Minutes wake")).toHaveValue("15");
});

async function clearWithKeyboard(input: Locator) {
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
}

async function storedProfiler(page: Page) {
  return page.evaluate(() => JSON.parse(
    localStorage.getItem("sleepops.morningRoutineProfiler.v1") ?? "null",
  ));
}

test("profiler allows clearing, multi-digit typing, cancellation and persistent commits", async ({ page }) => {
  const minutes = page.getByLabel("Minutes wake");
  const saved = await storedProfiler(page);
  await clearWithKeyboard(minutes);
  await expect(minutes).toHaveValue("");
  await minutes.pressSequentially("12");
  await expect(minutes).toHaveValue("12");
  expect(await storedProfiler(page)).toEqual(saved);
  await page.clock.fastForward(31_000);
  await expect(minutes).toBeFocused();
  await expect(minutes).toHaveValue("12");
  await minutes.press("Enter");
  await expect.poll(() => storedProfiler(page)).toMatchObject({
    days: [{ date: "2026-05-10", minutesByStepId: { wake: 12 } }],
  });
  await clearWithKeyboard(minutes);
  await minutes.pressSequentially("30");
  await minutes.press("Escape");
  await expect(minutes).toHaveValue("12");
  await minutes.press("Tab");
  await page.reload();
  await expect(minutes).toHaveValue("12");
});

test("duration digits are preserved until Tab or Enter and sliders stay synchronized", async ({ page }) => {
  for (const label of ["Morning routine duration", "Commute / buffer duration"]) {
    const input = page.getByRole("spinbutton", { name: label, exact: true });
    const slider = page.getByRole("slider", { name: `${label} slider` });
    await clearWithKeyboard(input);
    await expect(input).toHaveValue("");
    await input.pressSequentially("12");
    await expect(input).toHaveValue("12");
    await input.press("Tab");
    await expect(input).toHaveValue("10");
    await expect(slider).toHaveValue("10");
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(input).toHaveValue("15");
    await clearWithKeyboard(input);
    await input.pressSequentially("60");
    await input.press("Enter");
    await expect(input).toHaveValue("60");
  }
  await page.clock.fastForward(300);
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Morning routine duration", exact: true })).toHaveValue("60");
  await expect(page.getByRole("spinbutton", { name: "Commute / buffer duration", exact: true })).toHaveValue("60");
});

test("number edits preserve decimals and invalid drafts, and distinguish blank from zero", async ({ page }) => {
  const input = page.getByLabel("Minutes wake");
  await clearWithKeyboard(input);
  await input.pressSequentially("12.5");
  await expect(input).toHaveValue("12.5");
  await input.press("Tab");
  await expect(input).toHaveValue("13");
  await clearWithKeyboard(input);
  await input.press("Tab");
  await expect(input).toHaveValue("13");
  await clearWithKeyboard(input);
  await input.pressSequentially("-");
  await input.press("Tab");
  await expect(input).toHaveValue("13");
  await clearWithKeyboard(input);
  await input.pressSequentially("9999");
  await expect(input).toHaveValue("9999");
  await input.press("Enter");
  await expect(input).toHaveValue("900");
  await clearWithKeyboard(input);
  await input.pressSequentially("0");
  await input.press("Tab");
  await expect(input).toHaveValue("0");
});

test("step names retain spaces, caret, and focus across clock updates", async ({ page }) => {
  const name = page.getByLabel("Step name wake");
  await clearWithKeyboard(name);
  await name.pressSequentially("Morning routine");
  await name.press("Home");
  await name.pressSequentially("My ");
  await page.clock.fastForward(31_000);
  await expect(name).toBeFocused();
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(3);
  await name.pressSequentially("daily ");
  await expect(name).toHaveValue("My daily Morning routine");
  await name.press("Enter");
  await page.reload();
  await expect(name).toHaveValue("My daily Morning routine");
  const newName = page.getByLabel("New step name");
  await newName.pressSequentially("Coffee break");
  await newName.press("Enter");
  await expect(page.locator('input[type="text"][value="Coffee break"]')).toBeVisible();
});

test("work time can be retyped by segment without saving midnight", async ({ page }) => {
  const time = page.getByLabel("Work start time");
  await time.focus();
  await time.press("ArrowLeft");
  await time.press("ArrowLeft");
  await time.press("Backspace");
  await expect(time).toHaveValue("");
  await expect(page.getByText("Start shutdown by 21:30")).toBeVisible();
  await page.clock.fastForward(31_000);
  await time.pressSequentially("10");
  await time.pressSequentially("30");
  await time.press("Enter");
  await expect(time).toHaveValue("10:30");
  await expect(page.getByText("Start shutdown by 23:00")).toBeVisible();
});

test("date edits do not switch recorded days until committed", async ({ page }) => {
  const day = page.getByLabel("Day", { exact: true });
  await day.focus();
  await day.press("ArrowRight");
  await day.press("ArrowRight");
  await day.press("ArrowRight");
  await day.press("Backspace");
  await expect(day).toHaveValue("");
  await day.pressSequentially("2026");
  await expect(day).toHaveValue("2026-05-10");
  await day.press("Enter");
  await day.fill("");
  await expect(day).toHaveValue("");
  await page.clock.fastForward(31_000);
  await expect(day).toHaveValue("");
  await day.press("Escape");
  await expect(day).toHaveValue("2026-05-10");
  await day.fill("2026-05-09");
  await day.press("Enter");
  const minutes = page.getByLabel("Minutes wake");
  await clearWithKeyboard(minutes);
  await minutes.pressSequentially("23");
  await minutes.press("Tab");
  await day.fill("2026-05-10");
  await day.press("Enter");
  await expect(minutes).toHaveValue("15");
  await day.fill("2026-05-09");
  await day.press("Enter");
  await expect(minutes).toHaveValue("23");
});

test("wake targets and optional recorded times support segment edits and deliberate clearing", async ({ page }) => {
  const target = page.getByLabel("Wake target");
  await target.fill("07:15");
  await target.press("Enter");
  await target.focus();
  await target.press("ArrowLeft");
  await target.press("ArrowLeft");
  await target.press("Backspace");
  await expect(target).toHaveValue("");
  await page.clock.fastForward(31_000);
  await expect(target).toHaveValue("");
  await target.pressSequentially("08");
  await target.press("Enter");
  await expect(target).toHaveValue("08:15");
  await target.fill("");
  await target.blur();
  await expect(target).toHaveValue("08:15");

  await page.getByRole("button", { name: "Save tonight's plan" }).click();
  const actual = page.getByLabel("Actual lights out");
  await actual.fill("22:15");
  await actual.press("Enter");
  await actual.focus();
  await actual.press("ArrowLeft");
  await actual.press("ArrowLeft");
  await actual.press("Backspace");
  await expect(actual).toHaveValue("");
  await page.clock.fastForward(31_000);
  await actual.pressSequentially("11");
  await actual.press("Enter");
  await expect(actual).toHaveValue("23:15");
  await page.reload();
  await expect(actual).toHaveValue("23:15");
  await actual.fill("");
  await actual.blur();
  await page.reload();
  await expect(actual).toHaveValue("");
});
