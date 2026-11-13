# Handover report — 2026-11-13 (session 1)

Status legend: **Verified** = exercised end-to-end this session · **Implemented** = built, not fully exercised · **Planned** = not built.

## 1. What was implemented
- Public site: home, pricing (reads live plan data), sign in / sign up / reset password, Google sign-in.
- Organizations, workspaces, members, roles, invitation links, org switcher, audit log.
- Onboarding wizard (business, offer, goals) with optional website analysis.
- Business profile + knowledge base with source labels and verify/delete.
- Document upload (private storage) + AI fact extraction for PDF/TXT/MD/CSV.
- AI Growth Officer chat with conversation history, grounded in profile + facts, proposals sent to Approvals.
- Approval center (admin decides, audited), AI activity + audit views.
- Agents, capabilities, integrations directory, modules catalog (code registries).
- Plans, entitlements, trial (14 days, 200 credits), credit ledger, metering per AI call with € cost estimate.
- Plan & usage page, billing details (VAT stored only).
- Owner control center: orgs, configured MRR, AI cost, margin, manual plan change, credit adjustments.

## 2. Works end-to-end (Verified, browser test with a test account)
Create organization → onboarding → ask Growth Officer (real AI answer) → 1 proposal created → approved → audit entry written → 3 credits deducted, usage event recorded (€0.018 est.).

## 3. Tests
- Database RLS isolation suite: **33/33 pass** (cross-tenant read/write, viewer limits, self-promotion, credit abuse, platform-role self-grant, anon access).
- Unit tests: **31/31 pass**.
- Typecheck: clean. Security scan: 1 finding (public plan entitlements readable) — tightened to public plans only; intentional for the pricing page.

## 4. Incomplete / not built
MFA, SSO/SCIM, account deletion, session revocation; Word/Excel reading; policy editor UI (table exists); per-workspace module toggles UI; connector OAuth flows; usage-period reset job (monthly credit grant); invitation emails; owner pricing editor UI (plans editable by platform owner via DB policy, no UI yet); agency client-org management; all growth modules (SEO, social, ads, CRM, email, revenue).

## 5. Mocked or simulated
Nothing is simulated in the UI. Integrations other than Website/Documents are shown as "Not configured". MRR is "configured" (plan price), not collected revenue. AI cost is an estimate from list rates.

## 6. Needs your input
- **D3** real plan prices and credit allowances (current values are placeholders).
- **D8** your account email to make you platform owner (no one has owner-center access yet).
- **D1** GitHub connection (project settings).
- D4/D5/D6/D7 from the plan (trial terms, extra sign-in methods, approval defaults, EU-only hosting).
- Stripe account when you want payments switched on.

## 7. Database migration status
6 migrations applied to the development database (schema, function hardening, storage policies, anon revoke, co-member profiles, entitlement policy). One internal test account exists: `qa-owner@aigrowthos.test` with org "QA Bakery Co".

## 8. AI provider
Lovable AI Gateway, model `openai/gpt-6-astra`, behind the `AIProvider` interface. Working.

## 9. Billing infrastructure
No payment provider active. No charges possible. Subscription status, billing cycle and VAT fields exist for a future Stripe integration.

## 10. Next tasks (priority order)
1. Make you platform owner (needs D8) and set real prices (D3).
2. Monthly credit grant / period reset (scheduled job).
3. Policy settings UI + per-workspace module toggles.
4. Account deletion, MFA, HIBP check.
5. Stripe provider behind a PaymentProvider interface (test mode only).
6. Word/Excel extraction.
7. Agency client organizations.
8. First growth module (Strategy & Opportunities).
