# Staging database — initialization record

Staging is a separate database project in EU West (Ireland), reference `tvfbvzytjpizqwixkecx`
(derived from the verified connection settings; the reference typed in earlier requests had two
transposed letters and is rejected by the guard). The live app and preview stay on the existing
Lovable Cloud database; nothing in this document touches it.

## How staging is reached

All staging work goes through `scripts/staging/*.ts` (run with `bun`). Every script:

1. validates `STAGING_DB_MIGRATION_URL` with `scripts/staging/target.ts` (must be the staging
   reference; refuses the production reference, the app's own database URL, or an app configured
   for staging) — unit tested in `src/test/staging-target.test.ts`;
2. strips inherited `PG*` variables (they point at the live database in this sandbox);
3. requires the in-database marker `ops_staging.identity` (created once by `preflight.ts`, only on an
   empty database; not in the API-exposed `public` schema).

| Script | Purpose |
| --- | --- |
| `preflight.ts` | Identity + emptiness check; creates the marker on first run only |
| `migrate.ts` | Applies the committed Drizzle journal with Drizzle's own migrator (ledger `drizzle.__drizzle_migrations`) |
| `verify-schema.ts` | Ledger/file hash comparison, RLS on every table, grants, constraints |
| `configure.ts` | Staging-only, idempotent: private buckets and the staging AI accounting verifier |
| `run-sql-tests.ts` | Runs every `tests/sql/*.sql` suite (each rolls back) and confirms no rows persisted |
| `report-privileges.ts` | Read-only report of anon-callable tables/functions |

## Results — 2026-11-18

| Step | Result |
| --- | --- |
| Preflight | PASS — staging reference, empty `public`, no ledger, 0 users, 0 buckets |
| Migrations 0000–0052 (54 files, incl. both `0043_*`) | PASS — one run, ledger 54, file hashes match |
| Re-run | PASS — no-op (ledger unchanged) |
| New forward migrations `0054_privilege_hardening`, `0055_anon_catalogue_read_only` | PASS — ledger 56 |
| Schema | 51 tables, RLS on all, every SECURITY DEFINER function pins `search_path`, signup trigger present |
| Storage | `documents` private, 20 MB, document MIME list; `execution-files` private, 10 MB (matches app limits) |
| AI accounting | Staging secret `STAGING_AI_ACCOUNTING_SECRET` (separate from live); only its SHA-256 is in the staging verifier; correct value accepted, wrong/empty rejected, not callable by app roles |
| SQL suites | 19/19 PASS (≈318 checks) incl. new `growth_plans` (42), `privilege_hardening` (7), `storage_isolation` (11); no rows persisted |

### Finding fixed by 0054/0055

Both databases grant every new `public` object to the signed-out and signed-in API roles by default.
RLS and in-function session checks already denied access (no data was exposed), but 16 tables and 18
privileged functions were technically reachable by signed-out callers, all tables allowed TRUNCATE
(which bypasses RLS) and Growth Plan tables allowed direct writes. 0054/0055 remove those privileges;
`tests/sql/privilege_hardening.sql` fails if a future table or function reintroduces them.
They are committed but **not applied to the live database** (needs owner approval, like 0043b/0046–0052).

### Staging-only configuration (not migrations)

`configure.ts` owns bucket rows and the staging verifier. If a later migration redefines
`verify_ai_accounting`, re-run `configure.ts` on staging.

## Not done / blocked

- **Staging app runtime and test sign-ins** — the preview must keep using the live backend, so a
  staging app needs separate hosting plus the staging project URL and publishable key. Staging test
  accounts and the staging Platform Owner are created through that app's sign-in, not by SQL.
- **Live database** — 10 committed migrations remain unapplied there; applying them needs explicit approval.

## Recovery

No destructive resets. A failed migration rolls back as one transaction (Drizzle wraps the batch);
fix forward with a new migration and re-run `migrate.ts`. The marker and ledger make re-runs safe.
