import { describe, expect, it } from "vitest";
import {
  buildShutdownActions,
  buildShutdownWindow,
  getShutdownProgress,
  isShutdownWindowActive,
} from "./shutdown";

describe("shutdown assistant", () => {
  it("derives the shutdown window from lights-out and a valid duration", () => {
    expect(
      buildShutdownWindow({
        lightsOutTime: "22:15",
        shutdownMinutes: 45,
      }),
    ).toEqual({
      lightsOutTime: "22:15",
      shutdownStartTime: "21:30",
      shutdownMinutes: 45,
    });

    expect(
      buildShutdownWindow({
        lightsOutTime: "23:15",
        shutdownMinutes: 75,
      }).shutdownStartTime,
    ).toBe("22:00");
  });

  it("detects active shutdown windows before lights-out", () => {
    const window = buildShutdownWindow({
      lightsOutTime: "22:15",
      shutdownMinutes: 45,
    });

    expect(isShutdownWindowActive(window, "21:29")).toBe(false);
    expect(isShutdownWindowActive(window, "21:30")).toBe(true);
    expect(isShutdownWindowActive(window, "22:14")).toBe(true);
    expect(isShutdownWindowActive(window, "22:15")).toBe(false);
  });

  it("detects active shutdown windows that cross midnight", () => {
    const window = buildShutdownWindow({
      lightsOutTime: "00:30",
      shutdownMinutes: 45,
    });

    expect(window.shutdownStartTime).toBe("23:45");
    expect(isShutdownWindowActive(window, "23:44")).toBe(false);
    expect(isShutdownWindowActive(window, "23:50")).toBe(true);
    expect(isShutdownWindowActive(window, "00:10")).toBe(true);
    expect(isShutdownWindowActive(window, "00:30")).toBe(false);
  });

  it("orders fixed shutdown actions before evening and prep tasks, then bed", () => {
    const actions = buildShutdownActions({
      eveningTasks: [
        { stepId: "shower", label: "Shower" },
        { stepId: "exercise", label: "Mobility" },
      ],
      eveningPreparationTasks: [
        { stepId: "bag", label: "Pack bag" },
        { stepId: "clothes", label: "Choose clothes" },
      ],
    });

    expect(actions.map((action) => action.label)).toEqual([
      "Close laptop and put it away.",
      "Do evening task: Shower",
      "Do evening task: Mobility",
      "Prep for morning: Pack bag",
      "Prep for morning: Choose clothes",
      "Dental Care.",
      "Get in bed and turn lights out.",
    ]);
  });

  it("does not add default dental care when an evening task already covers it", () => {
    const actions = buildShutdownActions({
      eveningPreparationTasks: [
        { stepId: "brush-teeth", label: "Brush Teeth" },
      ],
    });

    expect(
      actions.filter((action) =>
        /brush teeth|dental care/i.test(action.label),
      ),
    ).toHaveLength(1);
    expect(actions.map((action) => action.label)).toEqual([
      "Close laptop and put it away.",
      "Prep for morning: Brush Teeth",
      "Get in bed and turn lights out.",
    ]);
  });

  it("tracks the current action and clear completion state", () => {
    const actions = buildShutdownActions({
      eveningPreparationTasks: [{ stepId: "bag", label: "Pack bag" }],
    });

    expect(getShutdownProgress(actions, 0)).toMatchObject({
      status: "active",
      action: { id: "close-laptop" },
      completedActions: 0,
      totalActions: 4,
    });
    expect(getShutdownProgress(actions, 2)).toMatchObject({
      status: "active",
      action: { id: "dental-care" },
      completedActions: 2,
      totalActions: 4,
    });
    expect(getShutdownProgress(actions, actions.length)).toEqual({
      status: "complete",
      action: null,
      completedActions: actions.length,
      totalActions: actions.length,
    });
  });
});
