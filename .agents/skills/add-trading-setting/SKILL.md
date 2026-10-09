---
name: add-trading-setting
description: End-to-end checklist for adding or changing a row in the Supabase settings table and wiring it through the Python trader and Next.js dashboard. Use when adding a settings column, new risk/strategy/watchlist knob, dashboard Settings field, or when min_share_price-style changes must stay in sync across trader, database, and UI.
---

# Add a trading setting

A new `settings` column touches Supabase, trader, dashboard, and often README. Missing one file causes silent wrong defaults or Vercel build failures (partial `SettingsRow` types).

## Before you start

1. Load [supabase](../supabase/SKILL.md) and [supabase-postgres-best-practices](../supabase-postgres-best-practices/SKILL.md) for schema work.
2. Read `.cursor/rules/supabase-mcp.mdc`: write the SQL as a new file under `supabase/migrations/`, then apply that same SQL on project `gbprapqifrvhylfazjvs` via Supabase MCP (`apply_migration` or `execute_sql`). Never edit a migration after it has shipped.
3. Choose column type, `NOT NULL` + `DEFAULT`, and whether the value is risk-only, strategy-only, or both.

## Checklist

Copy and track:

```text
- [ ] Supabase: new `supabase/migrations/*.sql` file, same SQL applied via MCP, verified with execute_sql
- [ ] trader/models/types.py — RiskSettings (and StrategySettings if applicable)
- [ ] trader/database/repository/_settings.py — get_risk_settings RiskSettings(...) parse (row is read with select("*"))
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

## 1. Database (migration file, then MCP)

Example pattern:

```sql
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS my_setting double precision NOT NULL DEFAULT 0;
```

Verify: `SELECT my_setting FROM settings WHERE id = 1;`

If the dashboard reads/writes this column via anon + RLS, confirm existing `settings` policies still allow authenticated updates. The column change belongs in a new migration file, applied to the live project with the same SQL.

## 2. Trader — risk settings

**`trader/models/types.py`**: add field on `RiskSettings` with the same default as SQL.

**`trader/database/repository/_settings.py`** — `get_risk_settings()`:

- The settings row is read with `select("*")`, so no select string to update. If NULL should mean "use the default", add the column to `_NULL_MEANS_UNSET`. Add the column to `FULL_ROW` in `tests/settings_row_fixtures.py` and add the parsed field to each scenario in `tests/settings_golden.json`.
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

- Column in DB but not parsed in `get_risk_settings()` → trader always uses Python default.
- Type on `Settings` but missing `normalizeSettings` default → runtime undefined or build errors.
- MCP change without a new migration file → friends' databases never get the column, and the release drift check fails.
- Editing an already-released migration instead of adding a new file → friends who already ran it stay on the old definition.
