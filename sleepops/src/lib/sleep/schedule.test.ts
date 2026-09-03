import { describe, expect, it } from "vitest";
import {
  buildSleepSchedule,
  clockOffsetMinutes,
  formatClockTime,
  formatDuration,
  minutesBetweenClockTimes,
  parseClockTime,
} from "./schedule";

describe("sleep scheduling", () => {
  it("compiles the 9-5 example into wake, bedtime, and shutdown times", () => {
    const schedule = buildSleepSchedule({
      workStart: "09:00",
      morningRoutineMinutes: 75,
      commuteBufferMinutes: 30,
    });

    expect(schedule).toMatchObject({
      wakeTime: "07:15",
      latestBedtime: "22:15",
      shutdownStartTime: "21:30",
      protectedBlockMinutes: 690,
      availableFlexMinutes: 750,
      constraintWarning: null,
    });
  });

  it("compiles the 10-6 example one hour later", () => {
    const schedule = buildSleepSchedule({
      workStart: "10:00",
      morningRoutineMinutes: 75,
      commuteBufferMinutes: 30,
    });

    expect(schedule.wakeTime).toBe("08:15");
    expect(schedule.latestBedtime).toBe("23:15");
    expect(schedule.shutdownStartTime).toBe("22:30");
  });

  it("warns when the protected block cannot fit inside one day", () => {
    const schedule = buildSleepSchedule({
      workStart: "09:00",
      morningRoutineMinutes: 840,
      commuteBufferMinutes: 60,
      shutdownMinutes: 60,
    });

    expect(schedule.availableFlexMinutes).toBe(-60);
    expect(schedule.constraintWarning).toBe("Reduce the plan by 1h.");
  });

  it("parses, formats, and wraps clock times across midnight", () => {
    expect(parseClockTime("23:45")).toBe(1425);
    expect(formatClockTime(-105)).toBe("22:15");
    expect(formatClockTime(24 * 60 + 30)).toBe("00:30");
    expect(formatDuration(750)).toBe("12h 30m");
    expect(formatDuration(-30)).toBe("-30m");
  });

  it("measures the forward distance between clock times across midnight", () => {
    expect(minutesBetweenClockTimes("22:15", "07:15")).toBe(540);
    expect(minutesBetweenClockTimes("00:30", "09:30")).toBe(540);
    expect(minutesBetweenClockTimes("23:50", "00:10")).toBe(20);
    expect(minutesBetweenClockTimes("00:10", "23:50")).toBe(1420);
    expect(minutesBetweenClockTimes("07:15", "07:15")).toBe(0);
  });

  it("signs clock offsets as early or late across midnight", () => {
    expect(clockOffsetMinutes("21:30", "21:45")).toBe(15);
    expect(clockOffsetMinutes("21:45", "21:30")).toBe(-15);
    expect(clockOffsetMinutes("23:50", "00:10")).toBe(20);
    expect(clockOffsetMinutes("00:10", "23:50")).toBe(-20);
  });

  it("resolves a half-day offset as late in both directions", () => {
    expect(clockOffsetMinutes("21:30", "09:30")).toBe(720);
    expect(clockOffsetMinutes("09:30", "21:30")).toBe(720);
  });

  it("rejects invalid schedule inputs", () => {
    expect(() => parseClockTime("24:00")).toThrow(RangeError);
    expect(() =>
      buildSleepSchedule({
        workStart: "09:00",
        morningRoutineMinutes: -1,
        commuteBufferMinutes: 30,
      }),
    ).toThrow(RangeError);
  });

  it("owns shutdown duration validation for the 45-75 minute window", () => {
    expect(() =>
      buildSleepSchedule({
        workStart: "09:00",
        morningRoutineMinutes: 75,
        commuteBufferMinutes: 30,
        shutdownMinutes: 44,
      }),
    ).toThrow(RangeError);

    expect(() =>
      buildSleepSchedule({
        workStart: "09:00",
        morningRoutineMinutes: 75,
        commuteBufferMinutes: 30,
        shutdownMinutes: 76,
      }),
    ).toThrow(RangeError);

    expect(
      buildSleepSchedule({
        workStart: "09:00",
        morningRoutineMinutes: 75,
        commuteBufferMinutes: 30,
        shutdownMinutes: 75,
      }).shutdownStartTime,
    ).toBe("21:00");
  });
});
