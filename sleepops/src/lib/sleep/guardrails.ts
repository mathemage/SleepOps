import { DAY_MINUTES, formatClockTime, type SleepSchedule } from "./schedule";

// Gardiner 2023: round the 8.8h estimate for ~107mg coffee to 9h.
// Population starting point, not an all-dose guarantee; dose/sensitivity matter.
// https://doi.org/10.1016/j.smrv.2023.101764
export const CAFFEINE_BUFFER_MINUTES = 540;
// Product heuristic, not a validated interval or advice that everyone should nap.
// Boukhris studied naps ENDING at 15:00, not an 8h cutoff:
// https://pmc.ncbi.nlm.nih.gov/articles/PMC12856117/
export const NAP_END_BUFFER_MINUTES = 480;
// Practical disengagement heuristic. REST-O does not prove an optimal interval:
// https://doi.org/10.1016/j.sleep.2025.02.043
export const SCREEN_OFF_BUFFER_MINUTES = 60;
// Product transition cues, not research-derived thresholds.
export const FIRST_SHUTDOWN_WARNING_MINUTES = 30;
export const FINAL_SHUTDOWN_WARNING_MINUTES = 10;

export type GuardrailId =
  | "caffeine-cutoff"
  | "nap-cutoff"
  | "screen-off"
  | "laptop-off"
  | "shutdown-warning-30"
  | "shutdown-warning-10";

export type Guardrail = {
  id: GuardrailId;
  // Relative to midnight on the work day, including negative/multiple days.
  minuteOffset: number;
  dayOffset: number;
  date: string;
  time: string;
};

export function guardrailStatus(rail: Guardrail, now: { date: string; time: string }) {
  const deadline = `${rail.date}T${rail.time}`;
  const current = `${now.date}T${now.time}`;
  // ISO local date + time order retains the occurrence across midnight.
  return deadline < current ? "Passed" : deadline === current ? "Due now" : "Upcoming";
}

/** Same convention as risk/history: work occurs the day after nightDate.
 * Dates are local wall-calendar coordinates, not UTC reminder instants.
 * No clock read or rollover: passed rails retain this plan's occurrence.
 */
export function buildGuardrails(schedule: SleepSchedule, nightDate: string): Guardrail[] {
  const { lightsOut, shutdown } = schedule.timeline;
  const screenOff = lightsOut - SCREEN_OFF_BUFFER_MINUTES;
  const offsets: [GuardrailId, number][] = [
    ["caffeine-cutoff", lightsOut - CAFFEINE_BUFFER_MINUTES],
    ["nap-cutoff", lightsOut - NAP_END_BUFFER_MINUTES],
    ["screen-off", screenOff],
    // Product rule: finish laptop work by BOTH deadlines; compare occurrences.
    ["laptop-off", Math.min(shutdown, screenOff)],
    ["shutdown-warning-30", shutdown - FIRST_SHUTDOWN_WARNING_MINUTES],
    ["shutdown-warning-10", shutdown - FINAL_SHUTDOWN_WARNING_MINUTES],
  ];
  return offsets.map(([id, minuteOffset]) => {
    const dayOffset = Math.floor(minuteOffset / DAY_MINUTES);
    // UTC is only a coordinate system for wall-calendar arithmetic, as in risk.
    const date = new Date(
      Date.parse(`${nightDate}T00:00:00Z`) + (1 + dayOffset) * DAY_MINUTES * 60_000,
    ).toISOString().slice(0, 10);
    return { id, minuteOffset, dayOffset, date, time: formatClockTime(minuteOffset) };
  }).sort((a, b) => a.minuteOffset - b.minuteOffset);
}
