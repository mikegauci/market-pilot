import { SettingsForm } from "@/components/settings-form";
import { WatchlistCharts } from "@/components/watchlist-charts";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
import { getEmUniverseStats, getLatestPortfolio, getSettings } from "@/lib/queries";

export default async function SettingsPage() {
  const [settings, portfolio, emUniverse] = await Promise.all([
    getSettings(),
    getLatestPortfolio(),
    getEmUniverseStats(),
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
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Settings</h2>
      <WatchlistCharts symbols={settings.watchlist} />
      <SettingsForm
        settings={settings}
        currentEquity={currentEquity}
        baselineEquity={baselineEquity}
        currency={currency}
        emUniverse={emUniverse}
      />
    </div>
  );
}
