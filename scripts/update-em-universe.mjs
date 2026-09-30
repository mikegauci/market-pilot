#!/usr/bin/env node
/**
 * Sync US-listed EM equities from EEM + IEMG ETF holdings into Supabase.
 *
 * Usage (from repo root):
 *   node scripts/update-em-universe.mjs
 *
 * Requires trader/.env (or env) with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Re-run weekly — index rebalances are quarterly, not intraday.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MAX_SYMBOLS = 80;
const SOURCE_LABEL = "eem+iemg";

const ETF_SOURCES = [
  {
    etf: "EEM",
    url: "https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf/latest-holdings.csv",
  },
  {
    etf: "IEMG",
    url: "https://www.blackrock.com/us/financial-professionals/products/244050/ishares-core-msci-emerging-markets-etf/latest-holdings.csv",
  },
];

const US_EXCHANGES = new Set([
  "NYSE",
  "NASDAQ",
  "NYSE ARCA",
  "ARCA",
  "BATS",
  "AMEX",
  "NYSE MKT",
  "NYSE American",
]);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function normalizeTicker(raw) {
  return raw.trim().toUpperCase().replace(/\*/g, "");
}

const KNOWN_EM_ETF_SYMBOLS = new Set([
  "EEM",
  "VWO",
  "IEMG",
  "SCHE",
  "EMXC",
  "FXI",
  "MCHI",
  "KWEB",
  "INDA",
  "EPI",
  "EWZ",
  "EWY",
  "EWJ",
  "EWT",
  "EWH",
  "EWS",
  "EIDO",
  "EPHE",
  "THD",
  "EWW",
  "ECH",
  "ARGT",
  "AAXJ",
  "EEMA",
  "FEM",
  "GEM",
  "DGS",
  "SPEM",
]);

function inferInstrumentType(symbol, name = "") {
  const key = String(symbol || "")
    .trim()
    .toUpperCase();
  const upperName = String(name || "").toUpperCase();
  if (KNOWN_EM_ETF_SYMBOLS.has(key) || /\bETF\b|EXCHANGE[\s-]?TRADED/.test(upperName)) {
    return "etf";
  }
  if (
    /ADR|ADS|AMERICAN DEPOSIT|DEPOSITARY|DEPOSITORY|\bGDR\b/.test(upperName)
  ) {
    return "adr";
  }
  return "stock";
}

function isUsListedEquity(fields, headers) {
  const idx = (name) => headers.indexOf(name);
  const ticker = normalizeTicker(fields[idx("Ticker")] ?? "");
  const rowType = fields[idx("Type")]?.trim();
  const assetClass = fields[idx("Asset Class")]?.trim();
  const exchange = fields[idx("Exchange")]?.trim().toUpperCase();
  const marketCurrency = fields[idx("Market Currency")]?.trim();
  const fxRate = parseFloat((fields[idx("FX Rate")] ?? "0").replace(/,/g, ""));
  const name = fields[idx("Name")]?.trim() ?? "";

  if (!ticker || rowType !== "EQUITY" || assetClass !== "Equity") {
    return null;
  }
  if (!US_EXCHANGES.has(exchange) && !(marketCurrency === "USD" && fxRate === 1)) {
    return null;
  }
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
    return null;
  }

  const instrumentType = inferInstrumentType(ticker, name);
  // Never sync broad EM / country ETFs into the single-name universe.
  if (instrumentType === "etf") {
    return null;
  }

  const weight = parseFloat((fields[idx("Weight (%)")] ?? "0").replace(/,/g, ""));
  return {
    symbol: ticker,
    name,
    country: fields[idx("Location")]?.trim() || null,
    weight: Number.isFinite(weight) ? weight : 0,
    instrument_type: instrumentType,
  };
}

function parseHoldingsCsv(text, etf) {
  const lines = text.trim().split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.startsWith("Ticker,"));
  if (headerIdx === -1) {
    throw new Error(`Could not find holdings header row for ${etf}`);
  }

  const headers = parseCsvLine(lines[headerIdx]);
  const merged = new Map();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = isUsListedEquity(fields, headers);
    if (!row) continue;

    const existing = merged.get(row.symbol) ?? {
      symbol: row.symbol,
      name: row.name,
      country: row.country,
      source_etfs: [],
      weight: 0,
      instrument_type: row.instrument_type,
    };

    if (!existing.source_etfs.includes(etf)) {
      existing.source_etfs.push(etf);
    }
    existing.weight = Math.max(existing.weight, row.weight);
    if (!existing.name && row.name) {
      existing.name = row.name;
    }
    if (!existing.country && row.country) {
      existing.country = row.country;
    }
    merged.set(row.symbol, existing);
  }

  return merged;
}

async function fetchHoldings(source) {
  console.log(`Fetching ${source.etf} holdings...`);
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`${source.etf} fetch failed: ${res.status} ${res.statusText}`);
  }
  return parseHoldingsCsv(await res.text(), source.etf);
}

function mergeHoldings(maps) {
  const merged = new Map();
  for (const holdings of maps) {
    for (const [symbol, row] of holdings) {
      const existing = merged.get(symbol);
      if (!existing) {
        merged.set(symbol, { ...row, source_etfs: [...row.source_etfs] });
        continue;
      }
      for (const etf of row.source_etfs) {
        if (!existing.source_etfs.includes(etf)) {
          existing.source_etfs.push(etf);
        }
      }
      existing.weight = Math.max(existing.weight, row.weight);
      if (!existing.name && row.name) existing.name = row.name;
      if (!existing.country && row.country) existing.country = row.country;
      if (!existing.instrument_type && row.instrument_type) {
        existing.instrument_type = row.instrument_type;
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_SYMBOLS);
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest(baseUrl, serviceRoleKey, path, init) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: supabaseHeaders(serviceRoleKey, init.headers),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function upsertUniverse(baseUrl, serviceRoleKey, rows, syncedAt) {
  const payload = rows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    source_etfs: row.source_etfs,
    weight_bps: Math.round(row.weight * 100),
    country: row.country,
    instrument_type: row.instrument_type || inferInstrumentType(row.symbol, row.name),
    // Do not set tradable here — verify/backfill owns that flag. Writing true
    // would re-enable chronically untradable / KID-blocked names on every sync.
    updated_at: syncedAt,
  })).filter((row) => row.instrument_type !== "etf");

  if (!payload.length) {
    throw new Error("No ADR/stock rows left after ETF filter — refusing empty upsert");
  }

  await supabaseRequest(baseUrl, serviceRoleKey, "/rest/v1/em_universe?on_conflict=symbol", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });

  const symbols = payload.map((row) => row.symbol);
  const inList = symbols.map((symbol) => encodeURIComponent(`"${symbol}"`)).join(",");
  await supabaseRequest(
    baseUrl,
    serviceRoleKey,
    `/rest/v1/em_universe?symbol=not.in.(${inList})`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );

  await supabaseRequest(baseUrl, serviceRoleKey, "/rest/v1/settings?id=eq.1", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      em_universe_synced_at: syncedAt,
      em_universe_source: SOURCE_LABEL,
      updated_at: syncedAt,
    }),
  });
}

async function main() {
  loadEnvFile(join(REPO_ROOT, "trader", ".env"));
  loadEnvFile(join(REPO_ROOT, ".env"));

  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (trader/.env)");
  }

  const holdingsMaps = await Promise.all(ETF_SOURCES.map(fetchHoldings));
  const ranked = mergeHoldings(holdingsMaps);
  if (!ranked.length) {
    throw new Error("No US-listed EM equities found in EEM/IEMG holdings");
  }

  const syncedAt = new Date().toISOString();
  await upsertUniverse(baseUrl, serviceRoleKey, ranked, syncedAt);

  console.log(
    `Synced ${ranked.length} symbol(s) to em_universe (${SOURCE_LABEL}) at ${syncedAt}`,
  );
  console.log(`Top holdings: ${ranked.slice(0, 10).map((row) => row.symbol).join(", ")}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
