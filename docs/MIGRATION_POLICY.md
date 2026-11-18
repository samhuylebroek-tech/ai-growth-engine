# Database migration policy (forward-only)

Applies to every file in `drizzle/migrations/` and its journal `drizzle/migrations/meta/_journal.json`.

## Rules

1. **Forward-only.** A migration that has been committed is never edited, renamed, reordered or deleted. Corrections ship as a new, later migration.
2. **Additive first.** New tables/columns are added nullable or with a default, backfilled, and only made stricter in a later migration. Columns or tables the app stops using are marked `COMMENT ... 'DEPRECATED: …'` instead of being dropped.
3. **One journal entry per file.** Every `.sql` file has exactly one journal entry and every entry has a file. Journal `idx` is contiguous from 0 and `when` is strictly increasing, because the migrator silently skips an entry whose `when` is not greater than the newest applied `created_at`.
4. **Tenant safety in the same migration.** Every new `public` table ships with its `GRANT`s, `ENABLE ROW LEVEL SECURITY`, org/workspace policies and composite tenant foreign keys in the same file, plus a self-rolling-back SQL test under `tests/sql/`.
5. **No hand-applied production changes.** Migrations are applied only through the platform's migration tool after explicit owner approval. Data fixes go through reviewed queries, never through migrations.
6. **Types follow the schema.** `src/integrations/supabase/types.ts` is regenerated from the database. When the database lags behind committed migrations, the generated file must not silently drop tables that application code depends on (see "Current status").

## Update — 2026-11-18

Journal now has 56 entries (`idx` 0–55). Staging (see `docs/STAGING.md`) has all 56 applied and all SQL suites passing. The live database is still at 46; pending there: the 8 below plus `0054_privilege_hardening` and `0055_anon_catalogue_read_only`.

## Journal consistency check — 2026-11-17 (read-only)

| Check | Result |
| --- | --- |
| Journal entries | 54 (`idx` 0–53, contiguous) |
| SQL files | 54, every journal tag has a file and vice versa |
| `when` ordering | strictly increasing |
| Applied in the connected database | 46 (`0000` … `0045_competitor_column_grants`) |
| Pending (committed, **not applied**) | 8: `0043_atomic_growth_strategy_conversion`, `0046_link_chat_execution_to_growth_goal`, `0047_versioned_growth_plans`, `0048_growth_initiative_work`, `0049_budget_initiative_links`, `0050_growth_initiative_operations`, `0051_guard_initiative_action_json`, `0052_guard_initiative_operations` |
| Pending `when` > newest applied `created_at` | yes — they will run, in order, on the next approved migration |
| Drizzle snapshots | missing for the 8 pending entries (hand-authored); not required by the SQL migrator |
| Duplicate numeric prefix | `0043_competitor_intelligence` (applied) and `0043_atomic_growth_strategy_conversion` (pending). Harmless because Drizzle keys on the full tag; not renamed (rule 1) |

## Current status and consequence

The 8 pending migrations add versioned Growth Plans, initiatives, initiative operations, budget-to-initiative links and atomic strategy conversion. Until they are applied:

- Screens that read Growth Plans/initiatives return a "not found" error from the database.
- The AI business context marks the plan module as *unavailable* (never as empty) and continues with the other modules.
- The platform regenerates `types.ts` from the connected database, so those tables are absent from it. The Growth Plan, initiative and budget-link screens type against `src/lib/pending-schema.ts`, a compile-time extension describing exactly these 8 migrations; delete it once the generated types include them. At runtime those screens still get "not found" from the database until the changes are applied. The AI business context does not depend on those generated types.

**Applying them requires explicit owner approval**, because the only connected database also serves the published app. Recommended order: run them in a draft/isolated database first, execute `tests/sql/*.sql`, then apply to the connected database.
