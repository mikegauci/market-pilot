import type { Settings, Trade } from "@/lib/types/database";

export type PriceTick = {
  price: number;
  created_at: string;
};

export type ProfitTakePathStats = {
  profit_take_enabled: boolean;
  /** Early soft-exit band as % along entry → take-profit path (matches bot settings). */
  early_exit_band_path_pct: { min: number; max: number } | null;
  min_band_hits_required: number | null;
  max_path_progress_pct: number | null;
  /** True when price never exceeded entry (do not describe as "reached 0%"). */
  never_reached_profit_on_path: boolean;
  reached_early_exit_min: boolean;
  entered_early_exit_band: boolean;
  would_fast_spike_exit: boolean;
  band_touch_cycles: number;
  sample_note: string;
};

const DEFAULT_PROFIT_TAKE_MIN = 0.7;
const DEFAULT_PROFIT_TAKE_MAX = 0.8;
const DEFAULT_LOSS_CUT_MIN = 0.7;
const DEFAULT_LOSS_CUT_MAX = 0.9;

export type LossCutPathStats = {
  loss_cut_enabled: boolean;
  /** Early soft-stop band as % along entry → hard stop path (matches bot settings). */
  early_loss_cut_band_path_pct: { min: number; max: number } | null;
  min_band_hits_required: number | null;
  max_stop_path_progress_pct: number | null;
  /** True when price never traded below entry (do not describe as "reached 0% toward stop"). */
  never_went_underwater_on_stop_path: boolean;
  reached_early_loss_cut_min: boolean;
  entered_early_loss_cut_band: boolean;
  would_fast_spike_loss_cut: boolean;
  band_touch_cycles: number;
  sample_note: string;
};

export type InTradePeak = {
  peak_price: number;
  peak_at: string;
  peak_pct_from_entry: number;
  peak_pct_of_take_profit_path: number | null;
  peak_unrealized_dollars: number | null;
  sample_note: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeProfitTakeFractions(
  minFraction: number,
  maxFraction: number,
): { min: number; max: number } {
  const minF = minFraction;
  const maxF = maxFraction;
  const valid =
    minF > 0 && minF < 1 && maxF > 0 && maxF <= 1 && maxF > minF;
  if (!valid) {
    return { min: DEFAULT_PROFIT_TAKE_MIN, max: DEFAULT_PROFIT_TAKE_MAX };
  }
  return { min: minF, max: maxF };
}

function takeProfitPathProgress(
  entryPrice: number,
  takeProfit: number,
  price: number,
): number | null {
  if (entryPrice <= 0 || takeProfit <= entryPrice) return null;
  return (price - entryPrice) / (takeProfit - entryPrice);
}

function progressInBand(progress: number, minFraction: number, maxFraction: number): boolean {
  return minFraction <= progress && progress <= maxFraction;
}

function isFastSpikeExit(progress: number, maxFraction: number): boolean {
  return maxFraction < progress && progress < 1.0;
}

function normalizeLossCutFractions(
  minFraction: number,
  maxFraction: number,
): { min: number; max: number } {
  const minF = minFraction;
  const maxF = maxFraction;
  const valid =
    minF > 0 && minF < 1 && maxF > 0 && maxF <= 1 && maxF > minF;
  if (!valid) {
    return { min: DEFAULT_LOSS_CUT_MIN, max: DEFAULT_LOSS_CUT_MAX };
  }
  return { min: minF, max: maxF };
}

function stopLossPathProgress(
  entryPrice: number,
  stopLoss: number,
  price: number,
): number | null {
  if (entryPrice <= 0 || stopLoss >= entryPrice) return null;
  if (price >= entryPrice) return null;
  if (price <= stopLoss) return 1.0;
  return (entryPrice - price) / (entryPrice - stopLoss);
}

/** Max entry→stop path progress from quote snapshots (mirrors trader stop_loss_path_progress). */
export function computeLossCutPathStats(
  trade: Pick<Trade, "entry_price" | "stop_loss" | "side">,
  ticks: PriceTick[],
  settings: Pick<
    Settings,
    | "loss_cut_enabled"
    | "loss_cut_min_fraction"
    | "loss_cut_max_fraction"
    | "loss_cut_min_band_hits"
  >,
): LossCutPathStats | null {
  if (trade.side !== "buy" || trade.entry_price <= 0 || ticks.length === 0) {
    return null;
  }
  const stop = trade.stop_loss;
  if (stop == null || stop >= trade.entry_price) {
    return null;
  }

  const { min: minFraction, max: maxFraction } = normalizeLossCutFractions(
    settings.loss_cut_min_fraction,
    settings.loss_cut_max_fraction,
  );
  const bandMinPct = round1(minFraction * 100);
  const bandMaxPct = round1(maxFraction * 100);

  let maxProgress: number | null = null;
  let enteredBand = false;
  let fastSpike = false;
  let bandTouches = 0;

  for (const tick of ticks) {
    const progress = stopLossPathProgress(trade.entry_price, stop, tick.price);
    if (progress == null || progress <= 0) continue;
    if (maxProgress == null || progress > maxProgress) {
      maxProgress = progress;
    }
    if (progressInBand(progress, minFraction, maxFraction)) {
      enteredBand = true;
      bandTouches += 1;
    }
    if (isFastSpikeExit(progress, maxFraction)) {
      fastSpike = true;
    }
  }

  const neverUnderwater = maxProgress == null;
  const maxStopPathProgressPct =
    maxProgress == null ? null : round1(maxProgress * 100);
  const reachedMin = maxProgress != null && maxProgress >= minFraction;

  return {
    loss_cut_enabled: settings.loss_cut_enabled,
    early_loss_cut_band_path_pct: settings.loss_cut_enabled
      ? { min: bandMinPct, max: bandMaxPct }
      : null,
    min_band_hits_required: settings.loss_cut_enabled
      ? Math.max(1, settings.loss_cut_min_band_hits)
      : null,
    max_stop_path_progress_pct: maxStopPathProgressPct,
    never_went_underwater_on_stop_path: neverUnderwater,
    reached_early_loss_cut_min: reachedMin,
    entered_early_loss_cut_band: enteredBand,
    would_fast_spike_loss_cut: fastSpike,
    band_touch_cycles: bandTouches,
    sample_note:
      "Stop path progress is % from entry toward hard stop (100 = at stop). Band matches early Soft Stop settings.",
  };
}

/** Max entry→TP path progress from quote snapshots (mirrors trader take_profit_path_progress). */
export function computeProfitTakePathStats(
  trade: Pick<Trade, "entry_price" | "take_profit" | "side">,
  ticks: PriceTick[],
  settings: Pick<
    Settings,
    | "profit_take_enabled"
    | "profit_take_min_fraction"
    | "profit_take_max_fraction"
    | "profit_take_min_band_hits"
  >,
): ProfitTakePathStats | null {
  if (trade.side !== "buy" || trade.entry_price <= 0 || ticks.length === 0) {
    return null;
  }
  const tp = trade.take_profit;
  if (tp == null || tp <= trade.entry_price) {
    return null;
  }

  const { min: minFraction, max: maxFraction } = normalizeProfitTakeFractions(
    settings.profit_take_min_fraction,
    settings.profit_take_max_fraction,
  );
  const bandMinPct = round1(minFraction * 100);
  const bandMaxPct = round1(maxFraction * 100);

  let maxProgress: number | null = null;
  let enteredBand = false;
  let fastSpike = false;
  let bandTouches = 0;

  for (const tick of ticks) {
    const progress = takeProfitPathProgress(trade.entry_price, tp, tick.price);
    if (progress == null) continue;
    if (maxProgress == null || progress > maxProgress) {
      maxProgress = progress;
    }
    if (progressInBand(progress, minFraction, maxFraction)) {
      enteredBand = true;
      bandTouches += 1;
    }
    if (isFastSpikeExit(progress, maxFraction)) {
      fastSpike = true;
    }
  }

  const neverReachedProfit =
    maxProgress == null || maxProgress <= 0;
  const maxPathProgressPct =
    maxProgress != null && maxProgress > 0 ? round1(maxProgress * 100) : null;
  const reachedMin =
    maxProgress != null && maxProgress >= minFraction;

  return {
    profit_take_enabled: settings.profit_take_enabled,
    early_exit_band_path_pct: settings.profit_take_enabled
      ? { min: bandMinPct, max: bandMaxPct }
      : null,
    min_band_hits_required: settings.profit_take_enabled
      ? Math.max(1, settings.profit_take_min_band_hits)
      : null,
    max_path_progress_pct: maxPathProgressPct,
    never_reached_profit_on_path: neverReachedProfit,
    reached_early_exit_min: reachedMin,
    entered_early_exit_band: enteredBand,
    would_fast_spike_exit: fastSpike,
    band_touch_cycles: bandTouches,
    sample_note:
      "Path progress is % from entry toward take-profit (100 = full TP). Band matches early Soft Sell settings.",
  };
}

/** Best favorable price from bot quote snapshots while the trade was open (long only). */
export function computeInTradePeak(
  trade: Pick<Trade, "entry_price" | "take_profit" | "quantity" | "side">,
  ticks: PriceTick[],
): InTradePeak | null {
  if (trade.side !== "buy" || trade.entry_price <= 0 || ticks.length === 0) {
    return null;
  }

  let peakPrice = trade.entry_price;
  let peakAt = ticks[0]!.created_at;
  for (const tick of ticks) {
    if (tick.price > peakPrice) {
      peakPrice = tick.price;
      peakAt = tick.created_at;
    }
  }

  if (peakPrice <= trade.entry_price) {
    return null;
  }

  const peakPctFromEntry = round1(((peakPrice - trade.entry_price) / trade.entry_price) * 100);

  let peakPctOfTakeProfitPath: number | null = null;
  const tp = trade.take_profit;
  if (tp != null && tp > trade.entry_price) {
    const progress = takeProfitPathProgress(trade.entry_price, tp, peakPrice);
    peakPctOfTakeProfitPath =
      progress == null ? null : round1(Math.max(0, progress) * 100);
  }

  const qty = trade.quantity;
  const peakUnrealized =
    qty != null && qty > 0 ? round2((peakPrice - trade.entry_price) * qty) : null;

  return {
    peak_price: peakPrice,
    peak_at: peakAt,
    peak_pct_from_entry: peakPctFromEntry,
    peak_pct_of_take_profit_path: peakPctOfTakeProfitPath,
    peak_unrealized_dollars: peakUnrealized,
    sample_note:
      "Peak from bot quote snapshots during the trade (typically ~15s apart; may miss the exact tick high).",
  };
}

export function closedTradeIsLoss(trade: Trade): boolean {
  if (trade.status !== "closed") return false;
  const pnl = trade.net_pnl ?? trade.gross_pnl;
  return pnl != null && pnl < 0;
}
