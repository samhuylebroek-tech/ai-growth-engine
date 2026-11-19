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
| New forward migration `0056_performance_measurements` | PASS — ledger 57 |
| Schema | 51 tables, RLS on all, every SECURITY DEFINER function pins `search_path`, signup trigger present |
| Storage | `documents` private, 20 MB, document MIME list; `execution-files` private, 10 MB (matches app limits) |
| AI accounting | Staging secret `STAGING_AI_ACCOUNTING_SECRET` (separate from live); only its SHA-256 is in the staging verifier; correct value accepted, wrong/empty rejected, not callable by app roles |
| SQL suites | 20/20 PASS (364 checks) incl. new `growth_plans` (42), `privilege_hardening` (7), `storage_isolation` (11), `performance_measurements` (39); no rows persisted |

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

## Staging app (sandbox-local) — 2026-11-19

`scripts/staging/app.ts` starts a separate copy of the app on `127.0.0.1:8091` inside the build
sandbox only. Its environment is built by `scripts/staging/app-env.ts` from an allowlist (staging
project URL, publishable key and accounting proof only; no live database URLs, service keys or `PG*`),
unit tested in `src/test/staging-app-env.test.ts`. Before starting it checks that the publishable key
is accepted by the staging sign-in service and rejected by the live one. The platform preview and the
published app are unchanged and keep using the live backend. This is not public hosting.

Staging test accounts (owner, admin, member, viewer, outsider; two organizations) and one staging
Platform Owner were created by `seed-users.ts`; passwords are random, stored only in a restricted
sandbox file and never printed. `seed-growth.ts` adds one QA goal, strategy, approved plan and two
initiatives through the app's own functions.

| Check (staging app, real sign-ins) | Result |
| --- | --- |
| Performance: create metrics, plan/forecast/entered values, duplicate refused, correction keeps history, filters, detail page, desktop + 390 px phone | PASS |
| Performance roles: viewer reads without edit controls; outsider sees nothing | PASS |
| Growth Officer (Dutch, real AI call): cites entered results as not verified, keeps forecast separate from plan, refuses to invent conversion rate | PASS |
| Home: performance overview, linked metrics under the primary goal, behind-plan attention item, budget per currency; light desktop + dark phone, no console errors | PASS |
| Integrations page: read-only connectors show "Not configured", what they would import and what they need | PASS |
| SQL suites after this work | 20/20 PASS, no rows persisted, ledger still 57 |

## Proposed schema changes (not migrations yet)

New migration files can only be created by the platform migration tool, which also applies them to
the live database. Schema work that still needs owner approval is therefore kept in `docs/proposals/`
and verified on staging with `scripts/staging/try-proposal.ts`, inside one transaction that always
rolls back (staging schema and ledger stay as the journal describes).

| Proposal | Staging check |
| --- | --- |
| `0057_read_only_integration_imports` — browser sessions can no longer mark integrations "connected"; imported results only via a server-attested function, only for a connected integration in the same workspace, re-syncs become corrections | PASS 17/17, nothing persisted |

## Not done / blocked

- **Staging project reference** — the verified connection belongs to `tvfbvzytjpizqwixkecx`. The
  references typed in requests (`tvfbvzytjzipqzwikxecx`, `tvfbvzytjzipqzwixkecx`) differ from it and
  from each other; the owner must confirm the verified reference is the intended staging project.
- **Public staging hosting** — the staging app runs only inside the build sandbox.
- **Live database** — 11 committed migrations remain unapplied there (0043b, 0046–0052, 0054–0056); applying them needs explicit approval. Until then the Performance page and Growth Plans show a "not switched on" note.
- **Real integrations** — reading GA4, Search Console, Stripe or HubSpot needs the owner's accounts and read-only credentials, plus applying proposal 0057.

## Recovery

No destructive resets. A failed migration rolls back as one transaction (Drizzle wraps the batch);
fix forward with a new migration and re-run `migrate.ts`. The marker and ledger make re-runs safe.
