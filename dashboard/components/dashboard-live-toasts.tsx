"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { useToast } from "@/components/toast-provider";
import { fetchSettings, fetchTradesForTradingDay } from "@/lib/data-client";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  tradeLifecycleDiff,
  tradeStatusSnapshot,
  watchlistDiff,
  watchlistToastDescription,
} from "@/lib/live-event-diff";
import { LIVE_SETTINGS_POLL_MS } from "@/lib/live-data-config";
import { tradingDayStartUtc } from "@/lib/market-hours";
import { createClient } from "@/lib/supabase/client";
import { resolveTradeAccountScope } from "@/lib/trade-account-scope";
import type { Settings, Trade } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

const EMPTY_TRADES: Trade[] = [];

export function DashboardLiveToasts({
  settings: initialSettings,
}: {
  settings: Settings | null;
}) {
  const { push } = useToast();
  const botStatus = useLiveBotStatus();
  const [tradesScopeReady, setTradesScopeReady] = useState(false);

  const loadSettings = useCallback(() => fetchSettings(), []);
  const settings = useLiveQuery(initialSettings, loadSettings, ["settings"], LIVE_SETTINGS_POLL_MS, {
    keepPreviousOnNull: true,
  });

  const loadTrades = useCallback(
    () => fetchTradesForTradingDay(tradingDayStartUtc()),
    [],
  );
  const trades = useLiveQuery(EMPTY_TRADES, loadTrades, ["trades"], undefined, {
    keepPreviousOnEmpty: true,
  });

  const watchlistReadyRef = useRef(false);
  const prevWatchlistRef = useRef<string[]>([]);
  const prevRotationEnabledRef = useRef<boolean | null>(null);
  const tradesReadyRef = useRef(false);
  const prevTradeStatusRef = useRef<Map<string, Trade["status"]>>(new Map());
  const prevTradesScopeReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = await resolveTradeAccountScope(createClient());
      if (!cancelled) {
        setTradesScopeReady(scope.accountId != null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [botStatus.ibkr_account_id]);

  useEffect(() => {
    const scopeBecameReady = tradesScopeReady && !prevTradesScopeReadyRef.current;
    prevTradesScopeReadyRef.current = tradesScopeReady;
    if (!tradesScopeReady || scopeBecameReady) {
      tradesReadyRef.current = false;
      prevTradeStatusRef.current = new Map();
    }
  }, [tradesScopeReady]);

  useEffect(() => {
    tradesReadyRef.current = false;
    prevTradeStatusRef.current = new Map();
  }, [botStatus.ibkr_account_id]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    const rotationEnabled = Boolean(settings.watchlist_rotation_enabled);
    const nextWatchlist = resolveEffectiveWatchlist(settings);

    if (
      prevRotationEnabledRef.current !== null &&
      prevRotationEnabledRef.current !== rotationEnabled
    ) {
      prevRotationEnabledRef.current = rotationEnabled;
      watchlistReadyRef.current = true;
      prevWatchlistRef.current = nextWatchlist;
      return;
    }
    prevRotationEnabledRef.current = rotationEnabled;

    if (!watchlistReadyRef.current) {
      watchlistReadyRef.current = true;
      prevWatchlistRef.current = nextWatchlist;
      return;
    }
    const diff = watchlistDiff(prevWatchlistRef.current, nextWatchlist);
    prevWatchlistRef.current = nextWatchlist;
    if (!diff) {
      return;
    }
    push({
      variant: "watchlist",
      title: "Watchlist updated",
      description: watchlistToastDescription(diff),
    });
  }, [settings, push]);

  useEffect(() => {
    if (!tradesScopeReady) {
      return;
    }
    if (!tradesReadyRef.current) {
      tradesReadyRef.current = true;
      prevTradeStatusRef.current = tradeStatusSnapshot(trades);
      return;
    }

    const { opened, closed } = tradeLifecycleDiff(prevTradeStatusRef.current, trades);
    prevTradeStatusRef.current = tradeStatusSnapshot(trades);

    for (const trade of opened) {
      push({
        variant: "trade-open",
        title: `Opened ${trade.symbol}`,
        description: `${trade.quantity} shares @ ${formatCurrency(trade.entry_price)}`,
      });
    }
    for (const trade of closed) {
      const pnl =
        trade.net_pnl != null ? ` · ${formatCurrency(trade.net_pnl)} net` : "";
      push({
        variant: "trade-closed",
        title: `Closed ${trade.symbol}`,
        description: `${trade.exit_reason?.trim() || "Position closed"}${pnl}`,
      });
    }
  }, [trades, tradesScopeReady, push]);

  return null;
}
