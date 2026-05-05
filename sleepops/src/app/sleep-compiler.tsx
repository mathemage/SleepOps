"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  REQUIRED_SLEEP_MINUTES,
  buildSleepSchedule,
  formatDuration,
} from "@/lib/sleep";
import {
  addStep,
  createDefaultMorningRoutineProfiler,
  measuredMorningRoutineMinutes,
  parseProfiler,
  pruneToLastNDays,
  removeStep,
  serializeProfiler,
  setStepLabel,
  setStepMinutesForDay,
  toDateKey,
  topTimeLeaks,
  totalMinutesForDay,
  type MorningRoutineProfiler,
} from "@/lib/routine";

const MINUTES_STEP = 5;
const MAX_ROUTINE_MINUTES = 900;
const MAX_BUFFER_MINUTES = 240;
const PROFILER_STORAGE_KEY = "sleepops.morningRoutineProfiler.v1";
const PROFILER_CHANGE_EVENT = "sleepops.morningRoutineProfiler.change";

export function SleepCompiler() {
  const [workStart, setWorkStart] = useState("09:00");
  const [manualMorningRoutineMinutes, setManualMorningRoutineMinutes] =
    useState(75);
  const [useProfiledMorningRoutine, setUseProfiledMorningRoutine] =
    useState(false);
  const [commuteBufferMinutes, setCommuteBufferMinutes] = useState(30);

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [recordDateKey, setRecordDateKey] = useState(todayKey);
  const [profiler, updateProfiler] = useMorningRoutineProfiler(todayKey);
  const [newStepLabel, setNewStepLabel] = useState("");

  const profiledMorningRoutineMinutes = useMemo(
    () => measuredMorningRoutineMinutes(profiler, todayKey, 7, MINUTES_STEP),
    [profiler, todayKey],
  );

  const canUseProfiled = profiledMorningRoutineMinutes !== null;

  const effectiveMorningRoutineMinutes =
    useProfiledMorningRoutine && profiledMorningRoutineMinutes !== null
      ? profiledMorningRoutineMinutes
      : manualMorningRoutineMinutes;

  const schedule = useMemo(
    () =>
      buildSleepSchedule({
        workStart,
        morningRoutineMinutes: effectiveMorningRoutineMinutes,
        commuteBufferMinutes,
      }),
    [workStart, effectiveMorningRoutineMinutes, commuteBufferMinutes],
  );

  const hasWarning = schedule.constraintWarning !== null;

  const results = [
    { label: "Wake time", value: schedule.wakeTime },
    { label: "Latest bedtime", value: schedule.latestBedtime },
    { label: "Shutdown start", value: schedule.shutdownStartTime },
    { label: "Day flex", value: formatDuration(schedule.availableFlexMinutes) },
  ];

  const rail = [
    {
      label: "Shutdown",
      value: schedule.shutdownStartTime,
      className: "border-[#c2410c] bg-[#fed7aa]",
    },
    {
      label: "Lights out",
      value: schedule.latestBedtime,
      className: "border-[#15803d] bg-[#bbf7d0]",
    },
    {
      label: "Wake",
      value: schedule.wakeTime,
      className: "border-[#1d4ed8] bg-[#bfdbfe]",
    },
  ];

  return (
    <main className="min-h-screen bg-[#f6f8f7] px-4 py-5 text-[#18181b] sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="flex flex-col justify-between gap-8 border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-6 lg:p-8">
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-[#166534]">
                SleepOps
              </p>
              <h1 className="mt-2 max-w-lg text-4xl font-semibold leading-tight text-[#18181b] sm:text-5xl">
                Tonight&apos;s shutdown deadline
              </h1>
            </div>

            <div
              aria-live={hasWarning ? "assertive" : "polite"}
              className={`border p-4 ${
                hasWarning
                  ? "border-[#b91c1c] bg-[#fee2e2]"
                  : "border-[#15803d] bg-[#dcfce7]"
              }`}
              role={hasWarning ? "alert" : "status"}
            >
              <p className="text-sm font-semibold">
                {hasWarning ? "Constraint violated" : "Next action"}
              </p>
              <p className="mt-2 text-2xl font-semibold leading-snug">
                {hasWarning
                  ? schedule.constraintWarning
                  : `Start shutdown by ${schedule.shutdownStartTime}`}
              </p>
            </div>
          </div>

          <div className="grid gap-3 text-sm text-[#52525b]">
            <div className="flex items-center justify-between gap-4 border-t border-[#e4e7e4] pt-4">
              <span>Required sleep</span>
              <strong className="text-[#18181b]">
                {formatDuration(REQUIRED_SLEEP_MINUTES)}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[#e4e7e4] pt-4">
              <span>Shutdown duration</span>
              <strong className="text-[#18181b]">
                {formatDuration(schedule.shutdownMinutes)}
              </strong>
            </div>
          </div>
        </section>

        <section className="grid gap-5">
          <form
            className="grid gap-5 border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-6"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="grid gap-2 text-sm font-medium text-[#3f3f46]">
              Work start time
              <input
                className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-lg font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                onChange={(event) =>
                  setWorkStart(event.currentTarget.value || "00:00")
                }
                type="time"
                value={workStart}
              />
            </label>

            <DurationControl
              id="morning-routine"
              label="Morning routine duration"
              max={MAX_ROUTINE_MINUTES}
              onChange={setManualMorningRoutineMinutes}
              value={effectiveMorningRoutineMinutes}
              disabled={useProfiledMorningRoutine && canUseProfiled}
            />

            <label className="flex items-start gap-3 border border-[#d8dfda] bg-[#fbfcfb] p-3 text-sm text-[#3f3f46]">
              <input
                checked={useProfiledMorningRoutine}
                className="mt-1 accent-[#166534]"
                disabled={!canUseProfiled}
                onChange={(event) =>
                  setUseProfiledMorningRoutine(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                Use measured 7-day average
                <span className="ml-2 text-[#52525b]">
                  {canUseProfiled
                    ? `(${formatDuration(profiledMorningRoutineMinutes!)})`
                    : "(record a day to enable)"}
                </span>
              </span>
            </label>

            <DurationControl
              id="commute-buffer"
              label="Commute / buffer duration"
              max={MAX_BUFFER_MINUTES}
              onChange={setCommuteBufferMinutes}
              value={commuteBufferMinutes}
            />
          </form>

          <section className="border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-semibold">Morning routine profiler</h2>
              <p className="text-sm text-[#52525b]">Keeps the last 7 days locally.</p>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-[#3f3f46]">
                Day
                <input
                  className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-lg font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                  max={todayKey}
                  onChange={(event) =>
                    setRecordDateKey(event.currentTarget.value || todayKey)
                  }
                  type="date"
                  value={recordDateKey}
                />
              </label>

              <div className="grid gap-2">
                <p className="text-sm font-medium text-[#3f3f46]">
                  Steps (minutes)
                </p>
                <div className="grid gap-2">
                  {profiler.steps.map((step) => {
                    const dayMinutes =
                      profiler.days.find((day) => day.date === recordDateKey)
                        ?.minutesByStepId[step.id] ?? 0;

                    return (
                      <div
                        className="grid grid-cols-[1fr_120px_auto] items-center gap-2"
                        key={step.id}
                      >
                        <input
                          aria-label={`Step name ${step.id}`}
                          className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-sm font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                          onChange={(event) => {
                            const label = event.currentTarget.value;
                            updateProfiler((current) =>
                              setStepLabel(current, step.id, label),
                            );
                          }}
                          type="text"
                          value={step.label}
                        />
                        <input
                          aria-label={`Minutes ${step.id}`}
                          className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-lg font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                          inputMode="numeric"
                          max={MAX_ROUTINE_MINUTES}
                          min={0}
                          onChange={(event) => {
                            const minutes = Number(event.currentTarget.value);
                            updateProfiler((current) =>
                              setStepMinutesForDay(
                                current,
                                recordDateKey,
                                step.id,
                                minutes,
                                todayKey,
                                7,
                              ),
                            );
                          }}
                          step={1}
                          type="number"
                          value={dayMinutes}
                        />
                        <button
                          aria-label={`Remove step ${step.id}`}
                          className="h-12 border border-[#d8dfda] bg-white px-3 text-sm font-semibold text-[#18181b] hover:bg-[#fbfcfb]"
                          onClick={() =>
                            updateProfiler((current) => removeStep(current, step.id))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <form
                className="grid gap-2 sm:grid-cols-[1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const label = newStepLabel.trim();
                  if (!label) {
                    return;
                  }

                  updateProfiler((current) =>
                    addStep(current, { id: makeStepId(), label }),
                  );
                  setNewStepLabel("");
                }}
              >
                <label className="grid gap-2 text-sm font-medium text-[#3f3f46]">
                  New step
                  <input
                    aria-label="New step name"
                    className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-sm font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                    onChange={(event) => setNewStepLabel(event.currentTarget.value)}
                    placeholder="e.g., Breakfast"
                    type="text"
                    value={newStepLabel}
                  />
                </label>
                <button
                  className="h-12 self-end border border-[#d8dfda] bg-white px-4 text-sm font-semibold text-[#18181b] hover:bg-[#fbfcfb]"
                  type="submit"
                >
                  Add step
                </button>
              </form>

              <div className="grid gap-2 border-t border-[#e4e7e4] pt-4 text-sm text-[#52525b]">
                <div className="flex items-center justify-between gap-4">
                  <span>Day total</span>
                  <strong className="text-[#18181b]">
                    {formatDuration(totalMinutesForDay(profiler, recordDateKey))}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>7-day measured average</span>
                  <strong className="text-[#18181b]">
                    {profiledMorningRoutineMinutes === null
                      ? "—"
                      : formatDuration(profiledMorningRoutineMinutes)}
                  </strong>
                </div>
              </div>

              <TopLeaks profiler={profiler} todayKey={todayKey} />
            </div>
          </section>

          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {results.map((result) => (
              <div
                className="min-h-32 border border-[#d8dfda] bg-white p-4 shadow-sm"
                key={result.label}
              >
                <dt className="text-sm font-medium text-[#52525b]">
                  {result.label}
                </dt>
                <dd className="mt-4 text-3xl font-semibold text-[#18181b]">
                  {result.value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-semibold">Tonight rail</h2>
              <p className="text-sm text-[#52525b]">
                {hasWarning
                  ? "The protected block is over capacity."
                  : `${formatDuration(
                      schedule.availableFlexMinutes,
                    )} remains outside protected blocks.`}
              </p>
            </div>

            <div className="mt-5 grid overflow-hidden border border-[#d8dfda] sm:grid-cols-3">
              {rail.map((item) => (
                <div
                  className={`min-h-28 border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${item.className}`}
                  key={item.label}
                >
                  <p className="text-sm font-medium text-[#27272a]">
                    {item.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-[#18181b]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

type DurationControlProps = {
  id: string;
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

function DurationControl({
  id,
  label,
  max,
  value,
  onChange,
  disabled = false,
}: DurationControlProps) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="text-sm font-medium text-[#3f3f46]" htmlFor={id}>
          {label}
        </label>
        <div className="flex h-12 w-full items-center border border-[#cfd8d1] bg-[#fbfcfb] sm:w-36">
          <input
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-lg font-semibold text-[#18181b] outline-none focus:bg-white"
            disabled={disabled}
            id={id}
            max={max}
            min={0}
            onChange={(event) =>
              onChange(readMinutes(event.currentTarget, max, MINUTES_STEP))
            }
            step={MINUTES_STEP}
            type="number"
            value={value}
          />
          <span className="pr-3 text-sm font-medium text-[#52525b]">min</span>
        </div>
      </div>
      <input
        aria-label={`${label} slider`}
        className="h-2 w-full accent-[#166534]"
        disabled={disabled}
        max={max}
        min={0}
        onChange={(event) =>
          onChange(readMinutes(event.currentTarget, max, MINUTES_STEP))
        }
        step={MINUTES_STEP}
        type="range"
        value={value}
      />
    </div>
  );
}

function readMinutes(input: HTMLInputElement, max: number, step: number): number {
  const minutes = Number(input.value);
  const roundedMinutes = Number.isFinite(minutes) ? Math.round(minutes) : 0;
  const steppedMinutes = Math.round(roundedMinutes / step) * step;

  return Math.min(max, Math.max(0, steppedMinutes));
}

function TopLeaks({
  profiler,
  todayKey,
}: {
  profiler: MorningRoutineProfiler;
  todayKey: string;
}) {
  const leaks = useMemo(() => topTimeLeaks(profiler, todayKey, 7, 3), [
    profiler,
    todayKey,
  ]);

  if (leaks.length === 0) {
    return (
      <div className="border border-[#d8dfda] bg-[#fbfcfb] p-3 text-sm text-[#52525b]">
        Top time leaks will appear after you record a day.
      </div>
    );
  }

  return (
    <div className="grid gap-2 border border-[#d8dfda] bg-[#fbfcfb] p-3">
      <p className="text-sm font-semibold text-[#18181b]">
        Top time leaks (7 days)
      </p>
      <ol aria-label="Top time leaks" className="grid gap-1 text-sm text-[#3f3f46]">
        {leaks.map((leak) => (
          <li className="flex items-center justify-between gap-3" key={leak.stepId}>
            <span className="truncate">{leak.label}</span>
            <strong className="text-[#18181b]">
              {formatDuration(leak.totalMinutes)}
            </strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

function makeStepId(): string {
  if ("crypto" in globalThis && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `step_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function useMorningRoutineProfiler(todayKey: string) {
  const raw = useSyncExternalStore(
    subscribeToProfilerStore,
    () => globalThis.localStorage?.getItem(PROFILER_STORAGE_KEY) ?? null,
    () => null,
  );

  const profiler = useMemo(
    () => hydrateProfiler(raw, todayKey),
    [raw, todayKey],
  );

  const updateProfiler = (updater: (current: MorningRoutineProfiler) => MorningRoutineProfiler) => {
    if (!("localStorage" in globalThis)) {
      return;
    }

    const current = hydrateProfiler(
      globalThis.localStorage.getItem(PROFILER_STORAGE_KEY),
      todayKey,
    );
    const next = updater(current);

    globalThis.localStorage.setItem(PROFILER_STORAGE_KEY, serializeProfiler(next));
    globalThis.dispatchEvent(new Event(PROFILER_CHANGE_EVENT));
  };

  return [profiler, updateProfiler] as const;
}

function subscribeToProfilerStore(callback: () => void) {
  if (!("addEventListener" in globalThis)) {
    return () => {};
  }

  const handler = () => callback();
  globalThis.addEventListener("storage", handler);
  globalThis.addEventListener(PROFILER_CHANGE_EVENT, handler);
  return () => {
    globalThis.removeEventListener("storage", handler);
    globalThis.removeEventListener(PROFILER_CHANGE_EVENT, handler);
  };
}

function hydrateProfiler(
  raw: string | null,
  todayKey: string,
): MorningRoutineProfiler {
  const fallback = createDefaultMorningRoutineProfiler();
  if (!raw) {
    return fallback;
  }

  const parsed = parseProfiler(raw);
  if (!parsed) {
    return fallback;
  }

  return {
    steps: parsed.steps.length > 0 ? parsed.steps : fallback.steps,
    days: pruneToLastNDays(parsed.days, todayKey, 7),
  };
}
