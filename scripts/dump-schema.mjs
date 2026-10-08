import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = createRequire(path.join(root, "setup", "package.json"))("pg");

function databaseUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const envPath = path.join(root, "trader", ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (line.startsWith("SUPABASE_DB_URL=")) return line.slice("SUPABASE_DB_URL=".length).trim().replace(/^"|"$/g, "");
  }
  return "";
}

function migrationText() {
  const dir = path.join(root, "supabase", "migrations");
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort().map((name) => fs.readFileSync(path.join(dir, name), "utf8")).join("\n");
}

function namesInSql(sql, pattern) {
  return new Set([...sql.matchAll(pattern)].map((match) => match[1]));
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error("Set SUPABASE_DB_URL to your database connection string to run the drift check.");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const tables = await client.query(`
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY 1, a.attnum
    `);
    const functions = await client.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    `);
    const sql = migrationText();
    const fileTables = namesInSql(sql, /CREATE TABLE(?: IF NOT EXISTS)? public\.([a-z0-9_]+)/g);
    const fileFunctions = namesInSql(sql, /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g);
    const problems = [];
    const liveTables = new Set(tables.rows.map((row) => row.table_name));
    for (const name of liveTables) {
      if (!fileTables.has(name)) problems.push(`Live table ${name} is not in supabase/migrations.`);
    }
    for (const name of fileTables) {
      if (!liveTables.has(name)) problems.push(`Migration table ${name} is not in the live database.`);
    }
    for (const row of tables.rows) {
      if (!fileTables.has(row.table_name)) continue;
      const block = sql.split(`CREATE TABLE`).find((part) => part.includes(`public.${row.table_name} (`));
      if (block && !block.slice(0, block.indexOf(");")).includes(row.column_name)) {
        problems.push(`Live column ${row.table_name}.${row.column_name} was not found in its migration.`);
      }
    }
    const liveFunctions = new Set(functions.rows.map((row) => row.proname));
    for (const name of liveFunctions) {
      if (!fileFunctions.has(name)) problems.push(`Live function ${name} is not in supabase/migrations.`);
    }
    for (const name of fileFunctions) {
      if (!liveFunctions.has(name)) problems.push(`Migration function ${name} is not in the live database.`);
    }
    const dump = spawnSync("pg_dump", [
      "--schema-only",
      "--schema=public",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      url,
    ], { encoding: "utf8" });
    if (dump.status === 0) {
      const out = path.join(root, "setup", ".schema-dump.sql");
      fs.writeFileSync(out, dump.stdout);
      console.log(`Wrote ${out}`);
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log(`Drift check passed (${liveTables.size} tables, ${liveFunctions.size} functions).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
