import {
  clampWholeMinutes,
  defaultStepMinutes,
  normalizeStepClassification,
  type MorningRoutineProfiler,
  type RoutineStepClassification,
} from "./profiler";

export type CompressedRoutineTask = {
  stepId: string;
  label: string;
  classification: RoutineStepClassification;
  minutes: number;
};

export type RoutineCompression = {
  minimumMorningTasks: CompressedRoutineTask[];
  eveningTasks: CompressedRoutineTask[];
  eveningPreparationTasks: CompressedRoutineTask[];
  minimumMorningMinutes: number;
  eveningMinutes: number;
  eveningPreparationMinutes: number;
  totalProfiledMinutes: number;
};

export function compressMorningRoutine(
  profiler: MorningRoutineProfiler,
  minutesByStepId?: Record<string, unknown>,
): RoutineCompression {
  const minimumMorningTasks: CompressedRoutineTask[] = [];
  const eveningTasks: CompressedRoutineTask[] = [];
  const eveningPreparationTasks: CompressedRoutineTask[] = [];

  for (const step of profiler.steps) {
    const minutes = clampWholeMinutes(
      minutesByStepId?.[step.id] ?? defaultStepMinutes(step.id),
    );

    if (minutes === 0) {
      continue;
    }

    const classification = normalizeStepClassification(step.classification);
    const task = {
      stepId: step.id,
      label: step.label,
      classification,
      minutes,
    };

    if (classification === "movable-evening") {
      eveningTasks.push(task);
    } else if (classification === "decision-setup") {
      eveningPreparationTasks.push(task);
    } else {
      minimumMorningTasks.push(task);
    }
  }

  const minimumMorningMinutes = sumTaskMinutes(minimumMorningTasks);
  const eveningMinutes = sumTaskMinutes(eveningTasks);
  const eveningPreparationMinutes = sumTaskMinutes(eveningPreparationTasks);

  return {
    minimumMorningTasks,
    eveningTasks,
    eveningPreparationTasks,
    minimumMorningMinutes,
    eveningMinutes,
    eveningPreparationMinutes,
    totalProfiledMinutes:
      minimumMorningMinutes + eveningMinutes + eveningPreparationMinutes,
  };
}

function sumTaskMinutes(tasks: CompressedRoutineTask[]): number {
  return tasks.reduce((sum, task) => sum + task.minutes, 0);
}
