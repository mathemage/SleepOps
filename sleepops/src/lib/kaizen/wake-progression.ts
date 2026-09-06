import { normalizeActualClockTime } from "../history";
import { isDateKey } from "../routine";
import {
  buildSleepSchedule,
  clockOffsetMinutes,
  formatClockTime,
  formatDuration,
  minutesBetweenClockTimes,
  parseClockTime,
  type SleepSchedule,
} from "../sleep";

export const KAIZEN_STEP_MINUTES = 1;
export const KAIZEN_WAKE_HISTORY_LIMIT = 7;

export type KaizenWakeContract = {
  workStart: string;
  shutdownMinutes: number;
};

export type KaizenResolvedMorning = {
  morning: string;
  target: string;
};

export type KaizenWakeState = {
  // The established target, plus the morning it applies to so a new day can advance it once.
  target: string;
  morning: string;
  resolved: KaizenResolvedMorning[];
};

export type KaizenWakeStatus = "pending" | "success" | "held" | "blocked";

export type KaizenMorningWindow = {
  target: string;
  endTime: string;
  morningMinutes: number;
};

export type KaizenWakeOutcome = {
  status: KaizenWakeStatus;
  target: string;
  actualWake: string | null;
  offsetMinutes: number | null;
  nextTarget: string;
  nextPlan: SleepSchedule;
  conflict: string | null;
};

/**
 * The stretch the morning screen owns: the target, plus the morning block the
 * schedule already budgets between waking and work.
 */
export function buildKaizenMorningWindow({
  morningMinutes,
  target,
}: {
  morningMinutes: number;
  target: string;
}): KaizenMorningWindow {
  return {
    target,
    endTime: formatClockTime(parseClockTime(target) + morningMinutes),
    morningMinutes,
  };
}

export function isKaizenMorningActive(
  window: KaizenMorningWindow,
  currentTime: string,
): boolean {
  return (
    minutesBetweenClockTimes(window.target, currentTime) < window.morningMinutes
  );
}

/**
 * Compiles the plan a wake target implies: the same 9h contract, paid for with an
 * equally earlier lights-out and shutdown rather than with less sleep.
 */
export function buildKaizenWakePlan(
  target: string,
  contract: KaizenWakeContract,
): SleepSchedule {
  return buildSleepSchedule({
    workStart: contract.workStart,
    morningRoutineMinutes: minutesBetweenClockTimes(target, contract.workStart),
    commuteBufferMinutes: 0,
    shutdownMinutes: contract.shutdownMinutes,
  });
}

export function evaluateKaizenWake({
  actualWake,
  contract,
  target,
}: {
  actualWake: string | null;
  contract: KaizenWakeContract;
  target: string;
}): KaizenWakeOutcome {
  const offsetMinutes =
    actualWake === null ? null : clockOffsetMinutes(target, actualWake);
  const reachedTarget = offsetMinutes !== null && offsetMinutes <= 0;
  const steppedTarget = formatClockTime(
    parseClockTime(target) - KAIZEN_STEP_MINUTES,
  );
  const steppedPlan = buildKaizenWakePlan(steppedTarget, contract);
  // The conflict is only ever the reason a step was refused, so a day that missed
  // the target reads as held rather than as a contract problem.
  const blocked = reachedTarget && steppedPlan.availableFlexMinutes < 0;
  const advances = reachedTarget && !blocked;

  return {
    status: actualWake === null
      ? "pending"
      : advances
        ? "success"
        : blocked
          ? "blocked"
          : "held",
    target,
    actualWake,
    offsetMinutes,
    nextTarget: advances ? steppedTarget : target,
    nextPlan: advances ? steppedPlan : buildKaizenWakePlan(target, contract),
    conflict: blocked
      ? `Waking at ${steppedTarget} would need lights out ${steppedPlan.latestBedtime} and shutdown ${steppedPlan.shutdownStartTime}, which no longer fits ${formatDuration(steppedPlan.requiredSleepMinutes)} of sleep.`
      : null,
  };
}

export function seedKaizenWakeState(
  state: KaizenWakeState | null,
  { morning, target }: { morning: string; target: string },
): KaizenWakeState {
  return { target, morning, resolved: state?.resolved ?? [] };
}

/**
 * Carries the established target into a new morning, applying at most one step for
 * the morning that just closed. An unrecorded morning holds the target.
 *
 * One step per call is deliberate rather than one step per elapsed day: a morning
 * is only credited if the wake was recorded while it was happening, so days spent
 * away from the app hold, and back-filling old nights later cannot buy steps.
 */
export function advanceKaizenWakeState({
  actualWake,
  contract,
  morning,
  state,
}: {
  actualWake: string | null;
  contract: KaizenWakeContract;
  morning: string;
  state: KaizenWakeState;
}): KaizenWakeState {
  if (morning <= state.morning) {
    return state;
  }

  const outcome = evaluateKaizenWake({
    actualWake,
    contract,
    target: state.target,
  });

  return {
    target: outcome.nextTarget,
    morning,
    resolved: [
      { morning: state.morning, target: state.target },
      ...state.resolved,
    ].slice(0, KAIZEN_WAKE_HISTORY_LIMIT),
  };
}

export function normalizeKaizenWakeState(
  value: unknown,
): KaizenWakeState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const target = normalizeActualClockTime(candidate.target);
  const morning = candidate.morning;

  if (!target || typeof morning !== "string" || !isDateKey(morning)) {
    return null;
  }

  return {
    target,
    morning,
    resolved: Array.isArray(candidate.resolved)
      ? candidate.resolved
          .map(normalizeResolvedMorning)
          .filter((entry): entry is KaizenResolvedMorning => entry !== null)
          .slice(0, KAIZEN_WAKE_HISTORY_LIMIT)
      : [],
  };
}

function normalizeResolvedMorning(value: unknown): KaizenResolvedMorning | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const target = normalizeActualClockTime(candidate.target);

  if (
    !target ||
    typeof candidate.morning !== "string" ||
    !isDateKey(candidate.morning)
  ) {
    return null;
  }

  return { morning: candidate.morning, target };
}
