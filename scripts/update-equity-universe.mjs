#!/usr/bin/env node
/**
 * Build dashboard watchlist search index: S&P 500 + bundled extras (e.g. QQQ names).
 *
 * Usage (from repo root):
 *   node scripts/update-equity-universe.mjs
 *
 * Re-run when S&P 500 membership changes (~quarterly) or extras file is updated.
 * Commit dashboard/data/equity-universe.json after regenerating (Vercel build imports it).
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../dashboard/data/equity-universe.json");
const EXTRAS_PATH = join(__dirname, "../dashboard/data/equity-extras.json");
const QQQ_HOLDINGS_PATH = join(__dirname, "../dashboard/data/qqq-top-holdings.json");
const SP500_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

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

function parseSp500Csv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const symbolIdx = headers.indexOf("Symbol");
  const nameIdx = headers.indexOf("Security");
  if (symbolIdx === -1 || nameIdx === -1) {
    throw new Error(`Unexpected CSV headers: ${headers.join(", ")}`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const symbol = fields[symbolIdx]?.trim().toUpperCase();
    const name = fields[nameIdx]?.trim();
    if (!symbol || !name) continue;
    rows.push({ symbol, name });
  }
  return rows;
}

function loadJsonSymbolList(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => ({
        symbol: String(row.symbol ?? "").trim().toUpperCase(),
        name: String(row.name ?? row.symbol ?? "").trim(),
      }))
      .filter((row) => row.symbol && row.name);
  } catch {
    return [];
  }
}

function loadExtras() {
  return [...loadJsonSymbolList(EXTRAS_PATH), ...loadJsonSymbolList(QQQ_HOLDINGS_PATH)];
}

function mergeUniverse(sp500, extras) {
  const bySymbol = new Map();
  for (const entry of sp500) {
    bySymbol.set(entry.symbol, entry);
  }
  for (const entry of extras) {
    if (!bySymbol.has(entry.symbol)) {
      bySymbol.set(entry.symbol, entry);
    }
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function main() {
  console.log(`Fetching S&P 500 from ${SP500_URL}...`);
  const res = await fetch(SP500_URL);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const sp500 = parseSp500Csv(await res.text());
  if (sp500.length < 400) {
    throw new Error(`Expected ~500 S&P symbols, got ${sp500.length}`);
  }

  const extras = loadExtras();
  const merged = mergeUniverse(sp500, extras);
  const added = merged.length - sp500.length;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${merged.length} symbols (${sp500.length} S&P 500 + ${added} new from ${extras.length} extra rows) to ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
