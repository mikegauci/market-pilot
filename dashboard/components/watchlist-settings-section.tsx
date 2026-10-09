"use client";

import { useEffect, useMemo, useState } from "react";
import {
  parseWatchlistFormDraft,
  type WatchlistFormDraftSlice,
} from "@/lib/settings-form-changes";
import { EntryBlockedSymbols } from "@/components/entry-blocked-symbols";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { SettingsFieldHelp } from "@/components/settings-field-help";
import {
  FieldDescription,
  SettingsSubsection,
} from "@/components/settings-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/lib/types/database";
import {
  formatPredictingWatchlistHeadline,
  resolveEffectiveWatchlist,
} from "@/lib/effective-watchlist";
import { rotationSessionPctInputValue } from "@/lib/format-rotation-session";
import {
  SETTING_DESCRIPTIONS,
  SETTING_DESCRIPTIONS_FULL,
} from "@/lib/settings-form-descriptions";
import {
  normalizeWatchlistSymbols,
  watchlistSymbolsHiddenValue,
} from "@/lib/watchlist-symbols";

type Props = {
  settings: Settings;
  /** Live Max RSI from Entry filters, so the breakout cap hint stays in sync before save. */
  maxRsi?: number;
  onDraftChange?: (draft: WatchlistFormDraftSlice) => void;
};

export function WatchlistSettingsSection({ settings, maxRsi, onDraftChange }: Props) {
  const [rotating, setRotating] = useState(Boolean(settings.watchlist_rotation_enabled));
  const [poolSymbols, setPoolSymbols] = useState(() =>
    normalizeWatchlistSymbols(settings.watchlist_pool ?? []),
  );
  const [manualWatchlist, setManualWatchlist] = useState(() =>
    normalizeWatchlistSymbols(settings.watchlist ?? []),
  );
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(
    () => (settings.benchmark_symbol ?? "").trim().toUpperCase(),
  );
  const [activeSize, setActiveSize] = useState(settings.watchlist_active_size ?? 12);
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(
    settings.watchlist_rotation_interval_minutes ?? 15,
  );
  const [maxSwaps, setMaxSwaps] = useState(settings.watchlist_max_swaps_per_rotation ?? 2);
  const [rotationSessionPctRaw, setRotationSessionPctRaw] = useState(() =>
    rotationSessionPctInputValue(settings.rotation_min_session_change_pct),
  );
  const [breakoutEnabled, setBreakoutEnabled] = useState(
    Boolean(settings.breakout_enabled ?? true),
  );
  const [breakoutMaxRsi, setBreakoutMaxRsi] = useState(settings.breakout_max_rsi ?? 82);
  const entryMaxRsi = maxRsi ?? settings.max_rsi ?? 70;
  const [breakoutWindowMinutes, setBreakoutWindowMinutes] = useState(
    settings.breakout_window_minutes ?? 10,
  );
  const [breakoutMaxPromotions, setBreakoutMaxPromotions] = useState(
    settings.breakout_max_promotions_per_cycle ?? 2,
  );
  const [breakoutLookbackMinutes, setBreakoutLookbackMinutes] = useState(
    settings.breakout_lookback_minutes ?? 10,
  );
  const [breakoutMinVolumeRatio, setBreakoutMinVolumeRatio] = useState(
    settings.breakout_min_volume_ratio ?? 1.5,
  );
  const [breakoutMinChange5mPct, setBreakoutMinChange5mPct] = useState(
    settings.breakout_min_change_5m_pct ?? 0.15,
  );

  const watchlistFormDraft = useMemo(
    () =>
      parseWatchlistFormDraft({
        rotating,
        manualWatchlist,
        poolSymbols,
        benchmarkSymbol,
        activeSize,
        rotationIntervalMinutes,
        maxSwaps,
        rotationSessionPctRaw,
        breakoutEnabled,
        breakoutMaxRsi,
        breakoutWindowMinutes,
        breakoutMaxPromotions,
        breakoutLookbackMinutes,
        breakoutMinVolumeRatio,
        breakoutMinChange5mPct,
        saved: settings,
      }),
    [
      rotating,
      manualWatchlist,
      poolSymbols,
      benchmarkSymbol,
      activeSize,
      rotationIntervalMinutes,
      maxSwaps,
      rotationSessionPctRaw,
      breakoutEnabled,
      breakoutMaxRsi,
      breakoutWindowMinutes,
      breakoutMaxPromotions,
      breakoutLookbackMinutes,
      breakoutMinVolumeRatio,
      breakoutMinChange5mPct,
      settings,
    ],
  );

  useEffect(() => {
    onDraftChange?.(watchlistFormDraft);
  }, [onDraftChange, watchlistFormDraft]);

  const previewSettings = useMemo(
    (): Settings => ({
      ...settings,
      watchlist_rotation_enabled: rotating,
      watchlist_pool: poolSymbols,
      watchlist: manualWatchlist,
    }),
    [settings, rotating, poolSymbols, manualWatchlist],
  );

  const effectiveWatchlist = resolveEffectiveWatchlist(previewSettings);
  const headline = formatPredictingWatchlistHeadline(effectiveWatchlist.length);

  return (
    <div className="space-y-1">
      <SettingsSubsection
        first
        title="Benchmark & headwind"
        description="Optional broad-market check for entry filters (not traded)."
      >
        <div className="space-y-2">
          <Label htmlFor="benchmark_symbol">Benchmark symbol</Label>
          <Input
            id="benchmark_symbol"
            name="benchmark_symbol"
            value={benchmarkSymbol}
            onChange={(event) => setBenchmarkSymbol(event.target.value.toUpperCase())}
            placeholder="QQQ"
            className="max-w-[10rem] font-mono uppercase"
          />
          <FieldDescription title="Used only to see if the market is a headwind. The bot does not buy this symbol.">
            QQQ fits a tech book. Leave blank to turn the headwind check off.
          </FieldDescription>
        </div>
      </SettingsSubsection>

      <SettingsSubsection
        title="Rotation"
        description="When on, Jev evaluates a smaller active list that can change through the session."
      >
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              name="watchlist_rotation_enabled"
              value="on"
              checked={rotating}
              onChange={(e) => setRotating(e.target.checked)}
              className="rounded border-zinc-700"
            />
            Rotate the active list through the session
          </label>

          {rotating ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="watchlist_active_size">Active list size</Label>
                <Input
                  id="watchlist_active_size"
                  name="watchlist_active_size"
                  type="number"
                  min={1}
                  max={20}
                  value={activeSize}
                  onChange={(event) => setActiveSize(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="watchlist_rotation_interval_minutes">Minutes between swaps</Label>
                <Input
                  id="watchlist_rotation_interval_minutes"
                  name="watchlist_rotation_interval_minutes"
                  type="number"
                  min={5}
                  max={120}
                  value={rotationIntervalMinutes}
                  onChange={(event) =>
                    setRotationIntervalMinutes(Number(event.target.value))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="watchlist_max_swaps_per_rotation">Max swaps</Label>
                <Input
                  id="watchlist_max_swaps_per_rotation"
                  name="watchlist_max_swaps_per_rotation"
                  type="number"
                  min={1}
                  max={5}
                  value={maxSwaps}
                  onChange={(event) => setMaxSwaps(Number(event.target.value))}
                />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label htmlFor="rotation_min_session_change_pct">
                  Session % floor (since open)
                </Label>
                <FieldDescription title="Only applies while watchlist rotation is on.">
                  Names below this % vs today&apos;s price when the market opened are not
                  promoted onto the active list. Blank = off.{" "}
                  <span className="text-zinc-500">0 = flat or green since open (default).</span>
                </FieldDescription>
                <Input
                  id="rotation_min_session_change_pct"
                  name="rotation_min_session_change_pct"
                  value={rotationSessionPctRaw}
                  onChange={(event) => setRotationSessionPctRaw(event.target.value)}
                  placeholder="off"
                  className="max-w-[10rem] font-mono"
                />
                <FieldDescription title="Illustration only — not live prices.">
                  Example: stock opened at $100 when the market opened. Now $99.50 (−0.5%) → below
                  floor 0, rotation won&apos;t favor it. Now $100.10 (+0.1%) → OK. Open trades stay
                  on the list either way.
                </FieldDescription>
                <SettingsFieldHelp fieldKey="rotation_min_session_change_pct" />
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">
              Enable rotation to set active size, swap timing, and session % floor.
            </p>
          )}

          <FieldDescription title="Jev only checks the active list when rotation is on.">
            A challenger must beat the weakest active name. Open trades stay protected.
          </FieldDescription>
        </div>
      </SettingsSubsection>

      <SettingsSubsection
        title="Breakout promotion"
        description="Catch fast movers from the pool between rotation swaps. Stops 15 minutes before the close."
      >
        {rotating ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                name="breakout_enabled"
                value="on"
                checked={breakoutEnabled}
                onChange={(event) => setBreakoutEnabled(event.target.checked)}
                className="rounded border-zinc-700"
              />
              Promote pool symbols on 1-minute breakouts
            </label>
            {breakoutEnabled ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="breakout_max_rsi">Breakout max RSI</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_max_rsi}>
                    {SETTING_DESCRIPTIONS.breakout_max_rsi}
                  </FieldDescription>
                  <Input
                    id="breakout_max_rsi"
                    name="breakout_max_rsi"
                    type="number"
                    min={1}
                    max={100}
                    value={breakoutMaxRsi}
                    onChange={(event) => setBreakoutMaxRsi(Number(event.target.value))}
                    className="max-w-[10rem]"
                  />
                  {breakoutMaxRsi <= entryMaxRsi ? (
                    <p className="text-xs text-amber-400/90">
                      At or below Max RSI ({entryMaxRsi}), so promoted names get no extra RSI room.
                    </p>
                  ) : null}
                  <SettingsFieldHelp fieldKey="breakout_max_rsi" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="breakout_window_minutes">Breakout window (min)</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_window_minutes}>
                    {SETTING_DESCRIPTIONS.breakout_window_minutes}
                  </FieldDescription>
                  <Input
                    id="breakout_window_minutes"
                    name="breakout_window_minutes"
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={breakoutWindowMinutes}
                    onChange={(event) =>
                      setBreakoutWindowMinutes(Number(event.target.value))
                    }
                    className="max-w-[10rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="breakout_max_promotions_per_cycle">Max breakout names at once</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_max_promotions_per_cycle}>
                    {SETTING_DESCRIPTIONS.breakout_max_promotions_per_cycle}
                  </FieldDescription>
                  <Input
                    id="breakout_max_promotions_per_cycle"
                    name="breakout_max_promotions_per_cycle"
                    type="number"
                    min={1}
                    max={5}
                    value={breakoutMaxPromotions}
                    onChange={(event) =>
                      setBreakoutMaxPromotions(Number(event.target.value))
                    }
                    className="max-w-[10rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="breakout_lookback_minutes">Lookback (1-min bars)</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_lookback_minutes}>
                    {SETTING_DESCRIPTIONS.breakout_lookback_minutes}
                  </FieldDescription>
                  <Input
                    id="breakout_lookback_minutes"
                    name="breakout_lookback_minutes"
                    type="number"
                    min={5}
                    max={60}
                    value={breakoutLookbackMinutes}
                    onChange={(event) =>
                      setBreakoutLookbackMinutes(Number(event.target.value))
                    }
                    className="max-w-[10rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="breakout_min_volume_ratio">Min volume ratio</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_min_volume_ratio}>
                    {SETTING_DESCRIPTIONS.breakout_min_volume_ratio}
                  </FieldDescription>
                  <Input
                    id="breakout_min_volume_ratio"
                    name="breakout_min_volume_ratio"
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={breakoutMinVolumeRatio}
                    onChange={(event) =>
                      setBreakoutMinVolumeRatio(Number(event.target.value))
                    }
                    className="max-w-[10rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="breakout_min_change_5m_pct">Min 5m change (%)</Label>
                  <FieldDescription title={SETTING_DESCRIPTIONS_FULL.breakout_min_change_5m_pct}>
                    {SETTING_DESCRIPTIONS.breakout_min_change_5m_pct}
                  </FieldDescription>
                  <Input
                    id="breakout_min_change_5m_pct"
                    name="breakout_min_change_5m_pct"
                    type="number"
                    min={0}
                    max={5}
                    step={0.01}
                    value={breakoutMinChange5mPct}
                    onChange={(event) =>
                      setBreakoutMinChange5mPct(Number(event.target.value))
                    }
                    className="max-w-[10rem]"
                  />
                </div>
              </div>
            ) : (
              <>
                <input type="hidden" name="breakout_max_rsi" value={breakoutMaxRsi} />
                <input
                  type="hidden"
                  name="breakout_window_minutes"
                  value={breakoutWindowMinutes}
                />
                <input
                  type="hidden"
                  name="breakout_max_promotions_per_cycle"
                  value={breakoutMaxPromotions}
                />
                <input
                  type="hidden"
                  name="breakout_lookback_minutes"
                  value={breakoutLookbackMinutes}
                />
                <input
                  type="hidden"
                  name="breakout_min_volume_ratio"
                  value={breakoutMinVolumeRatio}
                />
                <input
                  type="hidden"
                  name="breakout_min_change_5m_pct"
                  value={breakoutMinChange5mPct}
                />
              </>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-zinc-600">
              Turn on rotation above to configure breakout promotion.
            </p>
            <input
              type="hidden"
              name="breakout_enabled"
              value={settings.breakout_enabled ? "on" : ""}
            />
            <input type="hidden" name="breakout_max_rsi" value={settings.breakout_max_rsi ?? 82} />
            <input
              type="hidden"
              name="breakout_window_minutes"
              value={settings.breakout_window_minutes ?? 10}
            />
            <input
              type="hidden"
              name="breakout_max_promotions_per_cycle"
              value={settings.breakout_max_promotions_per_cycle ?? 2}
            />
            <input
              type="hidden"
              name="breakout_lookback_minutes"
              value={settings.breakout_lookback_minutes ?? 10}
            />
            <input
              type="hidden"
              name="breakout_min_volume_ratio"
              value={settings.breakout_min_volume_ratio ?? 1.5}
            />
            <input
              type="hidden"
              name="breakout_min_change_5m_pct"
              value={settings.breakout_min_change_5m_pct ?? 0.15}
            />
          </>
        )}
      </SettingsSubsection>

      <SettingsSubsection title="Live preview" description="What the bot is scanning now (read-only until save).">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-3">
          <p className="text-sm font-medium text-zinc-100">{headline}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {rotating
              ? "These are the names Jev is checking now. The bot updates this list."
              : "Symbols Jev monitors for entries. Open positions are added at runtime."}
          </p>
          {settings.watchlist_last_rotation_note ? (
            <p className="mt-1 text-xs text-zinc-400">
              Last change: {settings.watchlist_last_rotation_note}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {effectiveWatchlist.length ? (
              effectiveWatchlist.map((symbol) => (
                <span
                  key={symbol}
                  className="rounded border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-200"
                >
                  {symbol}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">—</span>
            )}
          </div>
        </div>
      </SettingsSubsection>

      {!rotating ? (
        <>
          <input type="hidden" name="watchlist_active_size" value={activeSize} />
          <input
            type="hidden"
            name="watchlist_rotation_interval_minutes"
            value={rotationIntervalMinutes}
          />
          <input
            type="hidden"
            name="watchlist_max_swaps_per_rotation"
            value={maxSwaps}
          />
          <input
            type="hidden"
            name="rotation_min_session_change_pct"
            value={rotationSessionPctRaw}
          />
        </>
      ) : null}

      <input
        type="hidden"
        name="watchlist"
        value={watchlistSymbolsHiddenValue(manualWatchlist)}
        required={!rotating}
      />
      <input
        type="hidden"
        name="watchlist_pool"
        value={watchlistSymbolsHiddenValue(poolSymbols)}
        required={rotating}
      />

      <SettingsSubsection title="Symbols">
        {rotating ? (
          <div className="space-y-2">
            <WatchlistPicker
              value={poolSymbols}
              onChange={setPoolSymbols}
              fieldLabel="Candidate pool"
            />
            <FieldDescription title="The larger list rotation chooses from. About 30 liquid names is enough.">
              The benchmark ETF is not traded.
            </FieldDescription>
          </div>
        ) : (
          <div className="space-y-2">
            <WatchlistPicker
              value={manualWatchlist}
              onChange={setManualWatchlist}
              fieldLabel="Watchlist"
            />
            <FieldDescription title="Symbols Jev monitors when rotation is off.">
              Save to apply.
            </FieldDescription>
          </div>
        )}
      </SettingsSubsection>

      <SettingsSubsection title="Entry blocks" description="Manual no-trade symbols (separate from filters).">
        <EntryBlockedSymbols
          settings={settings}
          symbols={settings.entry_blocked_symbols ?? []}
          changeBySymbol={new Map()}
        />
      </SettingsSubsection>
    </div>
  );
}
