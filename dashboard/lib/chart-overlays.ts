import type { ChartOverlayLine, Position, Trade } from "@/lib/types/database";

export function overlaysForTrade(trade: Trade): ChartOverlayLine[] {
  const lines: ChartOverlayLine[] = [
    {
      price: trade.entry_price,
      color: "#10b981",
      label: "Entry",
    },
  ];

  if (trade.stop_loss != null) {
    lines.push({
      price: trade.stop_loss,
      color: "#ef4444",
      label: "SL",
      lineStyle: "dashed",
    });
  }

  if (trade.take_profit != null) {
    lines.push({
      price: trade.take_profit,
      color: "#22d3ee",
      label: "TP",
      lineStyle: "dashed",
    });
  }

  if (trade.exit_price != null) {
    lines.push({
      price: trade.exit_price,
      color: "#a1a1aa",
      label: "Exit",
      lineStyle: "dashed",
    });
  }

  return lines;
}

export function overlaysForPosition(position: Position, trade?: Trade): ChartOverlayLine[] {
  const lines: ChartOverlayLine[] = [
    {
      price: position.avg_cost,
      color: "#10b981",
      label: "Avg cost",
    },
  ];

  if (trade) {
    if (trade.stop_loss != null) {
      lines.push({
        price: trade.stop_loss,
        color: "#ef4444",
        label: "SL",
        lineStyle: "dashed",
      });
    }
    if (trade.take_profit != null) {
      lines.push({
        price: trade.take_profit,
        color: "#22d3ee",
        label: "TP",
        lineStyle: "dashed",
      });
    }
  }

  return lines;
}
