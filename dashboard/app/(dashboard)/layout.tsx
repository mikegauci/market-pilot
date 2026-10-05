import { DashboardShell } from "@/components/dashboard-shell";
import { getBotStatus } from "@/lib/queries";

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
  const botStatus = (await getBotStatus()) ?? defaultBotStatus;
  return <DashboardShell botStatus={botStatus}>{children}</DashboardShell>;
}
