---
name: add-trading-setting
description: End-to-end checklist for adding or changing a row in the Supabase settings table and wiring it through the Python trader and Next.js dashboard. Use when adding a settings column, new risk/strategy/watchlist knob, dashboard Settings field, or when min_share_price-style changes must stay in sync across trader, database, and UI.
---

# Add a trading setting

A new `settings` column touches Supabase, trader, dashboard, and often README. Missing one file causes silent wrong defaults or Vercel build failures (partial `SettingsRow` types).

## Before you start

1. Load [supabase](../supabase/SKILL.md) and [supabase-postgres-best-practices](../supabase-postgres-best-practices/SKILL.md) for schema work.
2. Read `.cursor/rules/supabase-mcp.mdc`: apply schema on project `gbprapqifrvhylfazjvs` via Supabase MCP (`apply_migration` or `execute_sql`). **Do not** add new files under `supabase/migrations/` for production schema.
3. Choose column type, `NOT NULL` + `DEFAULT`, and whether the value is risk-only, strategy-only, or both.

## Checklist

Copy and track:

```text
- [ ] Supabase: column added with DEFAULT (MCP), verified with execute_sql
- [ ] trader/models/types.py — RiskSettings (and StrategySettings if applicable)
- [ ] trader/database/supabase.py — get_risk_settings select string + RiskSettings(...) parse
- [ ] trader/strategy/config.py — StrategyConfig + strategy_config_with_risk_overrides (if strategy-facing)
- [ ] trader/config.py — strategy_* field + strategy_config() mapping (if env-tunable)
- [ ] trader/.env.example — commented STRATEGY_* (if env-tunable)
- [ ] dashboard/lib/types/database.ts — Settings type
- [ ] dashboard/lib/normalize-settings.ts — SettingsRow Omit/Partial + normalizeSettings default
- [ ] dashboard/lib/validate-settings.ts — labelFor, ParsedSettings, parse
- [ ] dashboard/components/settings-form.tsx — form field + save payload
- [ ] dashboard/lib/actions.ts — update path if not using generic settings update
- [ ] README.md — settings or strategy table row
- [ ] Tests: trader and/or dashboard as appropriate
- [ ] preflight-checks skill
```

## 1. Database (MCP)

Example pattern:

```sql
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS my_setting double precision NOT NULL DEFAULT 0;
```

Verify: `SELECT my_setting FROM settings WHERE id = 1;`

If the dashboard reads/writes this column via anon + RLS, confirm existing `settings` policies still allow authenticated updates (no new migration file in repo).

## 2. Trader — risk settings

**`trader/models/types.py`**: add field on `RiskSettings` with the same default as SQL.

**`trader/database/supabase.py`** — `get_risk_settings()`:

- Append the column name to the `.select(...)` string (hand-maintained; omitted columns never load from DB).
- Map `data.get("column_name", default)` in the `RiskSettings(...)` constructor.

Trader reloads risk settings each cycle; no process restart required for values already in Supabase (see project rule: do not restart the trader yourself).

## 3. Trader — strategy overlay

If the dashboard setting overrides env-based strategy:

- Add field on `StrategyConfig` in `trader/strategy/config.py`.
- Extend `strategy_config_with_risk_overrides()` when the value comes from `RiskSettings` / Supabase.

If devs tune via env without Supabase:

- Add `strategy_my_setting` on `Settings` in `trader/config.py`.
- Map in `strategy_config()` property.
- Document in `trader/.env.example` as `# STRATEGY_MY_SETTING=...`.

## 4. Dashboard (all four layers)

Older rows may lack the column; TypeScript must tolerate partial selects.

| File | What to add |
|------|-------------|
| `dashboard/lib/types/database.ts` | Property on `Settings` |
| `dashboard/lib/normalize-settings.ts` | Add to `SettingsRow` `Omit`/`Partial<Pick<>>` if optional on read; `?? default` in `normalizeSettings` |
| `dashboard/lib/validate-settings.ts` | `labelFor`, `ParsedSettings`, parsing from `FormData` |
| `dashboard/components/settings-form.tsx` | Input + initial value from normalized settings |

Run `npm run build` in `dashboard/` — this catches incomplete `SettingsRow` typing.

## 5. README

Update the Phase 3 risk table or Strategy filters table in root `README.md` when the setting is user-visible.

## 6. Finish

Run the **preflight-checks** skill (`trader` pytest + `dashboard` test, lint, build).

## Common mistakes

- Column in DB but not in `get_risk_settings()` select → trader always uses Python default.
- Type on `Settings` but missing `normalizeSettings` default → runtime undefined or build errors.
- New migration file in repo instead of MCP → conflicts with team rule and live schema source of truth.
