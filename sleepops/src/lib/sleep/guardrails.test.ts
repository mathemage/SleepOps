import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGuardrails, guardrailStatus } from "./guardrails";
import { buildSleepSchedule, type SleepScheduleInput } from "./schedule";
import { compressMorningRoutine } from "../routine/compressor";
import { planNightDateKey } from "../history/daily-plan";

const input = { workStart: "09:00", morningRoutineMinutes: 75, commuteBufferMinutes: 30 };
const night = "2026-09-10";
function rails(overrides: Partial<SleepScheduleInput> = {}, date = night) {
  return buildGuardrails(buildSleepSchedule({ ...input, ...overrides }), date);
}
function byId(overrides: Partial<SleepScheduleInput> = {}) {
  return Object.fromEntries(rails(overrides).map((rail) => [rail.id, rail]));
}

afterEach(() => vi.useRealTimers());

describe("compiled guardrails", () => {
  it("matches every occurrence in the 09:00 worked example, ordered by time", () => {
    expect(rails()).toEqual([
      { id: "caffeine-cutoff", minuteOffset: -645, dayOffset: -1, date: night, time: "13:15" },
      { id: "nap-cutoff", minuteOffset: -585, dayOffset: -1, date: night, time: "14:15" },
      { id: "shutdown-warning-30", minuteOffset: -180, dayOffset: -1, date: night, time: "21:00" },
      { id: "screen-off", minuteOffset: -165, dayOffset: -1, date: night, time: "21:15" },
      { id: "laptop-off", minuteOffset: -165, dayOffset: -1, date: night, time: "21:15" },
      { id: "shutdown-warning-10", minuteOffset: -160, dayOffset: -1, date: night, time: "21:20" },
    ]);
    const schedule = buildSleepSchedule(input);
    expect(schedule.timeline).toEqual({ workStart: 540, wake: 435, lightsOut: -105, shutdown: -150 });
    expect(schedule.timeline.wake - schedule.timeline.lightsOut).toBe(540);
  });

  it.each([
    [{ workStart: "10:00" }, 60],
    [{ morningRoutineMinutes: 90 }, -15],
    [{ commuteBufferMinutes: 45 }, -15],
    [{ requiredSleepMinutes: 600 }, -60],
  ] as const)("moves all rails only by the bedtime change %j", (change, delta) => {
    const before = byId();
    for (const rail of rails(change)) {
      expect(rail.minuteOffset - before[rail.id].minuteOffset).toBe(delta);
    }
  });

  it("matches the 10:00 worked example", () => {
    expect(rails({ workStart: "10:00" }).map(({ time }) => time)).toEqual([
      "14:15", "15:15", "22:00", "22:15", "22:15", "22:20",
    ]);
  });

  it.each([45, 59, 60, 61, 75])("keeps bedtime rails fixed with %i minutes of shutdown", (shutdownMinutes) => {
    const before = byId();
    const after = byId({ shutdownMinutes });
    for (const id of ["caffeine-cutoff", "nap-cutoff", "screen-off"]) {
      expect(after[id]).toEqual(before[id]);
    }
    for (const id of ["shutdown-warning-30", "shutdown-warning-10"]) {
      expect(after[id].minuteOffset - before[id].minuteOffset).toBe(45 - shutdownMinutes);
    }
    expect(after["laptop-off"].minuteOffset).toBe(shutdownMinutes <= 60 ? -165 : -105 - shutdownMinutes);
    expect(buildSleepSchedule({ ...input, shutdownMinutes }).latestBedtime).toBe("22:15");
  });

  it("matches the 75-minute shutdown example and retains both equal-time IDs", () => {
    expect(rails({ shutdownMinutes: 75 }).map(({ id, time }) => [id, time])).toEqual([
      ["caffeine-cutoff", "13:15"], ["nap-cutoff", "14:15"],
      ["shutdown-warning-30", "20:30"], ["shutdown-warning-10", "20:50"],
      ["laptop-off", "21:00"], ["screen-off", "21:15"],
    ]);
    expect(new Set(rails().map(({ id }) => id)).size).toBe(6);
  });

  it("uses the applied compressed routine from the compiler", () => {
    const compression = compressMorningRoutine({
      steps: [
        { id: "wake", label: "Wake", classification: "required-morning" },
        { id: "shower", label: "Shower", classification: "movable-evening" },
      ], days: [],
    }, { wake: 50, shower: 25 });
    const schedule = buildSleepSchedule({ ...input, morningRoutineMinutes: compression.minimumMorningMinutes, shutdownMinutes: 70 });
    expect(schedule.timeline.wake - schedule.timeline.lightsOut).toBe(540);
    expect(buildGuardrails(schedule, night).find(({ id }) => id === "nap-cutoff")?.time).toBe("14:40");
    expect(buildGuardrails(schedule, night).find(({ id }) => id === "laptop-off")?.time).toBe("21:30");
  });

  it("keeps 00:30 bedtime cutoffs on the previous date", () => {
    const schedule = buildSleepSchedule({ ...input, workStart: "11:15" });
    expect(schedule.latestBedtime).toBe("00:30");
    expect(schedule.timeline.lightsOut).toBe(30);
    for (const [id, time] of [["caffeine-cutoff", "15:30"], ["nap-cutoff", "16:30"], ["screen-off", "23:30"]]) {
      expect(buildGuardrails(schedule, night).find((rail) => rail.id === id)).toMatchObject({ date: night, dayOffset: -1, time });
    }
  });

  it("compares laptop bounds by occurrence when shutdown is after midnight", () => {
    const result = byId({ workStart: "11:45" });
    expect(result["screen-off"].time).toBe("00:00");
    expect(result["laptop-off"]).toMatchObject({ time: "00:00", date: "2026-09-11", dayOffset: 0 });
    // At 00:50 bedtime, screen-off 23:50 precedes shutdown 00:05.
    expect(byId({ workStart: "11:35" })["laptop-off"]).toMatchObject({ time: "23:50", date: night, dayOffset: -1 });
  });

  it.each(["2026-12-31", "2028-02-28", "2026-03-28", "2026-10-24"])("retains calendar offsets at boundaries on %s", (date) => {
    const rail = rails({ workStart: "11:45" }, date).find(({ id }) => id === "screen-off")!;
    const expected = { "2026-12-31": "2027-01-01", "2028-02-28": "2028-02-29", "2026-03-28": "2026-03-29", "2026-10-24": "2026-10-25" };
    expect(rail.date).toBe(expected[date as keyof typeof expected]);
    expect(rail.time).toBe("00:00");
  });

  it("does not lose multiple negative days on an overfull plan", () => {
    const result = rails({ morningRoutineMinutes: 1800, commuteBufferMinutes: 60 });
    expect(result.find(({ id }) => id === "caffeine-cutoff")).toMatchObject({ minuteOffset: -2400, dayOffset: -2, date: "2026-09-09", time: "08:00" });
  });

  it("retains passed rails on the selected plan before and after midnight", () => {
    vi.useFakeTimers();
    const before = rails();
    for (const now of ["2026-09-10T23:00:00Z", "2026-09-11T00:10:00Z"]) {
      vi.setSystemTime(new Date(now));
      const dateKey = now.slice(0, 10);
      const selectedNight = planNightDateKey({ dateKey, previousDateKey: dateKey === night ? "2026-09-09" : night, currentTime: now.slice(11, 16), wakeTime: "07:15" });
      expect(rails({}, selectedNight)).toEqual(before);
    }
  });

  it("derives rails from compiled minutes without mutating the protected plan", () => {
    const schedule = buildSleepSchedule(input);
    const before = structuredClone(schedule);
    buildGuardrails(schedule, night);
    expect(schedule).toEqual(before);
    expect(schedule.requiredSleepMinutes).toBe(540);
  });

  it.each([
    ["2026-09-10", "14:14", "Upcoming"],
    ["2026-09-10", "14:15", "Due now"],
    ["2026-09-10", "14:16", "Passed"],
    ["2026-09-11", "00:00", "Passed"],
    ["2026-09-09", "23:59", "Upcoming"],
  ])("preserves elapsed status at %s %s", (date, time, expected) => {
    const nap = byId()["nap-cutoff"];
    expect(guardrailStatus(nap, { date, time })).toBe(expected);
    expect(nap).toMatchObject({ date: night, time: "14:15" });
  });
});
