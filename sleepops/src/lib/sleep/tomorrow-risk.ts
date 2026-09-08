import { compareDailyPlan, type DailyPlanRecord } from "../history/daily-plan";
import {
  measuredMorningRoutineMinutes,
  type MorningRoutineProfiler,
} from "../routine/profiler";
import { type RoutineCompression } from "../routine/compressor";
import { selectShutdownRoutineTasks } from "./shutdown";
import {
  assessSleepSchedule,
  buildSleepSchedule,
  DAY_MINUTES,
  DEFAULT_SHUTDOWN_MINUTES,
  formatClockTime,
  formatDuration,
  parseClockTime,
  type SleepSchedule,
} from "./schedule";

// Inclusive product thresholds, in minutes except for the recorded-miss count.
// The strongest signal wins; missing observations are not failures.
export const RISK_THRESHOLDS = {
  historyDays: 7,
  brokenOverbookedMinutes: 1,
  missedShutdowns: { medium: 1, high: 2 },
  routineOverrunMinutes: { medium: 15, high: 30 },
  sleepDeficitMinutes: { medium: 30, high: 60 },
} as const;

export const WORK_START_DELAY_MINUTES = 60;

export type RiskLevel = "low" | "medium" | "high" | "broken";
export type RiskReason = {
  signal: "overbooked" | "missed-shutdown" | "routine-trend" | "sleep-deficit";
  message: string;
};
export type RiskTradeoff = {
  workStartDelayMinutes: number;
  moves: string[];
  schedule: SleepSchedule;
  eveningMinutes: number;
  remainingOverbookedMinutes: number;
};
export type TomorrowRiskInput = {
  schedule: SleepSchedule;
  now: { date: string; time: string };
  // Date of the planned night; work is the following day, including after midnight.
  nightDate: string;
  eveningBlockMinutes: number;
  history: DailyPlanRecord[];
  profiler: MorningRoutineProfiler;
  compression: RoutineCompression;
};
export type TomorrowRisk = {
  level: RiskLevel;
  reasons: RiskReason[];
  tradeoffs: RiskTradeoff[];
  signals: {
    overbookedMinutes: number;
    missedShutdowns: number;
    routineOverrunMinutes: number;
    sleepDeficitMinutes: number;
  };
};

const MINUTE_MS = 60_000;
const DAY_MS = DAY_MINUTES * MINUTE_MS;

export function compileTomorrowRisk(input: TomorrowRiskInput): TomorrowRisk {
  const { schedule, now, history, profiler } = input;
  const earliestNight = new Date(
    Date.parse(`${now.date}T00:00:00Z`) - RISK_THRESHOLDS.historyDays * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  const recentHistory = history.filter(
    (record) => record.date >= earliestNight && record.date < now.date,
  );
  let sleepDeficitMinutes = 0;
  let missedShutdowns = 0;
  for (const record of recentHistory) {
    const comparison = compareDailyPlan(record);
    if (comparison.actualSleepMinutes !== null) {
      // Each night owes its own contract. A long night does not erase a short one.
      sleepDeficitMinutes += Math.max(
        0,
        record.plan.requiredSleepMinutes - comparison.actualSleepMinutes,
      );
    }
    if (comparison.missedShutdown) missedShutdowns += 1;
  }
  const measuredMinutes = measuredMorningRoutineMinutes(
    profiler,
    now.date,
    RISK_THRESHOLDS.historyDays,
    1,
  );
  const routineOverrunMinutes = Math.max(
    0,
    (measuredMinutes ?? schedule.morningRoutineMinutes) -
      schedule.morningRoutineMinutes,
  );
  const { overbookedMinutes } = assessCandidate(
    input,
    schedule,
    input.eveningBlockMinutes,
  );
  const signals = {
    overbookedMinutes,
    missedShutdowns,
    routineOverrunMinutes,
    sleepDeficitMinutes,
  };
  const reasons: RiskReason[] = [];
  if (overbookedMinutes > 0)
    reasons.push({
      signal: "overbooked",
      message: `The remaining plan is overbooked by ${formatDuration(overbookedMinutes)}.`,
    });
  if (missedShutdowns > 0)
    reasons.push({
      signal: "missed-shutdown",
      message: `${missedShutdowns} recorded late shutdown${missedShutdowns === 1 ? "" : "s"} in the last ${RISK_THRESHOLDS.historyDays} nights.`,
    });
  if (routineOverrunMinutes > 0)
    reasons.push({
      signal: "routine-trend",
      message: `Your measured morning averages ${formatDuration(routineOverrunMinutes)} longer than this plan.`,
    });
  if (sleepDeficitMinutes > 0)
    reasons.push({
      signal: "sleep-deficit",
      message: `${formatDuration(sleepDeficitMinutes)} of sleep deficit across recorded nights in the last ${RISK_THRESHOLDS.historyDays} nights.`,
    });
  const level: RiskLevel =
    overbookedMinutes >= RISK_THRESHOLDS.brokenOverbookedMinutes
      ? "broken"
      : missedShutdowns >= RISK_THRESHOLDS.missedShutdowns.high ||
          routineOverrunMinutes >= RISK_THRESHOLDS.routineOverrunMinutes.high ||
          sleepDeficitMinutes >= RISK_THRESHOLDS.sleepDeficitMinutes.high
        ? "high"
        : missedShutdowns >= RISK_THRESHOLDS.missedShutdowns.medium ||
            routineOverrunMinutes >=
              RISK_THRESHOLDS.routineOverrunMinutes.medium ||
            sleepDeficitMinutes >= RISK_THRESHOLDS.sleepDeficitMinutes.medium
          ? "medium"
          : "low";
  return {
    level,
    reasons,
    signals,
    tradeoffs: level === "broken" ? buildTradeoffs(input) : [],
  };
}

function assessCandidate(
  input: TomorrowRiskInput,
  schedule: SleepSchedule,
  eveningMinutes: number,
  workStartDelayMinutes = 0,
) {
  // UTC is only a coordinate system for local wall-clock inputs, not a clock read.
  const work =
    Date.parse(`${input.nightDate}T${input.schedule.workStart}:00Z`) +
    DAY_MS +
    workStartDelayMinutes * MINUTE_MS;
  const now = Date.parse(`${input.now.date}T${input.now.time}:00Z`);
  return assessSleepSchedule(
    schedule,
    (work - now) / MINUTE_MS,
    eveningMinutes,
  );
}

function buildTradeoffs(input: TomorrowRiskInput): RiskTradeoff[] {
  const { schedule, compression } = input;
  const selected = selectShutdownRoutineTasks({
    availableMinutes: schedule.shutdownMinutes - DEFAULT_SHUTDOWN_MINUTES,
    eveningTasks: compression.eveningTasks,
    eveningPreparationTasks: compression.eveningPreparationTasks,
  });
  const selectedIds = new Set(
    [...selected.eveningTasks, ...selected.eveningPreparationTasks].map(
      (task) => task.stepId,
    ),
  );
  const morningOptions = [
    {
      minutes: schedule.morningRoutineMinutes,
      extraEvening: 0,
      moves: [] as string[],
    },
  ];
  // Only subtract a named task when the current morning still contains the full routine.
  if (schedule.morningRoutineMinutes >= compression.totalProfiledMinutes) {
    for (const task of [
      ...compression.eveningTasks,
      ...compression.eveningPreparationTasks,
    ]) {
      morningOptions.push({
        minutes: schedule.morningRoutineMinutes - task.minutes,
        extraEvening: selectedIds.has(task.stepId) ? 0 : task.minutes,
        moves: [
          `Move ${task.label} to evening (${formatDuration(task.minutes)})`,
        ],
      });
    }
  }
  if (compression.minimumMorningMinutes < schedule.morningRoutineMinutes) {
    morningOptions.push({
      minutes: compression.minimumMorningMinutes,
      // Tasks that do not fit the shutdown assistant still need time before shutdown.
      extraEvening:
        compression.eveningMinutes +
        compression.eveningPreparationMinutes -
        selected.totalMinutes,
      moves: [
        `Use the compressed morning routine (${formatDuration(compression.minimumMorningMinutes)})`,
        ...[
          ...compression.eveningTasks,
          ...compression.eveningPreparationTasks,
        ].map(
          (task) =>
            `Move ${task.label} to evening (${formatDuration(task.minutes)})`,
        ),
      ],
    });
  }
  const candidates: RiskTradeoff[] = [];
  for (const morning of morningOptions) {
    for (const dropEvening of input.eveningBlockMinutes > 0
      ? [false, true]
      : [false]) {
      for (const workStartDelayMinutes of [0, WORK_START_DELAY_MINUTES]) {
        const delayedWorkStart =
          parseClockTime(schedule.workStart) + workStartDelayMinutes;
        const workStart = formatClockTime(delayedWorkStart);
        const dayLabel =
          delayedWorkStart >= DAY_MINUTES ? " the following day" : "";
        const moves = [
          ...(dropEvening
            ? [
                `Remove the evening block (${formatDuration(input.eveningBlockMinutes)})`,
              ]
            : []),
          ...morning.moves,
          ...(workStartDelayMinutes > 0
            ? [`Start work at ${workStart}${dayLabel}`]
            : []),
        ];
        if (moves.length === 0) continue;
        const candidateSchedule = buildSleepSchedule({
          ...schedule,
          workStart,
          morningRoutineMinutes: morning.minutes,
        });
        const eveningMinutes =
          (dropEvening ? 0 : input.eveningBlockMinutes) + morning.extraEvening;
        candidates.push({
          workStartDelayMinutes,
          moves,
          schedule: candidateSchedule,
          eveningMinutes,
          remainingOverbookedMinutes: assessCandidate(
            input,
            candidateSchedule,
            eveningMinutes,
            workStartDelayMinutes,
          ).overbookedMinutes,
        });
      }
    }
  }
  const fitting = candidates.filter(
    (candidate) => candidate.remainingOverbookedMinutes === 0,
  );
  // Keep minimal sets of moves. Never present a partial improvement as a solution.
  const minimal = fitting.filter(
    (candidate, index) =>
      !fitting.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.moves.every((move) => candidate.moves.includes(move)) &&
          (other.moves.length < candidate.moves.length || otherIndex < index),
      ),
  );
  if (minimal.length > 0) return minimal;
  const best = candidates.sort(
    (a, b) =>
      a.remainingOverbookedMinutes - b.remainingOverbookedMinutes ||
      a.moves.length - b.moves.length,
  )[0];
  return best ? [best] : [];
}
