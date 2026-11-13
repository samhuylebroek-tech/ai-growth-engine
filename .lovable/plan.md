# AI Growth OS — Foundation Release (Phase 0–1 + core of 2–4)

The spec covers 16 phases. This plan delivers the "Initial working product" from section 24: a real, secure, multi-tenant foundation that later modules (SEO, ads, CRM, email…) plug into. Nothing is faked: unconnected integrations show "Not configured", sample data is labeled.

## What you will get

1. **Brand & site** — rename "Surge" to AI Growth OS. Calm, premium look (Linear/Stripe inspired): fewer gradients, refined typography. Public pages: Home, Pricing, Sign in.
2. **Accounts** — sign up, email verification, sign in, password reset, Google sign-in, user profile.
3. **Organizations & workspaces** — create an organization, multiple workspaces/brands per org, invite teammates, roles (Owner, Admin, Member, Viewer) enforced on the server.
4. **Onboarding wizard** — website, business description, industry, business model, products/services, audiences, markets, competitors, objectives, budget.
5. **Business profile & knowledge base** — editable profile; upload PDF/DOCX/XLSX/CSV/TXT; AI extracts key facts with sources; every fact tagged as user-provided, extracted, or AI assumption.
6. **Executive overview** — goals, open opportunities, pending approvals, AI usage. Empty states until real data exists.
7. **AI Growth Officer** — central assistant (chat panel available everywhere) that knows your organization profile and documents, answers in plain language, and proposes actions that go to Approvals instead of executing silently.
8. **Agent & capability registry** — a catalog of AI agents (Strategy, Market Research, Content, SEO…) and the capabilities each may use, with permission levels.
9. **Integration directory** — catalog of connectors (Google Analytics, Search Console, Meta Ads, HubSpot, Stripe…) all shown as "Not configured" until real credentials exist; standard connector contract ready.
10. **Extensions** — registry for enabling/disabling modules per workspace.
11. **Approval center** — review, approve, or reject AI-proposed actions with reasoning, expected impact, and risk.
12. **Usage & budget** — AI usage tracked per organization with monthly limits.
13. **Audit log & AI activity** — every sensitive action and agent run recorded.
14. **Navigation** — full 24-item sidebar from the spec; modules not yet built show a clear "Coming in phase X" page.
15. **Plans & entitlements** — configurable plans (Free/Trial, Starter, Professional, Business, Agency, Enterprise) with feature limits and AI credit allowances enforced on the server; pricing page reads from the same configuration.
16. **Usage metering & AI credits** — every AI call deducts credits; limits block overuse with a clear upgrade message.
17. **Owner control center** — internal admin area (platform owners only): organizations, plans, pricing configuration, usage, AI cost overview.
18. **Tests & docs** — tests for permissions and tenant isolation rules; ARCHITECTURE.md and roadmap.md task queue.

## Note
The new document mentions an existing GitHub repo and backend. This project has none connected, so the plan uses a fresh Lovable Cloud backend; GitHub can be connected from project settings.

## Not in this release (needs later phases or your credentials)
SEO/social/ads/CRM/email execution, live payments (Stripe checkout, VAT, dunning — architecture prepared, needs Stripe enabled), MFA, SSO/SCIM, white label, agency client management, forecasting. Integrations need your API keys per service.

## Technical details
- Enable Lovable Cloud (Postgres, auth, storage). AI via Lovable AI Gateway, behind a provider abstraction.
- Tables: profiles, organizations, organization_members (role enum, separate table), workspaces, business_profiles, business_facts (source_type), documents (storage bucket, org-scoped paths), agents, capabilities, agent_capabilities, connectors, connector_connections, extensions, workspace_extensions, approvals, ai_runs, plans, plan_entitlements, subscriptions (status only, no payments yet), credit_ledger, platform_admins (separate role table), usage_ledger, audit_logs, conversations, messages.
- RLS on all tables via security-definer `is_org_member(org, min_role)`; GRANTs per migration. Registries are code-defined (typed manifests) and synced to DB, so new agents/connectors/extensions register without touching other modules.
- Server logic via createServerFn + requireSupabaseAuth; protected app under `_authenticated/` (`/app/...`). Documents treated as untrusted input (prompt-injection guarding in AI context).
- Vitest tests for role checks, approval state machine, usage limits.

## Build order
Cloud + auth → org/workspace/roles → app shell & navigation → onboarding & profile → documents & extraction → AI assistant + usage + audit → registries & integration directory → approvals → plans/entitlements/credits → owner control center → overview → tests, docs & handover report (what works, tested, mocked, blocked).
