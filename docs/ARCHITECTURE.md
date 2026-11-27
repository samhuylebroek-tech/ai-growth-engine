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
| Commercial | `plans`, `plan_entitlements`, `subscriptions`, `credit_ledger` (append-only), `ai_credit_reservations`, `billing_profiles`; SQL reservation/settlement/refund, balance, entitlement and owner-adjustment functions |
| Owner center | `/admin`, `src/lib/admin.functions.ts`, exact Platform Owner server guard; organization roles never imply platform roles |

## Request flow for an AI call
```text
UI → askGrowthOfficer (requireSupabaseAuth, RLS as user)
  → org/workspace member checks → entitlement and monthly-grant checks
  → reserve_ai_credits(run)  [org row lock, owner/workspace/balance check]
  → claim_ai_dispatch_verified(run) [once-only caller/role/receipt claim]
  → provider.generate()       [untrusted context quoted]
  → record_ai_delivery_verified [immutable private receipt before settlement]
  → reconcile_ai_receipt_verified [usage + ledger + reservation, atomic]
     unknown outcome retains reservation; confirmed unstarted may refund
  → atomic single request result + proposals → approvals(pending)
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

## 2026-11-15 workspace authorization
`workspace_members` records explicit assignments for non-owner organization members. `has_workspace_role` requires active organization membership, caps the assignment by the organization role and explicitly permits organization owners to administer every workspace. Existing sharing was backfilled as assignments; new invitations grant organization membership only. Removal clears all workspace assignments, so rejoining cannot revive stale access.
Restrictive RLS policies compose with existing permissive policies on workspace content, messages, usage and connector scope. Storage uses validated org/workspace paths. `confirm_business_profile` and `decide_approval` enforce workspace access despite SECURITY DEFINER execution. AI server functions check member access before provider work. `create_workspace` locks the organization, validates the active entitlement, creates the workspace/profile and audit event atomically; direct authenticated inserts are revoked. Page search uses `src/lib/navigation.ts`. Owner overview requires the exact Platform Owner role through a shared fail-closed server guard; no owner was initialized.

## 2026-11-15 credit, invitation, policy and identity completion
`ai_credit_reservations` keys one reservation per run. `reserve_ai_credits`, `settle_ai_credits` and `refund_ai_credits` serialize on the organization row; settlement inserts `ai_usage_events` and ledger changes atomically, and direct authenticated usage/reservation inserts are revoked. `create_invitation` and `accept_invitation` enforce seat quotas and confirmed matching emails without assigning workspaces. `guard_approval_proposal` and `decide_approval` enforce blocked organization policies. Microsoft managed OAuth and the dedicated custom OIDC provider are client authentication paths; SAML is unconfigured and SCIM is not implemented. See docs/ENTERPRISE_AUTH.md.

## 2026-11-16 controlled Release 0
`single_ai_requests` keys original input by user/org/workspace/request identity and atomically saves final conversations/proposals. Private receipts preserve paid text independently of final conversation persistence. Already-claimed delivery/outcome can be recorded after membership revocation only with server proof, original authenticated user/key and matching immutable run/reservation identity; no new dispatch, read, settlement or recovery authorization is granted. Current-member checks still protect reconciliation and final saving. An expired token or failed delivery transport can still prevent receipt ingestion; no worker or automatic transport replay exists. Full release/dependency target: docs/MASTER_RELEASE_MAP.md.

## Signals and interface language — 2026-11-20

- **Signals (`src/lib/signals.ts`)** — deterministic checks over the scoped business context: conflicting
  figures (initiative or goal value vs. its linked metric), completed initiatives without a measured
  outcome, missing monthly results, stale goals and website checks, overdue or stale deals, budget over
  plan or cap per currency, and metrics that beat plan two months running. Ranked by impact (×3),
  urgency (×2) and feasibility. The Command Center shows them as "Signals and next best actions" with a
  one-click hand-off to the Growth Officer; the same list goes into the Growth Officer context under
  "DETECTED SIGNALS" with its own evidence class, so the AI raises them unprompted. No AI credits.
- **Interface language (`src/lib/i18n/`)** — English, Dutch and French dictionaries; the choice is stored
  in a cookie and read on the server and in the browser, so the page language (`<html lang>`) and text
  match from the first render. Translated so far: navigation, header and menu, status labels, the
  Command Center frame and signals. Other screens still use English text and move over screen by screen.
