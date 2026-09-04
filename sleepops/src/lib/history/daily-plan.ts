import { isDateKey } from "../routine";
import {
  clockOffsetMinutes,
  formatClockTime,
  minutesBetweenClockTimes,
  parseClockTime,
  type SleepSchedule,
} from "../sleep";

export const DAILY_PLAN_HISTORY_LIMIT = 7;
export const MORNING_LAUNCH_RESULTS = ["on-time", "late", "missed"] as const;

export type MorningLaunchResult = (typeof MORNING_LAUNCH_RESULTS)[number];
export type MorningRoutineSource = "manual" | "profiled";

export type DailyPlan = {
  workStart: string;
  requiredSleepMinutes: number;
  morningRoutineMinutes: number;
  morningRoutineSource: MorningRoutineSource;
  commuteBufferMinutes: number;
  wakeTime: string;
  lightsOutTime: string;
  shutdownStartTime: string;
  shutdownMinutes: number;
};

export type DailyPlanActuals = {
  shutdownStartTime: string | null;
  lightsOutTime: string | null;
  wakeTime: string | null;
  morningLaunch: MorningLaunchResult | null;
};

export type DailyPlanActualsInput = {
  shutdownStartTime?: string | null;
  lightsOutTime?: string | null;
  wakeTime?: string | null;
  morningLaunch?: string | null;
};

export type DailyPlanRecord = {
  date: string; // YYYY-MM-DD of the night the plan runs, so wake happens the next morning.
  plan: DailyPlan;
  actuals: DailyPlanActuals;
};

export type DailyPlanComparison = {
  plannedSleepMinutes: number;
  actualSleepMinutes: number | null;
  sleepDeltaMinutes: number | null;
  // Morning minutes run to the planned work start, so the delta tracks wake drift only.
  plannedMorningMinutes: number;
  actualMorningMinutes: number | null;
  morningDeltaMinutes: number | null;
  shutdownDeltaMinutes: number | null;
  missedShutdown: boolean;
};

const HISTORY_VERSION = 1;

export function planNightDateKey({
  currentTime,
  dateKey,
  previousDateKey,
  wakeTime,
}: {
  currentTime: string;
  dateKey: string;
  previousDateKey: string;
  wakeTime: string;
}): string {
  return parseClockTime(currentTime) < parseClockTime(wakeTime)
    ? previousDateKey
    : dateKey;
}

export function createDailyPlanRecord({
  date,
  morningRoutineSource,
  schedule,
}: {
  date: string;
  morningRoutineSource: MorningRoutineSource;
  schedule: SleepSchedule;
}): DailyPlanRecord {
  return {
    date,
    plan: {
      workStart: schedule.workStart,
      requiredSleepMinutes: schedule.requiredSleepMinutes,
      morningRoutineMinutes: schedule.morningRoutineMinutes,
      morningRoutineSource,
      commuteBufferMinutes: schedule.commuteBufferMinutes,
      wakeTime: schedule.wakeTime,
      lightsOutTime: schedule.latestBedtime,
      shutdownStartTime: schedule.shutdownStartTime,
      shutdownMinutes: schedule.shutdownMinutes,
    },
    actuals: createDailyPlanActuals(),
  };
}

export function saveDailyPlan(
  history: DailyPlanRecord[],
  record: DailyPlanRecord,
): DailyPlanRecord[] {
  const savedRecord = history.find(
    (candidate) => candidate.date === record.date,
  );

  return sortRecentFirst([
    savedRecord ? { ...record, actuals: savedRecord.actuals } : record,
    ...history.filter((candidate) => candidate.date !== record.date),
  ]);
}

export function recordDailyPlanActuals(
  history: DailyPlanRecord[],
  date: string,
  input: DailyPlanActualsInput,
): DailyPlanRecord[] {
  return history.map((record) =>
    record.date === date
      ? { ...record, actuals: mergeDailyPlanActuals(record.actuals, input) }
      : record,
  );
}

export function compareDailyPlan(record: DailyPlanRecord): DailyPlanComparison {
  const { actuals, plan } = record;
  const plannedSleepMinutes = minutesBetweenClockTimes(
    plan.lightsOutTime,
    plan.wakeTime,
  );
  const actualSleepMinutes =
    actuals.lightsOutTime && actuals.wakeTime
      ? minutesBetweenClockTimes(actuals.lightsOutTime, actuals.wakeTime)
      : null;
  const plannedMorningMinutes =
    plan.morningRoutineMinutes + plan.commuteBufferMinutes;
  const actualMorningMinutes = actuals.wakeTime
    ? minutesBetweenClockTimes(actuals.wakeTime, plan.workStart)
    : null;
  const shutdownDeltaMinutes = actuals.shutdownStartTime
    ? clockOffsetMinutes(plan.shutdownStartTime, actuals.shutdownStartTime)
    : null;

  return {
    plannedSleepMinutes,
    actualSleepMinutes,
    sleepDeltaMinutes:
      actualSleepMinutes === null
        ? null
        : actualSleepMinutes - plannedSleepMinutes,
    plannedMorningMinutes,
    actualMorningMinutes,
    morningDeltaMinutes:
      actualMorningMinutes === null
        ? null
        : actualMorningMinutes - plannedMorningMinutes,
    shutdownDeltaMinutes,
    missedShutdown: shutdownDeltaMinutes !== null && shutdownDeltaMinutes > 0,
  };
}

export function normalizeActualClockTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return formatClockTime(hours * 60 + minutes);
}

export function serializeDailyPlanHistory(history: DailyPlanRecord[]): string {
  return JSON.stringify({ version: HISTORY_VERSION, days: history });
}

export function parseDailyPlanHistory(raw: string | null): DailyPlanRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const candidate = parsed as { version?: unknown; days?: unknown };
    if (candidate.version !== HISTORY_VERSION || !Array.isArray(candidate.days)) {
      return [];
    }

    return sortRecentFirst(
      candidate.days
        .map(parseDailyPlanRecord)
        .filter((record): record is DailyPlanRecord => record !== null),
    );
  } catch {
    return [];
  }
}

function createDailyPlanActuals(): DailyPlanActuals {
  return {
    shutdownStartTime: null,
    lightsOutTime: null,
    wakeTime: null,
    morningLaunch: null,
  };
}

function mergeDailyPlanActuals(
  actuals: DailyPlanActuals,
  input: DailyPlanActualsInput,
): DailyPlanActuals {
  return {
    shutdownStartTime:
      input.shutdownStartTime === undefined
        ? actuals.shutdownStartTime
        : normalizeActualClockTime(input.shutdownStartTime),
    lightsOutTime:
      input.lightsOutTime === undefined
        ? actuals.lightsOutTime
        : normalizeActualClockTime(input.lightsOutTime),
    wakeTime:
      input.wakeTime === undefined
        ? actuals.wakeTime
        : normalizeActualClockTime(input.wakeTime),
    morningLaunch:
      input.morningLaunch === undefined
        ? actuals.morningLaunch
        : normalizeMorningLaunch(input.morningLaunch),
  };
}

function normalizeMorningLaunch(value: unknown): MorningLaunchResult | null {
  return MORNING_LAUNCH_RESULTS.some((result) => result === value)
    ? (value as MorningLaunchResult)
    : null;
}

function sortRecentFirst(records: DailyPlanRecord[]): DailyPlanRecord[] {
  return [...records]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, DAILY_PLAN_HISTORY_LIMIT);
}

function parseDailyPlanRecord(value: unknown): DailyPlanRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const plan = parseDailyPlan(candidate.plan);
  if (
    typeof candidate.date !== "string" ||
    !isDateKey(candidate.date) ||
    !plan
  ) {
    return null;
  }

  return {
    date: candidate.date,
    plan,
    actuals: parseDailyPlanActuals(candidate.actuals),
  };
}

function parseDailyPlan(value: unknown): DailyPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const workStart = normalizeActualClockTime(candidate.workStart);
  const wakeTime = normalizeActualClockTime(candidate.wakeTime);
  const lightsOutTime = normalizeActualClockTime(candidate.lightsOutTime);
  const shutdownStartTime = normalizeActualClockTime(
    candidate.shutdownStartTime,
  );
  const requiredSleepMinutes = parseStoredMinutes(
    candidate.requiredSleepMinutes,
  );
  const morningRoutineMinutes = parseStoredMinutes(
    candidate.morningRoutineMinutes,
  );
  const commuteBufferMinutes = parseStoredMinutes(candidate.commuteBufferMinutes);
  const shutdownMinutes = parseStoredMinutes(candidate.shutdownMinutes);

  if (
    !workStart ||
    !wakeTime ||
    !lightsOutTime ||
    !shutdownStartTime ||
    requiredSleepMinutes === null ||
    morningRoutineMinutes === null ||
    commuteBufferMinutes === null ||
    shutdownMinutes === null
  ) {
    return null;
  }

  return {
    workStart,
    requiredSleepMinutes,
    morningRoutineMinutes,
    morningRoutineSource:
      candidate.morningRoutineSource === "profiled" ? "profiled" : "manual",
    commuteBufferMinutes,
    wakeTime,
    lightsOutTime,
    shutdownStartTime,
    shutdownMinutes,
  };
}

function parseDailyPlanActuals(value: unknown): DailyPlanActuals {
  if (!value || typeof value !== "object") {
    return createDailyPlanActuals();
  }

  const candidate = value as Record<string, unknown>;

  return {
    shutdownStartTime: normalizeActualClockTime(candidate.shutdownStartTime),
    lightsOutTime: normalizeActualClockTime(candidate.lightsOutTime),
    wakeTime: normalizeActualClockTime(candidate.wakeTime),
    morningLaunch: normalizeMorningLaunch(candidate.morningLaunch),
  };
}

function parseStoredMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
