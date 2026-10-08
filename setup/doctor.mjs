import fs from "node:fs";
import path from "node:path";
import { parseEnvFile, portOpen, pythonBin, readDashboardUrl, root } from "./lib.mjs";

const checks = [];

function add(ok, label, fix) {
  checks.push({ ok, label, fix });
  console.log(`${ok ? "OK   " : "FIX  "} ${label}`);
  if (!ok && fix) console.log(`       ${fix}`);
}

async function main() {
  console.log("\nMarket Pilot check\n");
  add(Boolean(process.versions.node), `Node.js ${process.version}`, "Double-click Setup Market Pilot.");
  const traderEnv = path.join(root, "trader", ".env");
  const dashboardEnv = path.join(root, "dashboard", ".env.local");
  add(fs.existsSync(traderEnv), "Trading settings file", "Double-click Setup Market Pilot.");
  add(fs.existsSync(dashboardEnv), "Dashboard settings file", "Double-click Setup Market Pilot.");
  add(fs.existsSync(pythonBin()), "Trading program installed", "Double-click Setup Market Pilot.");
  add(
    fs.existsSync(path.join(root, "dashboard", "node_modules")),
    "Dashboard program installed",
    "Double-click Setup Market Pilot.",
  );

  const env = parseEnvFile(traderEnv);
  const dash = parseEnvFile(dashboardEnv);
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/settings?id=eq.1&select=id`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      add(response.ok, "Database answers", "Check the Supabase keys in Setup.");
    } catch (error) {
      add(false, "Database answers", error.message);
    }
  } else {
    add(false, "Database answers", "Double-click Setup Market Pilot.");
  }

  const url = readDashboardUrl();
  if (!url) {
    add(false, "Dashboard is online", "Double-click Setup Market Pilot so it can publish the dashboard.");
  } else {
    try {
      const response = await fetch(url);
      add(response.ok || response.status === 401 || response.status === 307, `Dashboard ${url}`, "Double-click Update Market Pilot.");
    } catch (error) {
      add(false, `Dashboard ${url}`, error.message);
    }
  }

  const port = Number(env.IBKR_PORT || 4002);
  add(
    await portOpen(port),
    `IB Gateway on port ${port}`,
    "Open IB Gateway, log in with your paper account, and turn on the API.",
  );
  add(Boolean(dash.NEXT_PUBLIC_SUPABASE_URL), "Dashboard knows your Supabase project", "Double-click Setup Market Pilot.");

  const failed = checks.filter((check) => !check.ok).length;
  console.log(failed === 0 ? "\nEverything looks ready.\n" : `\n${failed} item${failed === 1 ? "" : "s"} need attention. Send a screenshot of this window if you need help.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
