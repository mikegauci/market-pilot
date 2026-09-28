"use client";

import { useState, useTransition } from "react";
import { toggleBot } from "@/lib/actions";

type Props = {
  enabled: boolean;
};

export function BotToggle({ enabled: initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        startTransition(async () => {
          try {
            await toggleBot(next);
          } catch {
            setEnabled(!next);
          }
        });
      }}
      className={`relative inline-flex h-8 w-14 items-center rounded-full transition ${
        enabled ? "bg-emerald-600" : "bg-zinc-700"
      } ${pending ? "opacity-60" : ""}`}
      aria-label={enabled ? "Disable bot" : "Enable bot"}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white transition ${
          enabled ? "translate-x-7" : "translate-x-1"
        }`}
      />
    </button>
  );
}
