export const DAY_MINUTES = 24 * 60;
export const REQUIRED_SLEEP_MINUTES = 9 * 60;
export const MIN_SHUTDOWN_MINUTES = 45;
export const MAX_SHUTDOWN_MINUTES = 75;
export const DEFAULT_SHUTDOWN_MINUTES = 45;

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type SleepScheduleInput = {
  workStart: string;
  morningRoutineMinutes: number;
  commuteBufferMinutes: number;
  shutdownMinutes?: number;
  requiredSleepMinutes?: number;
};

export type SleepSchedule = {
  workStart: string;
  requiredSleepMinutes: number;
  morningRoutineMinutes: number;
  commuteBufferMinutes: number;
  shutdownMinutes: number;
  wakeTime: string;
  latestBedtime: string;
  shutdownStartTime: string;
  protectedBlockMinutes: number;
  availableFlexMinutes: number;
  constraintWarning: string | null;
};

export function buildSleepSchedule(input: SleepScheduleInput): SleepSchedule {
  const workStartMinutes = parseClockTime(input.workStart);
  const requiredSleepMinutes =
    input.requiredSleepMinutes ?? REQUIRED_SLEEP_MINUTES;
  const shutdownMinutes = input.shutdownMinutes ?? DEFAULT_SHUTDOWN_MINUTES;

  assertWholeMinutes(requiredSleepMinutes, "requiredSleepMinutes");
  assertWholeMinutes(input.morningRoutineMinutes, "morningRoutineMinutes");
  assertWholeMinutes(input.commuteBufferMinutes, "commuteBufferMinutes");
  assertShutdownMinutes(shutdownMinutes);

  const morningBlockMinutes =
    input.morningRoutineMinutes + input.commuteBufferMinutes;
  const protectedBlockMinutes =
    requiredSleepMinutes + morningBlockMinutes + shutdownMinutes;
  const availableFlexMinutes = DAY_MINUTES - protectedBlockMinutes;
  const wakeTimeMinutes = workStartMinutes - morningBlockMinutes;
  const latestBedtimeMinutes = wakeTimeMinutes - requiredSleepMinutes;
  const shutdownStartTimeMinutes = latestBedtimeMinutes - shutdownMinutes;

  return {
    workStart: input.workStart,
    requiredSleepMinutes,
    morningRoutineMinutes: input.morningRoutineMinutes,
    commuteBufferMinutes: input.commuteBufferMinutes,
    shutdownMinutes,
    wakeTime: formatClockTime(wakeTimeMinutes),
    latestBedtime: formatClockTime(latestBedtimeMinutes),
    shutdownStartTime: formatClockTime(shutdownStartTimeMinutes),
    protectedBlockMinutes,
    availableFlexMinutes,
    constraintWarning:
      availableFlexMinutes < 0
        ? `Reduce the plan by ${formatDuration(
            Math.abs(availableFlexMinutes),
          )}.`
        : null,
  };
}

export function parseClockTime(value: string): number {
  const match = CLOCK_TIME_PATTERN.exec(value);

  if (!match) {
    throw new RangeError(`Invalid clock time: ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClockTime(totalMinutes: number): string {
  const normalizedMinutes =
    ((totalMinutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;

  return `${padTimePart(hours)}:${padTimePart(minutes)}`;
}

export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const roundedMinutes = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${sign}${minutes}m`;
  }

  if (minutes === 0) {
    return `${sign}${hours}h`;
  }

  return `${sign}${hours}h ${minutes}m`;
}

function assertWholeMinutes(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a whole number of minutes.`);
  }
}

function assertShutdownMinutes(shutdownMinutes: number): void {
  assertWholeMinutes(shutdownMinutes, "shutdownMinutes");

  if (
    shutdownMinutes < MIN_SHUTDOWN_MINUTES ||
    shutdownMinutes > MAX_SHUTDOWN_MINUTES
  ) {
    throw new RangeError(
      `shutdownMinutes must be between ${MIN_SHUTDOWN_MINUTES} and ${MAX_SHUTDOWN_MINUTES}.`,
    );
  }
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, "0");
}
