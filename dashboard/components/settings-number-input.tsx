"use client";

import { useState, type ComponentProps, type FocusEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  isIncompleteSettingsNumberDraft,
  parseSettingsNumberDraft,
} from "@/lib/settings-number-draft";

type SettingsNumberInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onChange: (value: number) => void;
  /** Whole numbers only (default false). */
  integer?: boolean;
};

/** Controlled numeric field that allows clearing while typing; restores on blur if empty. */
export function SettingsNumberInput({
  value,
  onChange,
  integer = false,
  onBlur,
  onFocus,
  ...props
}: SettingsNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => String(value));

  const commitBlur = () => {
    if (draft === "" || draft === "-" || isIncompleteSettingsNumberDraft(draft)) {
      setDraft(String(value));
      return;
    }
    const n = parseSettingsNumberDraft(draft, integer);
    if (n != null) {
      onChange(n);
      setDraft(String(n));
    } else {
      setDraft(String(value));
    }
  };

  const displayValue = focused ? draft : String(value);

  return (
    <Input
      {...props}
      type="number"
      value={displayValue}
      onFocus={(e: FocusEvent<HTMLInputElement>) => {
        setFocused(true);
        setDraft(String(value));
        onFocus?.(e);
      }}
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        setFocused(false);
        commitBlur();
        onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (isIncompleteSettingsNumberDraft(raw)) return;
        const n = parseSettingsNumberDraft(raw, integer);
        if (n != null) onChange(n);
      }}
    />
  );
}
