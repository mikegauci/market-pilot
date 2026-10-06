#!/usr/bin/env node
/**
 * @deprecated Use scripts/update-equity-universe.mjs (S&P 500 + equity-extras.json).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "update-equity-universe.mjs");
const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
process.exit(result.status ?? 1);
