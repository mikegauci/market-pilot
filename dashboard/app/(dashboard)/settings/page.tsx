import { SettingsForm } from "@/components/settings-form";
import { StrategyIndicatorsCard } from "@/components/strategy-indicators-card";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
import { getEmUniverseStats, getLatestPortfolio, getSettings } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

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
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold sm:text-2xl">Settings</h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Configure how Jev trades, how much risk to take, and which symbols to watch.
        </p>
        <p className="text-xs leading-relaxed text-zinc-600">
          Auto-trading is controlled on{" "}
          <span className="text-zinc-400">Overview</span>. Trading mode:{" "}
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
      />

      <details className="group rounded-xl border border-zinc-800/80 bg-zinc-950/20">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-300 marker:content-none sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block text-zinc-500 transition group-open:rotate-90">
              ▸
            </span>
            Indicators & filters (reference)
          </span>
        </summary>
        <div className="border-t border-zinc-800/60 px-4 pb-4 pt-2 sm:px-5">
          <StrategyIndicatorsCard
            variant="reference"
            embedded
            benchmarkSymbol={settings.benchmark_symbol ?? "EEM"}
            minVolumeRatio={settings.min_volume_ratio ?? 0}
          />
        </div>
      </details>
    </div>
  );
}
