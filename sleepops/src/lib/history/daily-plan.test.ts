import { describe, expect, it } from "vitest";
import { buildSleepSchedule } from "../sleep";
import {
  compareDailyPlan,
  createDailyPlanRecord,
  normalizeActualClockTime,
  parseDailyPlanHistory,
  planNightDateKey,
  recordDailyPlanActuals,
  saveDailyPlan,
  serializeDailyPlanHistory,
  type DailyPlanRecord,
} from "./daily-plan";

function buildRecord(
  date: string,
  workStart = "09:00",
  morningRoutineMinutes = 75,
): DailyPlanRecord {
  return createDailyPlanRecord({
    date,
    morningRoutineSource: "manual",
    schedule: buildSleepSchedule({
      workStart,
      morningRoutineMinutes,
      commuteBufferMinutes: 30,
    }),
  });
}

describe("daily plan records", () => {
  it("saves the compiled inputs and deadlines needed to reconstruct the day", () => {
    const record = createDailyPlanRecord({
      date: "2026-05-10",
      morningRoutineSource: "profiled",
      schedule: buildSleepSchedule({
        workStart: "09:00",
        morningRoutineMinutes: 75,
        commuteBufferMinutes: 30,
      }),
    });

    expect(record).toEqual({
      date: "2026-05-10",
      plan: {
        workStart: "09:00",
        requiredSleepMinutes: 540,
        morningRoutineMinutes: 75,
        morningRoutineSource: "profiled",
        commuteBufferMinutes: 30,
        wakeTime: "07:15",
        lightsOutTime: "22:15",
        shutdownStartTime: "21:30",
        shutdownMinutes: 45,
      },
      actuals: {
        shutdownStartTime: null,
        lightsOutTime: null,
        wakeTime: null,
        morningLaunch: null,
      },
    });
  });

  it("keeps the plan on the night the shutdown starts", () => {
    const clock = {
      dateKey: "2026-05-11",
      previousDateKey: "2026-05-10",
      wakeTime: "07:15",
    };

    expect(planNightDateKey({ ...clock, currentTime: "22:00" })).toBe(
      "2026-05-11",
    );
    expect(planNightDateKey({ ...clock, currentTime: "00:30" })).toBe(
      "2026-05-10",
    );
    expect(planNightDateKey({ ...clock, currentTime: "07:15" })).toBe(
      "2026-05-11",
    );
  });

  it("replaces a re-saved plan while keeping the recorded actuals", () => {
    const history = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10")),
      "2026-05-10",
      { wakeTime: "07:05" },
    );

    const updated = saveDailyPlan(history, buildRecord("2026-05-10", "10:00"));

    expect(updated).toHaveLength(1);
    expect(updated[0].plan.wakeTime).toBe("08:15");
    expect(updated[0].actuals.wakeTime).toBe("07:05");
  });

  it("keeps the most recent nights first and drops older ones", () => {
    const history = [
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
    ].reduce(
      (current, date) => saveDailyPlan(current, buildRecord(date)),
      [] as DailyPlanRecord[],
    );

    expect(history).toHaveLength(7);
    expect(history[0].date).toBe("2026-05-12");
    expect(history.at(-1)?.date).toBe("2026-05-06");
  });
});

describe("daily plan actuals", () => {
  it("normalizes a late or partially typed entry", () => {
    expect(normalizeActualClockTime("7:05")).toBe("07:05");
    expect(normalizeActualClockTime(" 07:05:30 ")).toBe("07:05");
    expect(normalizeActualClockTime("00:30")).toBe("00:30");
    expect(normalizeActualClockTime("")).toBeNull();
    expect(normalizeActualClockTime("24:00")).toBeNull();
    expect(normalizeActualClockTime("07:60")).toBeNull();
    expect(normalizeActualClockTime(null)).toBeNull();
  });

  it("merges corrections without clearing the fields left untouched", () => {
    const saved = saveDailyPlan([], buildRecord("2026-05-10"));
    const recorded = recordDailyPlanActuals(saved, "2026-05-10", {
      shutdownStartTime: "21:45",
      lightsOutTime: "22:40",
      wakeTime: "7:05",
      morningLaunch: "late",
    });

    expect(recorded[0].actuals).toEqual({
      shutdownStartTime: "21:45",
      lightsOutTime: "22:40",
      wakeTime: "07:05",
      morningLaunch: "late",
    });

    const corrected = recordDailyPlanActuals(recorded, "2026-05-10", {
      wakeTime: "06:50",
    });

    expect(corrected[0].actuals).toEqual({
      shutdownStartTime: "21:45",
      lightsOutTime: "22:40",
      wakeTime: "06:50",
      morningLaunch: "late",
    });

    const cleared = recordDailyPlanActuals(corrected, "2026-05-10", {
      wakeTime: "",
      morningLaunch: "unknown",
    });

    expect(cleared[0].actuals).toMatchObject({
      wakeTime: null,
      morningLaunch: null,
      lightsOutTime: "22:40",
    });
  });

  it("ignores actuals for a night without a saved plan", () => {
    const saved = saveDailyPlan([], buildRecord("2026-05-10"));

    expect(
      recordDailyPlanActuals(saved, "2026-05-09", { wakeTime: "07:00" }),
    ).toEqual(saved);
  });
});

describe("planned vs actual comparison", () => {
  it("compares an evening lights-out against a late night", () => {
    const record = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10")),
      "2026-05-10",
      {
        shutdownStartTime: "21:45",
        lightsOutTime: "22:40",
        wakeTime: "07:05",
      },
    )[0];

    expect(record.plan.lightsOutTime).toBe("22:15");
    expect(compareDailyPlan(record)).toEqual({
      plannedSleepMinutes: 540,
      actualSleepMinutes: 505,
      sleepDeltaMinutes: -35,
      plannedMorningMinutes: 105,
      actualMorningMinutes: 115,
      morningDeltaMinutes: 10,
      shutdownDeltaMinutes: 15,
      missedShutdown: true,
    });
  });

  it("compares a plan whose lights-out falls after midnight", () => {
    const record = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10", "12:00")),
      "2026-05-10",
      {
        shutdownStartTime: "00:20",
        lightsOutTime: "01:40",
        wakeTime: "10:00",
      },
    )[0];

    expect(record.plan).toMatchObject({
      shutdownStartTime: "00:30",
      lightsOutTime: "01:15",
      wakeTime: "10:15",
    });
    expect(compareDailyPlan(record)).toEqual({
      plannedSleepMinutes: 540,
      actualSleepMinutes: 500,
      sleepDeltaMinutes: -40,
      plannedMorningMinutes: 105,
      actualMorningMinutes: 120,
      morningDeltaMinutes: 15,
      shutdownDeltaMinutes: -10,
      missedShutdown: false,
    });
  });

  it("measures actual sleep that crosses midnight in both directions", () => {
    const beforeMidnight = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10")),
      "2026-05-10",
      { lightsOutTime: "23:50", wakeTime: "07:10" },
    )[0];
    const afterMidnight = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10", "12:00")),
      "2026-05-10",
      { lightsOutTime: "00:30", wakeTime: "06:45" },
    )[0];

    expect(compareDailyPlan(beforeMidnight).actualSleepMinutes).toBe(440);
    expect(compareDailyPlan(afterMidnight).actualSleepMinutes).toBe(375);
  });

  it("flags a shutdown started after midnight as missed", () => {
    const record = recordDailyPlanActuals(
      saveDailyPlan([], buildRecord("2026-05-10", "11:00")),
      "2026-05-10",
      { shutdownStartTime: "00:10" },
    )[0];

    expect(record.plan.shutdownStartTime).toBe("23:30");
    expect(compareDailyPlan(record)).toMatchObject({
      shutdownDeltaMinutes: 40,
      missedShutdown: true,
    });
  });

  it("reports missing actuals instead of guessing them", () => {
    const record = buildRecord("2026-05-10");

    expect(compareDailyPlan(record)).toEqual({
      plannedSleepMinutes: 540,
      actualSleepMinutes: null,
      sleepDeltaMinutes: null,
      plannedMorningMinutes: 105,
      actualMorningMinutes: null,
      morningDeltaMinutes: null,
      shutdownDeltaMinutes: null,
      missedShutdown: false,
    });
  });
});

describe("daily plan history persistence", () => {
  it("round-trips saved nights and their actuals", () => {
    const history = recordDailyPlanActuals(
      saveDailyPlan(saveDailyPlan([], buildRecord("2026-05-09")), buildRecord("2026-05-10")),
      "2026-05-10",
      { lightsOutTime: "22:40", morningLaunch: "on-time" },
    );

    expect(parseDailyPlanHistory(serializeDailyPlanHistory(history))).toEqual(
      history,
    );
  });

  it("drops unreadable stored history and records", () => {
    expect(parseDailyPlanHistory(null)).toEqual([]);
    expect(parseDailyPlanHistory("not json")).toEqual([]);
    expect(parseDailyPlanHistory(JSON.stringify({ version: 2, days: [] }))).toEqual(
      [],
    );

    const valid = buildRecord("2026-05-10");
    const stored = JSON.stringify({
      version: 1,
      days: [
        valid,
        { date: "not-a-date", plan: valid.plan, actuals: valid.actuals },
        { date: "2026-05-09", plan: { ...valid.plan, wakeTime: "99:99" } },
      ],
    });

    expect(parseDailyPlanHistory(stored)).toEqual([valid]);
  });
});
