import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ask,
  latestRelease,
  openBrowser,
  parseEnvFile,
  portOpen,
  pythonBin,
  readDashboardUrl,
  readVersion,
  root,
  say,
} from "./lib.mjs";

const pidPath = path.join(root, "logs", "trader.pid");

async function waitForGateway(port) {
  if (await portOpen(port)) return;
  say(`IB Gateway is not running on port ${port}.`);
  console.log("Open IB Gateway, log in with your paper account, then press Enter.");
  await ask("");
  if (!(await portOpen(port))) {
    throw new Error(`Still nothing on port ${port}. In IB Gateway, open Configure, Settings, API, and set the port to ${port}.`);
  }
}

async function noticeUpdate() {
  try {
    const release = await latestRelease();
    if (!release?.tag_name) return;
    const latest = release.tag_name.replace(/^v/, "");
    if (latest === readVersion()) return;
    const notes = (release.body || "").split("\n").slice(0, 3).join(" ");
    say(`Version ${latest} is available. ${notes}`.trim());
    say("Double-click Update Market Pilot when you are ready. Nothing will change until you do.");
  } catch {
    // Offline or no release yet. Starting still works.
  }
}

async function main() {
  const envPath = path.join(root, "trader", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("Setup has not been finished. Double-click Setup Market Pilot first.");
  }
  if (!fs.existsSync(pythonBin())) {
    throw new Error("The trading program is not installed. Double-click Setup Market Pilot.");
  }
  const env = parseEnvFile(envPath);
  const port = Number(env.IBKR_PORT || 4002);
  await waitForGateway(port);
  await noticeUpdate();

  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const log = fs.openSync(path.join(root, "logs", "trader.log"), "a");
  const child = spawn(pythonBin(), ["main.py"], {
    cwd: path.join(root, "trader"),
    detached: false,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  fs.writeFileSync(pidPath, `${child.pid}\n`);
  const url = readDashboardUrl();
  say(url ? `The trader is running. Your dashboard: ${url}` : "The trader is running.");
  say("Leave this window open. Closing it stops the trader. The dashboard stays online either way.");
  if (url) openBrowser(url);

  const stop = () => {
    child.kill();
    try {
      fs.rmSync(pidPath);
    } catch {
      // already gone
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    try {
      fs.rmSync(pidPath);
    } catch {
      // already gone
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
