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
      eveningBlockMinutes: 60,
      shutdownProgressState: {
        sessionKey: "active:2026-05-10|21:30|22:15",
        completedActions: 2,
      },
      shutdownRemindersEnabled: true,
      kaizenWake: {
        target: "07:15",
        morning: "2026-05-10",
        resolved: [{ morning: "2026-05-09", target: "07:16" }],
      },
    };

    expect(parseSleepOpsCoreState(serializeSleepOpsCoreState(state))).toEqual(
      state,
    );
  });

  it("defaults old plans to no evening block and retains the new duration", () => {
    expect(normalizeSleepOpsCoreState({}).eveningBlockMinutes).toBe(0);
    expect(normalizeSleepOpsCoreState({ eveningBlockMinutes: 62 }).eveningBlockMinutes).toBe(60);
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

  it("drops a Kaizen wake target that lost its clock time or morning", () => {
    expect(
      normalizeSleepOpsCoreState({
        kaizenWake: { target: "25:00", morning: "2026-05-10" },
      }).kaizenWake,
    ).toBeNull();
    expect(
      normalizeSleepOpsCoreState({
        kaizenWake: { target: "07:15", morning: "2026-13-40" },
      }).kaizenWake,
    ).toBeNull();
  });

  it("uses defaults for malformed stored state", () => {
    expect(parseSleepOpsCoreState("{")).toEqual(DEFAULT_SLEEP_OPS_CORE_STATE);
    expect(parseSleepOpsCoreState(null)).toEqual(
      DEFAULT_SLEEP_OPS_CORE_STATE,
    );
  });

  it("uses defaults for unsupported stored state versions", () => {
    expect(
      parseSleepOpsCoreState(
        JSON.stringify({
          version: 2,
          workStart: "10:00",
          manualMorningRoutineMinutes: 60,
          useProfiledMorningRoutine: true,
          commuteBufferMinutes: 45,
          shutdownProgressState: {
            sessionKey: "active",
            completedActions: 2,
          },
          shutdownRemindersEnabled: true,
        }),
      ),
    ).toEqual(DEFAULT_SLEEP_OPS_CORE_STATE);
  });

  it("returns fresh default state objects for malformed stored state", () => {
    const parsed = parseSleepOpsCoreState(null);
    const normalized = normalizeSleepOpsCoreState({
      shutdownProgressState: null,
    });

    parsed.shutdownProgressState.completedActions = 3;
    normalized.shutdownProgressState.completedActions = 4;

    expect(parseSleepOpsCoreState(null).shutdownProgressState).toEqual(
      DEFAULT_SLEEP_OPS_CORE_STATE.shutdownProgressState,
    );
    expect(
      normalizeSleepOpsCoreState({
        shutdownProgressState: null,
      }).shutdownProgressState,
    ).toEqual(DEFAULT_SLEEP_OPS_CORE_STATE.shutdownProgressState);
    expect(DEFAULT_SLEEP_OPS_CORE_STATE.shutdownProgressState).toEqual({
      sessionKey: "",
      completedActions: 0,
    });
  });
});
