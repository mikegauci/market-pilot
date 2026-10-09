"use client";

import { useNow } from "@/lib/hooks/use-now";
import {
  formatGaugePercent,
  formatPriceMoveFromEntry,
  slProximityPct,
  tpProgressPct,
} from "@/lib/position-risk";
import type { Position, Settings, Trade } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  position: Position;
  trade: Trade | null;
  settings: Settings | null | undefined;
};

function GaugeBar({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: number | null;
  tone: "danger" | "success" | "neutral";
  detail?: string;
}) {
  if (value == null) return null;

  const color =
    tone === "danger"
      ? "bg-red-500"
      : tone === "success"
        ? "bg-emerald-500"
        : "bg-zinc-500";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-zinc-500">{label}</span>
        <span className="tabular-nums text-zinc-400">{formatGaugePercent(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      {detail && <p className="mt-0.5 text-[10px] text-zinc-600">{detail}</p>}
    </div>
  );
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "expired";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours}h ${mins}m left`;
  }
  return `${totalMinutes}m left`;
}

export function PositionRiskGauge({ position, trade, settings }: Props) {
  const now = useNow(true, 30_000);

  if (!trade) return null;

  const price = position.market_price ?? trade.entry_price;
  const moveFromEntry = formatPriceMoveFromEntry(trade.entry_price, price);
  const slProximity =
    trade.stop_loss != null
      ? slProximityPct(trade.entry_price, trade.stop_loss, price)
      : null;
  const tpProgress =
    trade.take_profit != null
      ? tpProgressPct(trade.entry_price, trade.take_profit, price)
      : null;

  const maxHold = settings ? settings.max_hold_minutes : 0;
  let holdDetail: string | undefined;
  let holdProgress: number | null = null;

  if (maxHold > 0 && trade.entry_time) {
    const elapsed = now - new Date(trade.entry_time).getTime();
    const limitMs = maxHold * 60_000;
    const remaining = limitMs - elapsed;
    holdProgress = Math.max(0, Math.min(100, (elapsed / limitMs) * 100));
    holdDetail = formatCountdown(remaining);
  }

  const hasAny = slProximity != null || tpProgress != null || holdProgress != null;
  if (!hasAny) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-800/60 pt-3">
      <p className="text-[11px] font-medium text-zinc-500">Exit proximity</p>
      <GaugeBar
        label="Stop progress"
        value={slProximity}
        tone={slProximity != null && slProximity >= 70 ? "danger" : "neutral"}
        detail={
          trade.stop_loss != null
            ? [`Stop ${trade.stop_loss.toFixed(2)}`, moveFromEntry].filter(Boolean).join(" · ")
            : undefined
        }
      />
      <GaugeBar
        label="Take-profit progress"
        value={tpProgress}
        tone="success"
        detail={
          trade.take_profit != null ? `Target ${trade.take_profit.toFixed(2)}` : undefined
        }
      />
      {holdProgress != null && (
        <GaugeBar
          label="Max hold elapsed"
          value={holdProgress}
          tone={holdProgress >= 85 ? "danger" : "neutral"}
          detail={holdDetail}
        />
      )}
    </div>
  );
}
