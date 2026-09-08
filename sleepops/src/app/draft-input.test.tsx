// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftInput } from "./draft-input";

afterEach(cleanup);

describe("draft input editing", () => {
  it("keeps clearing and intermediate digits out of saved state", () => {
    const onValueCommit = vi.fn();
    const { getByRole } = render(
      <DraftInput type="number" value={75} step={5} required onValueCommit={onValueCommit} />,
    );
    const input = getByRole("spinbutton") as HTMLInputElement;
    for (const value of ["", "1", "12"]) {
      fireEvent.input(input, { target: { value } });
      expect(input.value).toBe(value);
      expect(onValueCommit).not.toHaveBeenCalled();
    }
    fireEvent.blur(input);
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith("10");
    expect(input.value).toBe("10");
  });

  it.each([
    ["842", "840"], ["999", "900"], ["-10", "0"],
    ["12.5", "15"], ["0", "0"], ["", "75"],
  ])("normalizes %s to %s only on commit", (draft, expected) => {
    const onValueCommit = vi.fn();
    const { getByRole } = render(
      <DraftInput type="number" value={75} min={0} max={900} step={5} required onValueCommit={onValueCommit} />,
    );
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: draft } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe(expected);
    if (draft === "") expect(onValueCommit).not.toHaveBeenCalled();
    else expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(expected);
    fireEvent.blur(input);
    expect(onValueCommit.mock.calls.length).toBe(draft === "" ? 0 : 1);
  });

  it("cancels edits with Escape without saving", () => {
    const onValueCommit = vi.fn();
    const { getByRole } = render(<DraftInput value="Wake" onValueCommit={onValueCommit} />);
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Breakfast" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(input.value).toBe("Wake");
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it("updates idle inputs but preserves active edits across parent updates", () => {
    const onValueCommit = vi.fn();
    const { getByRole, rerender } = render(<DraftInput value="Wake" onValueCommit={onValueCommit} />);
    const input = getByRole("textbox") as HTMLInputElement;
    rerender(<DraftInput value="Boot" onValueCommit={onValueCommit} />);
    expect(input.value).toBe("Boot");
    input.focus();
    fireEvent.input(input, { target: { value: "My routine" } });
    input.setSelectionRange(3, 3);
    rerender(<DraftInput value="External update" onValueCommit={onValueCommit} />);
    expect(input.value).toBe("My routine");
    expect(input.selectionStart).toBe(3);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("External update");
  });

  it("does not commit Enter during IME composition", () => {
    const onValueCommit = vi.fn();
    const { getByRole } = render(<DraftInput value="Wake" onValueCommit={onValueCommit} />);
    const input = getByRole("textbox");
    fireEvent.input(input, { target: { value: "朝" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onValueCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith("朝");
  });

  it.each([true, false])("handles blank time fields with required=%s", (required) => {
    const onValueCommit = vi.fn();
    const { getByLabelText } = render(
      <DraftInput aria-label="Time" type="time" value="09:00" required={required} onValueCommit={onValueCommit} />,
    );
    const input = getByLabelText("Time") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe(required ? "09:00" : "");
    if (required) expect(onValueCommit).not.toHaveBeenCalled();
    else expect(onValueCommit).toHaveBeenCalledExactlyOnceWith("");
  });

  it("clamps the date only after editing ends", () => {
    const onValueCommit = vi.fn();
    const { getByLabelText } = render(
      <DraftInput aria-label="Day" type="date" value="2026-05-10" min="2026-05-04" max="2026-05-10" required onValueCommit={onValueCommit} />,
    );
    const input = getByLabelText("Day") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "2000-01-01" } });
    expect(input.value).toBe("2000-01-01");
    fireEvent.blur(input);
    expect(input.value).toBe("2026-05-04");
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith("2026-05-04");
  });
});
