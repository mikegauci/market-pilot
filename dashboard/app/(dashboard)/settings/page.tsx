import { SettingsForm } from "@/components/settings-form";
import { getSettings } from "@/lib/queries";

export default async function SettingsPage() {
  const settings = await getSettings();

  if (!settings) {
    return <p className="text-zinc-500">Settings not found.</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <SettingsForm settings={settings} />
    </div>
  );
}
