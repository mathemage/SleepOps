"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_SHUTDOWN_MINUTES,
  MAX_SHUTDOWN_MINUTES,
  REQUIRED_SLEEP_MINUTES,
  buildShutdownActions,
  buildShutdownWindow,
  buildSleepSchedule,
  formatClockTime,
  formatDuration,
  getShutdownProgress,
  isShutdownWindowActive,
  parseClockTime,
  selectShutdownRoutineTasks,
  type ShutdownProgress,
  type ShutdownWindow,
} from "@/lib/sleep";
import {
  getNextClockDelayMs,
  resolveShutdownNotificationSupport,
  type ShutdownNotificationSupport,
} from "@/lib/pwa/notifications";
import {
  MAX_COMMUTE_BUFFER_MINUTES,
  MAX_MORNING_ROUTINE_MINUTES,
  SLEEPOPS_STATE_STORAGE_KEY,
  SLEEPOPS_MINUTES_STEP,
  parseSleepOpsCoreState,
  serializeSleepOpsCoreState,
  type SleepOpsCoreState,
} from "@/lib/pwa/sleepops-state";
import { readCachedString, writeCachedString } from "@/lib/pwa/storage";
import {
  addStep,
  compressMorningRoutine,
  createDefaultMorningRoutineProfiler,
  defaultStepMinutes,
  measuredMorningRoutineMinutes,
  parseProfiler,
  pruneToLastNDays,
  removeStep,
  serializeProfiler,
  setStepClassification,
  setStepLabel,
  setStepMinutesForDay,
  toDateKey,
  topTimeLeaks,
  type CompressedRoutineTask,
  type MorningRoutineProfiler,
  type RoutineCompression,
  type RoutineStepClassification,
} from "@/lib/routine";

const PROFILER_RETENTION_DAYS = 7;
const PROFILER_STORAGE_KEY = "sleepops.morningRoutineProfiler.v1";
const PROFILER_CHANGE_EVENT = "sleepops.morningRoutineProfiler.change";
const SERVICE_WORKER_SUPPORT_FALLBACK_MS = 5_000;
const SERVICE_WORKER_READY_CHECK_MS = 1_000;
const CORE_STATE_WRITE_DEBOUNCE_MS = 250;
const STEP_CLASSIFICATION_OPTIONS: Array<{
  value: RoutineStepClassification;
  label: string;
}> = [
  { value: "required-morning", label: "Required morning" },
  { value: "movable-evening", label: "Move to evening" },
  { value: "decision-setup", label: "Prep tonight" },
];

function readInitialCoreState(): SleepOpsCoreState {
  if (typeof window === "undefined") {
    return parseSleepOpsCoreState(null);
  }

  return parseSleepOpsCoreState(readCachedString(SLEEPOPS_STATE_STORAGE_KEY));
}

export function SleepCompiler() {
  const [initialCoreState] = useState(readInitialCoreState);
  const [workStart, setWorkStart] = useState(initialCoreState.workStart);
  const [manualMorningRoutineMinutes, setManualMorningRoutineMinutes] =
    useState(initialCoreState.manualMorningRoutineMinutes);
  const [useProfiledMorningRoutine, setUseProfiledMorningRoutine] =
    useState(initialCoreState.useProfiledMorningRoutine);
  const [commuteBufferMinutes, setCommuteBufferMinutes] = useState(
    initialCoreState.commuteBufferMinutes,
  );
  const [shutdownPreviewMode, setShutdownPreviewMode] = useState(false);
  const [shutdownProgressState, setShutdownProgressState] =
    useState<ShutdownProgressState>({
      ...initialCoreState.shutdownProgressState,
    });
  const [shutdownRemindersEnabled, setShutdownRemindersEnabled] = useState(
    initialCoreState.shutdownRemindersEnabled,
  );
  const currentClock = useCurrentClock();

  const serializedCoreState = useMemo(
    () =>
      serializeSleepOpsCoreState({
        workStart,
        manualMorningRoutineMinutes,
        useProfiledMorningRoutine,
        commuteBufferMinutes,
        shutdownProgressState,
        shutdownRemindersEnabled,
      }),
    [
      commuteBufferMinutes,
      manualMorningRoutineMinutes,
      shutdownProgressState,
      shutdownRemindersEnabled,
      useProfiledMorningRoutine,
      workStart,
    ],
  );
  const latestSerializedCoreState = useRef(serializedCoreState);

  useLayoutEffect(() => {
    latestSerializedCoreState.current = serializedCoreState;
  }, [serializedCoreState]);

  useEffect(() => {
    const persistCoreState = () => {
      writeCachedString(SLEEPOPS_STATE_STORAGE_KEY, serializedCoreState);
    };

    const timeoutId = window.setTimeout(
      persistCoreState,
      CORE_STATE_WRITE_DEBOUNCE_MS,
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [serializedCoreState]);

  useEffect(() => {
    const persistLatestCoreState = () => {
      writeCachedString(
        SLEEPOPS_STATE_STORAGE_KEY,
        latestSerializedCoreState.current,
      );
    };

    window.addEventListener("pagehide", persistLatestCoreState);

    return () => {
      window.removeEventListener("pagehide", persistLatestCoreState);
    };
  }, []);

  const { recordDateKey, retainedStartKey, setRecordDateKey, todayKey } =
    useProfilerDateKeys();
  const [profiler, updateProfiler] = useMorningRoutineProfiler(todayKey);
  const [newStepLabel, setNewStepLabel] = useState("");

  const profiledMorningRoutineMinutes = useMemo(
    () => {
      if (!todayKey) {
        return null;
      }

      return measuredMorningRoutineMinutes(
        profiler,
        todayKey,
        PROFILER_RETENTION_DAYS,
        SLEEPOPS_MINUTES_STEP,
      );
    },
    [profiler, todayKey],
  );

  const canUseProfiled = profiledMorningRoutineMinutes !== null;

  useEffect(() => {
    if (!canUseProfiled && useProfiledMorningRoutine) {
      const timeoutId = setTimeout(() => {
        setUseProfiledMorningRoutine(false);
      }, 0);

      return () => clearTimeout(timeoutId);
    }
  }, [canUseProfiled, useProfiledMorningRoutine]);

  const updateMorningProfiler = (
    updater: (current: MorningRoutineProfiler) => MorningRoutineProfiler,
  ) => {
    updateProfiler((current) => {
      const next = updater(current);
      if (todayKey) {
        const nextProfiledMinutes = measuredMorningRoutineMinutes(
          next,
          todayKey,
          PROFILER_RETENTION_DAYS,
          SLEEPOPS_MINUTES_STEP,
        );

        if (nextProfiledMinutes === null) {
          setUseProfiledMorningRoutine(false);
        }
      }

      return next;
    });
  };

  const effectiveMorningRoutineMinutes =
    useProfiledMorningRoutine && profiledMorningRoutineMinutes !== null
      ? profiledMorningRoutineMinutes
      : manualMorningRoutineMinutes;
  const recordDayMinutesByStepId =
    profiler.days.find((day) => day.date === recordDateKey)?.minutesByStepId;
  const routineCompression: RoutineCompression = useMemo(
    () => compressMorningRoutine(profiler, recordDayMinutesByStepId),
    [profiler, recordDayMinutesByStepId],
  );
  const selectedShutdownTasks = useMemo(
    () =>
      selectShutdownRoutineTasks({
        availableMinutes: MAX_SHUTDOWN_MINUTES - DEFAULT_SHUTDOWN_MINUTES,
        eveningTasks: routineCompression.eveningTasks,
        eveningPreparationTasks: routineCompression.eveningPreparationTasks,
      }),
    [
      routineCompression.eveningTasks,
      routineCompression.eveningPreparationTasks,
    ],
  );

  const schedule = useMemo(
    () =>
      buildSleepSchedule({
        workStart,
        morningRoutineMinutes: effectiveMorningRoutineMinutes,
        commuteBufferMinutes,
        shutdownMinutes:
          DEFAULT_SHUTDOWN_MINUTES + selectedShutdownTasks.totalMinutes,
      }),
    [
      workStart,
      effectiveMorningRoutineMinutes,
      commuteBufferMinutes,
      selectedShutdownTasks.totalMinutes,
    ],
  );

  const hasWarning = schedule.constraintWarning !== null;
  const shutdownWindow = useMemo(
    () =>
      buildShutdownWindow({
        lightsOutTime: schedule.latestBedtime,
        shutdownMinutes: schedule.shutdownMinutes,
      }),
    [schedule.latestBedtime, schedule.shutdownMinutes],
  );
  const shutdownActions = useMemo(
    () =>
      buildShutdownActions({
        eveningTasks: selectedShutdownTasks.eveningTasks,
        eveningPreparationTasks: selectedShutdownTasks.eveningPreparationTasks,
      }),
    [
      selectedShutdownTasks.eveningTasks,
      selectedShutdownTasks.eveningPreparationTasks,
    ],
  );
  const shutdownActionKey = shutdownActions
    .map((action) => action.id)
    .join("|");
  const shutdownSessionKey = [
    currentClock
      ? shutdownWindowInstanceKey(shutdownWindow, currentClock)
      : "pending",
    shutdownWindow.shutdownStartTime,
    shutdownWindow.lightsOutTime,
    shutdownActionKey,
  ].join("|");
  const shutdownProgressKey = `${
    shutdownPreviewMode ? "preview" : "active"
  }:${shutdownSessionKey}`;
  const completedShutdownActions =
    shutdownProgressState.sessionKey === shutdownProgressKey
      ? shutdownProgressState.completedActions
      : 0;
  const shutdownProgress = useMemo(
    () => getShutdownProgress(shutdownActions, completedShutdownActions),
    [shutdownActions, completedShutdownActions],
  );
  const isShutdownActive =
    currentClock !== null &&
    isShutdownWindowActive(shutdownWindow, currentClock.time);
  const showShutdownAssistant = shutdownPreviewMode || isShutdownActive;

  const applyCompressedRoutine = () => {
    setManualMorningRoutineMinutes(routineCompression.minimumMorningMinutes);
    setUseProfiledMorningRoutine(false);
  };

  const enterShutdownPreview = () => {
    setShutdownProgressState({
      sessionKey: `preview:${shutdownSessionKey}`,
      completedActions: 0,
    });
    setShutdownPreviewMode(true);
  };

  const exitShutdownPreview = () => {
    setShutdownPreviewMode(false);
    setShutdownProgressState({ sessionKey: "", completedActions: 0 });
  };

  if (currentClock === null) {
    return <SleepOpsLoading />;
  }

  if (showShutdownAssistant) {
    return (
      <ShutdownAssistant
        isPreview={shutdownPreviewMode}
        onAdvance={() =>
          setShutdownProgressState((current) => {
            const currentCompletedActions =
              current.sessionKey === shutdownProgressKey
                ? current.completedActions
                : 0;

            return {
              sessionKey: shutdownProgressKey,
              completedActions: Math.min(
                currentCompletedActions + 1,
                shutdownActions.length,
              ),
            };
          })
        }
        onExitPreview={exitShutdownPreview}
        progress={shutdownProgress}
        window={shutdownWindow}
      />
    );
  }

  const results = [
    { label: "Wake time", value: schedule.wakeTime },
    { label: "Latest bedtime", value: schedule.latestBedtime },
    { label: "Shutdown start", value: schedule.shutdownStartTime },
    hasWarning
      ? {
          label: "Overbooked by",
          value: formatDuration(Math.abs(schedule.availableFlexMinutes)),
        }
      : {
          label: "Free time left today",
          value: formatDuration(schedule.availableFlexMinutes),
        },
  ];

  const rail = [
    {
      label: "Shutdown",
      value: schedule.shutdownStartTime,
      className: "border-[#9a3412] bg-[#ffedd5]",
    },
    {
      label: "Lights out",
      value: schedule.latestBedtime,
      className: "border-[#065f46] bg-[#d1fae5]",
    },
    {
      label: "Wake",
      value: schedule.wakeTime,
      className: "border-[#1e3a8a] bg-[#dbeafe]",
    },
  ];

  return (
    <main className="min-h-screen bg-[#e7ecf1] px-4 py-5 text-[#0f172a] sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="flex flex-col justify-between gap-8 rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-6 lg:p-8">
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-[#1f2937]">
                SleepOps
              </p>
              <h1 className="mt-2 max-w-lg text-4xl font-semibold leading-tight text-[#0f172a] sm:text-5xl">
                Tonight&apos;s shutdown deadline
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-[#475569]">
                Enter tomorrow&apos;s work start, morning routine, and buffer.
                SleepOps turns that into tonight&apos;s shutdown time, bedtime,
                and wake-up plan.
              </p>
            </div>

            <div
              aria-live={hasWarning ? "assertive" : "polite"}
              className={`rounded-2xl border p-4 ${
                hasWarning
                  ? "border-[#b91c1c] bg-[#fee2e2]"
                  : "border-[#334155] bg-[#e2e8f0]"
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

            <button
              className="h-12 w-full rounded-xl border border-[#1f2937] bg-[#1f2937] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#111827] sm:w-auto"
              onClick={enterShutdownPreview}
              type="button"
            >
              Preview shutdown mode
            </button>

            <ShutdownReminderSetup
              enabled={shutdownRemindersEnabled}
              onEnabledChange={setShutdownRemindersEnabled}
              shutdownStartTime={schedule.shutdownStartTime}
            />
          </div>

          <div className="grid gap-3 text-sm text-[#475569]">
            <div className="flex items-center justify-between gap-4 border-t border-[#dbe2ea] pt-4">
              <span>Required sleep</span>
              <strong className="text-[#0f172a]">
                {formatDuration(REQUIRED_SLEEP_MINUTES)}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[#dbe2ea] pt-4">
              <span>Shutdown duration</span>
              <strong className="text-[#0f172a]">
                {formatDuration(schedule.shutdownMinutes)}
              </strong>
            </div>
          </div>
        </section>

        <section className="grid gap-5">
          <form
            className="grid gap-5 rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-6"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="grid gap-2 text-sm font-medium text-[#334155]">
              Work start time
              <input
                className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-lg font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
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
              max={MAX_MORNING_ROUTINE_MINUTES}
              onChange={setManualMorningRoutineMinutes}
              value={effectiveMorningRoutineMinutes}
              disabled={useProfiledMorningRoutine && canUseProfiled}
            />

            <label className="flex items-start gap-3 rounded-xl border border-[#cbd5e1] bg-[#f8fafc] p-3 text-sm text-[#334155]">
              <input
                checked={useProfiledMorningRoutine}
                className="mt-1 accent-[#1f2937]"
                disabled={!canUseProfiled}
                onChange={(event) =>
                  setUseProfiledMorningRoutine(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                Use measured 7-day average
                <span className="ml-2 text-[#475569]">
                  {canUseProfiled
                    ? `(${formatDuration(profiledMorningRoutineMinutes!)})`
                    : "(record a day to enable)"}
                </span>
              </span>
            </label>

            <DurationControl
              id="commute-buffer"
              label="Commute / buffer duration"
              max={MAX_COMMUTE_BUFFER_MINUTES}
              onChange={setCommuteBufferMinutes}
              value={commuteBufferMinutes}
            />
          </form>

          <section className="rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-semibold">Morning routine profiler</h2>
              <p className="text-sm text-[#475569]">Keeps the last 7 days locally.</p>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-[#334155]">
                Day
                <input
                  className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-lg font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
                  disabled={!todayKey}
                  max={todayKey ?? undefined}
                  min={retainedStartKey ?? undefined}
                  onChange={(event) =>
                    setRecordDateKey(event.currentTarget.value || todayKey || "")
                  }
                  type="date"
                  value={recordDateKey}
                />
              </label>

              <div className="grid gap-2">
                <p className="text-sm font-medium text-[#334155]">
                  Steps (minutes)
                </p>
                <div className="grid gap-2">
                  {profiler.steps.map((step) => {
                    const dayMinutes = displayedStepMinutes(
                      recordDayMinutesByStepId,
                      step.id,
                    );

                    return (
                      <div
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_120px_auto] sm:items-center"
                        key={step.id}
                      >
                        <input
                          aria-label={`Step name ${step.id}`}
                          className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-sm font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
                          onChange={(event) => {
                            const label = event.currentTarget.value;
                            updateMorningProfiler((current) =>
                              setStepLabel(current, step.id, label),
                            );
                          }}
                          type="text"
                          value={step.label}
                        />
                        <select
                          aria-label={`Classify ${step.id}`}
                          className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-sm font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
                          onChange={(event) =>
                            updateMorningProfiler((current) =>
                              setStepClassification(
                                current,
                                step.id,
                                event.currentTarget
                                  .value as RoutineStepClassification,
                              ),
                            )
                          }
                          value={step.classification}
                        >
                          {STEP_CLASSIFICATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Minutes ${step.id}`}
                          className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-lg font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
                          disabled={!todayKey || !recordDateKey}
                          inputMode="numeric"
                          max={MAX_MORNING_ROUTINE_MINUTES}
                          min={0}
                          onChange={(event) => {
                            if (!todayKey || !recordDateKey) {
                              return;
                            }
                            const minutes = Number(event.currentTarget.value);
                            updateMorningProfiler((current) =>
                              setStepMinutesForDay(
                                current,
                                recordDateKey,
                                step.id,
                                minutes,
                                todayKey,
                                PROFILER_RETENTION_DAYS,
                              ),
                            );
                          }}
                          step={1}
                          type="number"
                          value={dayMinutes}
                        />
                        <button
                          aria-label={`Remove step ${step.id}`}
                          className="h-12 rounded-xl border border-[#cbd5e1] bg-white px-3 text-sm font-semibold text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                          onClick={() =>
                            updateMorningProfiler((current) =>
                              removeStep(current, step.id),
                            )
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

                  updateMorningProfiler((current) =>
                    addStep(current, { id: makeStepId(), label }),
                  );
                  setNewStepLabel("");
                }}
              >
                <label className="grid gap-2 text-sm font-medium text-[#334155]">
                  New step
                  <input
                    aria-label="New step name"
                    className="h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-sm font-semibold text-[#0f172a] outline-none focus:border-[#1f2937] focus:ring-2 focus:ring-[#1f2937]/20"
                    onChange={(event) => setNewStepLabel(event.currentTarget.value)}
                    placeholder="e.g., Breakfast"
                    type="text"
                    value={newStepLabel}
                  />
                </label>
                <button
                  className="h-12 self-end rounded-xl border border-[#cbd5e1] bg-white px-4 text-sm font-semibold text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
                  type="submit"
                >
                  Add step
                </button>
              </form>

              <div className="grid gap-2 border-t border-[#dbe2ea] pt-4 text-sm text-[#475569]">
                <div className="flex items-center justify-between gap-4">
                  <span>Day total</span>
                  <strong className="text-[#0f172a]">
                    {formatDuration(displayedTotalMinutesForDay(profiler, recordDateKey))}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>7-day measured average</span>
                  <strong className="text-[#0f172a]">
                    {profiledMorningRoutineMinutes === null
                      ? "—"
                      : formatDuration(profiledMorningRoutineMinutes)}
                  </strong>
                </div>
              </div>

              <TopLeaks profiler={profiler} todayKey={todayKey} />
            </div>
          </section>

          <section
            aria-labelledby="routine-compressor-heading"
            className="rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-6"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  className="text-xl font-semibold"
                  id="routine-compressor-heading"
                >
                  Routine compressor
                </h2>
                <p className="mt-1 text-sm text-[#475569]">
                  Uses the selected profiler day. Mark each step as required in
                  the morning, movable to the evening, or something you can prep
                  tonight ahead of time.
                </p>
              </div>
              <div className="text-sm text-[#475569]">
                Profiled total{" "}
                <strong className="text-[#0f172a]">
                  {formatDuration(routineCompression.totalProfiledMinutes)}
                </strong>
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <CompressionBlock
                emptyText="No required morning tasks with minutes."
                listLabel="Minimum viable morning tasks"
                minutes={routineCompression.minimumMorningMinutes}
                tasks={routineCompression.minimumMorningTasks}
                title="Minimum viable morning"
              />
              <CompressionBlock
                emptyText="No tasks marked movable yet."
                listLabel="Moved evening tasks"
                minutes={routineCompression.eveningMinutes}
                tasks={routineCompression.eveningTasks}
                title="Moved to evening"
              />
              <CompressionBlock
                emptyText="No tasks marked for tonight's prep yet."
                listLabel="Tonight's prep tasks"
                minutes={routineCompression.eveningPreparationMinutes}
                tasks={routineCompression.eveningPreparationTasks}
                title="Prep tonight"
              />
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-[#dbe2ea] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-[#475569]">
                Compressed morning duration
                <strong className="ml-2 text-lg text-[#0f172a]">
                  {formatDuration(routineCompression.minimumMorningMinutes)}
                </strong>
              </div>
              <button
                className="h-12 rounded-xl border border-[#1f2937] bg-[#1f2937] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#111827]"
                onClick={applyCompressedRoutine}
                type="button"
              >
                Use compressed duration in tonight&apos;s schedule
              </button>
            </div>
          </section>

          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {results.map((result) => (
              <div
                className="min-h-32 rounded-2xl border border-[#cbd5e1] bg-white/95 p-4 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.7)]"
                key={result.label}
              >
                <dt className="text-sm font-medium text-[#475569]">
                  {result.label}
                </dt>
                <dd className="mt-4 text-3xl font-semibold text-[#0f172a]">
                  {result.value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Tonight timeline</h2>
                <p className="mt-1 text-sm text-[#475569]">
                  The checkpoints below show when shutdown starts, when you need
                  to be in bed, and when tomorrow begins.
                </p>
              </div>
              <p className="text-sm text-[#475569]">
                {hasWarning
                  ? "Your shutdown-and-sleep window no longer fits before work."
                  : `${formatDuration(
                      schedule.availableFlexMinutes,
                    )} is still free before shutdown begins.`}
              </p>
            </div>

            <div className="mt-5 grid overflow-hidden rounded-2xl border border-[#cbd5e1] sm:grid-cols-3">
              {rail.map((item) => (
                <div
                  className={`min-h-28 border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${item.className}`}
                  key={item.label}
                >
                  <p className="text-sm font-medium text-[#27272a]">
                    {item.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-[#0f172a]">
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

type ShutdownProgressState = {
  sessionKey: string;
  completedActions: number;
};

type ClockSnapshot = {
  dateKey: string;
  previousDateKey: string;
  time: string;
};

function SleepOpsLoading() {
  return (
    <main className="min-h-screen bg-[#e7ecf1] px-4 py-5 text-[#0f172a] sm:px-6 lg:px-8">
      <section
        aria-label="SleepOps loading"
        className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-3xl items-center rounded-3xl border border-[#cbd5e1] bg-white/95 p-5 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)] sm:p-8"
      >
        <p className="text-sm font-semibold text-[#1f2937]">SleepOps</p>
      </section>
    </main>
  );
}

function ShutdownAssistant({
  isPreview,
  onAdvance,
  onExitPreview,
  progress,
  window: shutdownWindow,
}: {
  isPreview: boolean;
  onAdvance: () => void;
  onExitPreview: () => void;
  progress: ShutdownProgress;
  window: ShutdownWindow;
}) {
  const isComplete = progress.status === "complete";
  const actionNumber = progress.completedActions + 1;

  return (
    <main className="min-h-screen bg-[#0b1117] px-4 py-5 text-white sm:px-6 lg:px-8">
      <section
        aria-label="Evening shutdown assistant"
        className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-3xl flex-col justify-center gap-8 rounded-3xl border border-[#334155] bg-[#141b24] p-5 shadow-[0_24px_40px_-28px_rgba(2,6,23,0.9)] sm:p-8"
      >
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[#94a3b8]">
            Shutdown {shutdownWindow.shutdownStartTime}-{shutdownWindow.lightsOutTime}
          </p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-6xl">
            {isComplete ? "Lights out" : progress.action.label}
          </h1>
          <p className="text-sm text-[#d1d5db]">
            {isComplete
              ? "Shutdown complete. Go to bed now."
              : `Action ${actionNumber} of ${progress.totalActions}`}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {progress.status === "active" ? (
            <button
              className="h-14 rounded-xl border border-[#cbd5e1] bg-[#cbd5e1] px-5 text-base font-semibold text-[#0b1117] transition-colors hover:bg-[#94a3b8]"
              onClick={onAdvance}
              type="button"
            >
              Done
            </button>
          ) : null}
          {isPreview ? (
            <button
              className="h-14 rounded-xl border border-[#475569] bg-transparent px-5 text-base font-semibold text-white transition-colors hover:bg-[#1f2937]"
              onClick={onExitPreview}
              type="button"
            >
              Back to planning
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

type ReminderSupportState =
  | {
      status: "checking";
      message: string;
      permission: null;
    }
  | {
      status: "unsupported";
      message: string;
      permission: null;
    }
  | {
      status: "supported";
      message: string;
      permission: NotificationPermission;
    };

function ShutdownReminderSetup({
  enabled,
  onEnabledChange,
  shutdownStartTime,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  shutdownStartTime: string;
}) {
  const [support, setSupport] = useState<ReminderSupportState>({
    status: "checking",
    message: "Checking notification support.",
    permission: null,
  });

  useEffect(() => {
    let disposed = false;

    const refreshSupport = async (allowPendingRegistration = true) => {
      const nextSupport = await readShutdownReminderSupport({
        allowPendingRegistration,
      });
      if (!disposed) {
        setSupport(nextSupport);
      }
    };

    const handleControllerChange = () => {
      void refreshSupport();
    };

    void refreshSupport();

    const serviceWorker = navigator.serviceWorker;
    const fallbackTimeoutId = window.setTimeout(() => {
      void refreshSupport(false);
    }, SERVICE_WORKER_SUPPORT_FALLBACK_MS);

    if (
      typeof serviceWorker?.addEventListener === "function" &&
      typeof serviceWorker.ready?.then === "function"
    ) {
      serviceWorker.addEventListener(
        "controllerchange",
        handleControllerChange,
      );
      void serviceWorker.ready.then(() => refreshSupport()).catch(() => {});
    }

    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimeoutId);
      if (typeof serviceWorker?.removeEventListener === "function") {
        serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (
      enabled &&
      (support.status === "unsupported" ||
        (support.status === "supported" && support.permission !== "granted"))
    ) {
      onEnabledChange(false);
    }
  }, [enabled, onEnabledChange, support]);

  useEffect(() => {
    if (
      !enabled ||
      support.status !== "supported" ||
      support.permission !== "granted"
    ) {
      return;
    }

    let timeoutId: number | null = null;
    let disposed = false;
    const scheduleNextReminder = () => {
      const delay = getNextClockDelayMs(shutdownStartTime, new Date());
      timeoutId = window.setTimeout(() => {
        void showShutdownReminder(shutdownStartTime).finally(() => {
          if (!disposed) {
            scheduleNextReminder();
          }
        });
      }, Math.max(1000, delay));
    };

    scheduleNextReminder();

    return () => {
      disposed = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [enabled, shutdownStartTime, support]);

  const isEnabled =
    enabled && support.status === "supported" && support.permission === "granted";
  const isDenied = support.status === "supported" && support.permission === "denied";
  const isUnavailable = support.status !== "supported" || isDenied;
  const statusText = getShutdownReminderStatusText(
    support,
    isEnabled,
    shutdownStartTime,
  );

  const toggleReminders = async () => {
    if (isEnabled) {
      onEnabledChange(false);
      return;
    }

    if (support.status !== "supported" || isDenied) {
      return;
    }

    let permission = window.Notification.permission;
    if (permission === "default") {
      permission = await window.Notification.requestPermission();
    }

    setSupport({
      status: "supported",
      message: support.message,
      permission,
    });
    onEnabledChange(permission === "granted");
  };

  return (
    <section
      aria-labelledby="shutdown-reminders-heading"
      className="rounded-2xl border border-[#cbd5e1] bg-[#f8fafc] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-sm font-semibold text-[#0f172a]"
            id="shutdown-reminders-heading"
          >
            Open-app shutdown reminders
          </h2>
          <p className="mt-1 text-sm text-[#475569]">{statusText}</p>
        </div>
        <button
          className="h-11 rounded-xl border border-[#1f2937] bg-white px-3 text-sm font-semibold text-[#1f2937] transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:border-[#cbd5e1] disabled:text-[#71717a] disabled:hover:bg-white"
          disabled={isUnavailable}
          onClick={toggleReminders}
          type="button"
        >
          {isEnabled
            ? "Turn off open-app reminders"
            : "Enable open-app reminders"}
        </button>
      </div>
    </section>
  );
}

function CompressionBlock({
  emptyText,
  listLabel,
  minutes,
  tasks,
  title,
}: {
  emptyText: string;
  listLabel: string;
  minutes: number;
  tasks: CompressedRoutineTask[];
  title: string;
}) {
  return (
    <div className="min-h-40 rounded-2xl border border-[#cbd5e1] bg-[#f8fafc] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#0f172a]">{title}</h3>
        <strong className="shrink-0 text-sm text-[#0f172a]">
          {formatDuration(minutes)}
        </strong>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-4 text-sm text-[#475569]">{emptyText}</p>
      ) : (
        <ol aria-label={listLabel} className="mt-4 grid gap-2 text-sm">
          {tasks.map((task) => (
            <li
              className="flex items-center justify-between gap-3 text-[#334155]"
              key={task.stepId}
            >
              <span className="min-w-0 truncate">{task.label}</span>
              <span className="shrink-0 font-semibold text-[#0f172a]">
                {formatDuration(task.minutes)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

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
        <label className="text-sm font-medium text-[#334155]" htmlFor={id}>
          {label}
        </label>
        <div className="flex h-12 w-full items-center rounded-xl border border-[#cbd5e1] bg-[#f8fafc] sm:w-36">
          <input
            className="h-full min-w-0 flex-1 rounded-xl bg-transparent px-3 text-lg font-semibold text-[#0f172a] outline-none focus:bg-white"
            disabled={disabled}
            id={id}
            max={max}
            min={0}
            onChange={(event) =>
              onChange(
                readMinutes(event.currentTarget, max, SLEEPOPS_MINUTES_STEP),
              )
            }
            step={SLEEPOPS_MINUTES_STEP}
            type="number"
            value={value}
          />
          <span className="pr-3 text-sm font-medium text-[#475569]">min</span>
        </div>
      </div>
      <input
        aria-label={`${label} slider`}
        className="h-2 w-full rounded-full accent-[#1f2937]"
        disabled={disabled}
        max={max}
        min={0}
        onChange={(event) =>
          onChange(
            readMinutes(event.currentTarget, max, SLEEPOPS_MINUTES_STEP),
          )
        }
        step={SLEEPOPS_MINUTES_STEP}
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

function displayedTotalMinutesForDay(
  profiler: MorningRoutineProfiler,
  dateKey: string,
): number {
  const dayMinutesByStepId =
    profiler.days.find((candidate) => candidate.date === dateKey)?.minutesByStepId;

  return profiler.steps.reduce(
    (sum, step) => sum + displayedStepMinutes(dayMinutesByStepId, step.id),
    0,
  );
}

function displayedStepMinutes(
  dayMinutesByStepId: MorningRoutineProfiler["days"][number]["minutesByStepId"] | undefined,
  stepId: string,
): number {
  return dayMinutesByStepId?.[stepId] ?? defaultStepMinutes(stepId);
}

function TopLeaks({
  profiler,
  todayKey,
}: {
  profiler: MorningRoutineProfiler;
  todayKey: string | null;
}) {
  const leaks = useMemo(
    () => {
      if (!todayKey) {
        return [];
      }

      return topTimeLeaks(profiler, todayKey, PROFILER_RETENTION_DAYS, 3);
    },
    [profiler, todayKey],
  );

  if (leaks.length === 0) {
    return (
      <div className="rounded-2xl border border-[#cbd5e1] bg-[#f8fafc] p-3 text-sm text-[#475569]">
        Top time leaks will appear after you record a day.
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-[#cbd5e1] bg-[#f8fafc] p-3">
      <p className="text-sm font-semibold text-[#0f172a]">
        Top time leaks (7 days)
      </p>
      <ol aria-label="Top time leaks" className="grid gap-1 text-sm text-[#334155]">
        {leaks.map((leak) => (
          <li className="flex items-center justify-between gap-3" key={leak.stepId}>
            <span className="truncate">{leak.label}</span>
            <strong className="text-[#0f172a]">
              {formatDuration(leak.totalMinutes)}
            </strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

async function readShutdownReminderSupport({
  allowPendingRegistration = true,
}: {
  allowPendingRegistration?: boolean;
} = {}): Promise<ReminderSupportState> {
  if (typeof window === "undefined") {
    return {
      status: "unsupported",
      message: "Notifications are not supported in this browser.",
      permission: null,
    };
  }

  const hasNotification = typeof window.Notification !== "undefined";
  const serviceWorker =
    typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  const hasServiceWorker = typeof serviceWorker?.ready?.then === "function";

  if (!window.isSecureContext || !hasNotification) {
    const support: ShutdownNotificationSupport =
      resolveShutdownNotificationSupport({
        isSecureContext: window.isSecureContext,
        hasNotification,
        hasServiceWorker: false,
        hasShowNotification: false,
      });

    return {
      status: "unsupported",
      message: support.message,
      permission: null,
    };
  }

  if (!hasServiceWorker) {
    const support: ShutdownNotificationSupport =
      resolveShutdownNotificationSupport({
        isSecureContext: window.isSecureContext,
        hasNotification,
        hasServiceWorker: false,
        hasShowNotification: false,
      });

    return {
      status: "unsupported",
      message: support.message,
      permission: null,
    };
  }

  const registration = await readServiceWorkerRegistration(serviceWorker);
  if (!registration) {
    if (allowPendingRegistration) {
      return {
        status: "checking",
        message: "Finishing notification setup.",
        permission: null,
      };
    }

    return {
      status: "unsupported",
      message: "This browser cannot show SleepOps reminders from the app shell.",
      permission: null,
    };
  }

  const support: ShutdownNotificationSupport =
    resolveShutdownNotificationSupport({
      isSecureContext: window.isSecureContext,
      hasNotification,
      hasServiceWorker,
      hasShowNotification: typeof registration?.showNotification === "function",
    });

  if (!support.supported || !hasNotification) {
    return {
      status: "unsupported",
      message: support.message,
      permission: null,
    };
  }

  return {
    status: "supported",
    message: support.message,
    permission: window.Notification.permission,
  };
}

function getShutdownReminderStatusText(
  support: ReminderSupportState,
  isEnabled: boolean,
  shutdownStartTime: string,
): string {
  if (support.status === "checking") {
    return support.message;
  }

  if (support.status === "unsupported") {
    return support.message;
  }

  if (support.permission === "denied") {
    return "Notifications are blocked in this browser.";
  }

  if (isEnabled) {
    return `Reminder set for ${shutdownStartTime} while this tab is open.`;
  }

  if (support.permission === "granted") {
    return "Notifications are allowed. Open-app shutdown reminders are off.";
  }

  return "Enable reminders to be notified at shutdown start while this tab is open.";
}

async function readServiceWorkerRegistration(
  serviceWorker: ServiceWorkerContainer,
): Promise<ServiceWorkerRegistration | null> {
  try {
    const registration =
      typeof serviceWorker.getRegistration === "function"
        ? await serviceWorker.getRegistration()
        : null;

    if (registration) {
      return registration;
    }

    let timeoutId: number | null = null;
    try {
      return await Promise.race<ServiceWorkerRegistration | null>([
        serviceWorker.ready,
        new Promise((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve(null),
            SERVICE_WORKER_READY_CHECK_MS,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  } catch {
    return null;
  }
}

async function showShutdownReminder(shutdownStartTime: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.showNotification !== "function") {
      return;
    }

    await registration.showNotification("SleepOps shutdown", {
      body: `Start shutdown by ${shutdownStartTime}.`,
      badge: "/badge-96.png",
      data: {
        url: "/",
      },
      icon: "/icon-192.png",
      tag: "sleepops-shutdown",
    });
  } catch {
    // Notification delivery should not interrupt the planning surface.
  }
}

function makeStepId(): string {
  if ("crypto" in globalThis && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `step_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function useCurrentClock(): ClockSnapshot | null {
  const [currentClock, setCurrentClock] = useState<ClockSnapshot | null>(null);

  useEffect(() => {
    const updateClock = () => setCurrentClock(readCurrentClock());
    let disposed = false;
    const scheduleInitialClockUpdate =
      typeof globalThis.queueMicrotask === "function"
        ? globalThis.queueMicrotask
        : (callback: VoidFunction) => {
            void Promise.resolve().then(callback);
          };

    scheduleInitialClockUpdate(() => {
      if (!disposed) {
        updateClock();
      }
    });

    const intervalId = setInterval(() => {
      setCurrentClock(readCurrentClock());
    }, 30_000);

    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, []);

  return currentClock;
}

function readCurrentClock(): ClockSnapshot {
  const now = new Date();
  const dateKey = toDateKey(now);

  return {
    dateKey,
    previousDateKey: addDaysToDateKey(dateKey, -1),
    time: formatClockTime(now.getHours() * 60 + now.getMinutes()),
  };
}

function shutdownWindowInstanceKey(
  window: ShutdownWindow,
  clock: ClockSnapshot,
): string {
  const startMinutes = parseClockTime(window.shutdownStartTime);
  const lightsOutMinutes = parseClockTime(window.lightsOutTime);
  const currentMinutes = parseClockTime(clock.time);
  const startsOnPreviousDay =
    startMinutes >= lightsOutMinutes && currentMinutes < lightsOutMinutes;

  return startsOnPreviousDay ? clock.previousDateKey : clock.dateKey;
}

function useProfilerDateKeys() {
  const [dateKeys, setDateKeys] = useState<{
    recordDateKey: string;
    retainedStartKey: string | null;
    todayKey: string | null;
  }>(() => ({
    recordDateKey: "",
    retainedStartKey: null,
    todayKey: null,
  }));

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleMidnightUpdate = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      const delay = Math.max(1_000, nextMidnight.getTime() - now.getTime());

      timeoutId = setTimeout(() => {
        const nextTodayKey = toDateKey(new Date());
        const retainedStartKey = addDaysToDateKey(
          nextTodayKey,
          -(PROFILER_RETENTION_DAYS - 1),
        );

        setDateKeys((current) => {
          const followToday = Boolean(
            current.todayKey && current.recordDateKey === current.todayKey,
          );
          const candidateRecordDateKey = current.recordDateKey
            ? (followToday ? nextTodayKey : current.recordDateKey)
            : nextTodayKey;

          return {
            todayKey: nextTodayKey,
            retainedStartKey,
            recordDateKey: clampDateKey(
              candidateRecordDateKey,
              retainedStartKey,
              nextTodayKey,
            ),
          };
        });
        scheduleMidnightUpdate();
      }, delay);
    };

    const initTimeoutId = setTimeout(() => {
      setDateKeys(() => {
        const nextTodayKey = toDateKey(new Date());
        const retainedStartKey = addDaysToDateKey(
          nextTodayKey,
          -(PROFILER_RETENTION_DAYS - 1),
        );

        return {
          todayKey: nextTodayKey,
          retainedStartKey,
          recordDateKey: nextTodayKey,
        };
      });
    }, 0);

    scheduleMidnightUpdate();
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(initTimeoutId);
    };
  }, []);

  return {
    ...dateKeys,
    setRecordDateKey: (recordDateKey: string) =>
      setDateKeys((current) => ({
        ...current,
        recordDateKey: current.todayKey && current.retainedStartKey
          ? clampDateKey(recordDateKey, current.retainedStartKey, current.todayKey)
          : recordDateKey,
      })),
  };
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function clampDateKey(dateKey: string, minDateKey: string, maxDateKey: string) {
  if (dateKey < minDateKey) {
    return minDateKey;
  }
  if (dateKey > maxDateKey) {
    return maxDateKey;
  }
  return dateKey;
}

function useMorningRoutineProfiler(todayKey: string | null) {
  const raw = useSyncExternalStore(
    subscribeToProfilerStore,
    readProfilerSnapshot,
    () => null,
  );

  const profiler = useMemo(
    () => hydrateProfiler(raw, todayKey),
    [raw, todayKey],
  );

  const updateProfiler = (updater: (current: MorningRoutineProfiler) => MorningRoutineProfiler) => {
    const current = hydrateProfiler(readProfilerSnapshot(), todayKey);
    const next = updater(current);

    writeProfilerSnapshot(serializeProfiler(next));
  };

  return [profiler, updateProfiler] as const;
}

function readProfilerSnapshot(): string | null {
  return readCachedString(PROFILER_STORAGE_KEY);
}

function writeProfilerSnapshot(raw: string) {
  writeCachedString(PROFILER_STORAGE_KEY, raw);

  try {
    globalThis.dispatchEvent(new Event(PROFILER_CHANGE_EVENT));
  } catch {
    // Rendering should not depend on custom event delivery.
  }
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
  todayKey: string | null,
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
    steps: parsed.steps,
    days: todayKey
      ? pruneToLastNDays(parsed.days, todayKey, PROFILER_RETENTION_DAYS)
      : parsed.days,
  };
}
