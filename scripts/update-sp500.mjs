#!/usr/bin/env node
/**
 * Refresh S&P 500 constituent list for the dashboard watchlist picker.
 *
 * Usage (from repo root):
 *   node scripts/update-sp500.mjs
 *
 * Re-run manually when S&P 500 membership changes (~quarterly).
 * Source: https://github.com/datasets/s-and-p-500-companies
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../dashboard/data/sp500.json");
const SOURCE_URL =
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

function parseCsv(text) {
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

async function main() {
  console.log(`Fetching S&P 500 constituents from ${SOURCE_URL}...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const constituents = parseCsv(text).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  if (constituents.length < 400) {
    throw new Error(`Expected ~500 constituents, got ${constituents.length}`);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(constituents, null, 2)}\n`, "utf8");
  console.log(`Wrote ${constituents.length} symbols to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
