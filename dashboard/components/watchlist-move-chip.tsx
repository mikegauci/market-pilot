import type { ReactNode } from "react";
import {
  formatSignedPct,
  watchlistMoveChipClass,
  watchlistMoveTitle,
  watchlistMoveTone,
  WATCHLIST_HEADWIND_FLOOR,
} from "@/lib/market-condition";
import { cn } from "@/lib/utils";

type Props = {
  symbol: string;
  change5m: number | null | undefined;
  floor?: number;
  className?: string;
  trailing?: ReactNode;
};

export function WatchlistMoveChip({
  symbol,
  change5m,
  floor = WATCHLIST_HEADWIND_FLOOR,
  className,
  trailing,
}: Props) {
  const tone = watchlistMoveTone(change5m, floor);
  const hasMove = change5m != null && Number.isFinite(change5m);
  const moveLabel = hasMove ? formatSignedPct(change5m) : "—";

  return (
    <span
      title={watchlistMoveTitle(symbol, change5m)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-xs tabular-nums",
        watchlistMoveChipClass(tone),
        className,
      )}
    >
      <span className="font-semibold">{symbol}</span>
      <span className={cn("text-[10px] opacity-90", !hasMove && "text-zinc-500")}>
        {moveLabel}
      </span>
      {trailing}
    </span>
  );
}
