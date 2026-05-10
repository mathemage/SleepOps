import { formatClockTime, parseClockTime } from "./schedule";

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

export type ShutdownRoutineTaskSelection = {
  eveningTasks: ShutdownRoutineTask[];
  eveningPreparationTasks: ShutdownRoutineTask[];
  totalMinutes: number;
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

export function selectShutdownRoutineTasks({
  availableMinutes,
  eveningTasks = [],
  eveningPreparationTasks = [],
}: {
  availableMinutes: number;
  eveningTasks?: ShutdownRoutineTask[];
  eveningPreparationTasks?: ShutdownRoutineTask[];
}): ShutdownRoutineTaskSelection {
  let remainingMinutes = Math.max(0, Math.floor(availableMinutes));
  let totalMinutes = 0;

  const selectTask = (task: ShutdownRoutineTask) => {
    const minutes = task.minutes ?? 0;
    if (minutes > remainingMinutes) {
      return null;
    }

    remainingMinutes -= minutes;
    totalMinutes += minutes;
    return task;
  };

  const selectedEveningTasks = eveningTasks
    .map(selectTask)
    .filter((task): task is ShutdownRoutineTask => task !== null);
  const selectedEveningPreparationTasks = eveningPreparationTasks
    .map(selectTask)
    .filter((task): task is ShutdownRoutineTask => task !== null);

  return {
    eveningTasks: selectedEveningTasks,
    eveningPreparationTasks: selectedEveningPreparationTasks,
    totalMinutes,
  };
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

function isDentalCareActionLabel(label: string): boolean {
  const normalizedLabel = label.toLowerCase();
  return (
    normalizedLabel.includes("brush teeth") ||
    normalizedLabel.includes("dental care")
  );
}
