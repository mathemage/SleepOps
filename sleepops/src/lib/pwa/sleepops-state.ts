import { parseClockTime } from "../sleep";

export const SLEEPOPS_STATE_STORAGE_KEY = "sleepops.coreState.v1";

export type SleepOpsCoreState = {
  workStart: string;
  manualMorningRoutineMinutes: number;
  useProfiledMorningRoutine: boolean;
  commuteBufferMinutes: number;
  shutdownProgressState: {
    sessionKey: string;
    completedActions: number;
  };
  shutdownRemindersEnabled: boolean;
};

export const DEFAULT_SLEEP_OPS_CORE_STATE: SleepOpsCoreState = {
  workStart: "09:00",
  manualMorningRoutineMinutes: 75,
  useProfiledMorningRoutine: false,
  commuteBufferMinutes: 30,
  shutdownProgressState: {
    sessionKey: "",
    completedActions: 0,
  },
  shutdownRemindersEnabled: false,
};

const STATE_VERSION = 1;
const MAX_ROUTINE_MINUTES = 900;
const MAX_BUFFER_MINUTES = 240;
const MINUTES_STEP = 5;

export function serializeSleepOpsCoreState(state: SleepOpsCoreState): string {
  return JSON.stringify({
    version: STATE_VERSION,
    ...state,
  });
}

export function parseSleepOpsCoreState(
  raw: string | null,
): SleepOpsCoreState {
  if (!raw) {
    return DEFAULT_SLEEP_OPS_CORE_STATE;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_SLEEP_OPS_CORE_STATE;
    }

    return normalizeSleepOpsCoreState(parsed as Record<string, unknown>);
  } catch {
    return DEFAULT_SLEEP_OPS_CORE_STATE;
  }
}

export function normalizeSleepOpsCoreState(
  value: Record<string, unknown>,
): SleepOpsCoreState {
  const workStart =
    typeof value.workStart === "string" && isClockTime(value.workStart)
      ? value.workStart
      : DEFAULT_SLEEP_OPS_CORE_STATE.workStart;
  const shutdownProgressState = parseShutdownProgressState(
    value.shutdownProgressState,
  );

  return {
    workStart,
    manualMorningRoutineMinutes: readSteppedMinutes(
      value.manualMorningRoutineMinutes,
      DEFAULT_SLEEP_OPS_CORE_STATE.manualMorningRoutineMinutes,
      MAX_ROUTINE_MINUTES,
    ),
    useProfiledMorningRoutine:
      typeof value.useProfiledMorningRoutine === "boolean"
        ? value.useProfiledMorningRoutine
        : DEFAULT_SLEEP_OPS_CORE_STATE.useProfiledMorningRoutine,
    commuteBufferMinutes: readSteppedMinutes(
      value.commuteBufferMinutes,
      DEFAULT_SLEEP_OPS_CORE_STATE.commuteBufferMinutes,
      MAX_BUFFER_MINUTES,
    ),
    shutdownProgressState,
    shutdownRemindersEnabled:
      typeof value.shutdownRemindersEnabled === "boolean"
        ? value.shutdownRemindersEnabled
        : DEFAULT_SLEEP_OPS_CORE_STATE.shutdownRemindersEnabled,
  };
}

function parseShutdownProgressState(value: unknown) {
  if (!value || typeof value !== "object") {
    return DEFAULT_SLEEP_OPS_CORE_STATE.shutdownProgressState;
  }

  const candidate = value as {
    sessionKey?: unknown;
    completedActions?: unknown;
  };
  const completedActions = Number(candidate.completedActions);

  return {
    sessionKey:
      typeof candidate.sessionKey === "string" ? candidate.sessionKey : "",
    completedActions: Number.isFinite(completedActions)
      ? Math.max(0, Math.floor(completedActions))
      : 0,
  };
}

function readSteppedMinutes(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) {
    return fallback;
  }

  const rounded = Math.round(minutes / MINUTES_STEP) * MINUTES_STEP;
  return Math.min(max, Math.max(0, rounded));
}

function isClockTime(value: string): boolean {
  try {
    parseClockTime(value);
    return true;
  } catch {
    return false;
  }
}
