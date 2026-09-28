import { SettingsForm } from "@/components/settings-form";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
import { getLatestPortfolio, getSettings } from "@/lib/queries";

export default async function SettingsPage() {
  const [settings, portfolio] = await Promise.all([getSettings(), getLatestPortfolio()]);

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
      <h2 className="text-2xl font-semibold">Settings</h2>
      <SettingsForm
        settings={settings}
        currentEquity={currentEquity}
        baselineEquity={baselineEquity}
        currency={currency}
      />
    </div>
  );
}
