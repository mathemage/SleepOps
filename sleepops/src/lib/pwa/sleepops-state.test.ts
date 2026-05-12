import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLEEP_OPS_CORE_STATE,
  normalizeSleepOpsCoreState,
  parseSleepOpsCoreState,
  serializeSleepOpsCoreState,
} from "./sleepops-state";

describe("SleepOps core state persistence", () => {
  it("round-trips the local MVP state", () => {
    const state = {
      workStart: "10:00",
      manualMorningRoutineMinutes: 60,
      useProfiledMorningRoutine: true,
      commuteBufferMinutes: 45,
      shutdownProgressState: {
        sessionKey: "active:2026-05-10|21:30|22:15",
        completedActions: 2,
      },
      shutdownRemindersEnabled: true,
    };

    expect(parseSleepOpsCoreState(serializeSleepOpsCoreState(state))).toEqual(
      state,
    );
  });

  it("normalizes persisted values at the browser boundary", () => {
    expect(
      normalizeSleepOpsCoreState({
        workStart: "25:99",
        manualMorningRoutineMinutes: 842,
        commuteBufferMinutes: 999,
        useProfiledMorningRoutine: true,
        shutdownProgressState: {
          sessionKey: "active",
          completedActions: 2.8,
        },
        shutdownRemindersEnabled: true,
      }),
    ).toEqual({
      ...DEFAULT_SLEEP_OPS_CORE_STATE,
      manualMorningRoutineMinutes: 840,
      commuteBufferMinutes: 240,
      useProfiledMorningRoutine: true,
      shutdownProgressState: {
        sessionKey: "active",
        completedActions: 2,
      },
      shutdownRemindersEnabled: true,
    });
  });

  it("uses defaults for malformed stored state", () => {
    expect(parseSleepOpsCoreState("{")).toEqual(DEFAULT_SLEEP_OPS_CORE_STATE);
    expect(parseSleepOpsCoreState(null)).toEqual(
      DEFAULT_SLEEP_OPS_CORE_STATE,
    );
  });
});
