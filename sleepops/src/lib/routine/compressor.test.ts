import { describe, expect, it } from "vitest";
import { compressMorningRoutine } from "./compressor";
import type { MorningRoutineProfiler } from "./profiler";

describe("routine compressor", () => {
  it("keeps required tasks in the morning and moves eligible tasks to evening blocks", () => {
    const compression = compressMorningRoutine(
      createProfiler([
        ["wake", "Wake", "required-morning"],
        ["shower", "Shower", "movable-evening"],
        ["clothes", "Choose clothes", "decision-setup"],
        ["coffee", "Coffee", "required-morning"],
      ]),
      {
        wake: 10,
        shower: 20,
        clothes: 5,
        coffee: 0,
      },
    );

    expect(compression.minimumMorningTasks.map((task) => task.stepId)).toEqual([
      "wake",
    ]);
    expect(compression.eveningTasks.map((task) => task.stepId)).toEqual([
      "shower",
    ]);
    expect(
      compression.eveningPreparationTasks.map((task) => task.stepId),
    ).toEqual(["clothes"]);
    expect(compression.minimumMorningMinutes).toBe(10);
    expect(compression.eveningMinutes).toBe(20);
    expect(compression.eveningPreparationMinutes).toBe(5);
    expect(compression.totalProfiledMinutes).toBe(35);
  });

  it("uses routine defaults for missing step minutes", () => {
    const compression = compressMorningRoutine(
      createProfiler([
        ["wake", "Wake", "required-morning"],
        ["toilet", "Commute/Post-morning", "movable-evening"],
        ["custom", "Custom", "decision-setup"],
      ]),
    );

    expect(compression.minimumMorningMinutes).toBe(15);
    expect(compression.eveningMinutes).toBe(20);
    expect(compression.eveningPreparationMinutes).toBe(0);
  });

  it("preserves original routine order inside each compressed block", () => {
    const compression = compressMorningRoutine(
      createProfiler([
        ["bag", "Pack bag", "decision-setup"],
        ["wake", "Wake", "required-morning"],
        ["shower", "Shower", "movable-evening"],
        ["meds", "Meds", "required-morning"],
        ["clothes", "Choose clothes", "decision-setup"],
        ["exercise", "Exercise", "movable-evening"],
      ]),
      {
        exercise: 30,
        clothes: 5,
        meds: 2,
        shower: 15,
        wake: 8,
        bag: 4,
      },
    );

    expect(compression.minimumMorningTasks.map((task) => task.stepId)).toEqual([
      "wake",
      "meds",
    ]);
    expect(compression.eveningTasks.map((task) => task.stepId)).toEqual([
      "shower",
      "exercise",
    ]);
    expect(
      compression.eveningPreparationTasks.map((task) => task.stepId),
    ).toEqual(["bag", "clothes"]);
  });
});

function createProfiler(
  steps: Array<
    [
      id: string,
      label: string,
      classification: MorningRoutineProfiler["steps"][number]["classification"],
    ]
  >,
): MorningRoutineProfiler {
  return {
    steps: steps.map(([id, label, classification]) => ({
      id,
      label,
      classification,
    })),
    days: [],
  };
}
