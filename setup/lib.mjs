import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const progressPath = path.join(root, "setup", ".progress");
export const dashboardUrlPath = path.join(root, "setup", ".dashboard-url");
export const repo = "mikegauci/market-pilot";

export function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(progressPath, "utf8"));
  } catch {
    return { done: [] };
  }
}

export function markDone(step) {
  const progress = readProgress();
  if (!progress.done.includes(step)) progress.done.push(step);
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2) + "\n");
}

export function isDone(step) {
  return readProgress().done.includes(step);
}

export function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    }
    env[key] = value;
  }
  return env;
}

export function formatEnvValue(value) {
  const text = value == null ? "" : String(value);
  if (text === "") return "";
  if (/[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

export function fillExample(exampleText, values) {
  const seen = new Set();
  const lines = exampleText.split("\n").map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${formatEnvValue(values[match[1]])}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) lines.push(`${key}=${formatEnvValue(value)}`);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function pythonBin() {
  return process.platform === "win32"
    ? path.join(root, "trader", ".venv", "Scripts", "python.exe")
    : path.join(root, "trader", ".venv", "bin", "python");
}

export function readVersion() {
  try {
    return fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

export function readDashboardUrl() {
  try {
    return fs.readFileSync(dashboardUrlPath, "utf8").trim();
  } catch {
    return "";
  }
}

export function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1500);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

export function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: root, ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes("\n") || text.includes("\r")) return;
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`${question}${"*".repeat(rl.line.length)}`);
    };
    process.stdin.on("data", onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "";
  } catch {
    return "";
  }
}

export async function latestRelease() {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "market-pilot-setup" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking for updates.`);
  return response.json();
}

export function say(text) {
  console.log(`\n${text}`);
}
