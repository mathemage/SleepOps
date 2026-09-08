import { describe, expect, it } from "vitest";
import {
  createDailyPlanRecord,
  type DailyPlanRecord,
} from "../history/daily-plan";
import { compressMorningRoutine } from "../routine/compressor";
import { createDefaultMorningRoutineProfiler } from "../routine/profiler";
import {
  assessSleepSchedule,
  buildSleepSchedule,
  formatClockTime,
  parseClockTime,
} from "./schedule";
import {
  compileTomorrowRisk,
  RISK_THRESHOLDS,
  type TomorrowRiskInput,
} from "./tomorrow-risk";

const schedule = buildSleepSchedule({
  workStart: "09:00",
  morningRoutineMinutes: 75,
  commuteBufferMinutes: 30,
});
function input(overrides: Partial<TomorrowRiskInput> = {}): TomorrowRiskInput {
  const profiler = createDefaultMorningRoutineProfiler();
  return {
    schedule,
    now: { date: "2026-05-10", time: "12:00" },
    nightDate: "2026-05-10",
    eveningBlockMinutes: 0,
    history: [],
    profiler,
    compression: compressMorningRoutine(profiler),
    ...overrides,
  };
}
function night(date = "2026-05-09", deficit = 0, late = 0): DailyPlanRecord {
  const record = createDailyPlanRecord({
    date,
    morningRoutineSource: "manual",
    schedule,
  });
  record.actuals = {
    shutdownStartTime: formatClockTime(
      parseClockTime(schedule.shutdownStartTime) + late,
    ),
    lightsOutTime: formatClockTime(
      parseClockTime(schedule.latestBedtime) + deficit,
    ),
    wakeTime: schedule.wakeTime,
    morningLaunch: "on-time",
  };
  return record;
}
function routine(overrun: number) {
  const profiler = createDefaultMorningRoutineProfiler();
  profiler.days = [
    { date: "2026-05-10", minutesByStepId: { wake: 75 + overrun } },
  ];
  return profiler;
}

describe("tomorrow risk thresholds", () => {
  it("has exactly four levels and keeps an unobserved fitting plan low", () => {
    expect(compileTomorrowRisk(input())).toEqual({
      level: "low",
      reasons: [],
      tradeoffs: [],
      signals: {
        overbookedMinutes: 0,
        missedShutdowns: 0,
        routineOverrunMinutes: 0,
        sleepDeficitMinutes: 0,
      },
    });
  });
  it.each([
    [RISK_THRESHOLDS.brokenOverbookedMinutes - 1, "low"],
    [RISK_THRESHOLDS.brokenOverbookedMinutes, "broken"],
    [RISK_THRESHOLDS.brokenOverbookedMinutes + 1, "broken"],
  ])("overbooking %i minutes selects %s", (overbooked, level) => {
    const result = compileTomorrowRisk(
      input({ eveningBlockMinutes: 570 + Number(overbooked) }),
    );
    expect(result.level).toBe(level);
    expect(result.signals.overbookedMinutes).toBe(overbooked);
  });
  it.each([
    [RISK_THRESHOLDS.sleepDeficitMinutes.medium - 1, "low"],
    [RISK_THRESHOLDS.sleepDeficitMinutes.medium, "medium"],
    [RISK_THRESHOLDS.sleepDeficitMinutes.medium + 1, "medium"],
    [RISK_THRESHOLDS.sleepDeficitMinutes.high - 1, "medium"],
    [RISK_THRESHOLDS.sleepDeficitMinutes.high, "high"],
    [RISK_THRESHOLDS.sleepDeficitMinutes.high + 1, "high"],
  ])("sleep deficit %i selects %s", (deficit, level) => {
    expect(
      compileTomorrowRisk(
        input({ history: [night("2026-05-09", Number(deficit))] }),
      ).level,
    ).toBe(level);
  });
  it.each([
    [RISK_THRESHOLDS.routineOverrunMinutes.medium - 1, "low"],
    [RISK_THRESHOLDS.routineOverrunMinutes.medium, "medium"],
    [RISK_THRESHOLDS.routineOverrunMinutes.medium + 1, "medium"],
    [RISK_THRESHOLDS.routineOverrunMinutes.high - 1, "medium"],
    [RISK_THRESHOLDS.routineOverrunMinutes.high, "high"],
    [RISK_THRESHOLDS.routineOverrunMinutes.high + 1, "high"],
  ])("routine overrun %i selects %s", (overrun, level) => {
    expect(
      compileTomorrowRisk(input({ profiler: routine(Number(overrun)) })).level,
    ).toBe(level);
  });
  it.each([
    [0, "low"],
    [1, "medium"],
    [2, "high"],
    [3, "high"],
  ])("%i recorded shutdown misses selects %s", (misses, level) => {
    const history = Array.from({ length: Number(misses) }, (_, i) =>
      night(`2026-05-0${9 - i}`, 0, 1),
    );
    expect(compileTomorrowRisk(input({ history })).level).toBe(level);
  });
  it("reports each reason while the strongest signal wins", () => {
    const result = compileTomorrowRisk(
      input({ history: [night("2026-05-09", 60, 1)], profiler: routine(15) }),
    );
    expect(result.level).toBe("high");
    expect(result.reasons).toEqual([
      {
        signal: "missed-shutdown",
        message: "1 recorded late shutdown in the last 7 nights.",
      },
      {
        signal: "routine-trend",
        message: "Your measured morning averages 15m longer than this plan.",
      },
      {
        signal: "sleep-deficit",
        message:
          "1h of sleep deficit across recorded nights in the last 7 nights.",
      },
    ]);
  });
});

describe("history and current time", () => {
  it("uses required sleep across midnight and never offsets deficit with surplus sleep", () => {
    const incomplete = night("2026-05-06", 200);
    incomplete.actuals.wakeTime = null;
    expect(
      compileTomorrowRisk(
        input({
          history: [
            night("2026-05-09", 30),
            night("2026-05-08", 40),
            night("2026-05-07", -90),
            incomplete,
          ],
        }),
      ).signals.sleepDeficitMinutes,
    ).toBe(70);
  });
  it("uses each historical contract instead of the current plan", () => {
    const record = night();
    record.plan.requiredSleepMinutes = 600;
    expect(
      compileTomorrowRisk(input({ history: [record] })).signals
        .sleepDeficitMinutes,
    ).toBe(60);
  });
  it("includes the seventh prior night, excludes older, current, and future nights", () => {
    const result = compileTomorrowRisk(
      input({
        history: [
          night("2026-05-03", 30),
          night("2026-05-02", 60),
          night("2026-05-10", 60),
          night("2026-05-11", 60),
        ],
      }),
    );
    expect(result.signals.sleepDeficitMinutes).toBe(30);
  });
  it.each([-1, 0, 1])(
    "handles a shutdown offset of %i across midnight",
    (offset) => {
      const record = night();
      record.plan.shutdownStartTime = "23:59";
      record.actuals.shutdownStartTime = formatClockTime(1439 + offset);
      expect(
        compileTomorrowRisk(input({ history: [record] })).signals
          .missedShutdowns,
      ).toBe(offset > 0 ? 1 : 0);
    },
  );
  it("does not interpret missing shutdown or sleep records as failures", () => {
    const record = createDailyPlanRecord({
      date: "2026-05-09",
      morningRoutineSource: "manual",
      schedule,
    });
    expect(compileTomorrowRisk(input({ history: [record] })).level).toBe("low");
  });
  it("uses only observed recent routines, averaging rather than summing overruns", () => {
    const profiler = routine(10);
    profiler.days.push(
      { date: "2026-05-04", minutesByStepId: { wake: 95 } },
      { date: "2026-05-03", minutesByStepId: { wake: 900 } },
      { date: "2026-05-11", minutesByStepId: { wake: 900 } },
    );
    const result = compileTomorrowRisk(input({ profiler }));
    expect(result.signals.routineOverrunMinutes).toBe(15);
    expect(result.level).toBe("medium");
    expect(
      compileTomorrowRisk(input({ profiler: routine(-20) })).signals
        .routineOverrunMinutes,
    ).toBe(0);
  });
  it("uses the supplied time at, before, and after the shutdown deadline", () => {
    for (const [time, expected] of [
      ["21:29", "low"],
      ["21:30", "low"],
      ["21:31", "broken"],
    ] as const) {
      expect(
        compileTomorrowRisk(input({ now: { date: "2026-05-10", time } })).level,
      ).toBe(expected);
    }
  });
  it("keeps the work date anchored when now or shutdown crosses midnight", () => {
    const lateSchedule = buildSleepSchedule({
      ...schedule,
      workStart: "12:00",
    });
    expect(
      compileTomorrowRisk(
        input({
          schedule: lateSchedule,
          now: { date: "2026-05-11", time: "00:30" },
        }),
      ).level,
    ).toBe("low");
    expect(
      compileTomorrowRisk(
        input({
          schedule: lateSchedule,
          now: { date: "2026-05-11", time: "00:31" },
        }),
      ).signals.overbookedMinutes,
    ).toBe(1);
  });
  it("is deterministic and leaves all inputs unchanged", () => {
    const data = input({ history: [night()], eveningBlockMinutes: 600 });
    const before = structuredClone(data);
    expect(compileTomorrowRisk(data)).toEqual(compileTomorrowRisk(data));
    expect(data).toEqual(before);
  });
});

describe("concrete broken-plan tradeoffs", () => {
  function broken(overrides: Partial<TomorrowRiskInput> = {}) {
    const profiler = {
      steps: [
        {
          id: "wake",
          label: "Wake",
          classification: "required-morning" as const,
        },
        {
          id: "shower",
          label: "Shower",
          classification: "movable-evening" as const,
        },
      ],
      days: [{ date: "2026-05-10", minutesByStepId: { wake: 60, shower: 30 } }],
    };
    return input({
      profiler,
      compression: compressMorningRoutine(
        profiler,
        profiler.days[0].minutesByStepId,
      ),
      schedule: buildSleepSchedule({
        ...schedule,
        morningRoutineMinutes: 90,
        shutdownMinutes: 75,
      }),
      now: { date: "2026-05-10", time: "20:30" },
      eveningBlockMinutes: 30,
      ...overrides,
    });
  }
  it("prints real alternatives: drop the block, move shower, compress, or start at 10:00", () => {
    const result = compileTomorrowRisk(broken());
    expect(result.level).toBe("broken");
    const moves = result.tradeoffs.flatMap((option) => option.moves);
    expect(moves).toContain("Remove the evening block (30m)");
    expect(moves).toContain("Move Shower to evening (30m)");
    expect(moves).toContain("Start work at 10:00");
    // Compression and moving the only eligible task are equivalent; keep the smaller move.
    const compressed = compileTomorrowRisk(
      broken({
        schedule: buildSleepSchedule({
          ...schedule,
          morningRoutineMinutes: 150,
          shutdownMinutes: 75,
        }),
      }),
    );
    expect(compressed.tradeoffs.flatMap((option) => option.moves)).toContain(
      "Use the compressed morning routine (1h)",
    );
  });
  it("verifies every offered fit using schedule capacity and the full sleep contract", () => {
    const data = broken();
    const result = compileTomorrowRisk(data);
    for (const option of result.tradeoffs) {
      const untilWork =
        (Date.parse(`2026-05-11T${option.schedule.workStart}:00Z`) -
          Date.parse("2026-05-10T20:30:00Z")) /
        60_000;
      expect(
        assessSleepSchedule(option.schedule, untilWork, option.eveningMinutes)
          .overbookedMinutes,
      ).toBe(0);
      expect(option.schedule.requiredSleepMinutes).toBe(540);
      expect(option.remainingOverbookedMinutes).toBe(0);
    }
  });
  it("combines moves when neither dropping the block nor starting at 10 works alone", () => {
    const result = compileTomorrowRisk(
      broken({
        now: { date: "2026-05-10", time: "21:30" },
        eveningBlockMinutes: 60,
      }),
    );
    expect(result.tradeoffs.length).toBeGreaterThan(0);
    expect(result.tradeoffs.every((option) => option.moves.length >= 2)).toBe(
      true,
    );
    expect(
      result.tradeoffs.every(
        (option) => option.remainingOverbookedMinutes === 0,
      ),
    ).toBe(true);
  });
  it("does not offer 10:00 for a plan already starting at 10:00", () => {
    const result = compileTomorrowRisk(
      broken({
        schedule: buildSleepSchedule({ ...schedule, workStart: "10:00" }),
        eveningBlockMinutes: 900,
      }),
    );
    expect(result.tradeoffs.flatMap((option) => option.moves)).not.toContain(
      "Start work at 10:00",
    );
  });
  it("does not drop required tasks or subtract an already compressed task again", () => {
    const data = broken();
    data.schedule = buildSleepSchedule({
      ...data.schedule,
      morningRoutineMinutes: 60,
    });
    data.eveningBlockMinutes = 100;
    const moves = compileTomorrowRisk(data).tradeoffs.flatMap(
      (option) => option.moves,
    );
    expect(moves).not.toContain("Move Shower to evening (30m)");
    expect(moves.join(" ")).not.toContain("Move Wake");
    expect(moves.join(" ")).not.toContain("compressed");
  });
  it("budgets tasks that overflow the shutdown assistant instead of inventing savings", () => {
    const data = broken();
    data.compression.eveningTasks[0].minutes = 60;
    data.compression.eveningMinutes = 60;
    data.compression.totalProfiledMinutes = 120;
    data.schedule = buildSleepSchedule({
      ...schedule,
      workStart: "10:00",
      morningRoutineMinutes: 120,
    });
    data.now.time = "22:00";
    data.eveningBlockMinutes = 0;
    const result = compileTomorrowRisk(data);
    expect(result.level).toBe("broken");
    expect(
      result.tradeoffs.every((option) => option.remainingOverbookedMinutes > 0),
    ).toBe(true);
  });
  it("credits moved tasks only when the supplied shutdown duration budgets them", () => {
    const result = compileTomorrowRisk(
      broken({
        schedule: buildSleepSchedule({
          ...schedule,
          workStart: "10:00",
          morningRoutineMinutes: 90,
        }),
        now: { date: "2026-05-10", time: "21:50" },
      }),
    );
    expect(result.level).toBe("broken");
    expect(result.tradeoffs.map((option) => option.moves)).toEqual([
      ["Remove the evening block (30m)"],
    ]);
  });

  it("does not claim shifting work fixes more than 24 hours of protected time", () => {
    const data = input({
      schedule: buildSleepSchedule({
        ...schedule,
        morningRoutineMinutes: 900,
        commuteBufferMinutes: 240,
      }),
    });
    const result = compileTomorrowRisk(data);
    expect(result.level).toBe("broken");
    expect(
      result.tradeoffs.some(
        (option) =>
          option.moves.length === 1 &&
          option.moves[0] === "Start work at 10:00",
      ),
    ).toBe(false);
    expect(
      result.tradeoffs.some((option) =>
        option.moves.includes("Use the compressed morning routine (1h 50m)"),
      ),
    ).toBe(true);
  });
});
