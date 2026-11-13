# AI Growth OS — Foundation Release: Final Implementation Plan

This plan combines all three documents (master spec v1, enterprise/commercial spec v2, review brief). It covers the Foundation Release. Later modules (SEO, social, ads, CRM, email, forecasting) plug into it. Nothing is implemented yet. Build starts only after you approve.

---

## 0. Findings from the specification review

Conflicts and gaps, and how this plan resolves each one:

| # | Issue | Resolution |
|---|---|---|
| 1 | Spec v2 says "use the existing GitHub repo and configured backend". This project has neither. | Use a new Lovable Cloud backend. You connect GitHub in project settings (decision D1). |
| 2 | The 24-item navigation conflicts with "calm, minimal UX". | Group it into 6 sections. Modules that aren't built yet are hidden behind a "Coming soon" catalog, not shown as dead links. |
| 3 | "Agents execute actions" vs "never fake integrations". | Agents can only read data and propose actions. Every external write goes through Approvals and a connector that is actually connected. |
| 4 | Usage-based billing and credits are specified, but live payments are forbidden. | Build a real internal ledger, plans and entitlements. Stripe is behind a payment-provider interface with no live keys. VAT fields are stored but not calculated. |
| 5 | MFA, SSO/SCIM, white label and agency reseller are required, but there's no infrastructure for them. | The schema includes the fields and hooks. The features are marked "Planned". MFA (TOTP) is included if the auth provider supports it (verified at build time). |
| 6 | "Customer profitability and margin" needs actual AI cost per call. | Every AI call writes provider, model, tokens and estimated cost to `ai_usage_events`. Margin = plan revenue (configured price) − AI cost − allocated platform cost. Labeled "estimated" until Stripe is live. |
| 7 | Documents are untrusted input (prompt injection). | Extracted text is wrapped as quoted data in the AI context. Agents can't call tools based on document content without policy checks. |
| 8 | Platform owner vs customer admin roles could be mixed up. | They use separate role tables: `platform_roles` (owner, support, finance) vs `organization_members.role`. They never mix. |
| 9 | "Real database-level security tests". | Use SQL-level RLS tests that run as different users (tenant A vs B). They run in CI scripts against the Cloud database, alongside Vitest unit tests. |
| 10 | Industry independence vs fixed metrics. | Industries, business models and metric definitions are configuration tables, not code. |

---

## 1. Architecture and module boundaries

```text
Public site ── Auth ── App shell (/app)
                         │
  ┌──────────────┬───────┴────────┬──────────────┬──────────────┐
Identity &     Business         AI Orchestration  Commercial    Platform Admin
Tenancy        Intelligence     (Growth Officer)  (plans,       (owner control
(orgs, ws,     (onboarding,     agents, runs,     entitlements, center)
roles, audit)  profile, docs,   policies)         credits,
               facts)                             usage, billing)
                         │
          Registries: Agents · Capabilities · Connectors · Extensions
```

Module rules:
- Each module lives in `src/modules/<name>/` with `*.functions.ts` (server functions), `schema.ts` (zod contracts), `ui/`, and `manifest.ts`.
- Modules talk to each other only through exported contracts, never through each other's tables.
- **Registries are code-first manifests** (typed `defineAgent`, `defineCapability`, `defineConnector`, `defineExtension`), synced to the DB on deploy. Adding a capability = one new manifest file.
- **Capability** = one unit of work that an agent or the UI can run: input/output schema, required permission, risk level (read / write-internal / write-external), credit cost, and whether approval is needed.
- **Connector contract**: `auth` (oauth/apikey/none), `capabilities[]`, `healthCheck()`, `status` (not_configured / connected / error). The directory shows real status only.
- **AI provider abstraction**: `AIProvider` interface. Lovable AI Gateway is the first implementation. Cost-aware model routing (cheap model for classification, stronger model for strategy).
- **Orchestrator guards**: max delegation depth 3, max tool calls per run, credit pre-check, per-run timeout, policy check before each capability.

Tech: TanStack Start, server functions with `requireSupabaseAuth`, Postgres with RLS, private storage bucket, Lovable AI Gateway. No microservices.

---

## 2. Database schema (initial)

Identity and tenancy
- `profiles` (user_id PK→auth.users, display_name, avatar_url, locale)
- `organizations` (id, name, slug, type: business|agency|enterprise, parent_org_id nullable for agency clients, status: active|suspended, created_by)
- `organization_members` (org_id, user_id, role enum owner|admin|member|viewer, status)
- `invitations` (org_id, email, role, token_hash, expires_at, accepted_at)
- `workspaces` (id, org_id, name, kind: brand|website|business_unit)
- `platform_roles` (user_id, role enum platform_owner|support|finance)
- `audit_logs` (id, org_id nullable, actor_id, action, target_type, target_id, metadata jsonb, ip, created_at) — append-only

Business intelligence
- `industries`, `business_models` (configuration tables)
- `business_profiles` (workspace_id, website, description, industry_id, model_id, markets[], objectives jsonb, budget)
- `offerings` (products/services), `audiences`, `competitors`
- `documents` (workspace_id, storage_path, mime, size, version, status: uploaded|processing|ready|failed, retention_until)
- `business_facts` (workspace_id, key, value, source_type: user|document|website|ai_assumption|external, source_ref, confidence, verified_by)
- `intelligence_snapshots` (workspace_id, data jsonb, created_at)

AI
- `agents`, `capabilities`, `agent_capabilities` (synced from manifests)
- `conversations`, `messages`
- `agent_runs` (org_id, workspace_id, agent_key, status, input, output, parent_run_id, depth)
- `ai_usage_events` (org_id, run_id, provider, model, input_tokens, output_tokens, cost_estimate_eur, credits_charged)
- `approvals` (org_id, workspace_id, run_id, capability_key, payload, reasoning, expected_impact, risk, status: pending|approved|rejected|executed|failed|expired, decided_by, decided_at, result)
- `policies` (org_id, capability_key, mode: auto|approval|blocked)

Registries
- `connectors` (key, name, category, auth_type, manifest jsonb)
- `connector_connections` (org_id, workspace_id, connector_key, status, secret_ref — secrets never stored in plain text)
- `extensions`, `workspace_extensions` (enabled, config)

Commercial
- `plans` (key, name, tier, price_monthly_eur, price_yearly_eur, currency, is_public, active)
- `plan_entitlements` (plan_key, feature_key, limit_value, period)
- `add_ons` (key, price, entitlement deltas)
- `subscriptions` (org_id, plan_key, status: trialing|active|past_due|canceled, billing_cycle, trial_ends_at, provider, provider_ref nullable)
- `subscription_add_ons`
- `credit_ledger` (org_id, delta, reason: plan_grant|usage|purchase|adjustment, ref, balance_after) — append-only
- `usage_counters` (org_id, feature_key, period_start, used)
- `billing_profiles` (org_id, legal_name, country, vat_id, vat_validated, address)
- `invoices` (structure only; filled in when Stripe goes live)
- `platform_cost_allocations` (month, category, amount)

All tables: `created_at`, `updated_at`; org-scoped FKs with `ON DELETE CASCADE`, except audit and ledger tables (retained).

---

## 3. Security and authorization model

- **Tenant isolation**: every tenant row has `org_id`. RLS uses security-definer helpers `is_org_member(org)`, `has_org_role(org, min_role)`, `is_platform_role(role)`. Explicit GRANTs in every migration. No anonymous access except public plans.
- **Server-side enforcement**: every server function verifies session → membership → permission → resource ownership. The UI only hides controls.
- **Permission matrix**: Owner (everything, billing, delete org) · Admin (members, integrations, policies) · Member (use AI, edit profile, propose) · Viewer (read only). Approvals need Admin or higher, unless the policy says otherwise.
- **OWASP coverage**: injection (parameterized queries, zod validation), broken access control (RLS + tests), auth (provider-managed sessions, password-leak check, email verification), sensitive data (private bucket, signed URLs ≤10 min, secrets only in Cloud secrets), SSRF (website-fetch allowlist: http/https only, private IP ranges blocked, size/time limits), file uploads (mime and size allowlist, 20 MB limit, no execution), prompt injection (quoted untrusted content, capability policy gate), logging (audit for auth, roles, approvals, billing, exports), rate limits on AI and invites.
- **Audit**: append-only, readable only by org admins and platform owners.
- **Deletion**: org deletion is a soft-delete with a 30-day grace period. Hard deletion is a separate, explicit job (not run in this release).

---

## 4. Commercial and revenue architecture

- **Plans** (configurable, prices are placeholders until D3): Free/Trial, Starter, Professional, Business, Agency, Enterprise, Custom.
- **Entitlements**: feature flags and limits (workspaces, seats, documents, monthly AI credits, agents, connectors, approval automation). A single `checkEntitlement(org, feature)` server helper runs at every gate.
- **AI credits**: monthly grant per plan plus add-on packs. Each capability declares a credit cost. The orchestrator pre-checks, reserves, then settles credits against actual tokens. Balance comes from the ledger, never from a mutable counter.
- **Usage metering**: `usage_counters` per feature per period. Overage behavior per plan: block, or allow-and-bill (stored for later).
- **Add-ons**: extra seats, workspaces, credit packs, premium agents.
- **Trial engine**: 14-day trial (D4). Trial status, days left, upgrade prompts at limits.
- **Agency/reseller**: agency orgs own client orgs (`parent_org_id`). Wholesale pricing fields stored. Client billing goes through the agency.
- **Billing provider interface**: `PaymentProvider` with `createCheckout`, `changePlan`, `cancel` and `handleWebhook`. A **NullProvider** is active and Stripe is stubbed. Dunning states are modeled in `subscriptions.status`.
- **EU VAT**: billing profile stores country, VAT ID and reverse-charge flag. VIES validation and tax calculation are deferred to Stripe Tax at go-live.
- **Profitability**: per org per month = configured plan revenue − AI cost (`ai_usage_events`) − allocated platform cost. Labeled "estimated".

---

## 5. Platform owner control center (`/admin`, platform roles only)

- Commercial overview: orgs by plan, trials, conversions, estimated MRR (labeled as configured, not collected)
- Subscription management: change plan, extend trial, grant credits (all audited)
- Pricing management: edit plans, entitlements and add-ons (versioned)
- AI cost and margin: cost per org, model mix, top consumers
- Customer lifecycle: signups, activation (onboarding done), at-risk orgs (inactive, near limits)
- Platform cost allocations input

---

## 6. UX system

- Calm, premium, Linear/Stripe-inspired look. The dark theme from the existing site is refined: fewer gradients, Syne headings, Plus Jakarta body text, dense but airy tables.
- Navigation groups: **Home** (Overview, Growth Officer) · **Grow** (Strategy, Opportunities, Market research) · **Know** (Business profile, Documents, Intelligence) · **Operate** (Approvals, AI activity, Automation) · **Connect** (Integrations, Extensions) · **Settings** (Organization, Members, Plan & usage, Security). Modules that aren't built yet appear in a "Modules" catalog with their status.
- The Growth Officer is a persistent side panel (⌘K) that knows the current page.
- Every AI answer shows its sources, and a fact/assumption badge where relevant.
- Status chips everywhere: Implemented · Connected · Not configured · Simulated · Planned.

---

## 7. Phased implementation (dependencies)

```text
P1 Foundation ─► P2 Tenancy ─► P3 Business intel ─► P4 AI core ─► P6 Approvals
                     │                                  │
                     └────────► P5 Commercial ◄─────────┘ (credits gate AI)
P4 + P5 ─► P7 Registries/Connectors ─► P8 Owner center ─► P9 Hardening & handover
```

1. **P1 Foundation**: Cloud, design system, public site (Home, Pricing, Security, Sign in), auth (email + Google, verification, reset), profiles, app shell.
2. **P2 Tenancy**: orgs, workspaces, members, invites, roles, RLS helpers, audit log, org switcher.
3. **P3 Business intelligence**: onboarding wizard, profile, offerings/audiences/competitors, document upload and parsing, fact extraction with source types, website analysis (SSRF-safe).
4. **P4 AI core**: provider abstraction, orchestrator, Growth Officer chat (streaming), agent runs, usage events.
5. **P5 Commercial**: plans, entitlements, credit ledger, usage counters, trial, Plan & usage page, provider interface (Null and Stripe stub), billing profile.
6. **P6 Approvals & policies**: approval center, policy settings, execution audit.
7. **P7 Registries**: agent, capability, connector and extension manifests plus directory UIs. Two reference connectors: "Website" (works) and "Google Analytics" (contract only, not configured).
8. **P8 Owner control center**.
9. **P9 Hardening**: security scan, RLS test suite, performance pass, docs, handover report.

---

## 8. Testing and acceptance criteria

Automated:
- **RLS isolation suite**: users in org A get 0 rows from org B on every tenant table, for select, insert, update and delete. A viewer can't write. A non-admin can't approve. A non-platform user can't read `/admin` data.
- **Unit (Vitest)**: role permission matrix, entitlement checks, credit reservation/settlement math, approval state machine (no illegal transitions), orchestrator depth/tool limits, SSRF URL validator, upload validator.
- **Integration**: server functions reject unauthenticated or cross-tenant calls.
- **E2E (Playwright)**: sign up → create org → onboarding → upload doc → ask the Growth Officer → proposal appears in Approvals → approve → audit entry exists.

Acceptance (per phase): builds clean · tests pass · security scan has no critical/high findings · empty, loading and error states present · works at 375px and 1440px · docs updated.

---

## 9. Documentation and handover

- `README.md`, `AGENTS.md` (architecture rules), `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATA_MODEL.md`, `docs/EXTENDING.md` (how to add an agent, capability, connector or extension), `docs/COMMERCIAL.md`, `docs/STATUS.md` (implemented / tested / mocked / blocked / planned).
- `roadmap.md` as the persistent task queue.
- Handover report after each session covering all 16 points from spec v2 §23.

---

## 10. Prioritized task queue

1. Enable Cloud; design tokens; public site + Pricing (reads plans)
2. Auth + profiles + verification + reset + Google
3. Orgs/workspaces/members/invites + RLS helpers + audit
4. RLS isolation test harness (written early, extended every phase)
5. Plans/entitlements/credit ledger (needed before AI)
6. Onboarding wizard + business profile
7. Document upload + parsing + facts
8. AI provider + orchestrator + Growth Officer
9. Approvals + policies
10. Registries + integration directory + extensions
11. Executive overview
12. Owner control center
13. Stripe provider stub + billing profile/VAT fields
14. Hardening, docs, handover report

---

## 11. Remaining decisions (needed before or during build)

- **D1** GitHub: connect your repository now, or later?
- **D2** Brand: keep the name "AI Growth OS" on the public site, and the current dark green/lime style?
- **D3** Plan prices and credit allowances per tier (placeholders otherwise, clearly labeled).
- **D4** Trial length and whether a card is needed (default: 14 days, no card).
- **D5** Sign-in methods: email + Google (default). Add Apple or Microsoft?
- **D6** Default approval policy: everything external needs approval (default), or allow auto for low-risk actions?
- **D7** Data residency: EU-only hosting requirement?
- **D8** Who are the platform owners (your account email)?

## Explicitly out of scope for this release
Live payments, Stripe activation, outbound emails or messages to third parties, production deployment, SSO/SCIM, white label, SEO/social/ads/CRM/email execution, forecasting.
