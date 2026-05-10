import { formatClockTime, parseClockTime } from "./schedule";

export const MIN_SHUTDOWN_MINUTES = 45;
export const MAX_SHUTDOWN_MINUTES = 75;

export type ShutdownRoutineTask = {
  stepId: string;
  label: string;
  minutes?: number;
};

export type ShutdownWindowInput = {
  lightsOutTime: string;
  shutdownMinutes: number;
};

export type ShutdownWindow = {
  lightsOutTime: string;
  shutdownStartTime: string;
  shutdownMinutes: number;
};

export type ShutdownAction = {
  id: string;
  label: string;
};

export type ShutdownProgress =
  | {
      status: "active";
      action: ShutdownAction;
      completedActions: number;
      totalActions: number;
    }
  | {
      status: "complete";
      action: null;
      completedActions: number;
      totalActions: number;
    };

export function buildShutdownWindow(
  input: ShutdownWindowInput,
): ShutdownWindow {
  assertShutdownMinutes(input.shutdownMinutes);

  const lightsOutMinutes = parseClockTime(input.lightsOutTime);

  return {
    lightsOutTime: input.lightsOutTime,
    shutdownStartTime: formatClockTime(lightsOutMinutes - input.shutdownMinutes),
    shutdownMinutes: input.shutdownMinutes,
  };
}

export function isShutdownWindowActive(
  window: ShutdownWindow,
  currentTime: string,
): boolean {
  const startMinutes = parseClockTime(window.shutdownStartTime);
  const endMinutes = parseClockTime(window.lightsOutTime);
  const currentMinutes = parseClockTime(currentTime);

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function buildShutdownActions({
  eveningTasks = [],
  eveningPreparationTasks = [],
}: {
  eveningTasks?: ShutdownRoutineTask[];
  eveningPreparationTasks?: ShutdownRoutineTask[];
} = {}): ShutdownAction[] {
  const taskActions = [
    ...eveningTasks.map((task) => ({
      id: `evening:${task.stepId}`,
      label: `Do evening task: ${task.label}`,
    })),
    ...eveningPreparationTasks.map((task) => ({
      id: `prep:${task.stepId}`,
      label: `Prep for morning: ${task.label}`,
    })),
  ];

  const hasDentalCareAction = taskActions.some((action) =>
    isDentalCareActionLabel(action.label),
  );

  return [
    {
      id: "close-laptop",
      label: "Close laptop and put it away.",
    },
    ...taskActions,
    ...(hasDentalCareAction
      ? []
      : [
          {
            id: "dental-care",
            label: "Dental Care.",
          },
        ]),
    {
      id: "lights-out",
      label: "Get in bed and turn lights out.",
    },
  ];
}

export function getShutdownProgress(
  actions: ShutdownAction[],
  completedActions: number,
): ShutdownProgress {
  const totalActions = actions.length;
  const safeCompletedActions = Math.min(
    totalActions,
    Math.max(0, Math.floor(completedActions)),
  );

  if (safeCompletedActions >= totalActions) {
    return {
      status: "complete",
      action: null,
      completedActions: safeCompletedActions,
      totalActions,
    };
  }

  return {
    status: "active",
    action: actions[safeCompletedActions],
    completedActions: safeCompletedActions,
    totalActions,
  };
}

function assertShutdownMinutes(shutdownMinutes: number): void {
  if (
    !Number.isInteger(shutdownMinutes) ||
    shutdownMinutes < MIN_SHUTDOWN_MINUTES ||
    shutdownMinutes > MAX_SHUTDOWN_MINUTES
  ) {
    throw new RangeError(
      `shutdownMinutes must be between ${MIN_SHUTDOWN_MINUTES} and ${MAX_SHUTDOWN_MINUTES}.`,
    );
  }
}

function isDentalCareActionLabel(label: string): boolean {
  const normalizedLabel = label.toLowerCase();
  return (
    normalizedLabel.includes("brush teeth") ||
    normalizedLabel.includes("dental care")
  );
}
