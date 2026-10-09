"use client";

import { useState, type ReactNode } from "react";
import { useReadOnly } from "@/components/read-only-provider";
import { useServerResult } from "@/lib/hooks/use-server-result";
import { cn } from "@/lib/utils";

type Props<Res extends { ok: true } | { ok: false; error: string }> = {
  action: () => Promise<Res>;
  labels: { show: string; hide: string; pending: string };
  render: (result: Extract<Res, { ok: true }>) => ReactNode;
  className?: string;
  panelClassName?: string;
};

/** "Why?"-style link that loads an AI explanation once, then toggles it. Hidden for read-only viewers. */
export function AiExplainToggle<Res extends { ok: true } | { ok: false; error: string }>({
  action,
  labels,
  render,
  className = "mt-1",
  panelClassName,
}: Props<Res>) {
  const readOnly = useReadOnly();
  const { pending, result, error, run } = useServerResult<Res>();
  const [open, setOpen] = useState(false);

  function onClick() {
    if (result) {
      setOpen((current) => !current);
      return;
    }
    setOpen(true);
    run(action);
  }

  if (readOnly) {
    return null;
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
      >
        {pending ? labels.pending : open && result ? labels.hide : labels.show}
      </button>
      {open && error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      {open && result ? (
        <div
          className={cn(
            "mt-2 space-y-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-2 text-xs leading-relaxed text-zinc-300",
            panelClassName,
          )}
        >
          {render(result)}
        </div>
      ) : null}
    </div>
  );
}
