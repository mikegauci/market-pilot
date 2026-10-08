import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dashboardUrlPath, openBrowser, projectRefFromUrl, root, run, say } from "./lib.mjs";

function vercelBin() {
  return path.join(root, "setup", "node_modules", "vercel", "dist", "index.js");
}

function vercel(args, { input, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vercelBin(), ...args], {
      cwd: path.join(root, "dashboard"),
      stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    let output = "";
    if (!inherit) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
        process.stderr.write(chunk);
      });
      if (input == null) child.stdin.end();
      else child.stdin.end(input);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Vercel exited with code ${code}.`));
    });
  });
}

async function ensureVercelCli() {
  if (fs.existsSync(vercelBin())) return;
  say("Installing the Vercel tool. This can take a minute.");
  await run("npm", ["install", "vercel@48.2.9", "--no-save", "--prefix", path.join(root, "setup")]);
}

async function setEnv(name, value) {
  await vercel(["env", "rm", name, "production", "--yes"]).catch(() => {});
  await vercel(["env", "add", name, "production"], { input: `${value}\n` });
}

export async function deployDashboard({ supabaseUrl, publishableKey, openaiKey = "" }) {
  await ensureVercelCli();
  const linked = path.join(root, "dashboard", ".vercel", "project.json");
  if (!fs.existsSync(linked)) {
    say("A browser window will open so you can sign in to Vercel. Come back here when it says you are logged in.");
    await vercel(["login"], { inherit: true });
    say("Creating your online dashboard project.");
    await vercel(["link", "--yes", "--project", "market-pilot"], { inherit: true });
  }

  await setEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  await setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);
  if (openaiKey) await setEnv("OPENAI_API_KEY", openaiKey);

  say("Publishing your dashboard. This can take a few minutes.");
  const output = await vercel(["--prod", "--yes"]);
  const match = output.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/i);
  if (!match) {
    throw new Error("Vercel finished, but no dashboard link was found. Double-click Setup again to retry this step.");
  }
  const url = match[0].replace(/\/$/, "");
  fs.writeFileSync(dashboardUrlPath, `${url}\n`);

  const ref = projectRefFromUrl(supabaseUrl);
  const authPage = ref
    ? `https://supabase.com/dashboard/project/${ref}/auth/url-configuration`
    : "https://supabase.com/dashboard";
  say(`Your dashboard is live at ${url}`);
  say("Bookmark that link. It also works on your phone.");
  say("One browser step is left, so logging in works:");
  console.log(`  1. This page should open: ${authPage}`);
  console.log(`  2. Set Site URL to ${url}`);
  console.log(`  3. Add ${url} under Redirect URLs, then save.`);
  console.log("  4. Open Authentication, then Providers, then Email, and turn off public sign-ups if you see that switch.");
  openBrowser(authPage);
  return url;
}
