"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskProfilePicker } from "@/components/risk-profile-picker";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { RiskRecommendationStatus } from "@/components/risk-recommendation-status";
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

const SETTING_DESCRIPTIONS = {
  minimum_jev_confidence:
    "The AI must be at least this confident before the bot will actually buy — higher means fewer, pickier trades.",
  signal_record_threshold:
    "Buy signals above this level are marked as worth watching, so you can spot near-misses below your trade threshold.",
  risk_per_trade:
    "Most you are willing to lose on one trade if the stop loss is hit.",
  max_position_size: "Largest amount the bot will put into a single trade.",
  max_daily_loss:
    "If today's losses reach this amount, the bot stops opening new trades until tomorrow.",
  max_open_positions: "How many trades the bot can hold at the same time.",
  stop_loss_percentage:
    "Auto-sell if the price drops this % below your entry — also controls how large each trade is for a given risk budget.",
  take_profit_percentage:
    "Auto-sell when the price rises this % above your entry to lock in gains.",
  max_hold_minutes:
    "Force-close open trades after this many minutes (0 = off). When off, exits use stop loss, take profit, and Jev SELL only.",
  watchlist: "Effective symbols the bot watches right now (updated by Jev when dynamic mode is on).",
  watchlist_core:
    "Always-on EM symbols. Jev merges these with its top dynamic picks when dynamic mode is enabled.",
  watchlist_dynamic_enabled:
    "Let Jev scan the EM universe and add the highest BUY% symbols to the watchlist.",
  watchlist_dynamic_size: "How many extra symbols Jev adds from each universe scan.",
  watchlist_refresh_minutes: "How often Jev re-scores the full EM universe.",
  benchmark_symbol: "EM benchmark used for headwind checks and Jev context (default EEM).",
} as const;

function FieldDescription({ children }: { children: string }) {
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{children}</p>
  );
}

type SettingFieldProps = {
  id: string;
  label: string;
  description: string;
  defaultValue: string | number;
  step: string;
};

function SettingField({ id, label, description, defaultValue, step }: SettingFieldProps) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 p-3">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        step={step}
        defaultValue={defaultValue}
        required
        className="mt-2"
      />
      <FieldDescription>{description}</FieldDescription>
    </div>
  );
}

type RiskFieldProps = {
  id: RiskRecommendationKey;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  baselineEquity: number;
  currency: string;
  profile: RiskProfile;
};

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

type StrategyPercentFieldProps = {
  id: "stop_loss_percentage" | "take_profit_percentage";
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  hints: StrategyHint[];
  matchesRecommended: boolean;
};

function StrategyPercentField({
  id,
  label,
  description,
  value,
  onChange,
  hints,
  matchesRecommended,
}: StrategyPercentFieldProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        matchesRecommended
          ? "border-emerald-800/60 bg-emerald-950/20"
          : "border-zinc-800/80 bg-zinc-950/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {matchesRecommended && (
          <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
      </div>
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
          "mt-2",
          matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
        )}
      />
      <div className="mt-1.5 space-y-1">
        {hints.map((hint) => (
          <StrategyHintLine key={hint.message} hint={hint} />
        ))}
      </div>
      <FieldDescription>{description}</FieldDescription>
    </div>
  );
}

function RiskField({
  id,
  label,
  description,
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
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        matchesRecommended
          ? "border-emerald-800/60 bg-emerald-950/20"
          : "border-zinc-800/80 bg-zinc-950/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {matchesRecommended && baselineEquity > 0 && (
          <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
      </div>
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
          "mt-2",
          matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
        )}
      />
      {baselineEquity > 0 && pct != null && (
        <p
          className={cn(
            "mt-1.5 text-xs",
            matchesRecommended ? "text-emerald-400/90" : "text-amber-400/90",
          )}
        >
          {formatRiskPct(pct)} of {formatCurrency(baselineEquity, currency)} equity tier
          {!matchesRecommended &&
            ` · Suggested: ${formatCurrency(recommended, currency)} (${formatRiskPct(targetPct)})`}
        </p>
      )}
      {baselineEquity <= 0 && (
        <p className="mt-1.5 text-xs text-zinc-600">Equity unavailable — percentage cannot be calculated</p>
      )}
      <FieldDescription>{description}</FieldDescription>
    </div>
  );
}

type EmUniverseStats = {
  count: number;
  tradableCount: number;
  topHoldings: EmUniverseRow[];
};

export function SettingsForm({
  settings,
  currentEquity,
  baselineEquity,
  currency,
  emUniverse,
}: {
  settings: Settings;
  currentEquity: number;
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

  const recommended = getRecommendedValuesForProfile(baselineEquity, selectedProfile);
  const appliedProfile = detectMatchingProfile(riskValues, baselineEquity);
  const allApplied = areAllRecommendationsApplied(riskValues, baselineEquity, selectedProfile);
  const savedValues = {
    risk_per_trade: settings.risk_per_trade,
    max_position_size: settings.max_position_size,
    max_daily_loss: settings.max_daily_loss,
  };
  const profileSelectionError =
    baselineEquity > 0
      ? validateProfileSelection(riskValues, baselineEquity, selectedProfile)
      : null;

  const applyRecommended = () => {
    setRiskPerTrade(recommended.risk_per_trade);
    setMaxPositionSize(recommended.max_position_size);
    setMaxDailyLoss(recommended.max_daily_loss);
  };

  return (
    <Card>
      <CardTitle>Risk & Strategy Settings</CardTitle>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Bot ON/OFF and simulated vs IBKR orders are on the{" "}
        <span className="text-zinc-400">Overview</span> page. Trading mode:{" "}
        <span className="text-zinc-400">{settings.trading_mode}</span> (live requires server{" "}
        <code className="text-zinc-500">.env</code> change).
      </p>

      <RiskProfilePicker
        selectedProfile={selectedProfile}
        onSelect={setSelectedProfile}
        baselineEquity={baselineEquity}
        currency={currency}
        appliedProfile={appliedProfile}
        valuesMatchSelected={allApplied}
      />

      <RiskRecommendationStatus
        className="mt-4"
        baselineEquity={baselineEquity}
        currentEquity={currentEquity}
        currency={currency}
        profile={selectedProfile}
        allApplied={allApplied}
        savedValues={savedValues}
        onApply={applyRecommended}
      />

      <form
        className="mt-6 grid gap-4 sm:grid-cols-2"
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
        <SettingField
          id="minimum_jev_confidence"
          label="Min Jev confidence (%)"
          description={SETTING_DESCRIPTIONS.minimum_jev_confidence}
          defaultValue={Math.round(settings.minimum_jev_confidence * 100)}
          step="1"
        />
        <SettingField
          id="signal_record_threshold"
          label="Signal record threshold (%)"
          description={SETTING_DESCRIPTIONS.signal_record_threshold}
          defaultValue={Math.round(settings.signal_record_threshold * 100)}
          step="1"
        />
        <RiskField
          id="risk_per_trade"
          label="Risk per trade"
          description={SETTING_DESCRIPTIONS.risk_per_trade}
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
          value={maxDailyLoss}
          onChange={setMaxDailyLoss}
          baselineEquity={baselineEquity}
          currency={currency}
          profile={selectedProfile}
        />
        <SettingField
          id="max_open_positions"
          label="Max open positions"
          description={SETTING_DESCRIPTIONS.max_open_positions}
          defaultValue={settings.max_open_positions}
          step="1"
        />
        <StrategyPercentField
          id="stop_loss_percentage"
          label="Stop loss (%)"
          description={SETTING_DESCRIPTIONS.stop_loss_percentage}
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
          value={takeProfitPct}
          onChange={setTakeProfitPct}
          hints={takeProfitHints}
          matchesRecommended={isNearStrategyPercent(
            takeProfitFraction,
            STRATEGY_RECOMMENDATIONS.take_profit_percentage,
          )}
        />
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 p-3">
          <Label htmlFor="max_hold_minutes">Max hold (minutes)</Label>
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
            className="mt-2"
          />
          <div className="mt-2 space-y-1">
            {maxHoldHints.map((hint) => (
              <StrategyHintLine key={hint.message} hint={hint} />
            ))}
          </div>
          <FieldDescription>{SETTING_DESCRIPTIONS.max_hold_minutes}</FieldDescription>
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 p-3 sm:col-span-2 space-y-4">
          <div className="rounded-md border border-zinc-800/60 bg-zinc-950/40 p-3">
            <p className="text-sm font-medium text-zinc-200">EM universe (EEM + IEMG)</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {emUniverse.tradableCount > 0 ? (
                <>
                  {emUniverse.tradableCount} tradable US-listed symbol
                  {emUniverse.tradableCount === 1 ? "" : "s"}
                  {settings.em_universe_synced_at
                    ? ` · last sync ${new Date(settings.em_universe_synced_at).toLocaleString()}`
                    : ""}
                  {settings.em_universe_source ? ` · source ${settings.em_universe_source}` : ""}
                </>
              ) : (
                <>
                  No synced universe in Supabase yet — trader falls back to{" "}
                  <code className="text-zinc-300">dashboard/data/em-us-listed.json</code>.
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Refresh weekly from the repo root:{" "}
              <code className="text-zinc-400">node scripts/update-em-universe.mjs</code>
            </p>
            {emUniverse.topHoldings.length > 0 && (
              <div className="mt-3 max-h-40 overflow-y-auto rounded border border-zinc-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Symbol</th>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emUniverse.topHoldings.slice(0, 10).map((row) => (
                      <tr key={row.symbol} className="border-t border-zinc-900">
                        <td className="px-2 py-1">{row.symbol}</td>
                        <td className="px-2 py-1 truncate max-w-[12rem] text-zinc-400">
                          {row.name}
                        </td>
                        <td className="px-2 py-1 text-right text-zinc-400">
                          {(row.weight_bps / 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Core watchlist</p>
            <WatchlistPicker
              inputName="watchlist_core"
              defaultValue={
                settings.watchlist_core?.length ? settings.watchlist_core : settings.watchlist
              }
            />
            <FieldDescription>{SETTING_DESCRIPTIONS.watchlist_core}</FieldDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="watchlist_dynamic_enabled"
                defaultChecked={settings.watchlist_dynamic_enabled ?? false}
                className="rounded border-zinc-700"
              />
              Enable Jev dynamic EM watchlist
            </label>
            <div>
              <Label htmlFor="watchlist_dynamic_size">Dynamic top-N</Label>
              <Input
                id="watchlist_dynamic_size"
                name="watchlist_dynamic_size"
                type="number"
                min={0}
                max={20}
                defaultValue={settings.watchlist_dynamic_size ?? 5}
                className="mt-2"
              />
              <FieldDescription>{SETTING_DESCRIPTIONS.watchlist_dynamic_size}</FieldDescription>
            </div>
            <div>
              <Label htmlFor="watchlist_refresh_minutes">Jev scan interval (minutes)</Label>
              <Input
                id="watchlist_refresh_minutes"
                name="watchlist_refresh_minutes"
                type="number"
                min={5}
                max={240}
                defaultValue={settings.watchlist_refresh_minutes ?? 30}
                className="mt-2"
              />
              <FieldDescription>{SETTING_DESCRIPTIONS.watchlist_refresh_minutes}</FieldDescription>
            </div>
            <div>
              <Label htmlFor="benchmark_symbol">Benchmark symbol</Label>
              <Input
                id="benchmark_symbol"
                name="benchmark_symbol"
                defaultValue={settings.benchmark_symbol ?? "EEM"}
                className="mt-2 uppercase"
              />
              <FieldDescription>{SETTING_DESCRIPTIONS.benchmark_symbol}</FieldDescription>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Effective watchlist</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {settings.watchlist.join(", ") || "—"}
            </p>
            <FieldDescription>{SETTING_DESCRIPTIONS.watchlist}</FieldDescription>
          </div>
          {(settings.watchlist_jev_rankings?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-medium text-zinc-200">Last Jev universe scan</p>
              <p className="mt-1 text-xs text-zinc-500">
                {settings.watchlist_screener_ran_at
                  ? new Date(settings.watchlist_screener_ran_at).toLocaleString()
                  : "Unknown time"}
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-zinc-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Symbol</th>
                      <th className="px-2 py-1 text-right">BUY</th>
                      <th className="px-2 py-1 text-right">HOLD</th>
                      <th className="px-2 py-1 text-right">SELL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.watchlist_jev_rankings.slice(0, 15).map((row) => (
                      <tr key={row.symbol} className="border-t border-zinc-900">
                        <td className="px-2 py-1 text-zinc-500">{row.rank}</td>
                        <td className="px-2 py-1">{row.symbol}</td>
                        <td className="px-2 py-1 text-right text-emerald-400">
                          {Math.round(row.buy * 100)}%
                        </td>
                        <td className="px-2 py-1 text-right text-zinc-400">
                          {Math.round(row.hold * 100)}%
                        </td>
                        <td className="px-2 py-1 text-right text-red-400">
                          {Math.round(row.sell * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="sm:col-span-2 space-y-2">
          {profileSelectionError && !saveError && (
            <p className="text-sm text-amber-400">{profileSelectionError}</p>
          )}
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
