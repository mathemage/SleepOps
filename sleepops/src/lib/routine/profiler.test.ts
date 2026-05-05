import { describe, expect, it } from "vitest";
import {
  addStep,
  createDefaultMorningRoutineProfiler,
  measuredMorningRoutineMinutes,
  pruneToLastNDays,
  setStepMinutesForDay,
  topTimeLeaks,
  totalMinutesForDay,
} from "./profiler";

describe("morning routine profiler", () => {
  it("retains only the last 7 days (inclusive) in date order", () => {
    const days = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, "0")}`,
      minutesByStepId: { wake: 1 },
    }));

    const pruned = pruneToLastNDays(days, "2026-05-10", 7);

    expect(pruned).toHaveLength(7);
    expect(pruned[0]?.date).toBe("2026-05-04");
    expect(pruned[6]?.date).toBe("2026-05-10");
  });

  it("records step minutes per day and reports that day's total", () => {
    const profiler = createDefaultMorningRoutineProfiler();
    const todayKey = "2026-05-05";

    const next = setStepMinutesForDay(
      profiler,
      todayKey,
      "wake",
      7,
      todayKey,
      7,
    );

    const next2 = setStepMinutesForDay(next, todayKey, "meds", 3, todayKey, 7);

    expect(totalMinutesForDay(next2, todayKey)).toBe(10);
  });

  it("computes a 7-day average measured total with deterministic rounding", () => {
    const profiler = createDefaultMorningRoutineProfiler();
    const todayKey = "2026-05-07";

    const withDay1 = setStepMinutesForDay(
      profiler,
      "2026-05-06",
      "wake",
      72,
      todayKey,
      7,
    );
    const withDay2 = setStepMinutesForDay(
      withDay1,
      "2026-05-07",
      "wake",
      78,
      todayKey,
      7,
    );

    expect(measuredMorningRoutineMinutes(withDay2, todayKey, 7, 5)).toBe(75);
  });

  it("returns null when there is no measured data", () => {
    const profiler = createDefaultMorningRoutineProfiler();
    expect(measuredMorningRoutineMinutes(profiler, "2026-05-05", 7, 5)).toBe(
      null,
    );
  });

  it("identifies the top leaks by total minutes with stable tie-breaking", () => {
    const todayKey = "2026-05-05";
    let profiler = createDefaultMorningRoutineProfiler();
    profiler = addStep(profiler, { id: "coffee", label: "Coffee" });

    profiler = setStepMinutesForDay(
      profiler,
      "2026-05-04",
      "wake",
      10,
      todayKey,
      7,
    );
    profiler = setStepMinutesForDay(
      profiler,
      "2026-05-05",
      "wake",
      10,
      todayKey,
      7,
    );
    profiler = setStepMinutesForDay(
      profiler,
      "2026-05-05",
      "coffee",
      20,
      todayKey,
      7,
    );
    profiler = setStepMinutesForDay(
      profiler,
      "2026-05-05",
      "meds",
      20,
      todayKey,
      7,
    );

    const leaks = topTimeLeaks(profiler, todayKey, 7, 3);

    expect(leaks.map((leak) => leak.stepId)).toEqual(["coffee", "meds", "wake"]);
    expect(leaks[0]?.totalMinutes).toBe(20);
  });
});
