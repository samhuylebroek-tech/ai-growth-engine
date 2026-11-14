# Architecture

TanStack Start (React 19, SSR on Cloudflare Workers) + Lovable Cloud (Postgres, Auth, Storage) + Lovable AI Gateway.

## Layers
| Layer | Where |
|---|---|
| Identity & tenancy | `organizations`, `organization_members` (role enum), `workspaces`, `invitations`, `platform_roles`, `audit_logs`; SQL helpers `has_org_role`, `is_org_member`, `is_platform_staff` |
| Business intelligence | `business_profiles`, `business_facts` (source_type), `documents` + private `documents` bucket (`{org}/{workspace}/{uuid}-{name}`) |
| AI orchestration | `src/lib/ai.functions.ts` (server functions), `src/lib/ai/provider.server.ts` (provider abstraction), `agent_runs`, `ai_usage_events`, `conversations`, `messages` |
| Registries | Code-first manifests in `src/lib/registry/` (agents, capabilities, connectors, extensions) |
| Approvals | `approvals`, `policies`, SQL `decide_approval` (pending → approved/rejected only, admin+) |
| Commercial | `plans`, `plan_entitlements`, `subscriptions`, `credit_ledger` (append-only), `billing_profiles`; SQL `consume_credits`, `credit_balance`, `org_entitlement`, `admin_grant_credits` |
| Owner center | `/admin`, `src/lib/admin.functions.ts`, reads via platform-staff RLS policies |

## Request flow for an AI call
```text
UI → askGrowthOfficer (requireSupabaseAuth, RLS as user)
  → has_org_role(member) → entitlement check (plan_entitlements)
  → consume_credits(reserve)  [row lock on org, balance check]
  → provider.generate()       [untrusted context quoted]
  → settle extra credits → ai_usage_events (tokens, € estimate)
  → proposals → approvals(pending)  [only registered capability keys]
```

## Key decisions
- All tenant writes run as the user under RLS; no service-role key is used anywhere in app code.
- Privileged state changes (org creation, credits, approval decisions, invite acceptance, audit) are SECURITY DEFINER SQL functions with explicit checks.
- Registries live in code, not the DB: adding an agent/capability/connector/extension is one manifest entry. `defineCapability` refuses external writes without approval.
- Payments: no provider is active. Plan changes are manual by platform owners and audited.

## 2026-11-14 additions
Discovery validation lives in src/lib/discovery.ts; discoverBusiness is authenticated and uses existing meteredGenerate. Office parser is dynamically imported inside document extraction; fflate and fast-xml-parser are bundled dependencies, with no filesystem/runtime asset loading.
confirm_business_profile provides one role-checked SQL transaction for confirmation and audit. Workspace associations are immutable via triggers. ensure_monthly_credit_grant performs lazy, lock-serialized grants with a partial unique organization/month ledger index; no idle scheduler required.
Leaf metadata uses pageHead. Shared semantic light/dark tokens remain in styles.css. Service worker intercepts only same-origin GET navigations, falling back to one cached static page on network failure; never caches successful tenant responses.
