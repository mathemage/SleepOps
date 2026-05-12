"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  SLEEPOPS_STATE_STORAGE_KEY,
  parseSleepOpsCoreState,
  serializeSleepOpsCoreState,
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

const MINUTES_STEP = 5;
const MAX_ROUTINE_MINUTES = 900;
const MAX_BUFFER_MINUTES = 240;
const PROFILER_RETENTION_DAYS = 7;
const PROFILER_STORAGE_KEY = "sleepops.morningRoutineProfiler.v1";
const PROFILER_CHANGE_EVENT = "sleepops.morningRoutineProfiler.change";
const STEP_CLASSIFICATION_OPTIONS: Array<{
  value: RoutineStepClassification;
  label: string;
}> = [
  { value: "required-morning", label: "Required morning" },
  { value: "movable-evening", label: "Move to evening" },
  { value: "decision-setup", label: "Prep tonight" },
];

export function SleepCompiler() {
  const [initialCoreState] = useState(() =>
    parseSleepOpsCoreState(readCachedString(SLEEPOPS_STATE_STORAGE_KEY)),
  );
  const [workStart, setWorkStart] = useState(
    initialCoreState.workStart,
  );
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

  useEffect(() => {
    writeCachedString(
      SLEEPOPS_STATE_STORAGE_KEY,
      serializeSleepOpsCoreState({
        workStart,
        manualMorningRoutineMinutes,
        useProfiledMorningRoutine,
        commuteBufferMinutes,
        shutdownProgressState,
        shutdownRemindersEnabled,
      }),
    );
  }, [
    commuteBufferMinutes,
    manualMorningRoutineMinutes,
    shutdownProgressState,
    shutdownRemindersEnabled,
    useProfiledMorningRoutine,
    workStart,
  ]);

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
        MINUTES_STEP,
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
          MINUTES_STEP,
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
              <p className="mt-3 max-w-2xl text-sm text-[#52525b]">
                Enter tomorrow&apos;s work start, morning routine, and buffer.
                SleepOps turns that into tonight&apos;s shutdown time, bedtime,
                and wake-up plan.
              </p>
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

            <button
              className="h-12 w-full border border-[#166534] bg-[#166534] px-4 text-sm font-semibold text-white hover:bg-[#14532d] sm:w-auto"
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
                <p className="text-sm font-medium text-[#3f3f46]">
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
                          className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-sm font-semibold text-[#18181b] outline-none focus:border-[#166534]"
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
                          className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-sm font-semibold text-[#18181b] outline-none focus:border-[#166534]"
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
                          className="h-12 w-full border border-[#cfd8d1] bg-[#fbfcfb] px-3 text-lg font-semibold text-[#18181b] outline-none focus:border-[#166534]"
                          disabled={!todayKey || !recordDateKey}
                          inputMode="numeric"
                          max={MAX_ROUTINE_MINUTES}
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
                          className="h-12 border border-[#d8dfda] bg-white px-3 text-sm font-semibold text-[#18181b] hover:bg-[#fbfcfb]"
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
                    {formatDuration(displayedTotalMinutesForDay(profiler, recordDateKey))}
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

          <section
            aria-labelledby="routine-compressor-heading"
            className="border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  className="text-xl font-semibold"
                  id="routine-compressor-heading"
                >
                  Routine compressor
                </h2>
                <p className="mt-1 text-sm text-[#52525b]">
                  Uses the selected profiler day. Mark each step as required in
                  the morning, movable to the evening, or something you can prep
                  tonight ahead of time.
                </p>
              </div>
              <div className="text-sm text-[#52525b]">
                Profiled total{" "}
                <strong className="text-[#18181b]">
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

            <div className="mt-5 flex flex-col gap-3 border-t border-[#e4e7e4] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-[#52525b]">
                Compressed morning duration
                <strong className="ml-2 text-lg text-[#18181b]">
                  {formatDuration(routineCompression.minimumMorningMinutes)}
                </strong>
              </div>
              <button
                className="h-12 border border-[#166534] bg-[#166534] px-4 text-sm font-semibold text-white hover:bg-[#14532d]"
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
              <div>
                <h2 className="text-xl font-semibold">Tonight timeline</h2>
                <p className="mt-1 text-sm text-[#52525b]">
                  The checkpoints below show when shutdown starts, when you need
                  to be in bed, and when tomorrow begins.
                </p>
              </div>
              <p className="text-sm text-[#52525b]">
                {hasWarning
                  ? "Your shutdown-and-sleep window no longer fits before work."
                  : `${formatDuration(
                      schedule.availableFlexMinutes,
                    )} is still free before shutdown begins.`}
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
    <main className="min-h-screen bg-[#f6f8f7] px-4 py-5 text-[#18181b] sm:px-6 lg:px-8">
      <section
        aria-label="SleepOps loading"
        className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-3xl items-center border border-[#d8dfda] bg-white p-5 shadow-sm sm:p-8"
      >
        <p className="text-sm font-semibold text-[#166534]">SleepOps</p>
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
    <main className="min-h-screen bg-[#101513] px-4 py-5 text-white sm:px-6 lg:px-8">
      <section
        aria-label="Evening shutdown assistant"
        className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-3xl flex-col justify-center gap-8 border border-[#34443c] bg-[#16211c] p-5 shadow-sm sm:p-8"
      >
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[#86efac]">
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
              className="h-14 border border-[#bbf7d0] bg-[#bbf7d0] px-5 text-base font-semibold text-[#101513] hover:bg-[#86efac]"
              onClick={onAdvance}
              type="button"
            >
              Done
            </button>
          ) : null}
          {isPreview ? (
            <button
              className="h-14 border border-[#4b5f55] bg-transparent px-5 text-base font-semibold text-white hover:bg-[#1f2d27]"
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

    const refreshSupport = async () => {
      const nextSupport = await readShutdownReminderSupport();
      if (!disposed) {
        setSupport(nextSupport);
      }
    };

    void refreshSupport();

    return () => {
      disposed = true;
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
      className="border border-[#d8dfda] bg-[#fbfcfb] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-sm font-semibold text-[#18181b]"
            id="shutdown-reminders-heading"
          >
            Shutdown reminders
          </h2>
          <p className="mt-1 text-sm text-[#52525b]">{statusText}</p>
        </div>
        <button
          className="h-11 border border-[#166534] bg-white px-3 text-sm font-semibold text-[#166534] hover:bg-[#f0fdf4] disabled:cursor-not-allowed disabled:border-[#cfd8d1] disabled:text-[#71717a] disabled:hover:bg-white"
          disabled={isUnavailable}
          onClick={toggleReminders}
          type="button"
        >
          {isEnabled ? "Turn off reminders" : "Enable shutdown reminders"}
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
    <div className="min-h-40 border border-[#d8dfda] bg-[#fbfcfb] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#18181b]">{title}</h3>
        <strong className="shrink-0 text-sm text-[#18181b]">
          {formatDuration(minutes)}
        </strong>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-4 text-sm text-[#52525b]">{emptyText}</p>
      ) : (
        <ol aria-label={listLabel} className="mt-4 grid gap-2 text-sm">
          {tasks.map((task) => (
            <li
              className="flex items-center justify-between gap-3 text-[#3f3f46]"
              key={task.stepId}
            >
              <span className="min-w-0 truncate">{task.label}</span>
              <span className="shrink-0 font-semibold text-[#18181b]">
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

async function readShutdownReminderSupport(): Promise<ReminderSupportState> {
  if (typeof window === "undefined") {
    return {
      status: "unsupported",
      message: "Notifications are not supported in this browser.",
      permission: null,
    };
  }

  const hasNotification = typeof window.Notification !== "undefined";
  const hasServiceWorker =
    "serviceWorker" in navigator &&
    typeof navigator.serviceWorker?.ready?.then === "function";
  const registration = hasServiceWorker
    ? await waitForServiceWorkerRegistration()
    : null;
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
    return `Reminder set for ${shutdownStartTime} while SleepOps is open.`;
  }

  if (support.permission === "granted") {
    return "Notifications are allowed. Shutdown reminders are off.";
  }

  return "Enable reminders to be notified at shutdown start while SleepOps is open.";
}

async function waitForServiceWorkerRegistration() {
  return Promise.race<ServiceWorkerRegistration | null>([
    navigator.serviceWorker.ready,
    new Promise((resolve) => {
      window.setTimeout(() => resolve(null), 1500);
    }),
  ]);
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

    queueMicrotask(() => {
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
