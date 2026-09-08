"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";

type DraftInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "onInput" | "onBlur" | "onKeyDown"
> & {
  value: string | number;
  onValueCommit: (value: string) => void;
};

// Keep unfinished edits in the native input, including partial date/time segments.
// Only completed edits belong in the schedule and persistent storage.
export function DraftInput({
  value,
  onValueCommit,
  ...props
}: DraftInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && !(document.activeElement === input && dirty.current)) {
      input.value = String(value);
    }
  }, [value]);

  const commit = (input: HTMLInputElement) => {
    if (!dirty.current) return;
    dirty.current = false;
    let next = input.value;

    if (input.validity.badInput || (next === "" && props.required)) {
      input.value = String(value);
      return;
    }

    if (next !== "" && props.type === "number") {
      const step = Number(props.step ?? 1);
      const min = Number(props.min ?? 0);
      const max = Number(props.max ?? Infinity);
      const rounded = min + Math.round((Number(next) - min) / step) * step;
      next = String(Math.min(max, Math.max(min, rounded)));
    } else if (next !== "" && props.type === "date") {
      if (props.min && next < String(props.min)) next = String(props.min);
      if (props.max && next > String(props.max)) next = String(props.max);
    }

    input.value = next;
    onValueCommit(next);
  };

  return (
    <input
      {...props}
      defaultValue={value}
      ref={inputRef}
      onInput={() => { dirty.current = true; }}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault();
          dirty.current = false;
          event.currentTarget.value = String(value);
        }
      }}
    />
  );
}
