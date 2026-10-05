import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";
import { ScreenerRankingDelta } from "@/components/screener-ranking-delta";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
import {
  getEmUniverseStats,
  getLatestPortfolio,
  getLatestSessionBriefForUser,
  getScreenerHistory,
  getSettings,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export default async function SettingsPage() {
  const [settings, portfolio, emUniverse, screenerHistory, latestBrief] = await Promise.all([
    getSettings(),
    getLatestPortfolio(),
    getEmUniverseStats(),
    getScreenerHistory(5),
    getLatestSessionBriefForUser(),
  ]);

  if (!settings) {
    return <p className="text-zinc-500">Settings not found.</p>;
  }

  const currentEquity = portfolio?.equity ?? settings.account_capital;
  const baselineEquity = resolveBaselineEquity(
    settings.risk_sync_equity,
    currentEquity,
    settings.account_capital,
  );
  const currency = portfolio?.currency ?? "USD";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold sm:text-2xl">Settings</h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Configure how Jev trades, how much risk to take, and which symbols to watch.
        </p>
        <p className="text-xs leading-relaxed text-zinc-600">
          Stop the trading engine to halt new trades. Trading mode:{" "}
          <span className="text-zinc-400">{settings.trading_mode}</span> (live requires server{" "}
          <code className="text-zinc-500">.env</code>).
          {baselineEquity > 0 && (
            <>
              {" "}
              Risk tier baseline:{" "}
              <span className="text-zinc-400">{formatCurrency(baselineEquity, currency)}</span>
              {currentEquity > 0 && currentEquity !== baselineEquity && (
                <>
                  {" "}
                  · current equity{" "}
                  <span className="text-zinc-400">{formatCurrency(currentEquity, currency)}</span>
                </>
              )}
            </>
          )}
        </p>
      </header>

      <SettingsForm
        settings={settings}
        baselineEquity={baselineEquity}
        currency={currency}
        emUniverse={emUniverse}
        briefSessionDate={latestBrief?.session_date ?? null}
        briefSuggestions={latestBrief?.brief?.suggestions ?? []}
      />

      <ScreenerRankingDelta history={screenerHistory} />

      <p className="text-sm text-zinc-500">
        See{" "}
        <Link href="/strategy" className="text-emerald-500/80 hover:text-emerald-400">
          Indicators & Filters
        </Link>{" "}
        for a full guide to what the bot watches and which safety checks can block a trade.
      </p>
    </div>
  );
}
