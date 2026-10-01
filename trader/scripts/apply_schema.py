#!/usr/bin/env python3
"""Apply Phase 1 schema to Supabase via direct Postgres connection.

Deprecated for ongoing schema work: use Supabase MCP apply_migration on the live
project (see .cursor/rules/supabase-mcp.mdc). Keep this script for one-off local
bootstrap or disaster recovery only.

Requires in trader/.env:
  SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_DB_PASSWORD=<database password from Dashboard > Settings > Database>

Usage:
  cd trader && python scripts/apply_schema.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT.parent / "supabase" / "migrations" / "20250928000000_initial_schema.sql"


def main() -> int:
    load_dotenv(ROOT / ".env")

    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    password = os.getenv("SUPABASE_DB_PASSWORD", "")

    if not url:
        print("ERROR: SUPABASE_URL is not set in trader/.env", file=sys.stderr)
        return 1
    if not password:
        print(
            "ERROR: SUPABASE_DB_PASSWORD is not set.\n"
            "Get it from Supabase Dashboard → Project Settings → Database → Database password",
            file=sys.stderr,
        )
        return 1

    ref = url.removeprefix("https://").removesuffix(".supabase.co")
    if not MIGRATION.exists():
        print(f"ERROR: Migration file not found: {MIGRATION}", file=sys.stderr)
        return 1

    sql = MIGRATION.read_text()

    try:
        import psycopg
    except ImportError:
        print("Installing psycopg...", file=sys.stderr)
        os.system(f"{sys.executable} -m pip install psycopg[binary] -q")
        import psycopg

    conninfo = (
        f"host=db.{ref}.supabase.co port=5432 dbname=postgres user=postgres.{ref} "
        f"password={password} sslmode=require"
    )

    print(f"Connecting to db.{ref}.supabase.co ...")
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()

    print("Schema applied successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
