import { Check, Circle, Minus, X } from "lucide-react";
import type { CheckState, ChecklistFrame } from "@/lib/strategy-scenarios";
import { cn } from "@/lib/utils";

const STATE_ICON: Record<CheckState, { icon: typeof Check; className: string; label: string }> = {
  pass: { icon: Check, className: "text-emerald-400", label: "Passes" },
  fail: { icon: X, className: "text-red-400", label: "Fails" },
  pending: { icon: Circle, className: "text-zinc-600", label: "Not checked yet" },
  skip: { icon: Minus, className: "text-zinc-500", label: "Doesn't apply" },
};

const OUTCOME_CLASS = {
  good: "border-emerald-800/60 bg-emerald-950/30 text-emerald-200",
  bad: "border-red-900/60 bg-red-950/25 text-red-200",
  neutral: "border-zinc-700 bg-zinc-900/60 text-zinc-300",
} as const;

export function ScenarioChecklist({ frame }: { frame: ChecklistFrame }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {frame.checks.map((check) => {
          const { icon: Icon, className, label } = STATE_ICON[check.state];
          return (
            <li
              key={check.label}
              className={cn(
                "flex items-start gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5",
                check.state === "pending" && "opacity-60",
              )}
            >
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", className)} aria-label={label} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">{check.label}</p>
                <p className="text-[11px] leading-snug text-zinc-500">{check.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {frame.outcome ? (
        <p className={cn("rounded-md border px-2.5 py-2 text-xs", OUTCOME_CLASS[frame.outcome.tone])}>
          {frame.outcome.text}
        </p>
      ) : null}
    </div>
  );
}
