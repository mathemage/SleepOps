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
    {
      accentClassName: "bg-[#6889a3]",
      label: "Wake time",
      value: schedule.wakeTime,
    },
    {
      accentClassName: "bg-[#6c7898]",
      label: "Latest bedtime",
      value: schedule.latestBedtime,
    },
    {
      accentClassName: "bg-[#b97845]",
      label: "Shutdown start",
      value: schedule.shutdownStartTime,
    },
    hasWarning
      ? {
          accentClassName: "bg-[#c35358]",
          label: "Overbooked by",
          value: formatDuration(Math.abs(schedule.availableFlexMinutes)),
        }
      : {
          accentClassName: "bg-[#4d8c78]",
          label: "Free time left today",
          value: formatDuration(schedule.availableFlexMinutes),
        },
  ];

  const rail = [
    {
      label: "Shutdown",
      value: schedule.shutdownStartTime,
      className: "border-[#d6b391] bg-[#f5e7da]",
      markerClassName: "bg-[#af6432]",
    },
    {
      label: "Lights out",
      value: schedule.latestBedtime,
      className: "border-[#aebbc8] bg-[#e9eef3]",
      markerClassName: "bg-[#607a91]",
    },
    {
      label: "Wake",
      value: schedule.wakeTime,
      className: "border-[#b4b9d1] bg-[#ececf5]",
      markerClassName: "bg-[#6f7095]",
    },
  ];

  return (
    <main className="relative min-h-screen px-3 py-3 text-[#131a21] sm:px-5 sm:py-5 xl:px-6 xl:py-6">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-white/80" />
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-[90rem] gap-4 sm:min-h-[calc(100vh-2.5rem)] sm:gap-5 xl:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.42fr)] xl:items-start xl:gap-6">
        <section className="metal-panel-dark relative flex flex-col justify-between gap-8 overflow-hidden p-5 text-white sm:p-7 lg:gap-5 lg:p-6 xl:min-h-[calc(100vh-3rem)] xl:gap-8 xl:p-7">
          <div
            aria-hidden="true"
            className="absolute -right-24 -top-24 size-72 rounded-full border border-white/[0.06] bg-white/[0.025]"
          />
          <div className="relative z-10 space-y-7 lg:space-y-5 xl:space-y-7">
            <div className="flex flex-col items-start gap-4 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-[0.9rem] border border-white/20 bg-white/10 font-mono text-lg font-semibold text-[#d9e5ee] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
                >
                  S
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-[0.08em] text-white">
                    SleepOps
                  </p>
                  <p className="truncate text-xs text-[#9facb7]">
                    Constraint control
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#79a99a]/35 bg-[#79a99a]/10 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-[#b8dfd2]">
                <span className="size-1.5 rounded-full bg-[#7cc4ad] shadow-[0_0_0_4px_rgba(124,196,173,0.1)]" />
                9h protected
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9facb7]">
                Tonight&apos;s contract
              </p>
              <h1 className="mt-3 max-w-lg text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-5xl">
                Tonight&apos;s shutdown deadline
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#aeb9c3]">
                Enter tomorrow&apos;s work start, morning routine, and buffer.
                SleepOps turns that into tonight&apos;s shutdown time, bedtime,
                and wake-up plan.
              </p>
            </div>

            <div
              aria-live={hasWarning ? "assertive" : "polite"}
              className={`rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-5 ${
                hasWarning
                  ? "border-[#9b4d52]/70 bg-[#7d3037]/25 text-[#ffd9dc]"
                  : "border-[#7796ae]/55 bg-[#6c89a1]/15 text-[#e9f2f8]"
              }`}
              role={hasWarning ? "alert" : "status"}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">
                {hasWarning ? "Constraint violated" : "Next action"}
              </p>
              <p className="tabular-time mt-3 text-2xl font-semibold leading-snug tracking-[-0.035em] sm:text-3xl">
                {hasWarning
                  ? schedule.constraintWarning
                  : `Start shutdown by ${schedule.shutdownStartTime}`}
              </p>
            </div>

            <button
              className="button-inverse flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap px-4 text-sm font-semibold min-[360px]:gap-3 min-[360px]:px-5 sm:w-auto"
              onClick={enterShutdownPreview}
              type="button"
            >
              Preview shutdown mode
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#17212a] text-sm text-white"
              >
                →
              </span>
            </button>

            <ShutdownReminderSetup
              enabled={shutdownRemindersEnabled}
              onEnabledChange={setShutdownRemindersEnabled}
              shutdownStartTime={schedule.shutdownStartTime}
            />
          </div>

          <div className="relative z-10 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className="block text-xs text-[#9facb7]">Required sleep</span>
              <strong className="tabular-time mt-2 block text-xl font-semibold text-white">
                {formatDuration(REQUIRED_SLEEP_MINUTES)}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className="block text-xs text-[#9facb7]">Shutdown duration</span>
              <strong className="tabular-time mt-2 block text-xl font-semibold text-white">
                {formatDuration(schedule.shutdownMinutes)}
              </strong>
            </div>
          </div>
        </section>

        <section aria-label="Sleep planning workspace" className="grid gap-4 sm:gap-5">
          <form
            className="metal-panel grid gap-5 p-5 sm:p-6"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#596976]">
                  Sleep contract
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#151d24]">
                  Plan inputs
                </h2>
              </div>
              <span className="w-fit rounded-full border border-[#c7d0d8] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#596672]">
                Tomorrow
              </span>
            </div>

            <label className="grid gap-2 text-sm font-medium text-[#394550]">
              <span>Work start time</span>
              <input
                className="sleepops-control tabular-time h-12 w-full px-3 text-lg font-semibold"
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

            <label className="inset-panel flex items-start gap-3 p-3.5 text-sm text-[#394550]">
              <input
                checked={useProfiledMorningRoutine}
                className="mt-0.5 size-4 shrink-0 accent-[#46657d]"
                disabled={!canUseProfiled}
                onChange={(event) =>
                  setUseProfiledMorningRoutine(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                Use measured 7-day average
                <span className="ml-2 text-[#687581]">
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

          <section className="metal-panel p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#596976]">
                  Routine intelligence
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#151d24]">
                  Morning routine profiler
                </h2>
              </div>
              <p className="text-sm text-[#687581]">Keeps the last 7 days locally.</p>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-[#394550]">
                Day
                <input
                  className="sleepops-control tabular-time h-12 w-full px-3 text-lg font-semibold"
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
                <p className="text-sm font-medium text-[#394550]">
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
                        aria-label={`Routine step ${step.id}`}
                        className="inset-panel grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2 p-2.5 sm:grid-cols-[minmax(0,1fr)_11rem_6.5rem_auto] sm:items-center"
                        key={step.id}
                        role="group"
                      >
                        <input
                          aria-label={`Step name ${step.id}`}
                          className="sleepops-control col-span-2 h-11 w-full px-3 text-sm font-semibold sm:col-span-1"
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
                          className="sleepops-control col-span-2 h-11 w-full px-3 text-sm font-semibold sm:col-span-1"
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
                          className="sleepops-control tabular-time h-11 w-full px-3 text-base font-semibold"
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
                          className="button-secondary h-11 px-3 text-sm font-semibold"
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
                className="inset-panel grid gap-2 p-3 sm:grid-cols-[1fr_auto]"
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
                <label className="grid gap-2 text-sm font-medium text-[#394550]">
                  New step
                  <input
                    aria-label="New step name"
                    className="sleepops-control h-11 w-full px-3 text-sm font-semibold"
                    onChange={(event) => setNewStepLabel(event.currentTarget.value)}
                    placeholder="e.g., Breakfast"
                    type="text"
                    value={newStepLabel}
                  />
                </label>
                <button
                  className="button-secondary h-11 self-end px-4 text-sm font-semibold"
                  type="submit"
                >
                  Add step
                </button>
              </form>

              <div className="grid gap-2 text-sm text-[#687581] sm:grid-cols-2">
                <div className="inset-panel flex items-center justify-between gap-4 p-3.5">
                  <span>Day total</span>
                  <strong className="tabular-time text-[#151d24]">
                    {formatDuration(displayedTotalMinutesForDay(profiler, recordDateKey))}
                  </strong>
                </div>
                <div className="inset-panel flex items-center justify-between gap-4 p-3.5">
                  <span>7-day measured average</span>
                  <strong className="tabular-time text-[#151d24]">
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
            className="metal-panel p-5 sm:p-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#596976]">
                  Decision removal
                </p>
                <h2
                  className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#151d24]"
                  id="routine-compressor-heading"
                >
                  Routine compressor
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687581]">
                  Uses the selected profiler day. Mark each step as required in
                  the morning, movable to the evening, or something you can prep
                  tonight ahead of time.
                </p>
              </div>
              <div className="w-fit rounded-full border border-[#c7d0d8] bg-white/70 px-3 py-1.5 text-xs text-[#687581]">
                Profiled total{" "}
                <strong className="tabular-time text-[#151d24]">
                  {formatDuration(routineCompression.totalProfiledMinutes)}
                </strong>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
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

            <div className="mt-5 flex flex-col gap-4 border-t border-[#d5dce2] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-[#687581]">
                Compressed morning duration
                <strong className="tabular-time ml-2 text-lg text-[#151d24]">
                  {formatDuration(routineCompression.minimumMorningMinutes)}
                </strong>
              </div>
              <button
                className="button-primary min-h-12 px-4 text-sm font-semibold"
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
                className="metal-panel group relative min-h-32 overflow-hidden p-4"
                key={result.label}
              >
                <dt className="pl-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#687581]">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${result.accentClassName}`}
                  />
                  {result.label}
                </dt>
                <dd className="tabular-time mt-5 pl-2 text-3xl font-semibold text-[#151d24]">
                  {result.value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="metal-panel p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#596976]">
                  Compiled output
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#151d24]">
                  Tonight timeline
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#687581]">
                  The checkpoints below show when shutdown starts, when you need
                  to be in bed, and when tomorrow begins.
                </p>
              </div>
              <p className="max-w-xs text-sm leading-6 text-[#687581] sm:text-right">
                {hasWarning
                  ? "Your shutdown-and-sleep window no longer fits before work."
                  : `${formatDuration(
                      schedule.availableFlexMinutes,
                    )} is still free before shutdown begins.`}
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {rail.map((item) => (
                <div
                  className={`relative min-h-28 overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ${item.className}`}
                  key={item.label}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-4 top-4 size-2 rounded-full ${item.markerClassName}`}
                  />
                  <p className="pl-5 text-xs font-semibold uppercase tracking-[0.12em] text-[#495661]">
                    {item.label}
                  </p>
                  <p className="tabular-time mt-4 text-3xl font-semibold text-[#151d24]">
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
    <main className="min-h-screen px-3 py-3 text-[#131a21] sm:px-5 sm:py-5">
      <section
        aria-label="SleepOps loading"
        className="metal-panel-dark mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-3xl items-center justify-center p-6 text-white sm:min-h-[calc(100vh-2.5rem)] sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-[0.9rem] border border-white/20 bg-white/10 font-mono text-lg font-semibold text-[#d9e5ee]"
          >
            S
          </span>
          <div>
            <p className="text-sm font-semibold tracking-[0.08em]">SleepOps</p>
            <p className="mt-0.5 text-xs text-[#9facb7]">Compiling tonight</p>
          </div>
        </div>
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
  const progressPercent = isComplete
    ? 100
    : (progress.completedActions / progress.totalActions) * 100;

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#080c10] px-3 py-3 text-white sm:px-5 sm:py-5 lg:px-6 lg:py-6">
      <div
        aria-hidden="true"
        className="absolute -left-40 top-1/4 -z-10 size-[32rem] rounded-full bg-[#506a7d]/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-48 -top-48 -z-10 size-[34rem] rounded-full bg-[#9d6947]/12 blur-3xl"
      />
      <section
        aria-label="Evening shutdown assistant"
        className="metal-panel-dark mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col justify-between gap-5 p-4 min-[360px]:gap-8 min-[360px]:p-5 sm:min-h-[calc(100vh-2.5rem)] sm:gap-10 sm:p-8 lg:min-h-[calc(100vh-3rem)] lg:p-10"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-[0.9rem] border border-white/20 bg-white/10 font-mono text-lg font-semibold text-[#d9e5ee]"
            >
              S
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[0.08em]">SleepOps</p>
              <p className="mt-0.5 text-xs text-[#9facb7]">Shutdown protocol</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#c38b62]/30 bg-[#c38b62]/10 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-[#e8b58e]">
            <span className="size-1.5 rounded-full bg-[#d59a70] shadow-[0_0_0_4px_rgba(213,154,112,0.1)]" />
            {isPreview ? "Preview" : "Active window"}
          </span>
        </div>

        <div className="rounded-[1.35rem] border border-white/10 bg-black/15 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] min-[360px]:p-5 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#e0a77d]">
              Shutdown {shutdownWindow.shutdownStartTime}-{shutdownWindow.lightsOutTime}
            </p>
            <p className="text-xs font-medium text-[#8f9ca7]">
              {isComplete
                ? "Sequence complete"
                : `Action ${actionNumber} of ${progress.totalActions}`}
            </p>
          </div>

          <div
            aria-hidden="true"
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10 min-[360px]:mt-5"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#bb7a51,#e4b084)] transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <h1 className="mt-5 max-w-3xl text-[2rem] font-semibold leading-[1.04] tracking-[-0.045em] text-white min-[360px]:mt-7 min-[360px]:text-4xl sm:mt-8 sm:text-6xl">
            {isComplete ? "Lights out" : progress.action.label}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#aab5be] min-[360px]:mt-5">
            {isComplete
              ? "Shutdown complete. Go to bed now."
              : "One action only. Finish it, then move forward."}
          </p>
        </div>

        <div className="flex flex-col gap-2 min-[360px]:gap-3 sm:flex-row sm:items-center">
          {progress.status === "active" ? (
            <button
              className="button-inverse min-h-12 px-6 text-base font-semibold min-[360px]:min-h-14 sm:min-w-36"
              onClick={onAdvance}
              type="button"
            >
              Done
            </button>
          ) : null}
          {isPreview ? (
            <button
              className="min-h-12 rounded-[0.8rem] border border-white/20 bg-white/[0.04] px-6 text-base font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.08] min-[360px]:min-h-14"
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
      className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-sm font-semibold text-white"
            id="shutdown-reminders-heading"
          >
            Open-app shutdown reminders
          </h2>
          <p className="mt-1 text-sm leading-5 text-[#9facb7]">{statusText}</p>
        </div>
        <button
          className="min-h-11 shrink-0 rounded-xl border border-[#71899d] bg-white/[0.05] px-3 text-sm font-semibold text-[#dce7ee] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.025] disabled:text-[#77838d]"
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
    <div className="inset-panel min-h-40 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#1c252d]">{title}</h3>
        <strong className="tabular-time shrink-0 rounded-full border border-[#c5ced6] bg-white/70 px-2 py-0.5 text-xs text-[#2b3741]">
          {formatDuration(minutes)}
        </strong>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-4 text-sm leading-5 text-[#687581]">{emptyText}</p>
      ) : (
        <ol aria-label={listLabel} className="mt-4 grid gap-2 text-sm">
          {tasks.map((task) => (
            <li
              className="flex items-start justify-between gap-3 border-t border-[#d5dce2] pt-2 text-[#44515c] first:border-0 first:pt-0"
              key={task.stepId}
            >
              <span className="min-w-0 break-words">{task.label}</span>
              <span className="tabular-time shrink-0 font-semibold text-[#1c252d]">
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
    <div className="inset-panel grid gap-2 p-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="text-sm font-medium text-[#394550]" htmlFor={id}>
          {label}
        </label>
        <div className="sleepops-control flex h-11 w-full items-center focus-within:border-[#66829a] focus-within:bg-white sm:w-36">
          <input
            className="tabular-time h-full min-w-0 flex-1 rounded-l-[0.7rem] bg-transparent px-3 text-lg font-semibold outline-none"
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
          <span className="pr-3 text-sm font-medium text-[#687581]">min</span>
        </div>
      </div>
      <input
        aria-label={`${label} slider`}
        className="sleepops-range w-full"
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
      <div className="inset-panel p-3.5 text-sm text-[#687581]">
        Top time leaks will appear after you record a day.
      </div>
    );
  }

  return (
    <div className="inset-panel grid gap-2 p-3.5">
      <p className="text-sm font-semibold text-[#1c252d]">
        Top time leaks (7 days)
      </p>
      <ol aria-label="Top time leaks" className="grid gap-1.5 text-sm text-[#44515c]">
        {leaks.map((leak) => (
          <li className="flex items-start justify-between gap-3" key={leak.stepId}>
            <span className="min-w-0 break-words">{leak.label}</span>
            <strong className="tabular-time shrink-0 text-[#1c252d]">
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
