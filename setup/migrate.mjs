import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseEnvFile, root, say } from "./lib.mjs";

const { Client } = pg;

function migrationFiles() {
  const dir = path.join(root, "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export async function migrate(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("The database connection string is missing. Run Setup again.");
  }
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("SELECT set_config('search_path', 'public, extensions', false)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set(
      (await client.query("SELECT filename FROM public.app_migrations")).rows.map((row) => row.filename),
    );
    const pending = migrationFiles().filter((name) => !applied.has(name));
    if (pending.length === 0) {
      say("Your database is already up to date.");
      return;
    }
    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(root, "supabase", "migrations", filename), "utf8");
      say(`Updating the database: ${filename}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.app_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Database update stopped on ${filename}.\n${error.message}\nNothing from that file was kept. Fix the message above, then run Setup or Update again.`,
        );
      }
    }
    const seedPath = path.join(root, "supabase", "seed.sql");
    if (fs.existsSync(seedPath)) {
      say("Adding the starting settings, if they are not there yet.");
      await client.query(fs.readFileSync(seedPath, "utf8"));
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = parseEnvFile(path.join(root, "trader", ".env"));
  migrate(process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL).catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
