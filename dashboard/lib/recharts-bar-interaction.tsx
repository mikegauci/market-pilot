import type { ComponentProps } from "react";
import { Rectangle } from "recharts";

export const perBarTooltipProps = {
  shared: false,
  cursor: false,
} as const;

type PnlBarPayload = {
  dailyPnl?: number;
  pnl?: number;
};

type PnlBarProps = ComponentProps<typeof Rectangle> & {
  value?: number;
  payload?: PnlBarPayload;
};

function pnlValueFromBarProps(barProps: PnlBarProps): number {
  if (typeof barProps.value === "number" && Number.isFinite(barProps.value)) {
    return barProps.value;
  }
  const payload = barProps.payload;
  if (!payload) {
    return 0;
  }
  const fromDaily =
    typeof payload.dailyPnl === "number" && Number.isFinite(payload.dailyPnl)
      ? payload.dailyPnl
      : undefined;
  const fromPnl =
    typeof payload.pnl === "number" && Number.isFinite(payload.pnl) ? payload.pnl : undefined;
  return fromDaily ?? fromPnl ?? 0;
}

export function renderPnlActiveBar(props: unknown) {
  const barProps = props as PnlBarProps;
  const value = pnlValueFromBarProps(barProps);
  const positive = value >= 0;
  return (
    <Rectangle
      {...barProps}
      fill={positive ? "#6ee7b7" : "#fca5a5"}
      stroke={positive ? "#34d399" : "#f87171"}
      strokeWidth={1}
    />
  );
}

/** @internal exported for unit tests */
export function pnlSignFromBarProps(props: unknown): "positive" | "negative" | "zero" {
  const barProps = props as PnlBarProps;
  const value = pnlValueFromBarProps(barProps);
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "zero";
}
