"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskProfilePicker } from "@/components/risk-profile-picker";
import { WatchlistSettingsSection } from "@/components/watchlist-settings-section";
import {
  SettingsField,
  SettingsFieldGroup,
  SettingsSection,
} from "@/components/settings-section";
import { updateSettings } from "@/lib/actions";
import {
  areAllRecommendationsApplied,
  detectMatchingProfile,
  formatRiskPct,
  getRecommendedValuesForProfile,
  isNearRecommended,
  pctOfEquity,
  resolveRiskProfile,
  RISK_PROFILES,
  validateProfileSelection,
  type RiskProfile,
  type RiskRecommendationKey,
} from "@/lib/risk-recommendations";
import {
  fractionToDisplayPercent,
  getMaxHoldHints,
  getStopLossHints,
  getTakeProfitHints,
  isNearStrategyPercent,
  STRATEGY_RECOMMENDATIONS,
  type StrategyHint,
} from "@/lib/strategy-recommendations";
import type { EmUniverseRow, Settings } from "@/lib/types/database";
import {
  computePositionSizing,
  isRiskPerTradeNonBinding,
  paperAvailableCash,
} from "@/lib/position-sizing";
import { cn, formatCurrency } from "@/lib/utils";

const SETTING_DESCRIPTIONS_FULL = {
  minimum_jev_confidence:
    "BUY probability must reach at least this level (and beat HOLD by the strategy margin) before the bot opens a trade — higher means fewer, pickier trades. This is not a calibrated chance of a profitable trade.",
  signal_record_threshold:
    "Buy signals above this BUY probability are marked as worth watching, so you can spot near-misses below your trade threshold.",
  risk_per_trade:
    "Most you are willing to lose on one trade if the stop loss is hit (USD). Profile presets derive this from risk_sync_equity × profile fraction.",
  max_position_size: "Largest amount the bot will put into a single trade (USD).",
  max_daily_loss:
    "If today's losses reach this amount, the bot stops opening new trades until tomorrow.",
  max_open_positions:
    "How many trades the bot can hold at the same time. Set at or above dynamic top-N to avoid slot blocking when names rotate off.",
  account_capital:
    "Paper sizing bankroll (USD). Live sizing uses min(IBKR NetLiquidation, this value).",
  stop_loss_percentage:
    "Auto-sell if the price drops this % below your entry — also controls how large each trade is for a given risk budget.",
  take_profit_percentage:
    "Auto-sell when the price rises this % above your entry to lock in gains.",
  prediction_horizon_minutes:
    "Expected holding horizon aligned with the Jev question (default 15 minutes).",
  last_entry_cutoff_minutes_before_close:
    "Block new entries this many minutes before the session close (early-close aware).",
  eod_closeout_minutes_before_close:
    "Flatten open positions this many minutes before the session close (5–15).",
  eod_flat_verify_minutes_before_close:
    "Verify the book is flat this many minutes before close and alert if not.",
  equity_divergence_alert_frac:
    "In live mode, alert when NetLiquidation and account capital differ by more than this %.",
  max_hold_minutes:
    "Force-close open trades after this many minutes (0 = off / unbounded). When off, exits use stop loss, take profit, Jev SELL, and EOD closeout.",
  min_hold_minutes:
    "Block Jev SELL soft-exits until a trade has been open this many minutes (0 = off). Stop loss, take profit, and EOD still work immediately.",
  jev_sell_exit_threshold:
    "Only soft-exit on a Jev SELL when sell probability reaches this % (and sell is dominant). Higher values let bracket take-profit work more often.",
  reentry_cooldown_minutes:
    "After exiting a symbol, block new entries in that symbol for this many minutes (0 = off). Reduces immediate re-chase after winners or stops.",
  min_volume_ratio:
    "Block new entries when latest 1-min volume is below this fraction of the 10-bar average (0 = off). Example: 0.5 requires at least half the recent average volume.",
  min_share_price:
    "Block entries and drop EM scan candidates below this USD share price (0 = off). Filters out thin/low-priced names such as sub-$5 ADRs.",
  watchlist: "Effective symbols the bot watches right now (updated by Jev when dynamic mode is on).",
  watchlist_core:
    "Fallback symbols until the first successful scan (or when dynamic mode is off).",
  watchlist_dynamic_size:
    "Maximum EM ADR/stock names kept after each scan that clear the min BUY floor (not a fill quota).",
  watchlist_min_buy:
    "Minimum Jev BUY (%) required to earn a dynamic watchlist slot. Trade entries still use Min BUY probability.",
  watchlist_refresh_minutes: "How often Jev re-scores the full EM universe.",
} as const;

const SETTING_DESCRIPTIONS = {
  minimum_jev_confidence: "Minimum BUY probability before the bot opens a trade.",
  signal_record_threshold: "Log buy signals above this % as watchlist-worthy near-misses.",
  risk_per_trade: "Max loss per trade if stop loss hits ($).",
  max_position_size: "Cap on capital deployed in one position ($).",
  max_daily_loss: "Stop new trades after today's losses reach this amount ($).",
  max_open_positions: "Concurrent open trades allowed (recommend ≥ max dynamic symbols).",
  account_capital: "Paper bankroll / live sizing ceiling ($).",
  stop_loss_percentage: "Exit when price falls this % below entry.",
  take_profit_percentage: "Exit when price rises this % above entry.",
  prediction_horizon_minutes: "Jev prediction horizon (minutes).",
  last_entry_cutoff_minutes_before_close: "No new entries N minutes before close.",
  eod_closeout_minutes_before_close: "Flatten N minutes before close (5–15).",
  eod_flat_verify_minutes_before_close: "Flat-check N minutes before close.",
  equity_divergence_alert_frac: "Alert when NetLiq vs capital diverge by this %.",
  max_hold_minutes: "Force-close after N minutes (0 = unbounded).",
  min_hold_minutes: "No Jev SELL exit until N minutes (0 = off).",
  jev_sell_exit_threshold: "Min Jev SELL % required to soft-exit.",
  reentry_cooldown_minutes: "No re-entry in same symbol for N minutes (0 = off).",
  min_volume_ratio: "Block entries when volume is below this fraction of average (0 = off).",
  min_share_price: "Block entries / EM picks below this USD price (0 = off).",
  watchlist: "Live symbols the trader evaluates each cycle.",
  watchlist_core: "Fallback until first scan; always-on when dynamic mode is off.",
  watchlist_dynamic_size: "Max symbols from each Jev scan that clear min BUY.",
  watchlist_min_buy: "Min Jev BUY % for a dynamic watchlist slot.",
  watchlist_refresh_minutes: "Minutes between full EM universe rescans.",
} as const;

function StrategyHintLine({ hint }: { hint: StrategyHint }) {
  return (
    <p
      className={cn(
        "text-xs leading-relaxed",
        hint.tone === "ok" && "text-emerald-400/90",
        hint.tone === "info" && "text-zinc-500",
        hint.tone === "warn" && "text-amber-400/90",
      )}
    >
      {hint.message}
    </p>
  );
}

type RiskFieldProps = {
  id: RiskRecommendationKey;
  label: string;
  description: string;
  descriptionFull: string;
  value: number;
  onChange: (value: number) => void;
  baselineEquity: number;
  currency: string;
  profile: RiskProfile;
};

function RiskField({
  id,
  label,
  description,
  descriptionFull,
  value,
  onChange,
  baselineEquity,
  currency,
  profile,
}: RiskFieldProps) {
  const targetPct = RISK_PROFILES[profile][id];
  const pct = pctOfEquity(value, baselineEquity);
  const recommended = getRecommendedValuesForProfile(baselineEquity, profile)[id];
  const matchesRecommended = isNearRecommended(value, baselineEquity, targetPct);

  return (
    <SettingsField
      id={id}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <Input
          id={id}
          name={id}
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(next);
          }}
          required
          className={cn(
            matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
          )}
        />
        {matchesRecommended && baselineEquity > 0 && (
          <span className="block text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
        {baselineEquity > 0 && pct != null && (
          <p
            className={cn(
              "text-xs",
              matchesRecommended ? "text-emerald-400/90" : "text-amber-400/90",
            )}
          >
            {formatRiskPct(pct)} of {formatCurrency(baselineEquity, currency)}
            {!matchesRecommended &&
              ` · Suggested ${formatCurrency(recommended, currency)}`}
          </p>
        )}
      </div>
    </SettingsField>
  );
}

type StrategyPercentFieldProps = {
  id: "stop_loss_percentage" | "take_profit_percentage";
  label: string;
  description: string;
  descriptionFull: string;
  value: number;
  onChange: (value: number) => void;
  hints: StrategyHint[];
  matchesRecommended: boolean;
};

function StrategyPercentField({
  id,
  label,
  description,
  descriptionFull,
  value,
  onChange,
  hints,
  matchesRecommended,
}: StrategyPercentFieldProps) {
  return (
    <SettingsField
      id={id}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <Input
          id={id}
          name={id}
          type="number"
          step="0.1"
          min="0.1"
          max="25"
          value={value}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(next);
          }}
          required
          className={cn(
            matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
          )}
        />
        {matchesRecommended && (
          <span className="block text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
        <div className="space-y-1">
          {hints.map((hint) => (
            <StrategyHintLine key={hint.message} hint={hint} />
          ))}
        </div>
      </div>
    </SettingsField>
  );
}

type EmUniverseStats = {
  count: number;
  tradableCount: number;
  topHoldings: EmUniverseRow[];
};

export function SettingsForm({
  settings,
  baselineEquity,
  currency,
  emUniverse,
}: {
  settings: Settings;
  baselineEquity: number;
  currency: string;
  emUniverse: EmUniverseStats;
}) {
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [riskPerTrade, setRiskPerTrade] = useState(settings.risk_per_trade);
  const [maxPositionSize, setMaxPositionSize] = useState(settings.max_position_size);
  const [maxDailyLoss, setMaxDailyLoss] = useState(settings.max_daily_loss);
  const [stopLossPct, setStopLossPct] = useState(
    fractionToDisplayPercent(settings.stop_loss_percentage),
  );
  const [takeProfitPct, setTakeProfitPct] = useState(
    fractionToDisplayPercent(settings.take_profit_percentage),
  );
  const [maxHoldMinutes, setMaxHoldMinutes] = useState(settings.max_hold_minutes ?? 0);
  const [minHoldMinutes, setMinHoldMinutes] = useState(settings.min_hold_minutes ?? 15);
  const [jevSellExitPct, setJevSellExitPct] = useState(
    fractionToDisplayPercent(settings.jev_sell_exit_threshold ?? 0.95),
  );
  const [reentryCooldownMinutes, setReentryCooldownMinutes] = useState(
    settings.reentry_cooldown_minutes ?? 45,
  );
  const [predictionHorizon, setPredictionHorizon] = useState(
    settings.prediction_horizon_minutes ?? 15,
  );
  const [lastEntryCutoff, setLastEntryCutoff] = useState(
    settings.last_entry_cutoff_minutes_before_close ?? 40,
  );
  const [eodCloseoutMinutes, setEodCloseoutMinutes] = useState(
    settings.eod_closeout_minutes_before_close ?? 10,
  );
  const [eodFlatVerifyMinutes, setEodFlatVerifyMinutes] = useState(
    settings.eod_flat_verify_minutes_before_close ?? 5,
  );
  const [accountCapital, setAccountCapital] = useState(settings.account_capital);
  const [equityDivergencePct, setEquityDivergencePct] = useState(
    Math.round((settings.equity_divergence_alert_frac ?? 0.05) * 100),
  );
  const [minVolumeRatio, setMinVolumeRatio] = useState(settings.min_volume_ratio ?? 0);
  const [minSharePrice, setMinSharePrice] = useState(settings.min_share_price ?? 20);
  const maxHoldHints = getMaxHoldHints(maxHoldMinutes);
  const [selectedProfile, setSelectedProfile] = useState<RiskProfile>(
    resolveRiskProfile(settings.risk_profile),
  );

  const stopLossFraction = stopLossPct / 100;
  const takeProfitFraction = takeProfitPct / 100;
  const stopLossHints = getStopLossHints(stopLossFraction);
  const takeProfitHints = getTakeProfitHints(takeProfitFraction, stopLossFraction);

  const sizingPreview = computePositionSizing({
    price: 50,
    riskPerTrade,
    stopLossPercentage: stopLossFraction,
    maxPositionSize,
    availableCash: paperAvailableCash(accountCapital, 0),
  });
  const riskNonBinding = isRiskPerTradeNonBinding(
    riskPerTrade,
    maxPositionSize,
    stopLossFraction,
  );
  const horizonWarnings: string[] = [];
  if (maxHoldMinutes === 0) {
    horizonWarnings.push("Max hold is off (unbounded) — positions rely on SL/TP and EOD closeout.");
  }
  if (maxHoldMinutes > 0 && maxHoldMinutes > predictionHorizon) {
    horizonWarnings.push(
      `Max hold (${maxHoldMinutes}m) is longer than prediction horizon (${predictionHorizon}m).`,
    );
  }
  if (lastEntryCutoff < eodCloseoutMinutes + minHoldMinutes) {
    horizonWarnings.push(
      `Last-entry cutoff (${lastEntryCutoff}m) is shorter than closeout + min hold (${eodCloseoutMinutes + minHoldMinutes}m).`,
    );
  }
  if (lastEntryCutoff < eodCloseoutMinutes + predictionHorizon) {
    horizonWarnings.push(
      `Last-entry cutoff (${lastEntryCutoff}m) is shorter than closeout + horizon (${eodCloseoutMinutes + predictionHorizon}m).`,
    );
  }
  const riskValues = {
    risk_per_trade: riskPerTrade,
    max_position_size: maxPositionSize,
    max_daily_loss: maxDailyLoss,
  };

  const appliedProfile = detectMatchingProfile(riskValues, baselineEquity);
  const allApplied = areAllRecommendationsApplied(riskValues, baselineEquity, selectedProfile);
  const profileSelectionError =
    baselineEquity > 0
      ? validateProfileSelection(riskValues, baselineEquity, selectedProfile)
      : null;

  const handleSelectProfile = (profile: RiskProfile) => {
    setSelectedProfile(profile);
    if (baselineEquity <= 0) return;
    const rec = getRecommendedValuesForProfile(baselineEquity, profile);
    setRiskPerTrade(rec.risk_per_trade);
    setMaxPositionSize(rec.max_position_size);
    setMaxDailyLoss(rec.max_daily_loss);
  };

  return (
    <form
      className="space-y-6 pb-24"
      action={(formData) => {
        setSaveError(null);
        const selectionError = validateProfileSelection(
          riskValues,
          baselineEquity,
          selectedProfile,
        );
        if (selectionError) {
          setSaveError(selectionError);
          return;
        }
        startTransition(async () => {
          try {
            await updateSettings(formData);
          } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Failed to save settings");
          }
        });
      }}
    >
      <input type="hidden" name="risk_profile" value={selectedProfile} />

      <SettingsSection
        title="Jev & signals"
        description="When the bot acts on AI predictions and how aggressively it filters buys."
      >
        <RiskProfilePicker
          selectedProfile={selectedProfile}
          onSelect={handleSelectProfile}
          baselineEquity={baselineEquity}
          currency={currency}
          appliedProfile={appliedProfile}
          valuesMatchSelected={allApplied}
        />

        <SettingsFieldGroup className="mt-4">
          <SettingsField
            id="minimum_jev_confidence"
            label="Min BUY probability (%)"
            description={SETTING_DESCRIPTIONS.minimum_jev_confidence}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.minimum_jev_confidence}
          >
            <Input
              id="minimum_jev_confidence"
              name="minimum_jev_confidence"
              type="number"
              step="1"
              defaultValue={Math.round(settings.minimum_jev_confidence * 100)}
              required
            />
          </SettingsField>
          <SettingsField
            id="signal_record_threshold"
            label="Signal record threshold (%)"
            description={SETTING_DESCRIPTIONS.signal_record_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.signal_record_threshold}
          >
            <Input
              id="signal_record_threshold"
              name="signal_record_threshold"
              type="number"
              step="1"
              defaultValue={Math.round(settings.signal_record_threshold * 100)}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_gate_field"
            label="Entry gate field"
            description="Which Jev metric must clear the min threshold (default: BUY probability)."
          >
            <select
              id="jev_gate_field"
              name="jev_gate_field"
              className="flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
              defaultValue={settings.jev_gate_field ?? "buy_probability"}
            >
              <option value="buy_probability">BUY probability</option>
              <option value="confidence">API confidence</option>
            </select>
          </SettingsField>
          <SettingsField
            id="jev_model_pin"
            label="Jev model pin"
            description="Optional fixed model id. Empty keeps the env/default model; mismatch alerts via Telegram."
          >
            <Input
              id="jev_model_pin"
              name="jev_model_pin"
              type="text"
              placeholder="e.g. jev-2025-01"
              defaultValue={settings.jev_model_pin ?? ""}
            />
          </SettingsField>
          <SettingsField
            id="jev_samples"
            label="Jev samples"
            description="Calls per symbol (1 = current). When >1, averages probabilities and stores stddev."
          >
            <Input
              id="jev_samples"
              name="jev_samples"
              type="number"
              min={1}
              max={5}
              step="1"
              defaultValue={settings.jev_samples ?? 1}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_spread_veto_enabled"
            label="Spread veto"
            description="When on, skip entries if multi-sample stddev exceeds the max below."
          >
            <label className="flex h-10 items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="jev_spread_veto_enabled"
                defaultChecked={settings.jev_spread_veto_enabled ?? false}
                className="h-4 w-4 rounded border-zinc-600"
              />
              Enable spread veto
            </label>
          </SettingsField>
          <SettingsField
            id="jev_spread_max_stddev"
            label="Max prob stddev"
            description="Spread veto threshold when samples > 1 (0–1)."
          >
            <Input
              id="jev_spread_max_stddev"
              name="jev_spread_max_stddev"
              type="number"
              min={0}
              max={1}
              step="0.01"
              defaultValue={settings.jev_spread_max_stddev ?? 0.05}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        title="Risk & limits"
        description="Capital at risk per trade, position caps, and daily loss guardrails."
      >
        <SettingsFieldGroup>
          <RiskField
            id="risk_per_trade"
            label="Risk per trade"
            description={SETTING_DESCRIPTIONS.risk_per_trade}
            descriptionFull={SETTING_DESCRIPTIONS_FULL.risk_per_trade}
            value={riskPerTrade}
            onChange={setRiskPerTrade}
            baselineEquity={baselineEquity}
            currency={currency}
            profile={selectedProfile}
          />
          <RiskField
            id="max_position_size"
            label="Max position size"
            description={SETTING_DESCRIPTIONS.max_position_size}
            descriptionFull={SETTING_DESCRIPTIONS_FULL.max_position_size}
            value={maxPositionSize}
            onChange={setMaxPositionSize}
            baselineEquity={baselineEquity}
            currency={currency}
            profile={selectedProfile}
          />
          <RiskField
            id="max_daily_loss"
            label="Max daily loss"
            description={SETTING_DESCRIPTIONS.max_daily_loss}
            descriptionFull={SETTING_DESCRIPTIONS_FULL.max_daily_loss}
            value={maxDailyLoss}
            onChange={setMaxDailyLoss}
            baselineEquity={baselineEquity}
            currency={currency}
            profile={selectedProfile}
          />
          <SettingsField
            id="daily_loss_action"
            label="Daily loss action"
            description="What to do when the daily loss limit is hit (US session date)."
          >
            <select
              id="daily_loss_action"
              name="daily_loss_action"
              className="flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
              defaultValue={settings.daily_loss_action ?? "block_entries"}
            >
              <option value="block_entries">Block new entries</option>
              <option value="flatten_and_block">Flatten open positions + block</option>
            </select>
          </SettingsField>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              name="daily_loss_include_unrealized"
              value="on"
              defaultChecked={settings.daily_loss_include_unrealized ?? true}
            />
            Include unrealized P&amp;L in daily loss
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              name="daily_loss_include_fees"
              value="on"
              defaultChecked={settings.daily_loss_include_fees ?? false}
            />
            Include fees (use net P&amp;L)
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              name="drawdown_breaker_enabled"
              value="on"
              defaultChecked={settings.drawdown_breaker_enabled ?? false}
            />
            Enable drawdown breaker (off until thresholds reviewed)
          </label>
          <SettingsField
            id="drawdown_max_pct"
            label="Drawdown max (%)"
            description="Peak-to-trough equity drawdown that trips the breaker when enabled."
          >
            <Input
              id="drawdown_max_pct"
              name="drawdown_max_pct"
              type="number"
              min={1}
              max={50}
              step={0.1}
              defaultValue={Math.round((settings.drawdown_max_frac ?? 0.1) * 1000) / 10}
              required
            />
          </SettingsField>
          <SettingsField
            id="max_open_positions"
            label="Max open positions"
            description={SETTING_DESCRIPTIONS.max_open_positions}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.max_open_positions}
          >
            <Input
              id="max_open_positions"
              name="max_open_positions"
              type="number"
              step="1"
              defaultValue={settings.max_open_positions}
              required
            />
          </SettingsField>
          <SettingsField
            id="account_capital"
            label="Account capital ($)"
            description={SETTING_DESCRIPTIONS.account_capital}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.account_capital}
          >
            <Input
              id="account_capital"
              name="account_capital"
              type="number"
              step="0.01"
              min={0.01}
              value={accountCapital}
              onChange={(event) => setAccountCapital(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="equity_divergence_alert_frac"
            label="Equity divergence alert (%)"
            description={SETTING_DESCRIPTIONS.equity_divergence_alert_frac}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.equity_divergence_alert_frac}
          >
            <Input
              id="equity_divergence_alert_frac"
              name="equity_divergence_alert_frac"
              type="number"
              step="1"
              min={1}
              max={50}
              value={equityDivergencePct}
              onChange={(event) => setEquityDivergencePct(Number(event.target.value))}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
        {riskNonBinding ? (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Risk per trade is non-binding at this stop — max position size caps the order.
            Requested risk ${sizingPreview.requestedRiskUsd.toFixed(2)} → planned $
            {sizingPreview.plannedRiskUsd.toFixed(2)} (binding: {sizingPreview.sizingBinding}).
          </p>
        ) : null}
        <p className="mt-2 text-xs text-zinc-500">
          Effective risk preview at $50/share: qty {sizingPreview.quantity}, notional $
          {sizingPreview.positionValue.toFixed(2)}, planned risk $
          {sizingPreview.plannedRiskUsd.toFixed(2)} ({sizingPreview.sizingBinding}).
          Profile dollars are derived from risk_sync_equity × profile fraction when you apply a
          card — the engine uses the stored dollar fields, not equity, at trade time.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Horizon & session"
        description="Prediction horizon, last-entry cutoff, and end-of-day closeout (overnight holding is not supported)."
      >
        <input type="hidden" name="eod_closeout_enabled" value="on" />
        {horizonWarnings.length > 0 ? (
          <div className="mb-3 space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {horizonWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        <SettingsFieldGroup>
          <SettingsField
            id="prediction_horizon_minutes"
            label="Prediction horizon (minutes)"
            description={SETTING_DESCRIPTIONS.prediction_horizon_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.prediction_horizon_minutes}
          >
            <Input
              id="prediction_horizon_minutes"
              name="prediction_horizon_minutes"
              type="number"
              step="1"
              min={1}
              max={480}
              value={predictionHorizon}
              onChange={(event) => setPredictionHorizon(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="last_entry_cutoff_minutes_before_close"
            label="Last-entry cutoff (min before close)"
            description={SETTING_DESCRIPTIONS.last_entry_cutoff_minutes_before_close}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.last_entry_cutoff_minutes_before_close}
          >
            <Input
              id="last_entry_cutoff_minutes_before_close"
              name="last_entry_cutoff_minutes_before_close"
              type="number"
              step="1"
              min={1}
              max={120}
              value={lastEntryCutoff}
              onChange={(event) => setLastEntryCutoff(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="eod_closeout_minutes_before_close"
            label="EOD closeout (min before close)"
            description={SETTING_DESCRIPTIONS.eod_closeout_minutes_before_close}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.eod_closeout_minutes_before_close}
          >
            <Input
              id="eod_closeout_minutes_before_close"
              name="eod_closeout_minutes_before_close"
              type="number"
              step="1"
              min={5}
              max={15}
              value={eodCloseoutMinutes}
              onChange={(event) => setEodCloseoutMinutes(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="eod_flat_verify_minutes_before_close"
            label="EOD flat-verify (min before close)"
            description={SETTING_DESCRIPTIONS.eod_flat_verify_minutes_before_close}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.eod_flat_verify_minutes_before_close}
          >
            <Input
              id="eod_flat_verify_minutes_before_close"
              name="eod_flat_verify_minutes_before_close"
              type="number"
              step="1"
              min={1}
              max={10}
              value={eodFlatVerifyMinutes}
              onChange={(event) => setEodFlatVerifyMinutes(Number(event.target.value))}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        title="Fresh inputs & confirmation"
        description="Quote/signal age gates, distinct-bar confirmation, and entry kill recovery. Universe scan still uses tick-built bars; newly ranked names are seeded before entry-eligible."
      >
        <input type="hidden" name="stale_input_gates_enabled" value="on" />
        <input type="hidden" name="pre_submit_recheck_enabled" value="on" />
        <SettingsFieldGroup>
          <SettingsField
            id="confirmation_enabled"
            label="Confirmation"
            description="Require consecutive eligible bars before entry. Off = enter on first eligible eval."
          >
            <label className="flex h-10 items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="confirmation_enabled"
                defaultChecked={settings.confirmation_enabled ?? true}
                className="h-4 w-4 rounded border-zinc-600"
              />
              Enable confirmation
            </label>
          </SettingsField>
          <SettingsField
            id="confirmation_count"
            label="Confirmation count (bars)"
            description="Consecutive eligible completed bars required before entry."
          >
            <Input
              id="confirmation_count"
              name="confirmation_count"
              type="number"
              step="1"
              min={1}
              max={5}
              defaultValue={settings.confirmation_count ?? 2}
              required
            />
          </SettingsField>
          <SettingsField id="confirmation_mode" label="Confirmation mode" description="">
            <select
              id="confirmation_mode"
              name="confirmation_mode"
              className="flex h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
              defaultValue={settings.confirmation_mode ?? "distinct_bars"}
            >
              <option value="distinct_bars">Distinct bars</option>
              <option value="legacy">Legacy (eval loops)</option>
            </select>
          </SettingsField>
          <SettingsField id="max_quote_age_sec" label="Max quote age (sec)" description="">
            <Input
              id="max_quote_age_sec"
              name="max_quote_age_sec"
              type="number"
              min={2}
              max={30}
              defaultValue={settings.max_quote_age_sec ?? 5}
              required
            />
          </SettingsField>
          <SettingsField id="kill_stale_quote_sec" label="Kill stale quote (sec)" description="">
            <Input
              id="kill_stale_quote_sec"
              name="kill_stale_quote_sec"
              type="number"
              min={5}
              max={60}
              defaultValue={settings.kill_stale_quote_sec ?? 15}
              required
            />
          </SettingsField>
          <SettingsField
            id="kill_stale_quote_share_pct"
            label="Kill stale share (%)"
            description=""
          >
            <Input
              id="kill_stale_quote_share_pct"
              name="kill_stale_quote_share_pct"
              type="number"
              min={10}
              max={100}
              defaultValue={Math.round(
                (settings.kill_stale_quote_share_frac ?? 0.5) * 100,
              )}
              required
            />
          </SettingsField>
          <SettingsField id="quote_age_log_only_sec" label="Quote-age log-only (sec)" description="">
            <Input
              id="quote_age_log_only_sec"
              name="quote_age_log_only_sec"
              type="number"
              min={0}
              max={3600}
              defaultValue={settings.quote_age_log_only_sec ?? 300}
              required
            />
          </SettingsField>
          <SettingsField id="max_signal_age_sec" label="Max signal age (sec)" description="">
            <Input
              id="max_signal_age_sec"
              name="max_signal_age_sec"
              type="number"
              min={5}
              max={120}
              defaultValue={settings.max_signal_age_sec ?? 30}
              required
            />
          </SettingsField>
          <SettingsField id="max_bar_gap_sec" label="Max bar gap (sec)" description="">
            <Input
              id="max_bar_gap_sec"
              name="max_bar_gap_sec"
              type="number"
              min={60}
              max={300}
              defaultValue={settings.max_bar_gap_sec ?? 90}
              required
            />
          </SettingsField>
          <SettingsField id="max_news_pub_age_sec" label="Max news pub age (sec)" description="">
            <Input
              id="max_news_pub_age_sec"
              name="max_news_pub_age_sec"
              type="number"
              min={300}
              max={86400}
              defaultValue={settings.max_news_pub_age_sec ?? 3600}
              required
            />
          </SettingsField>
          <SettingsField
            id="max_news_receipt_lag_sec"
            label="Max news receipt lag (sec)"
            description=""
          >
            <Input
              id="max_news_receipt_lag_sec"
              name="max_news_receipt_lag_sec"
              type="number"
              min={60}
              max={3600}
              defaultValue={settings.max_news_receipt_lag_sec ?? 600}
              required
            />
          </SettingsField>
          <SettingsField
            id="max_entry_price_drift_bps"
            label="Max entry price drift (bps)"
            description=""
          >
            <Input
              id="max_entry_price_drift_bps"
              name="max_entry_price_drift_bps"
              type="number"
              min={5}
              max={200}
              defaultValue={Math.round(
                (settings.max_entry_price_drift_frac ?? 0.002) * 10_000,
              )}
              required
            />
          </SettingsField>
          <SettingsField
            id="kill_recover_healthy_sec"
            label="Kill recover healthy (sec)"
            description=""
          >
            <Input
              id="kill_recover_healthy_sec"
              name="kill_recover_healthy_sec"
              type="number"
              min={30}
              max={600}
              defaultValue={settings.kill_recover_healthy_sec ?? 120}
              required
            />
          </SettingsField>
          <SettingsField
            id="reconcile_interval_sec"
            label="Reconcile interval (sec)"
            description="How often the engine reconciles IBKR positions vs open trades (15–600)."
          >
            <Input
              id="reconcile_interval_sec"
              name="reconcile_interval_sec"
              type="number"
              min={15}
              max={600}
              defaultValue={settings.reconcile_interval_sec ?? 60}
              required
            />
          </SettingsField>
          <input type="hidden" name="reconcile_protect_orphans" value="on" />
          <SettingsField id="kill_alert_min_gap_sec" label="Kill alert min gap (sec)" description="">
            <Input
              id="kill_alert_min_gap_sec"
              name="kill_alert_min_gap_sec"
              type="number"
              min={0}
              max={600}
              defaultValue={settings.kill_alert_min_gap_sec ?? 60}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_transport_fail_rate_kill_pct"
            label="Jev transport fail kill (%)"
            description=""
          >
            <Input
              id="jev_transport_fail_rate_kill_pct"
              name="jev_transport_fail_rate_kill_pct"
              type="number"
              min={10}
              max={100}
              defaultValue={Math.round(
                (settings.jev_transport_fail_rate_kill_frac ?? 0.5) * 100,
              )}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_transport_fail_window_sec"
            label="Jev transport window (sec)"
            description=""
          >
            <Input
              id="jev_transport_fail_window_sec"
              name="jev_transport_fail_window_sec"
              type="number"
              min={30}
              max={600}
              defaultValue={settings.jev_transport_fail_window_sec ?? 60}
              required
            />
          </SettingsField>
          <SettingsField id="jev_timeout_sec" label="Jev timeout (sec)" description="">
            <Input
              id="jev_timeout_sec"
              name="jev_timeout_sec"
              type="number"
              step="0.5"
              min={0.5}
              max={5}
              defaultValue={settings.jev_timeout_sec ?? 2}
              required
            />
          </SettingsField>
          <SettingsField id="jev_max_retries" label="Jev max retries" description="">
            <Input
              id="jev_max_retries"
              name="jev_max_retries"
              type="number"
              min={0}
              max={2}
              defaultValue={settings.jev_max_retries ?? 1}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        title="Exits & entry filters"
        description="Stop/take-profit exits, time-based closes, and hard volume gate after Jev BUY."
      >
        <SettingsFieldGroup>
          <StrategyPercentField
            id="stop_loss_percentage"
            label="Stop loss (%)"
            description={SETTING_DESCRIPTIONS.stop_loss_percentage}
            descriptionFull={SETTING_DESCRIPTIONS_FULL.stop_loss_percentage}
            value={stopLossPct}
            onChange={setStopLossPct}
            hints={stopLossHints}
            matchesRecommended={isNearStrategyPercent(
              stopLossFraction,
              STRATEGY_RECOMMENDATIONS.stop_loss_percentage,
            )}
          />
          <StrategyPercentField
            id="take_profit_percentage"
            label="Take profit (%)"
            description={SETTING_DESCRIPTIONS.take_profit_percentage}
            descriptionFull={SETTING_DESCRIPTIONS_FULL.take_profit_percentage}
            value={takeProfitPct}
            onChange={setTakeProfitPct}
            hints={takeProfitHints}
            matchesRecommended={isNearStrategyPercent(
              takeProfitFraction,
              STRATEGY_RECOMMENDATIONS.take_profit_percentage,
            )}
          />
          <SettingsField
            id="max_hold_minutes"
            label="Max hold (minutes)"
            description={SETTING_DESCRIPTIONS.max_hold_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.max_hold_minutes}
          >
            <Input
              id="max_hold_minutes"
              name="max_hold_minutes"
              type="number"
              step="1"
              min={0}
              max={480}
              value={maxHoldMinutes}
              onChange={(event) => setMaxHoldMinutes(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="min_hold_minutes"
            label="Min hold (minutes)"
            description={SETTING_DESCRIPTIONS.min_hold_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_hold_minutes}
          >
            <Input
              id="min_hold_minutes"
              name="min_hold_minutes"
              type="number"
              step="1"
              min={0}
              max={480}
              value={minHoldMinutes}
              onChange={(event) => setMinHoldMinutes(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_sell_exit_threshold"
            label="Jev SELL exit (%)"
            description={SETTING_DESCRIPTIONS.jev_sell_exit_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.jev_sell_exit_threshold}
          >
            <Input
              id="jev_sell_exit_threshold"
              name="jev_sell_exit_threshold"
              type="number"
              step="1"
              min={50}
              max={100}
              value={jevSellExitPct}
              onChange={(event) => setJevSellExitPct(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="reentry_cooldown_minutes"
            label="Re-entry cooldown (minutes)"
            description={SETTING_DESCRIPTIONS.reentry_cooldown_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.reentry_cooldown_minutes}
          >
            <Input
              id="reentry_cooldown_minutes"
              name="reentry_cooldown_minutes"
              type="number"
              step="1"
              min={0}
              max={480}
              value={reentryCooldownMinutes}
              onChange={(event) => setReentryCooldownMinutes(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="min_volume_ratio"
            label="Min volume ratio"
            description={SETTING_DESCRIPTIONS.min_volume_ratio}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_volume_ratio}
          >
            <Input
              id="min_volume_ratio"
              name="min_volume_ratio"
              type="number"
              step="0.05"
              min={0}
              max={5}
              value={minVolumeRatio}
              onChange={(event) => setMinVolumeRatio(Number(event.target.value))}
              required
            />
          </SettingsField>
          <SettingsField
            id="min_share_price"
            label="Min share price ($)"
            description={SETTING_DESCRIPTIONS.min_share_price}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_share_price}
          >
            <Input
              id="min_share_price"
              name="min_share_price"
              type="number"
              step="1"
              min={0}
              max={10000}
              value={minSharePrice}
              onChange={(event) => setMinSharePrice(Number(event.target.value))}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
        {maxHoldHints.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-zinc-800/60 pt-3">
            {maxHoldHints.map((hint) => (
              <StrategyHintLine key={hint.message} hint={hint} />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Entry filters"
        description="Individually switchable vetoes. Defaults match historical behaviour (all on). Offline audit/replay: trader/analysis/."
      >
        <SettingsFieldGroup>
          {(
            [
              ["buy_hold_margin_enabled", "BUY−HOLD margin", settings.buy_hold_margin_enabled],
              ["rsi_veto_enabled", "RSI overbought veto", settings.rsi_veto_enabled],
              ["price_floor_enabled", "Min share price floor", settings.price_floor_enabled],
              ["spread_filter_enabled", "Spread % filter", settings.spread_filter_enabled],
              ["volume_filter_enabled", "Volume ratio filter", settings.volume_filter_enabled],
              ["ema20_filter_enabled", "Price above EMA20", settings.ema20_filter_enabled],
              [
                "benchmark_headwind_enabled",
                "Benchmark headwind",
                settings.benchmark_headwind_enabled,
              ],
              ["news_filters_enabled", "News filters", settings.news_filters_enabled],
              [
                "correlation_cap_enabled",
                "Correlation cap",
                settings.correlation_cap_enabled,
              ],
              [
                "soft_exit_block_winners_enabled",
                "Block soft-exit of winners below TP",
                settings.soft_exit_block_winners_enabled,
              ],
            ] as const
          ).map(([name, label, checked]) => (
            <SettingsField
              key={name}
              id={name}
              label={label}
              description="Default on — preserves historical filter behaviour when enabled."
            >
              <label className="flex h-10 items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked ?? true}
                  className="h-4 w-4 rounded border-zinc-600"
                />
                Enabled
              </label>
            </SettingsField>
          ))}
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        title="Watchlist"
        description="Fallback symbols or dynamic EM top-N after each successful Jev scan, plus intraday charts."
      >
        <WatchlistSettingsSection settings={settings} emUniverse={emUniverse} />
      </SettingsSection>

      <div className="sticky bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 py-3 backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-[1.25rem] space-y-1">
            {profileSelectionError && !saveError && (
              <p className="text-sm text-amber-400">{profileSelectionError}</p>
            )}
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          </div>
          <Button type="submit" disabled={pending} className="sm:shrink-0">
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>
    </form>
  );
}
