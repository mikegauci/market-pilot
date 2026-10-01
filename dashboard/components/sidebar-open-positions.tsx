"use client";

import Link from "next/link";
import { useOpenPositions } from "@/components/open-positions-count-provider";
import { cn, formatCurrency } from "@/lib/utils";

export function SidebarOpenPositions() {
  const positions = useOpenPositions();

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Open positions
        </p>
        {positions.length > 0 ? (
          <Link
            href="/"
            className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
          >
            Details
          </Link>
        ) : null}
      </div>

      {positions.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">None</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
          {positions.map((p) => {
            const pnl = p.unrealized_pnl ?? 0;
            const hasPnl = p.unrealized_pnl != null;

            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="font-medium text-zinc-200">{p.symbol}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-medium",
                    !hasPnl
                      ? "text-zinc-500"
                      : pnl >= 0
                        ? "text-emerald-400/90"
                        : "text-red-400/90",
                  )}
                >
                  {hasPnl ? formatCurrency(pnl, p.currency) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
