import { ArrowRight, Hourglass, Lock } from "lucide-react";
import type { ChipState, ChipsFrame } from "@/lib/strategy-scenarios";
import { cn } from "@/lib/utils";

const CHIP_CLASS: Record<ChipState, string> = {
  normal: "border-zinc-700 bg-zinc-900 text-zinc-300",
  open: "border-sky-800/70 bg-sky-950/40 text-sky-200",
  confirming: "border-violet-800/70 bg-violet-950/40 text-violet-200",
  breakout: "border-amber-700/70 bg-amber-950/40 text-amber-200",
  weakest: "border-dashed border-red-700/80 bg-zinc-900 text-red-300",
  dropped: "border-red-900/60 bg-red-950/20 text-red-400/80 line-through",
  added: "border-emerald-700/70 bg-emerald-950/40 text-emerald-200",
};

const INCOMING_CLASS = {
  waiting: "border-amber-700/70 text-amber-200",
  added: "border-emerald-700/70 text-emerald-200",
  skipped: "border-red-800/70 text-red-300",
} as const;

const LEGEND: { state: ChipState; label: string }[] = [
  { state: "open", label: "Open trade" },
  { state: "confirming", label: "Confirming" },
  { state: "breakout", label: "Breakout window" },
  { state: "weakest", label: "Weakest" },
  { state: "dropped", label: "Removed" },
  { state: "added", label: "Added" },
];

function ChipIcon({ state }: { state: ChipState }) {
  if (state === "open") return <Lock className="h-3 w-3" aria-hidden />;
  if (state === "confirming") return <Hourglass className="h-3 w-3" aria-hidden />;
  return null;
}

export function ScenarioListChips({ frame }: { frame: ChipsFrame }) {
  const used = new Set(frame.chips.map((chip) => chip.state));
  return (
    <div className="space-y-3">
      {frame.incoming ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "rounded border bg-zinc-950 px-2 py-1 font-mono font-semibold",
              INCOMING_CLASS[frame.incoming.state],
            )}
          >
            {frame.incoming.symbol}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
          <span className="text-zinc-400">{frame.incoming.label}</span>
        </div>
      ) : null}
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-zinc-500">
          Active list ({frame.chips.filter((chip) => chip.state !== "dropped").length})
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {frame.chips.map((chip) => (
            <li
              key={chip.symbol}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-xs",
                CHIP_CLASS[chip.state],
              )}
            >
              <ChipIcon state={chip.state} />
              {chip.symbol}
              {chip.state === "breakout" ? (
                <span className="rounded bg-amber-500/15 px-1 font-sans text-[9px] font-medium text-amber-300">
                  Breakout
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {frame.caption ? <p className="text-[11px] text-zinc-500">{frame.caption}</p> : null}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        {LEGEND.filter((item) => used.has(item.state)).map((item) => (
          <li key={item.state} className="inline-flex items-center gap-1">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", CHIP_CLASS[item.state])} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
