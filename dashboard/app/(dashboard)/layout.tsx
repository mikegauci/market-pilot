import { DashboardShell } from "@/components/dashboard-shell";
import { getBotStatus } from "@/lib/queries";

const defaultBotStatus = {
  id: 1,
  enabled: false,
  trading_mode: "paper" as const,
  execution_mode: "ibkr" as const,
  ibkr_connected: false,
  jev_connected: false,
  last_heartbeat: null,
  last_error: null,
  updated_at: "",
  entry_kill_active: true,
  entry_kill_reason: "startup",
  entry_kill_at: null,
  market_data_type: null,
  quote_age_p50_sec: null,
  quote_age_p95_sec: null,
};

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const botStatus = (await getBotStatus()) ?? defaultBotStatus;
  return <DashboardShell botStatus={botStatus}>{children}</DashboardShell>;
}
