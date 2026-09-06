import { describe, expect, it } from "vitest";
import {
  KAIZEN_WAKE_HISTORY_LIMIT,
  advanceKaizenWakeState,
  buildKaizenWakePlan,
  evaluateKaizenWake,
  normalizeKaizenWakeState,
  seedKaizenWakeState,
  type KaizenWakeContract,
} from "./wake-progression";

const CONTRACT: KaizenWakeContract = {
  workStart: "09:00",
  shutdownMinutes: 45,
};

function evaluate(target: string, actualWake: string | null) {
  return evaluateKaizenWake({ actualWake, contract: CONTRACT, target });
}

describe("Kaizen wake progression", () => {
  it("advances the established target by exactly one minute after a successful day", () => {
    const outcome = evaluate("07:15", "07:12");

    expect(outcome.status).toBe("success");
    expect(outcome.offsetMinutes).toBe(-3);
    expect(outcome.nextTarget).toBe("07:14");
    expect(outcome.conflict).toBeNull();
  });

  it("counts waking exactly on the target as a successful day", () => {
    expect(evaluate("07:15", "07:15")).toMatchObject({
      status: "success",
      offsetMinutes: 0,
      nextTarget: "07:14",
    });
  });

  it("still advances one minute after an unusually early wake", () => {
    expect(evaluate("07:15", "06:45")).toMatchObject({
      status: "success",
      offsetMinutes: -30,
      nextTarget: "07:14",
    });
  });

  it("holds the target after a late morning and never moves it later", () => {
    const outcome = evaluate("07:15", "07:35");

    expect(outcome.status).toBe("held");
    expect(outcome.offsetMinutes).toBe(20);
    expect(outcome.nextTarget).toBe("07:15");
  });

  it("holds the target while no wake is recorded", () => {
    expect(evaluate("07:15", null)).toMatchObject({
      status: "pending",
      offsetMinutes: null,
      nextTarget: "07:15",
    });
  });

  it("re-reads the day from a corrected wake time", () => {
    expect(evaluate("07:15", "09:00").nextTarget).toBe("07:15");
    expect(evaluate("07:15", "07:05").nextTarget).toBe("07:14");
  });

  it("pays for the next target with an earlier lights-out and shutdown", () => {
    const outcome = evaluate("07:15", "07:10");

    expect(outcome.nextPlan).toMatchObject({
      wakeTime: "07:14",
      latestBedtime: "22:14",
      shutdownStartTime: "21:29",
      requiredSleepMinutes: 540,
    });
  });

  it("keeps the clock math safe across midnight", () => {
    expect(evaluate("00:00", "23:58").nextTarget).toBe("23:59");
    expect(evaluate("00:02", "23:58")).toMatchObject({
      status: "success",
      offsetMinutes: -4,
    });
    expect(evaluate("23:58", "00:02")).toMatchObject({
      status: "held",
      offsetMinutes: 4,
      nextTarget: "23:58",
    });
  });

  it("keeps compiling a target that has advanced into the previous day", () => {
    expect(buildKaizenWakePlan("23:59", CONTRACT)).toMatchObject({
      wakeTime: "23:59",
      latestBedtime: "14:59",
      shutdownStartTime: "14:14",
      constraintWarning: null,
    });
  });

  it("holds progression when the next target cannot be paid for with earlier sleep", () => {
    const outcome = evaluate("18:45", "18:30");

    expect(outcome.status).toBe("blocked");
    expect(outcome.nextTarget).toBe("18:45");
    expect(outcome.conflict).toBe(
      "Waking at 18:44 would need lights out 09:44 and shutdown 08:59, which no longer fits 9h of sleep.",
    );
  });

  it("still advances while the next target fits the required sleep", () => {
    expect(evaluate("18:46", "18:30")).toMatchObject({
      status: "success",
      nextTarget: "18:45",
      conflict: null,
    });
  });
});

describe("Kaizen wake state", () => {
  it("seeds a target for the current morning", () => {
    expect(
      seedKaizenWakeState(null, { morning: "2026-05-10", target: "07:15" }),
    ).toEqual({ target: "07:15", morning: "2026-05-10", resolved: [] });
  });

  it("keeps recorded mornings when the target is reseeded", () => {
    const seeded = seedKaizenWakeState(
      {
        target: "07:15",
        morning: "2026-05-10",
        resolved: [{ morning: "2026-05-09", target: "07:16" }],
      },
      { morning: "2026-05-10", target: "06:30" },
    );

    expect(seeded).toEqual({
      target: "06:30",
      morning: "2026-05-10",
      resolved: [{ morning: "2026-05-09", target: "07:16" }],
    });
  });

  it("applies one step when a successful morning rolls into the next day", () => {
    expect(
      advanceKaizenWakeState({
        actualWake: "07:10",
        contract: CONTRACT,
        morning: "2026-05-11",
        state: { target: "07:15", morning: "2026-05-10", resolved: [] },
      }),
    ).toEqual({
      target: "07:14",
      morning: "2026-05-11",
      resolved: [{ morning: "2026-05-10", target: "07:15" }],
    });
  });

  it("holds the target when the closed morning was never recorded", () => {
    expect(
      advanceKaizenWakeState({
        actualWake: null,
        contract: CONTRACT,
        morning: "2026-05-11",
        state: { target: "07:15", morning: "2026-05-10", resolved: [] },
      }),
    ).toMatchObject({ target: "07:15", morning: "2026-05-11" });
  });

  it("leaves the state untouched within the same morning", () => {
    const state = { target: "07:15", morning: "2026-05-10", resolved: [] };

    expect(
      advanceKaizenWakeState({
        actualWake: "07:10",
        contract: CONTRACT,
        morning: "2026-05-10",
        state,
      }),
    ).toBe(state);
  });

  it("keeps the recent mornings list bounded", () => {
    let state = seedKaizenWakeState(null, {
      morning: "2026-05-01",
      target: "07:15",
    });

    for (let day = 2; day <= 12; day += 1) {
      state = advanceKaizenWakeState({
        actualWake: state.target,
        contract: CONTRACT,
        morning: `2026-05-${String(day).padStart(2, "0")}`,
        state,
      });
    }

    expect(state.target).toBe("07:04");
    expect(state.resolved).toHaveLength(KAIZEN_WAKE_HISTORY_LIMIT);
    expect(state.resolved[0]).toEqual({
      morning: "2026-05-11",
      target: "07:05",
    });
  });

  it("normalizes persisted state at the browser boundary", () => {
    expect(
      normalizeKaizenWakeState({
        target: "7:05",
        morning: "2026-05-10",
        resolved: [
          { morning: "2026-05-09", target: "07:06" },
          { morning: "nope", target: "07:07" },
          "broken",
        ],
      }),
    ).toEqual({
      target: "07:05",
      morning: "2026-05-10",
      resolved: [{ morning: "2026-05-09", target: "07:06" }],
    });
    expect(normalizeKaizenWakeState(null)).toBeNull();
    expect(normalizeKaizenWakeState({ morning: "2026-05-10" })).toBeNull();
  });
});
