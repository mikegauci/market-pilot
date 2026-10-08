import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { latestRelease, parseEnvFile, readVersion, root, run, say } from "./lib.mjs";
import { migrate } from "./migrate.mjs";
import { deployDashboard } from "./deploy-vercel.mjs";

const keep = new Set([
  path.normalize("trader/.env"),
  path.normalize("dashboard/.env.local"),
  path.normalize("setup/.progress"),
  path.normalize("setup/.dashboard-url"),
]);

function skipDir(relative) {
  const normalized = relative.split(path.sep).join("/");
  return (
    normalized === "trader/.venv" ||
    normalized.startsWith("trader/.venv/") ||
    normalized === "logs" ||
    normalized.startsWith("logs/") ||
    normalized === "backup" ||
    normalized.startsWith("backup/") ||
    normalized === "setup/node_modules" ||
    normalized.startsWith("setup/node_modules/") ||
    normalized === "dashboard/node_modules" ||
    normalized.startsWith("dashboard/node_modules/") ||
    normalized === "dashboard/.next" ||
    normalized.startsWith("dashboard/.next/") ||
    normalized === "dashboard/.vercel" ||
    normalized.startsWith("dashboard/.vercel/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  );
}

function copyTree(fromDir, toDir, relative = "") {
  const current = path.join(fromDir, relative);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const rel = relative ? path.join(relative, entry.name) : entry.name;
    if (skipDir(rel) || keep.has(path.normalize(rel))) continue;
    const dest = path.join(toDir, rel);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(fromDir, toDir, rel);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(fromDir, rel), dest);
    }
  }
}

async function main() {
  const release = await latestRelease();
  if (!release) {
    throw new Error("No published version was found yet.");
  }
  const latest = release.tag_name.replace(/^v/, "");
  if (latest === readVersion()) {
    say(`You already have version ${latest}.`);
    return;
  }
  const asset = (release.assets || []).find((item) => item.name.endsWith(".zip"));
  if (!asset) throw new Error("The new version has no downloadable zip.");
  say(`Downloading version ${latest}.`);
  const response = await fetch(asset.browser_download_url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "market-pilot-setup" },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "market-pilot-"));
  const zipPath = path.join(temp, "release.zip");
  fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  const extracted = path.join(temp, "src");
  fs.mkdirSync(extracted);
  await run("tar", ["-xf", zipPath, "-C", extracted]);
  const entries = fs.readdirSync(extracted);
  const source = entries.length === 1 && fs.statSync(path.join(extracted, entries[0])).isDirectory()
    ? path.join(extracted, entries[0])
    : extracted;

  const backup = path.join(root, "backup", `before-${readVersion()}`);
  fs.mkdirSync(backup, { recursive: true });
  say("Saving a copy of the current version, then installing the new one.");
  copyTree(root, backup);
  copyTree(source, root);

  const env = parseEnvFile(path.join(root, "trader", ".env"));
  await migrate(env.SUPABASE_DB_URL);
  await run(process.platform === "win32" ? path.join(root, "trader", ".venv", "Scripts", "python.exe") : path.join(root, "trader", ".venv", "bin", "python"), [
    "-m",
    "pip",
    "install",
    "-r",
    path.join(root, "trader", "requirements.txt"),
  ]);
  await run("npm", ["ci"], { cwd: path.join(root, "dashboard") });
  const dash = parseEnvFile(path.join(root, "dashboard", ".env.local"));
  await deployDashboard({
    supabaseUrl: dash.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: dash.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    openaiKey: dash.OPENAI_API_KEY || "",
  });
  say(`Version ${latest} is installed. Open IB Gateway, then double-click Start Market Pilot.`);
}

main().catch((error) => {
  console.error(`\nUpdate stopped. Your previous copy is in the backup folder.\n${error.message}`);
  process.exit(1);
});
