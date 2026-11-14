# AI Growth OS — Task Queue
Plan: .lovable/plan.md · Report: docs/HANDOVER.md · Status: [x] done+verified · [~] partial · [ ] open · [B] blocked

1. [x] Cloud, design tokens, public site + Pricing
2. [x] Auth (email + Google, verification, reset) + profiles
3. [x] Orgs/workspaces/members/invites + RLS helpers + audit
4. [x] RLS isolation suite (tests/sql/rls_isolation.sql) — 33/33
5. [x] Plans/entitlements/credit ledger/metering — [ ] monthly grant job
6. [x] Onboarding wizard + business profile
7. [~] Documents + facts (PDF/TXT/MD/CSV done; Word/Excel open)
8. [x] AI provider + Growth Officer (verified end-to-end)
9. [~] Approvals done; policies UI open
10. [~] Registries + directories done; module toggles UI, connector OAuth open
11. [x] Executive overview
12. [~] Owner center (overview, plan change, credits); pricing editor UI open
13. [~] Billing profile/VAT fields done; PaymentProvider + Stripe stub open
14. [x] Docs + handover report

## Secure platform owner initialization
- [ ] Confirm the requesting user's authenticated account through preview sign-in before changing privileges.
- [ ] Add administration-only, one-time initialization with an immutable audit entry; enforce owner-only server access.
- [ ] Run initialization/permission tests and verify the confirmed user's owner-center access.

## Blocked on you
- [B] Platform owner account (D8; awaiting secure sign-in confirmation) · [B] Real prices (D3) · [B] Stripe account (payments)
## Later
MFA, SSO/SCIM, account deletion, agency client orgs, growth modules (SEO, social, ads, CRM, email, revenue)
