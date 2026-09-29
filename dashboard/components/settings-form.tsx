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
import { cn, formatCurrency } from "@/lib/utils";

const SETTING_DESCRIPTIONS_FULL = {
  minimum_jev_confidence:
    "The AI must be at least this confident before the bot will actually buy — higher means fewer, pickier trades.",
  signal_record_threshold:
    "Buy signals above this level are marked as worth watching, so you can spot near-misses below your trade threshold.",
  risk_per_trade:
    "Most you are willing to lose on one trade if the stop loss is hit.",
  max_position_size: "Largest amount the bot will put into a single trade.",
  max_daily_loss:
    "If today's losses reach this amount, the bot stops opening new trades until tomorrow.",
  max_open_positions:
    "How many trades the bot can hold at the same time. Set at or above dynamic top-N to avoid slot blocking when names rotate off.",
  stop_loss_percentage:
    "Auto-sell if the price drops this % below your entry — also controls how large each trade is for a given risk budget.",
  take_profit_percentage:
    "Auto-sell when the price rises this % above your entry to lock in gains.",
  max_hold_minutes:
    "Force-close open trades after this many minutes (0 = off). When off, exits use stop loss, take profit, and Jev SELL only.",
  min_hold_minutes:
    "Block Jev SELL soft-exits until a trade has been open this many minutes (0 = off). Stop loss and take profit still work immediately.",
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
    "Always-on EM symbols. Jev merges these with its top dynamic picks when dynamic mode is enabled.",
  watchlist_dynamic_size: "How many extra symbols Jev adds from each universe scan.",
  watchlist_refresh_minutes: "How often Jev re-scores the full EM universe.",
} as const;

const SETTING_DESCRIPTIONS = {
  minimum_jev_confidence: "Minimum AI confidence before the bot opens a trade.",
  signal_record_threshold: "Log buy signals above this % as watchlist-worthy near-misses.",
  risk_per_trade: "Max loss per trade if stop loss hits.",
  max_position_size: "Cap on capital deployed in one position.",
  max_daily_loss: "Stop new trades after today's losses reach this amount.",
  max_open_positions: "Concurrent open trades allowed (recommend ≥ dynamic top-N).",
  stop_loss_percentage: "Exit when price falls this % below entry.",
  take_profit_percentage: "Exit when price rises this % above entry.",
  max_hold_minutes: "Force-close after N minutes (0 = off).",
  min_hold_minutes: "No Jev SELL exit until N minutes (0 = off).",
  jev_sell_exit_threshold: "Min Jev SELL % required to soft-exit.",
  reentry_cooldown_minutes: "No re-entry in same symbol for N minutes (0 = off).",
  min_volume_ratio: "Block entries when volume is below this fraction of average (0 = off).",
  min_share_price: "Block entries / EM picks below this USD price (0 = off).",
  watchlist: "Live symbols the trader evaluates each cycle.",
  watchlist_core: "Always monitored; merged with dynamic picks when enabled.",
  watchlist_dynamic_size: "Extra symbols added per Jev universe scan.",
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
            label="Min Jev confidence (%)"
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
