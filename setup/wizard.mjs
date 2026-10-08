import fs from "node:fs";
import path from "node:path";
import { ask, askSecret, fillExample, isDone, markDone, openBrowser, projectRefFromUrl, pythonBin, root, run, say } from "./lib.mjs";
import { migrate } from "./migrate.mjs";
import { deployDashboard } from "./deploy-vercel.mjs";

const traderEnvPath = path.join(root, "trader", ".env");
const dashboardEnvPath = path.join(root, "dashboard", ".env.local");

function need(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : "";
}

async function promptValue({ title, body, url, secret = false, optional = false, envName }) {
  const preset = need(envName);
  if (preset) return preset;
  say(title);
  console.log(body);
  if (url) {
    console.log(`Opening ${url}`);
    openBrowser(url);
  }
  const hint = optional ? "Press Enter to skip: " : "Paste it here, then press Enter: ";
  const value = secret ? await askSecret(hint) : await ask(hint);
  if (!value && !optional) {
    say("That one is required. Let's try it again.");
    return promptValue({ title, body, url, secret, optional, envName });
  }
  return value;
}

async function checkSupabase(url, publishableKey, serviceKey) {
  const health = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
    headers: { apikey: publishableKey },
  });
  if (!health.ok) {
    throw new Error("That Supabase address or public key was not accepted. Copy both again from Project Settings, then API.");
  }
  const admin = await fetch(`${url.replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (admin.status === 401 || admin.status === 403) {
    throw new Error("The service role key was not accepted. Copy the service_role key, not the public one.");
  }
  if (!admin.ok) {
    throw new Error(`Supabase answered ${admin.status} while checking the service role key.`);
  }
}

async function checkDatabase(databaseUrl) {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    throw new Error(`The database connection string did not work. ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkJev(apiKey) {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("The TypeSafe AI key was not accepted. Create a key at typesafe.ai and paste it again.");
  }
}

async function checkFinnhub(apiKey) {
  const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`);
  if (response.status === 401 || response.status === 403) {
    throw new Error("The Finnhub key was not accepted. You can press Enter to skip news for now.");
  }
}

async function collectKeys() {
  const refHint = "In the Supabase dashboard, open your project, then Project Settings, then API.";
  let supabaseUrl = "";
  let publishableKey = "";
  let serviceKey = "";
  let databaseUrl = "";
  for (;;) {
    try {
      supabaseUrl = await promptValue({
        title: "Step 1 of 7. Your Supabase project address",
        body: `${refHint}\nCopy the Project URL. It looks like https://something.supabase.co`,
        url: "https://supabase.com/dashboard",
        envName: "SUPABASE_URL",
      });
      publishableKey = await promptValue({
        title: "Step 2 of 7. The public Supabase key",
        body: "On that same API page, copy the publishable key (or the anon key).",
        secret: true,
        envName: "SUPABASE_PUBLISHABLE_KEY",
      });
      serviceKey = await promptValue({
        title: "Step 3 of 7. The secret Supabase key",
        body: "On that same page, copy the service_role key. This stays on your computer. Never put it in Vercel.",
        secret: true,
        envName: "SUPABASE_SERVICE_ROLE_KEY",
      });
      await checkSupabase(supabaseUrl, publishableKey, serviceKey);
      break;
    } catch (error) {
      say(error.message);
    }
  }
  const ref = projectRefFromUrl(supabaseUrl);
  const dbPage = ref
    ? `https://supabase.com/dashboard/project/${ref}/settings/database`
    : "https://supabase.com/dashboard";
  for (;;) {
    try {
      databaseUrl = await promptValue({
        title: "Step 4 of 7. The database connection string",
        body: "Open Database settings and copy the URI. Use the direct connection, or Session mode on port 5432. Not the transaction pooler on port 6543.\nReplace [YOUR-PASSWORD] with the database password you chose when you created the project.",
        url: dbPage,
        secret: true,
        envName: "SUPABASE_DB_URL",
      });
      await checkDatabase(databaseUrl);
      break;
    } catch (error) {
      say(error.message);
    }
  }
  let jevKey = "";
  for (;;) {
    try {
      jevKey = await promptValue({
        title: "Step 5 of 7. Your free TypeSafe AI key",
        body: "This powers the Jev predictions. Sign up at typesafe.ai and copy an API key.",
        url: "https://typesafe.ai",
        secret: true,
        envName: "TYPESAFE_AI_API_KEY",
      });
      await checkJev(jevKey);
      break;
    } catch (error) {
      say(error.message);
    }
  }
  let finnhubKey = "";
  for (;;) {
    try {
      finnhubKey = await promptValue({
        title: "Finnhub news key (optional)",
        body: "A free key from finnhub.io adds headlines. Press Enter to skip.",
        url: "https://finnhub.io/register",
        secret: true,
        optional: true,
        envName: "FINNHUB_API_KEY",
      });
      if (finnhubKey) await checkFinnhub(finnhubKey);
      break;
    } catch (error) {
      say(error.message);
    }
  }
  const openaiKey = await promptValue({
    title: "OpenAI key (optional)",
    body: "Used only for the written session brief on the dashboard. Press Enter to skip.",
    secret: true,
    optional: true,
    envName: "OPENAI_API_KEY",
  });
  const telegramToken = await promptValue({
    title: "Telegram bot token (optional)",
    body: "Message @BotFather, send /newbot, and paste the token. Press Enter to skip alerts.",
    secret: true,
    optional: true,
    envName: "TELEGRAM_BOT_TOKEN",
  });
  const telegramChat = telegramToken
    ? await promptValue({
        title: "Telegram chat id (optional)",
        body: "Message your new bot, then open https://api.telegram.org/bot<token>/getUpdates and copy message.chat.id.",
        optional: true,
        envName: "TELEGRAM_CHAT_ID",
      })
    : "";
  const email = await promptValue({
    title: "Step 6 of 7. Your dashboard login",
    body: "Choose the email address you will use to sign in to the dashboard.",
    envName: "DASHBOARD_OWNER_EMAIL",
  });
  const password = await promptValue({
    title: "Choose a dashboard password",
    body: "At least 8 characters. You will type this on the dashboard login page.",
    secret: true,
    envName: "DASHBOARD_OWNER_PASSWORD",
  });
  if (password.length < 8) {
    throw new Error("Use a password of at least 8 characters, then run Setup again.");
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    publishableKey,
    serviceKey,
    databaseUrl,
    jevKey,
    finnhubKey,
    openaiKey,
    telegramToken,
    telegramChat,
    email,
    password,
  };
}

function writeEnvFiles(keys) {
  const traderExample = fs.readFileSync(path.join(root, "trader", ".env.example"), "utf8");
  const dashboardExample = fs.readFileSync(path.join(root, "dashboard", ".env.example"), "utf8");
  fs.writeFileSync(
    traderEnvPath,
    fillExample(traderExample, {
      TRADING_MODE: "paper",
      LIVE_TRADING_CONFIRMATION: "",
      SUPABASE_URL: keys.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: keys.serviceKey,
      SUPABASE_DB_URL: keys.databaseUrl,
      TYPESAFE_AI_API_KEY: keys.jevKey,
      FINNHUB_API_KEY: keys.finnhubKey,
      OPENAI_API_KEY: keys.openaiKey,
      TELEGRAM_BOT_TOKEN: keys.telegramToken,
      TELEGRAM_CHAT_ID: keys.telegramChat,
      DATA_SOURCE: "ibkr",
      EXECUTION_MODE: "ibkr",
    }),
  );
  fs.writeFileSync(
    dashboardEnvPath,
    fillExample(dashboardExample, {
      NEXT_PUBLIC_SUPABASE_URL: keys.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishableKey,
      OPENAI_API_KEY: keys.openaiKey,
      DASHBOARD_IBKR_ACCOUNT_ID: "",
    }),
  );
}

async function createOwner(keys) {
  const response = await fetch(`${keys.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: keys.serviceKey,
      Authorization: `Bearer ${keys.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: keys.email,
      password: keys.password,
      email_confirm: true,
      app_metadata: { dashboard_role: "owner" },
    }),
  });
  if (response.ok) return;
  const body = await response.text();
  if (response.status === 422 && /already/i.test(body)) {
    say("That email already has a login. If you cannot sign in, reset the password in the Supabase dashboard under Authentication, then Users.");
    return;
  }
  throw new Error(`Could not create your dashboard login. ${body}`);
}

async function installDeps() {
  say("Installing the trading program. This can take a few minutes.");
  const venv = path.join(root, "trader", ".venv");
  if (!fs.existsSync(pythonBin())) {
    const python = process.platform === "win32" ? "py" : "python3.11";
    const args = process.platform === "win32" ? ["-3.11", "-m", "venv", venv] : ["-m", "venv", venv];
    await run(python, args).catch(async () => {
      await run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]);
    });
  }
  await run(pythonBin(), ["-m", "pip", "install", "--upgrade", "pip"]);
  await run(pythonBin(), ["-m", "pip", "install", "-r", path.join(root, "trader", "requirements.txt")]);
  say("Installing the dashboard program.");
  await run("npm", ["ci"], { cwd: path.join(root, "dashboard") });
  await run("npm", ["install"], { cwd: path.join(root, "setup") });
}

async function main() {
  say("Market Pilot setup. This trades a paper account only. It is not financial advice.");
  say("You can close this window and double-click Setup again. Finished steps are skipped.");
  let keys = null;
  if (!isDone("database")) {
    if (isDone("keys") && fs.existsSync(traderEnvPath)) {
      say("Your keys are already saved.");
      const { parseEnvFile } = await import("./lib.mjs");
      const saved = parseEnvFile(traderEnvPath);
      const dashboard = fs.existsSync(dashboardEnvPath) ? parseEnvFile(dashboardEnvPath) : {};
      keys = {
        supabaseUrl: saved.SUPABASE_URL,
        publishableKey: dashboard.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        serviceKey: saved.SUPABASE_SERVICE_ROLE_KEY,
        databaseUrl: saved.SUPABASE_DB_URL,
        openaiKey: saved.OPENAI_API_KEY || "",
        email: await promptValue({
          title: "Your dashboard email",
          body: "Type the email you want to use to sign in.",
          envName: "DASHBOARD_OWNER_EMAIL",
        }),
        password: await promptValue({
          title: "Your dashboard password",
          body: "At least 8 characters.",
          secret: true,
          envName: "DASHBOARD_OWNER_PASSWORD",
        }),
      };
    } else {
      keys = await collectKeys();
      writeEnvFiles(keys);
      markDone("keys");
    }
    say("Building your database.");
    await migrate(keys.databaseUrl);
    await createOwner(keys);
    markDone("database");
  }
  if (!isDone("deps")) {
    await installDeps();
    markDone("deps");
  }
  if (!isDone("vercel")) {
    const saved = keys || {
      supabaseUrl: "",
      publishableKey: "",
      openaiKey: "",
    };
    const dashboardEnv = fs.existsSync(dashboardEnvPath)
      ? (await import("./lib.mjs")).parseEnvFile(dashboardEnvPath)
      : {};
    await deployDashboard({
      supabaseUrl: saved.supabaseUrl || dashboardEnv.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: saved.publishableKey || dashboardEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      openaiKey: saved.openaiKey || dashboardEnv.OPENAI_API_KEY || "",
    });
    markDone("vercel");
  }
  say("Setup is finished. Every trading day: open IB Gateway, log in with your paper account, then double-click Start Market Pilot.");
}

main().catch((error) => {
  console.error(`\nSetup stopped.\n${error.message}`);
  process.exit(1);
});
