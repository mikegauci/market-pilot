"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { fetchLatestPortfolio, fetchSettings } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { LIVE_SETTINGS_POLL_MS } from "@/lib/live-data-config";
import type { PortfolioSnapshot, Settings } from "@/lib/types/database";

const LivePortfolioContext = createContext<PortfolioSnapshot | null>(null);
const LiveSettingsContext = createContext<Settings | null>(null);

/**
 * One shell-level poll each for the latest portfolio snapshot and settings, shared by the
 * sidebar, toasts and page cards (instead of each component polling the same rows).
 * Must sit inside BotStatusProvider.
 */
export function ShellLiveDataProvider({
  initialSettings,
  children,
}: {
  initialSettings: Settings | null;
  children: ReactNode;
}) {
  const botStatus = useLiveBotStatus();

  const loadPortfolio = useCallback(() => fetchLatestPortfolio(), []);
  const portfolio = useLiveQuery<PortfolioSnapshot | null>(
    null,
    loadPortfolio,
    ["portfolio_history", "bot_status"],
    undefined,
    { keepPreviousOnNull: true, resetKey: botStatus.ibkr_account_id },
  );

  const loadSettings = useCallback(() => fetchSettings(), []);
  const settings = useLiveQuery(initialSettings, loadSettings, ["settings"], LIVE_SETTINGS_POLL_MS, {
    keepPreviousOnNull: true,
  });

  return (
    <LiveSettingsContext.Provider value={settings}>
      <LivePortfolioContext.Provider value={portfolio}>{children}</LivePortfolioContext.Provider>
    </LiveSettingsContext.Provider>
  );
}

/** Latest polled portfolio snapshot; `fallback` (e.g. the SSR row) until the first poll lands. */
export function useLivePortfolio(
  fallback: PortfolioSnapshot | null = null,
): PortfolioSnapshot | null {
  return useContext(LivePortfolioContext) ?? fallback;
}

/** Latest polled settings row; `fallback` (e.g. the page's SSR row) when none is loaded. */
export function useLiveSettings(fallback: Settings | null = null): Settings | null {
  return useContext(LiveSettingsContext) ?? fallback;
}
