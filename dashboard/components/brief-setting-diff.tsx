"use client";

import { Button } from "@/components/ui/button";
import type { SettingDiff } from "@/lib/session-brief/setting-diff";

export function BriefSettingDiff({
  sessionDate,
  diffs,
  onApply,
  onHide,
}: {
  sessionDate: string;
  diffs: SettingDiff[];
  onApply: () => void;
  onHide: () => void;
}) {
  if (diffs.length === 0) return null;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <h3 className="text-sm font-medium text-zinc-200">From the {sessionDate} session brief</h3>
      <p className="mt-1 text-xs text-zinc-500">
        A small step from the current saved value. Apply fills the form (then Save settings), or
        hide this note until the next session brief.
      </p>
      <ul className="mt-3 space-y-2 text-sm text-zinc-300">
        {diffs.map((diff) => (
          <li key={diff.key} className="rounded-md bg-zinc-900/60 px-3 py-2">
            <p className="font-medium text-zinc-200">
              {diff.label}{" "}
              <span className="font-normal text-zinc-400">
                {diff.currentLabel} → {diff.proposedLabel}
              </span>
            </p>
            <p className="mt-1 text-zinc-400">{diff.why}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={onApply}
        >
          Apply to form
        </Button>
        <Button
          type="button"
          className="border border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onHide}
        >
          Hide
        </Button>
      </div>
    </section>
  );
}
