export type RoutineStep = {
  id: string;
  label: string;
};

export type RoutineDay = {
  date: string; // YYYY-MM-DD
  minutesByStepId: Record<string, number>;
};

export type MorningRoutineProfiler = {
  steps: RoutineStep[];
  days: RoutineDay[];
};

export type RoutineLeak = {
  stepId: string;
  label: string;
  totalMinutes: number;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createDefaultMorningRoutineProfiler(): MorningRoutineProfiler {
  return {
    steps: [
      { id: "wake", label: "Wake + bathroom" },
      { id: "meds", label: "Meds + water" },
      { id: "hygiene", label: "Hygiene" },
      { id: "clothes", label: "Clothes" },
      { id: "out", label: "Out the door" },
    ],
    days: [],
  };
}

export function clampWholeMinutes(value: unknown, max = 900): number {
  const minutes = typeof value === "number" ? value : Number(value);
  const rounded = Number.isFinite(minutes) ? Math.round(minutes) : 0;
  const clamped = Math.min(max, Math.max(0, rounded));
  return clamped;
}

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  const [yearPart, monthPart, dayPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function pruneToLastNDays(
  days: RoutineDay[],
  todayKey: string,
  keepDays: number,
): RoutineDay[] {
  if (!isDateKey(todayKey)) {
    throw new RangeError(`Invalid todayKey: ${todayKey}`);
  }

  const todayEpochDay = dateKeyToEpochDay(todayKey);
  const minEpochDay = todayEpochDay - (keepDays - 1);

  return days
    .filter((day) => isDateKey(day.date))
    .filter((day) => {
      const epochDay = dateKeyToEpochDay(day.date);
      return epochDay >= minEpochDay && epochDay <= todayEpochDay;
    })
    .sort((a, b) => dateKeyToEpochDay(a.date) - dateKeyToEpochDay(b.date));
}

export function setStepLabel(
  profiler: MorningRoutineProfiler,
  stepId: string,
  label: string,
): MorningRoutineProfiler {
  return {
    ...profiler,
    steps: profiler.steps.map((step) =>
      step.id === stepId ? { ...step, label } : step,
    ),
  };
}

export function addStep(
  profiler: MorningRoutineProfiler,
  step: RoutineStep,
): MorningRoutineProfiler {
  if (!step.id.trim()) {
    throw new RangeError("Step id must be non-empty.");
  }

  if (profiler.steps.some((existing) => existing.id === step.id)) {
    throw new RangeError(`Step id already exists: ${step.id}`);
  }

  return { ...profiler, steps: [...profiler.steps, step] };
}

export function removeStep(
  profiler: MorningRoutineProfiler,
  stepId: string,
): MorningRoutineProfiler {
  const steps = profiler.steps.filter((step) => step.id !== stepId);
  const days = profiler.days.map((day) => {
    if (!(stepId in day.minutesByStepId)) {
      return day;
    }

    const remaining = { ...day.minutesByStepId };
    delete remaining[stepId];
    return { ...day, minutesByStepId: remaining };
  });

  return { steps, days };
}

export function setStepMinutesForDay(
  profiler: MorningRoutineProfiler,
  dateKey: string,
  stepId: string,
  minutes: number,
  todayKey: string,
  keepDays = 7,
): MorningRoutineProfiler {
  if (!isDateKey(dateKey)) {
    throw new RangeError(`Invalid dateKey: ${dateKey}`);
  }
  if (!isDateKey(todayKey)) {
    throw new RangeError(`Invalid todayKey: ${todayKey}`);
  }

  const normalizedMinutes = clampWholeMinutes(minutes);

  const nextDays = profiler.days
    .filter((day) => day.date !== dateKey)
    .concat({
      date: dateKey,
      minutesByStepId: {
        ...(profiler.days.find((day) => day.date === dateKey)?.minutesByStepId ??
          {}),
        [stepId]: normalizedMinutes,
      },
    });

  return {
    ...profiler,
    days: pruneToLastNDays(nextDays, todayKey, keepDays),
  };
}

export function totalMinutesForDay(
  profiler: MorningRoutineProfiler,
  dateKey: string,
): number {
  const day = profiler.days.find((candidate) => candidate.date === dateKey);
  if (!day) {
    return 0;
  }

  return Object.values(day.minutesByStepId).reduce(
    (sum, value) => sum + clampWholeMinutes(value),
    0,
  );
}

export function measuredMorningRoutineMinutes(
  profiler: MorningRoutineProfiler,
  todayKey: string,
  keepDays = 7,
  step = 5,
): number | null {
  const days = pruneToLastNDays(profiler.days, todayKey, keepDays);
  const totals = days
    .map((day) => Object.values(day.minutesByStepId).reduce(sumMinutes, 0))
    .map((total) => clampWholeMinutes(total));

  const nonZeroTotals = totals.filter((value) => value > 0);
  if (nonZeroTotals.length === 0) {
    return null;
  }

  const average = nonZeroTotals.reduce((sum, value) => sum + value, 0) /
    nonZeroTotals.length;
  return roundToStep(average, step);
}

export function topTimeLeaks(
  profiler: MorningRoutineProfiler,
  todayKey: string,
  keepDays = 7,
  limit = 3,
): RoutineLeak[] {
  const days = pruneToLastNDays(profiler.days, todayKey, keepDays);
  const totalsByStepId = new Map<string, number>();

  for (const day of days) {
    for (const [stepId, minutes] of Object.entries(day.minutesByStepId)) {
      totalsByStepId.set(
        stepId,
        (totalsByStepId.get(stepId) ?? 0) + clampWholeMinutes(minutes),
      );
    }
  }

  const stepLabelById = new Map(
    profiler.steps.map((step) => [step.id, step.label] as const),
  );

  const leaks: RoutineLeak[] = Array.from(totalsByStepId.entries())
    .filter(([, total]) => total > 0)
    .map(([stepId, totalMinutes]) => ({
      stepId,
      label: stepLabelById.get(stepId) ?? stepId,
      totalMinutes,
    }))
    .sort((a, b) => {
      if (b.totalMinutes !== a.totalMinutes) {
        return b.totalMinutes - a.totalMinutes;
      }
      return a.stepId.localeCompare(b.stepId);
    });

  return leaks.slice(0, limit);
}

export function serializeProfiler(profiler: MorningRoutineProfiler): string {
  return JSON.stringify(profiler);
}

export function parseProfiler(json: string): MorningRoutineProfiler | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Partial<MorningRoutineProfiler>;
    if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.days)) {
      return null;
    }

    const steps = candidate.steps
      .filter((step): step is RoutineStep =>
        Boolean(step) &&
        typeof (step as RoutineStep).id === "string" &&
        typeof (step as RoutineStep).label === "string",
      )
      .map((step) => ({ id: step.id, label: step.label }));

    const days = candidate.days
      .filter((day): day is RoutineDay =>
        Boolean(day) &&
        typeof (day as RoutineDay).date === "string" &&
        (day as RoutineDay).minutesByStepId !== null &&
        typeof (day as RoutineDay).minutesByStepId === "object",
      )
      .map((day) => ({
        date: day.date,
        minutesByStepId: sanitizeMinutesByStepId(day.minutesByStepId),
      }));

    return { steps, days };
  } catch {
    return null;
  }
}

function sanitizeMinutesByStepId(
  value: RoutineDay["minutesByStepId"],
): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, minutes] of Object.entries(value)) {
    output[key] = clampWholeMinutes(minutes);
  }
  return output;
}

function sumMinutes(sum: number, value: unknown): number {
  return sum + clampWholeMinutes(value);
}

function roundToStep(value: number, step: number): number {
  const safeStep = Math.max(1, Math.round(step));
  const rounded = Math.round(value);
  return Math.round(rounded / safeStep) * safeStep;
}

function dateKeyToEpochDay(value: string): number {
  if (!isDateKey(value)) {
    throw new RangeError(`Invalid date key: ${value}`);
  }

  const [yearPart, monthPart, dayPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);

  const epochMs = Date.UTC(year, month - 1, day);
  return Math.floor(epochMs / 86_400_000);
}
