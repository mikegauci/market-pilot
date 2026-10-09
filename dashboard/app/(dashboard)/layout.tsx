import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ReadOnlyProvider } from "@/components/read-only-provider";
import { isDashboardReadOnly } from "@/lib/dashboard-role";
import { getBotStatus, getSettings } from "@/lib/queries";
import { getCurrentUser } from "@/lib/supabase/server";

const defaultBotStatus = {
  id: 1,
  enabled: false,
  shutdown_requested: false,
  trading_mode: "paper" as const,
  execution_mode: "ibkr" as const,
  ibkr_connected: false,
  jev_connected: false,
  ibkr_account_id: null,
  last_heartbeat: null,
  last_error: null,
  updated_at: "",
};

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // The proxy only checks the token signature (getClaims), so confirm with Auth here that the
  // session is still valid (not revoked or banned) on every full page load.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const readOnly = isDashboardReadOnly(user);
  const [botStatus, settings] = await Promise.all([
    getBotStatus(),
    getSettings(),
  ]);
  return (
    <ReadOnlyProvider readOnly={readOnly}>
      <DashboardShell
        botStatus={botStatus ?? defaultBotStatus}
        readOnly={readOnly}
        settings={settings}
      >
        {children}
      </DashboardShell>
    </ReadOnlyProvider>
  );
}
