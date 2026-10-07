import { DashboardShell } from "@/components/dashboard-shell";
import { ReadOnlyProvider } from "@/components/read-only-provider";
import { isDashboardReadOnly } from "@/lib/dashboard-role";
import { getBotStatus } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const readOnly = isDashboardReadOnly(user);
  const botStatus = (await getBotStatus()) ?? defaultBotStatus;
  return (
    <ReadOnlyProvider readOnly={readOnly}>
      <DashboardShell botStatus={botStatus} readOnly={readOnly}>
        {children}
      </DashboardShell>
    </ReadOnlyProvider>
  );
}
