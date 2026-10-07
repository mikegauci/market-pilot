"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { BriefSettingDiff } from "@/components/brief-setting-diff";
import {
  RiskField,
  StrategyHintLine,
  StrategyPercentField,
} from "@/components/settings-form-fields";
import { Button } from "@/components/ui/button";
import { SettingsNumberInput } from "@/components/settings-number-input";
import { RiskProfilePicker } from "@/components/risk-profile-picker";
import { WatchlistSettingsSection } from "@/components/watchlist-settings-section";
import {
  SettingsCollapsible,
  SettingsField,
  SettingsFieldGroup,
  SettingsSection,
  SettingsSubsection,
} from "@/components/settings-section";
import { useReadOnly } from "@/components/read-only-provider";
import { updateSettings } from "@/lib/actions";
import {
  buildMainSettingsFormDraft,
  diffSettingsFormDraft,
  settingsToFormDraft,
  watchlistDraftFromSettings,
  type WatchlistFormDraftSlice,
} from "@/lib/settings-form-changes";
import {
  areAllRecommendationsApplied,
  detectMatchingProfile,
  getRecommendedValuesForProfile,
  resolveRiskProfile,
  validateProfileSelection,
  type RiskProfile,
} from "@/lib/risk-recommendations";
import {
  DEFAULT_ENTRY_EMA_GATE,
  normalizeEntryEmaGate,
  type EntryEmaGate,
} from "@/lib/entry-ema-gate";
import {
  SETTING_DESCRIPTIONS,
  SETTING_DESCRIPTIONS_FULL,
} from "@/lib/settings-form-descriptions";
import {
  fractionToDisplayPercent,
  getMaxHoldHints,
  getStopLossHints,
  getTakeProfitHints,
  isNearStrategyPercent,
  STRATEGY_RECOMMENDATIONS,
} from "@/lib/strategy-recommendations";
import { confidencePercentFromDecimal } from "@/lib/settings-display";
import {
  dismissBriefSettings,
  isBriefSettingsDismissed,
} from "@/lib/session-brief/brief-dismiss";
import { buildSettingDiffs } from "@/lib/session-brief/setting-diff";
import type { SessionBriefSuggestion } from "@/lib/session-brief/schema";
import type { Settings } from "@/lib/types/database";
export function SettingsForm({
  settings,
  baselineEquity,
  currency,
  briefSessionDate = null,
  briefSuggestions = [],
}: {
  settings: Settings;
  baselineEquity: number;
  currency: string;
  briefSessionDate?: string | null;
  briefSuggestions?: SessionBriefSuggestion[];
}) {
  const readOnly = useReadOnly();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedBaseline, setSavedBaseline] = useState(() => settingsToFormDraft(settings));
  const [watchlistDraft, setWatchlistDraft] = useState<WatchlistFormDraftSlice>(() =>
    watchlistDraftFromSettings(settings),
  );
  const handleWatchlistDraftChange = useCallback((slice: WatchlistFormDraftSlice) => {
    setWatchlistDraft(slice);
  }, []);

  useEffect(() => {
    setSavedBaseline(settingsToFormDraft(settings));
  }, [settings.updated_at]);
  const [riskPerTrade, setRiskPerTrade] = useState(settings.risk_per_trade);
  const [maxPositionSize, setMaxPositionSize] = useState(settings.max_position_size);
  const [maxDailyLoss, setMaxDailyLoss] = useState(settings.max_daily_loss);
  const [stopLossPct, setStopLossPct] = useState(
    fractionToDisplayPercent(settings.stop_loss_percentage),
  );
  const [takeProfitPct, setTakeProfitPct] = useState(
    fractionToDisplayPercent(settings.take_profit_percentage),
  );
  const [profitTakeEnabled, setProfitTakeEnabled] = useState(
    settings.profit_take_enabled ?? false,
  );
  const [profitTakeMinPct, setProfitTakeMinPct] = useState(
    fractionToDisplayPercent(settings.profit_take_min_fraction ?? 0.7),
  );
  const [profitTakeMaxPct, setProfitTakeMaxPct] = useState(
    fractionToDisplayPercent(settings.profit_take_max_fraction ?? 0.8),
  );
  const [profitTakeMinBandHits, setProfitTakeMinBandHits] = useState(
    settings.profit_take_min_band_hits ?? 3,
  );
  const [profitTakeBandWindow, setProfitTakeBandWindow] = useState(
    settings.profit_take_band_window_cycles ?? 10,
  );
  const [profitTakeJevSellPct, setProfitTakeJevSellPct] = useState(
    fractionToDisplayPercent(settings.profit_take_jev_sell_threshold ?? 0.7),
  );
  const [lossCutEnabled, setLossCutEnabled] = useState(settings.loss_cut_enabled ?? false);
  const [lossCutMinPct, setLossCutMinPct] = useState(
    fractionToDisplayPercent(settings.loss_cut_min_fraction ?? 0.7),
  );
  const [lossCutMaxPct, setLossCutMaxPct] = useState(
    fractionToDisplayPercent(settings.loss_cut_max_fraction ?? 0.9),
  );
  const [lossCutMinBandHits, setLossCutMinBandHits] = useState(
    settings.loss_cut_min_band_hits ?? 3,
  );
  const [lossCutBandWindow, setLossCutBandWindow] = useState(
    settings.loss_cut_band_window_cycles ?? 10,
  );
  const [lossCutJevSellPct, setLossCutJevSellPct] = useState(
    fractionToDisplayPercent(settings.loss_cut_jev_sell_threshold ?? 0),
  );
  const [maxHoldMinutes, setMaxHoldMinutes] = useState(settings.max_hold_minutes ?? 0);
  const [minHoldMinutes, setMinHoldMinutes] = useState(settings.min_hold_minutes ?? 15);
  const [jevSellExitPct, setJevSellExitPct] = useState(
    fractionToDisplayPercent(settings.jev_sell_exit_threshold ?? 0.95),
  );
  const [reentryCooldownMinutes, setReentryCooldownMinutes] = useState(
    settings.reentry_cooldown_minutes ?? 45,
  );
  const [maxEntriesPerSymbol, setMaxEntriesPerSymbol] = useState(
    settings.max_entries_per_symbol_per_day ?? 3,
  );
  const [entryEmaGate, setEntryEmaGate] = useState<EntryEmaGate>(
    normalizeEntryEmaGate(settings.entry_ema_gate ?? DEFAULT_ENTRY_EMA_GATE),
  );
  const [minVolumeRatio, setMinVolumeRatio] = useState(settings.min_volume_ratio ?? 0);
  const [minSharePrice, setMinSharePrice] = useState(settings.min_share_price ?? 20);
  const [minDollarVolume, setMinDollarVolume] = useState(
    settings.min_dollar_volume ?? 250_000,
  );
  const [minJevPct, setMinJevPct] = useState(
    confidencePercentFromDecimal(settings.minimum_jev_confidence),
  );
  const [signalRecordPct, setSignalRecordPct] = useState(
    confidencePercentFromDecimal(settings.signal_record_threshold),
  );
  const [maxOpenPositions, setMaxOpenPositions] = useState(settings.max_open_positions);
  const [confirmationCycles, setConfirmationCycles] = useState(
    settings.confirmation_cycles ?? 2,
  );
  const [confirmationSeconds, setConfirmationSeconds] = useState(
    settings.confirmation_seconds ?? 30,
  );
  const [dismissedBriefSession, setDismissedBriefSession] = useState<string | null>(
    () =>
      briefSessionDate && isBriefSettingsDismissed(briefSessionDate)
        ? briefSessionDate
        : null,
  );
  const briefDismissed =
    briefSessionDate != null && dismissedBriefSession === briefSessionDate;
  const maxHoldHints = getMaxHoldHints(maxHoldMinutes);
  const [selectedProfile, setSelectedProfile] = useState<RiskProfile>(
    resolveRiskProfile(settings.risk_profile),
  );

  const stopLossFraction = stopLossPct / 100;
  const takeProfitFraction = takeProfitPct / 100;
  const stopLossHints = getStopLossHints(stopLossFraction);
  const takeProfitHints = getTakeProfitHints(takeProfitFraction, stopLossFraction);
  const briefDiffs = buildSettingDiffs(settings, briefSuggestions);

  function dismissBriefBanner() {
    if (briefSessionDate) {
      dismissBriefSettings(briefSessionDate);
      setDismissedBriefSession(briefSessionDate);
    }
  }

  function applyBriefDiffs() {
    for (const diff of briefDiffs) {
      switch (diff.key) {
        case "minimum_jev_confidence":
          setMinJevPct(diff.proposed);
          break;
        case "signal_record_threshold":
          setSignalRecordPct(diff.proposed);
          break;
        case "stop_loss_percentage":
          setStopLossPct(diff.proposed);
          break;
        case "take_profit_percentage":
          setTakeProfitPct(diff.proposed);
          break;
        case "max_hold_minutes":
          setMaxHoldMinutes(diff.proposed);
          break;
        case "max_open_positions":
          setMaxOpenPositions(diff.proposed);
          break;
        case "min_volume_ratio":
          setMinVolumeRatio(diff.proposed);
          break;
        case "reentry_cooldown_minutes":
          setReentryCooldownMinutes(diff.proposed);
          break;
      }
    }
    dismissBriefBanner();
  }

  const showBriefDiffs =
    briefSessionDate && !briefDismissed && briefDiffs.length > 0;

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

  const formDraft = useMemo(
    () =>
      buildMainSettingsFormDraft({
        minJevPct,
        signalRecordPct,
        confirmationCycles,
        confirmationSeconds,
        riskPerTrade,
        maxPositionSize,
        maxDailyLoss,
        maxOpenPositions,
        stopLossPct,
        takeProfitPct,
        maxHoldMinutes,
        minHoldMinutes,
        jevSellExitPct,
        reentryCooldownMinutes,
        maxEntriesPerSymbol,
        entryEmaGate,
        minVolumeRatio,
        minSharePrice,
        minDollarVolume,
        selectedProfile,
        profitTakeEnabled,
        profitTakeMinPct,
        profitTakeMaxPct,
        profitTakeMinBandHits,
        profitTakeBandWindow,
        profitTakeJevSellPct,
        lossCutEnabled,
        lossCutMinPct,
        lossCutMaxPct,
        lossCutMinBandHits,
        lossCutBandWindow,
        lossCutJevSellPct,
        watchlist: watchlistDraft,
      }),
    [
      minJevPct,
      signalRecordPct,
      confirmationCycles,
      confirmationSeconds,
      riskPerTrade,
      maxPositionSize,
      maxDailyLoss,
      maxOpenPositions,
      stopLossPct,
      takeProfitPct,
      maxHoldMinutes,
      minHoldMinutes,
      jevSellExitPct,
      reentryCooldownMinutes,
      maxEntriesPerSymbol,
      entryEmaGate,
      minVolumeRatio,
      minSharePrice,
      minDollarVolume,
      selectedProfile,
      profitTakeEnabled,
      profitTakeMinPct,
      profitTakeMaxPct,
      profitTakeMinBandHits,
      profitTakeBandWindow,
      profitTakeJevSellPct,
      lossCutEnabled,
      lossCutMinPct,
      lossCutMaxPct,
      lossCutMinBandHits,
      lossCutBandWindow,
      lossCutJevSellPct,
      watchlistDraft,
    ],
  );

  const pendingChanges = useMemo(
    () => diffSettingsFormDraft(savedBaseline, formDraft, currency),
    [savedBaseline, formDraft, currency],
  );
  const hasPendingChanges = pendingChanges.length > 0;

  return (
    <form
      className={hasPendingChanges ? "space-y-6 pb-24" : "space-y-6 pb-8"}
      action={(formData) => {
        if (readOnly || !hasPendingChanges) return;
        setSaveError(null);
        setSaveSuccess(false);
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
            setSavedBaseline(formDraft);
            setSaveSuccess(true);
            router.refresh();
          } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Failed to save settings");
          }
        });
      }}
    >
      {showBriefDiffs ? (
        <BriefSettingDiff
          sessionDate={briefSessionDate!}
          diffs={briefDiffs}
          onApply={applyBriefDiffs}
          onHide={dismissBriefBanner}
          readOnly={readOnly}
        />
      ) : null}

      <fieldset disabled={readOnly} className="min-w-0 space-y-6 border-0 p-0">
      <input type="hidden" name="risk_profile" value={selectedProfile} />

      <SettingsSection
        id="jev-signals"
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
            fieldKey="minimum_jev_confidence"
            label="Min Jev confidence (%)"
            description={SETTING_DESCRIPTIONS.minimum_jev_confidence}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.minimum_jev_confidence}
          >
            <SettingsNumberInput
              id="minimum_jev_confidence"
              name="minimum_jev_confidence"
              step="1"
              integer
              value={minJevPct}
              onChange={setMinJevPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="signal_record_threshold"
            fieldKey="signal_record_threshold"
            label="Signal record threshold (%)"
            description={SETTING_DESCRIPTIONS.signal_record_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.signal_record_threshold}
          >
            <SettingsNumberInput
              id="signal_record_threshold"
              name="signal_record_threshold"
              step="1"
              integer
              value={signalRecordPct}
              onChange={setSignalRecordPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="confirmation_cycles"
            fieldKey="confirmation_cycles"
            label="Confirmation cycles"
            description={SETTING_DESCRIPTIONS.confirmation_cycles}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.confirmation_cycles}
          >
            <SettingsNumberInput
              id="confirmation_cycles"
              name="confirmation_cycles"
              step="1"
              min={1}
              max={10}
              integer
              value={confirmationCycles}
              onChange={setConfirmationCycles}
              required
            />
          </SettingsField>
          <SettingsField
            id="confirmation_seconds"
            fieldKey="confirmation_seconds"
            label="Confirmation seconds"
            description={SETTING_DESCRIPTIONS.confirmation_seconds}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.confirmation_seconds}
          >
            <SettingsNumberInput
              id="confirmation_seconds"
              name="confirmation_seconds"
              step="1"
              min={0}
              max={300}
              integer
              value={confirmationSeconds}
              onChange={setConfirmationSeconds}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        id="risk-limits"
        title="Risk & limits"
        description="Capital at risk per trade, position caps, and daily loss guardrails."
      >
        <SettingsFieldGroup>
          <RiskField
            id="risk_per_trade"
            fieldKey="risk_per_trade"
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
            fieldKey="max_position_size"
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
            fieldKey="max_daily_loss"
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
            fieldKey="max_open_positions"
            label="Max open positions"
            description={SETTING_DESCRIPTIONS.max_open_positions}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.max_open_positions}
          >
            <SettingsNumberInput
              id="max_open_positions"
              name="max_open_positions"
              step="1"
              integer
              value={maxOpenPositions}
              onChange={setMaxOpenPositions}
              required
            />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        id="exits-filters"
        title="Exits & entry filters"
        description="How trades close and which liquidity gates apply after Jev says BUY."
      >
        <div className="space-y-1">
          <SettingsSubsection
            first
            title="Bracket targets"
            description="Primary stop and take-profit on each new position."
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
            </SettingsFieldGroup>
          </SettingsSubsection>

          <SettingsCollapsible
            summary="Early take profit (optional band exit)"
            detail={
              profitTakeEnabled
                ? `On · ${profitTakeMinPct}–${profitTakeMaxPct}% toward TP`
                : "Off"
            }
            defaultOpen={profitTakeEnabled}
          >
            <SettingsFieldGroup className="mt-3">
          <SettingsField
            id="profit_take_enabled"
            fieldKey="profit_take_enabled"
            label="Early take profit"
            description={SETTING_DESCRIPTIONS.profit_take_enabled}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_enabled}
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                id="profit_take_enabled"
                name="profit_take_enabled"
                value="on"
                checked={profitTakeEnabled}
                onChange={(event) => setProfitTakeEnabled(event.target.checked)}
                className="rounded border-zinc-700"
              />
              <span className="text-xs">Enable band exit toward take profit</span>
            </label>
          </SettingsField>
          <SettingsField
            id="profit_take_min_fraction"
            fieldKey="profit_take_min_fraction"
            label="Early take profit min (% of target)"
            description={SETTING_DESCRIPTIONS.profit_take_min_fraction}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_min_fraction}
          >
            <SettingsNumberInput
              id="profit_take_min_fraction"
              name="profit_take_min_fraction"
              step="1"
              min={1}
              max={100}
              integer
              value={profitTakeMinPct}
              onChange={setProfitTakeMinPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="profit_take_max_fraction"
            fieldKey="profit_take_max_fraction"
            label="Early take profit max (% of target)"
            description={SETTING_DESCRIPTIONS.profit_take_max_fraction}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_max_fraction}
          >
            <SettingsNumberInput
              id="profit_take_max_fraction"
              name="profit_take_max_fraction"
              step="1"
              min={1}
              max={100}
              integer
              value={profitTakeMaxPct}
              onChange={setProfitTakeMaxPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="profit_take_min_band_hits"
            fieldKey="profit_take_min_band_hits"
            label="Early take profit band touches"
            description={SETTING_DESCRIPTIONS.profit_take_min_band_hits}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_min_band_hits}
          >
            <SettingsNumberInput
              id="profit_take_min_band_hits"
              name="profit_take_min_band_hits"
              step="1"
              min={1}
              max={20}
              integer
              value={profitTakeMinBandHits}
              onChange={setProfitTakeMinBandHits}
              required
            />
          </SettingsField>
          <SettingsField
            id="profit_take_band_window_cycles"
            fieldKey="profit_take_band_window_cycles"
            label="Early take profit lookback (cycles)"
            description={SETTING_DESCRIPTIONS.profit_take_band_window_cycles}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_band_window_cycles}
          >
            <SettingsNumberInput
              id="profit_take_band_window_cycles"
              name="profit_take_band_window_cycles"
              step="1"
              min={1}
              max={30}
              integer
              value={profitTakeBandWindow}
              onChange={setProfitTakeBandWindow}
              required
            />
          </SettingsField>
          <SettingsField
            id="profit_take_jev_sell_threshold"
            fieldKey="profit_take_jev_sell_threshold"
            label="Early take profit Jev SELL (%)"
            description={SETTING_DESCRIPTIONS.profit_take_jev_sell_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.profit_take_jev_sell_threshold}
          >
            <SettingsNumberInput
              id="profit_take_jev_sell_threshold"
              name="profit_take_jev_sell_threshold"
              step="1"
              min={0}
              max={100}
              integer
              value={profitTakeJevSellPct}
              onChange={setProfitTakeJevSellPct}
              required
            />
          </SettingsField>
            </SettingsFieldGroup>
          </SettingsCollapsible>

          <SettingsCollapsible
            summary="Early loss cut (optional band exit)"
            detail={
              lossCutEnabled
                ? `On · ${lossCutMinPct}–${lossCutMaxPct}% toward stop`
                : "Off"
            }
            defaultOpen={lossCutEnabled}
          >
            <SettingsFieldGroup className="mt-3">
          <SettingsField
            id="loss_cut_enabled"
            fieldKey="loss_cut_enabled"
            label="Early loss cut"
            description={SETTING_DESCRIPTIONS.loss_cut_enabled}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_enabled}
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                id="loss_cut_enabled"
                name="loss_cut_enabled"
                value="on"
                checked={lossCutEnabled}
                onChange={(event) => setLossCutEnabled(event.target.checked)}
                className="rounded border-zinc-700"
              />
              <span className="text-xs">Enable band exit toward stop loss</span>
            </label>
          </SettingsField>
          <SettingsField
            id="loss_cut_min_fraction"
            fieldKey="loss_cut_min_fraction"
            label="Early loss cut min (% toward stop)"
            description={SETTING_DESCRIPTIONS.loss_cut_min_fraction}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_min_fraction}
          >
            <SettingsNumberInput
              id="loss_cut_min_fraction"
              name="loss_cut_min_fraction"
              step="1"
              min={1}
              max={100}
              integer
              value={lossCutMinPct}
              onChange={setLossCutMinPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="loss_cut_max_fraction"
            fieldKey="loss_cut_max_fraction"
            label="Early loss cut max (% toward stop)"
            description={SETTING_DESCRIPTIONS.loss_cut_max_fraction}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_max_fraction}
          >
            <SettingsNumberInput
              id="loss_cut_max_fraction"
              name="loss_cut_max_fraction"
              step="1"
              min={1}
              max={100}
              integer
              value={lossCutMaxPct}
              onChange={setLossCutMaxPct}
              required
            />
          </SettingsField>
          <SettingsField
            id="loss_cut_min_band_hits"
            fieldKey="loss_cut_min_band_hits"
            label="Early loss cut band touches"
            description={SETTING_DESCRIPTIONS.loss_cut_min_band_hits}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_min_band_hits}
          >
            <SettingsNumberInput
              id="loss_cut_min_band_hits"
              name="loss_cut_min_band_hits"
              step="1"
              min={1}
              max={20}
              integer
              value={lossCutMinBandHits}
              onChange={setLossCutMinBandHits}
              required
            />
          </SettingsField>
          <SettingsField
            id="loss_cut_band_window_cycles"
            fieldKey="loss_cut_band_window_cycles"
            label="Early loss cut lookback (cycles)"
            description={SETTING_DESCRIPTIONS.loss_cut_band_window_cycles}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_band_window_cycles}
          >
            <SettingsNumberInput
              id="loss_cut_band_window_cycles"
              name="loss_cut_band_window_cycles"
              step="1"
              min={1}
              max={30}
              integer
              value={lossCutBandWindow}
              onChange={setLossCutBandWindow}
              required
            />
          </SettingsField>
          <SettingsField
            id="loss_cut_jev_sell_threshold"
            fieldKey="loss_cut_jev_sell_threshold"
            label="Early loss cut Jev SELL (%)"
            description={SETTING_DESCRIPTIONS.loss_cut_jev_sell_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.loss_cut_jev_sell_threshold}
          >
            <SettingsNumberInput
              id="loss_cut_jev_sell_threshold"
              name="loss_cut_jev_sell_threshold"
              step="1"
              min={0}
              max={100}
              integer
              value={lossCutJevSellPct}
              onChange={setLossCutJevSellPct}
              required
            />
          </SettingsField>
            </SettingsFieldGroup>
          </SettingsCollapsible>

          <SettingsSubsection
            title="Time & Jev exits"
            description="Optional time cap and when soft Jev SELL exits are allowed."
          >
            <SettingsFieldGroup>
          <SettingsField
            id="max_hold_minutes"
            fieldKey="max_hold_minutes"
            label="Max hold (minutes)"
            description={SETTING_DESCRIPTIONS.max_hold_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.max_hold_minutes}
          >
            <div className="space-y-1.5">
              <SettingsNumberInput
                id="max_hold_minutes"
                name="max_hold_minutes"
                step="1"
                min={0}
                max={480}
                integer
                value={maxHoldMinutes}
                onChange={setMaxHoldMinutes}
                required
              />
              {maxHoldHints.map((hint) => (
                <StrategyHintLine key={hint.message} hint={hint} />
              ))}
            </div>
          </SettingsField>
          <SettingsField
            id="min_hold_minutes"
            fieldKey="min_hold_minutes"
            label="Min hold (minutes)"
            description={SETTING_DESCRIPTIONS.min_hold_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_hold_minutes}
          >
            <SettingsNumberInput
              id="min_hold_minutes"
              name="min_hold_minutes"
              step="1"
              min={0}
              max={480}
              integer
              value={minHoldMinutes}
              onChange={setMinHoldMinutes}
              required
            />
          </SettingsField>
          <SettingsField
            id="jev_sell_exit_threshold"
            fieldKey="jev_sell_exit_threshold"
            label="Jev SELL exit (%)"
            description={SETTING_DESCRIPTIONS.jev_sell_exit_threshold}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.jev_sell_exit_threshold}
          >
            <SettingsNumberInput
              id="jev_sell_exit_threshold"
              name="jev_sell_exit_threshold"
              step="1"
              min={50}
              max={100}
              integer
              value={jevSellExitPct}
              onChange={setJevSellExitPct}
              required
            />
          </SettingsField>
            </SettingsFieldGroup>
          </SettingsSubsection>

          <SettingsSubsection
            title="Re-entry & churn"
            description="Limits repeat entries in the same symbol after an exit."
          >
            <SettingsFieldGroup>
          <SettingsField
            id="reentry_cooldown_minutes"
            fieldKey="reentry_cooldown_minutes"
            label="Re-entry cooldown (minutes)"
            description={SETTING_DESCRIPTIONS.reentry_cooldown_minutes}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.reentry_cooldown_minutes}
          >
            <SettingsNumberInput
              id="reentry_cooldown_minutes"
              name="reentry_cooldown_minutes"
              step="1"
              min={0}
              max={480}
              integer
              value={reentryCooldownMinutes}
              onChange={setReentryCooldownMinutes}
              required
            />
          </SettingsField>
          <SettingsField
            id="max_entries_per_symbol_per_day"
            fieldKey="max_entries_per_symbol_per_day"
            label="Max entries per symbol (day)"
            description={SETTING_DESCRIPTIONS.max_entries_per_symbol_per_day}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.max_entries_per_symbol_per_day}
          >
            <SettingsNumberInput
              id="max_entries_per_symbol_per_day"
              name="max_entries_per_symbol_per_day"
              step="1"
              min={0}
              max={20}
              integer
              value={maxEntriesPerSymbol}
              onChange={setMaxEntriesPerSymbol}
              required
            />
          </SettingsField>
            </SettingsFieldGroup>
          </SettingsSubsection>

          <SettingsSubsection
            title="Entry filters"
            description="Hard gates on share price and volume after a qualifying BUY."
          >
            <p className="text-[11px] leading-relaxed text-zinc-600 sm:col-span-2">
              RSI max 70 and spread 0.15% come from trader{" "}
              <code className="text-zinc-500">.env</code> — see{" "}
              <a href="/strategy#entry-filters" className="text-emerald-500/80 hover:text-emerald-400">
                Strategy
              </a>{" "}
              for details.
            </p>
            <SettingsFieldGroup>
          <SettingsField
            id="entry_ema_gate"
            fieldKey="entry_ema_gate"
            label="Trend filter (EMA)"
            description={SETTING_DESCRIPTIONS.entry_ema_gate}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.entry_ema_gate}
          >
            <select
              id="entry_ema_gate"
              name="entry_ema_gate"
              value={entryEmaGate}
              onChange={(event) =>
                setEntryEmaGate(normalizeEntryEmaGate(event.target.value))
              }
              className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
              disabled={readOnly}
            >
              <option value="off">Off</option>
              <option value="ema_9">Price above EMA-9 (~9 min)</option>
              <option value="ema_20">Price above EMA-20 (~20 min)</option>
            </select>
          </SettingsField>
          <SettingsField
            id="min_volume_ratio"
            fieldKey="min_volume_ratio"
            label="Min volume ratio"
            description={SETTING_DESCRIPTIONS.min_volume_ratio}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_volume_ratio}
          >
            <SettingsNumberInput
              id="min_volume_ratio"
              name="min_volume_ratio"
              step="0.05"
              min={0}
              max={5}
              value={minVolumeRatio}
              onChange={setMinVolumeRatio}
              required
            />
          </SettingsField>
          <SettingsField
            id="min_share_price"
            fieldKey="min_share_price"
            label="Min share price ($)"
            description={SETTING_DESCRIPTIONS.min_share_price}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_share_price}
          >
            <SettingsNumberInput
              id="min_share_price"
              name="min_share_price"
              step="1"
              min={0}
              max={10000}
              integer
              value={minSharePrice}
              onChange={setMinSharePrice}
              required
            />
          </SettingsField>
          <SettingsField
            id="min_dollar_volume"
            fieldKey="min_dollar_volume"
            label="Min dollar volume ($)"
            description={SETTING_DESCRIPTIONS.min_dollar_volume}
            descriptionTitle={SETTING_DESCRIPTIONS_FULL.min_dollar_volume}
          >
            <SettingsNumberInput
              id="min_dollar_volume"
              name="min_dollar_volume"
              step="1000"
              min={0}
              max={1000000000}
              integer
              value={minDollarVolume}
              onChange={setMinDollarVolume}
              required
            />
          </SettingsField>
            </SettingsFieldGroup>
          </SettingsSubsection>
        </div>
      </SettingsSection>

      <SettingsSection
        id="watchlist"
        title="Watchlist"
        description="Symbols Jev monitors for new trade entries."
      >
        <WatchlistSettingsSection
          settings={settings}
          onDraftChange={handleWatchlistDraftChange}
        />
      </SettingsSection>

      {!readOnly && (hasPendingChanges || saveError || (saveSuccess && !hasPendingChanges)) ? (
        <div className="sticky bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 py-3 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              {saveSuccess && !saveError && !hasPendingChanges ? (
                <p
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm leading-snug text-emerald-200"
                  role="status"
                >
                  <span className="font-medium text-emerald-100">Saved</span>
                  {" — "}
                  trader reloads these on the next settings sync (no restart).
                </p>
              ) : null}
              {hasPendingChanges ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Unsaved changes
                  </p>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto text-sm text-zinc-300">
                    {pendingChanges.map((change) => (
                      <li
                        key={change.key}
                        className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-3 py-1.5"
                      >
                        <span className="font-medium text-zinc-200">{change.label}</span>
                        <span className="text-zinc-500">
                          {" "}
                          {change.fromLabel} → {change.toLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {profileSelectionError && !saveError && hasPendingChanges ? (
                <p className="text-sm text-amber-400">{profileSelectionError}</p>
              ) : null}
              {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
            </div>
            {!readOnly && hasPendingChanges ? (
              <Button type="submit" disabled={pending} className="sm:shrink-0">
                {pending ? "Saving…" : "Save settings"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      </fieldset>
    </form>
  );
}
