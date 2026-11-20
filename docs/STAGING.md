# Staging database — initialization record

Staging is a separate database project in EU West (Ireland), reference `tvfbvzytjpizqwixkecx`
(derived from the verified connection settings and explicitly confirmed by the owner on 2026-11-19). The live app and preview stay on the existing
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

Staging test accounts (owner, admin, member, viewer, outsider; two organizations) were created by
`seed-users.ts`; passwords are random, stored only in a restricted sandbox file and never printed.
The staging Platform Owner is assigned only through the one-time initialization (below). `seed-growth.ts` adds one QA goal, strategy, approved plan and two
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
the live database. Schema work that still needs owner approval is therefore kept in `docs/proposals/`,
first verified with `scripts/staging/try-proposal.ts` (one always-rolled-back transaction), then applied
to staging only with `scripts/staging/apply-proposal.ts`, which records name + SHA-256 in
`ops_staging.applied_proposals`. Proposals are idempotent, so the later official migration can run on
staging again. The Drizzle ledger stays at 57. `run-sql-tests.ts` also runs `tests/proposals/<name>.test.sql`
for every applied proposal.

| Proposal | What it does | Staging |
| --- | --- | --- |
| `0057_read_only_integration_imports` | Browser sessions can no longer mark a source "connected"; imported results only through a server-attested function, only for a connected source in the same workspace; re-syncs become corrections | Applied; 17/17 |
| `0058_platform_owner_initialization` | One-time Platform Owner initialization; audit log append-only for every role; owner role cannot be inserted, changed or removed outside the procedure | Applied; 20/20 |
| `0059_connector_credentials_and_imports` | Credentials encrypted in Vault, readable only server-side; connection health (connected / access expired / missing permission / error); import runs with unique request keys and history; disconnect removes the credential but keeps history | Applied; 28/28 |

## Platform Owner initialization (staging) — 2026-11-19

**Before:** `seed-users.ts` had inserted the Platform Owner role directly (database administrator),
with one audit row without actor (`method: scripts/staging/seed-users.ts`). Nothing referenced the
role row; no request/confirmation step existed and the audit log could still be changed by the
database owner. That did not match the agreed procedure.

**Repair (staging only, `scripts/staging/owner-init.ts`):**
1. `retire-direct` — checked that no table depends on `platform_roles`, wrote an audit row
   `platform_owner.retired_for_formal_initialization` (reason + reference to the original row), then
   removed the directly inserted role. The original audit row is kept.
2. Applied proposal 0058.
3. `run` — signed in as the designated staging owner account; `request_platform_owner_initialization()`
   took the identity from the session only (user id + confirmed email) and granted nothing.
4. The script compared that identity with the designated account, then completed the initialization
   as controlled administration (`complete_platform_owner_initialization`, database owner only, never
   callable from an app session) with the confirmed id and email.

**Result:** one Platform Owner, one immutable initialization record, audit trail
`initialized (original) → retired_for_formal_initialization → initialization_requested → initialized`.
Re-initialization, self-promotion, role changes and audit edits are refused (tested, including as
organization owner/admin and as database owner). Owner center opens for the Platform Owner only;
organization admins, members, viewers and outsiders see "Platform Owner access required".

**For live (needs approval):** apply 0058, the person signs in and calls step 1 (identity shown back
for confirmation), then step 2 is run once by controlled administration with the confirmed id + email.

## Read-only connections (staging) — 2026-11-19

Server functions in `src/lib/integrations.functions.ts`; provider calls in `src/lib/integrations/`:
- Stripe: restricted keys only (`rk_…`; full secret keys refused), checked with one read-only call.
- HubSpot: private app token (`pat-…`), checked with one read-only deal search; without deal read
  permission the source is stored as "missing permission" and imports are refused.
- Google Analytics / Search Console: OAuth with read-only scopes, signed short-lived state bound to the
  signed-in user; return page `/app/integrations/google`. Needs `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET` and `INTEGRATIONS_STATE_SECRET`; without them the page says
  "not configured".
- Imports: last 1–12 complete months, into the workspace's own metrics with the same key, unit and
  currency ("Track" creates them); deterministic request keys per run/metric/month; 401 → access
  expired, 403 → missing permission; every run is kept with counts and errors.

No real account was connected. The error path was tested with a deliberately invalid, well-formed
Stripe test key: one read-only request to Stripe was refused, the source showed "Access expired" with
the reason, the run was saved as failed and nothing was imported. The key was then disconnected
(Vault secret removed). A successful import with real provider data was **not** tested (no accounts).

## Re-test on the latest code — 2026-11-19

| Check | Result |
| --- | --- |
| Journey: new goal → AI strategy → Growth Plan draft → approval → work from initiative → owner/metric/status → task done → metric linked to goal + initiative → result → Growth Officer (Dutch) → two approval proposals | PASS |
| Growth Officer after completing the initiative: compared the initiative's 62 with the metric's 46, flagged the open task, made no causal claim, proposed two actions for approval | PASS |
| Roles (owner, admin, member, viewer, outsider) on Home, Performance, Data sources, Owner center: edit/connect/import controls by role; outsider sees only its own organization | PASS |
| Desktop light and 390 px phone dark for every role on Home, Performance, Data sources, Goals, Growth Officer: no horizontal scroll, no console errors | PASS |
| SQL suites incl. proposals | 23/23 PASS, nothing persisted |

**Cleanup:** the QA Stripe connection was disconnected, the two test proposals rejected, the journey
goal and its metric archived. Insert-only history (plan versions, initiatives, measurements, audit
rows, import runs) stays by design; it is staging test data in the staging organizations only.

## Environment guard — 2026-11-20

Every request runs `checkRuntimeEnvironment` (`src/lib/environment.ts`). With `APP_ENVIRONMENT=staging`
it refuses to serve (HTTP 503, names only in the server log) when: the backend URL or project id is not
`tvfbvzytjpizqwixkecx`, any setting mentions the production project, a service-role key is present, the
publishable key or accounting secret is missing, or the browser and server labels differ. With
`APP_ENVIRONMENT=production` any reference to the staging project is refused. When no environment is
declared (the platform preview and live app) nothing changes. `scripts/staging/app.ts` runs the same
check before starting. Staging pages carry `X-Robots-Tag: noindex, nofollow`, a robots meta tag and a
visible "Staging" label in the header.

## Reachable staging URL — prepared, needs one Cloudflare token

Plan: a dedicated Worker (e.g. `ai-growth-staging`) on `*.workers.dev` or a staging hostname, built with
the allowlisted environment from `app-env.ts`, behind a Cloudflare Access application that allows only
named email addresses. Minimum token permissions:

| Permission | Why |
| --- | --- |
| Account · Workers Scripts · Edit | upload the staging Worker and its environment |
| Account · Access: Apps and Policies · Edit | create the Access application and the allow-list policy |
| Zone · Workers Routes · Edit (only for a custom staging hostname on your zone) | bind the hostname to the Worker |

Also needed: the Cloudflare account ID and the email addresses that may open staging. Not needed: DNS
edit for other records, billing, or any production Worker permission.

## Phase 8 — organization growth intelligence (staging) — 2026-11-20

Proposal `0070_organization_growth_intelligence` (applied to staging only; 78/78 rolled-back assertions, every refusal checked to be a deliberate one): organization strategies (versioned drafts, admin approval), cross-business opportunities, shared initiatives with one commitment per business, resource proposals (budget shift / specialist cap) and the metered organization AI request. Drizzle ledger still 57; all 33 SQL suites pass with no rows persisted.

| Check (staging app, real sign-ins) | Result |
| --- | --- |
| Owner: all six organization tabs render, no console errors | PASS |
| Track detected opportunity → validate → propose initiative → approve per business → project + task created inside each business → history shows every step | PASS |
| Organization Growth Officer (real AI call): structured draft strategy with priorities per business, collaboration, resources, risks | PASS |
| Member with one business: single-business view, only Overview and Resources | PASS |
| Dutch phone (390 px) and French desktop, context switcher with organization / business / brand | PASS |

## Phase 8.2 — evidence governance & quality (staging) — 2026-11-20

Proposal `0073_evidence_governance` (staging only; 53/53 rolled-back assertions; Drizzle ledger still 57; all
37 SQL suites pass, nothing persisted). Evidence items have six types (verified fact, measured observation,
estimate, assumption, hypothesis, missing information); facts/measurements must point at a real record of the
same business; AI-origin evidence is never a fact and never counts as independent. Evidence is versioned and
insert-only with an event history. Improvement proposals have three levels: observation (never work), formal
(accepted independent evidence or a stated reason, plus a review) and execution (adds objective, risk,
measurement and approval requirement, and needs a fact or measurement). An administrator approves only with the
exact list of evidence IDs shown on screen.

| Check (staging app, real sign-ins) | Result |
| --- | --- |
| Admin EN: create formal proposal → approve disabled → add measurement evidence → accept → review → approve → reload; evidence becomes "used in a decision" | PASS |
| Member NL phone: sees the proposal, no approve button; viewer FR: no approve button | PASS |
| Tab titles EN/NL/FR on every page; approvals, activity, notifications, documents, growth areas, specialists in NL/FR | PASS |
| 16 main pages as owner (EN desktop) and viewer (NL phone): no errors, no horizontal scroll | PASS |

## Not done / blocked

- **Reachable staging URL** — needs the token above. Until then staging runs only inside the build sandbox.
- **Live database** — 11 committed migrations (0043b, 0046–0052, 0054–0056) and proposals 0057–0059 need
  explicit approval. Until then the live app shows "not switched on" for Performance, Growth Plans and
  read-only connections.
- **Real integrations** — the owner's own read-only credentials (Stripe restricted key, HubSpot private
  app token) and, for Google, an OAuth client plus `APP_PUBLIC_ORIGINS`; connecting them needs separate permission.

## Recovery

No destructive resets. A failed migration rolls back as one transaction (Drizzle wraps the batch);
fix forward with a new migration and re-run `migrate.ts`. The marker and ledger make re-runs safe.
