# AI Growth OS — Task Queue
Plan: .lovable/plan.md · Report: docs/HANDOVER.md · Status: [x] done+verified · [~] partial · [ ] open · [B] blocked

1. [x] Cloud, design tokens, public site + Pricing
2. [x] Auth (email + Google, verification, reset) + profiles
3. [x] Orgs/workspaces/members/invites + RLS helpers + audit
4. [x] RLS isolation suite (tests/sql/rls_isolation.sql) — 39/39 (2026-11-14)
5. [x] Plans/entitlements/credit ledger/metering — [x] idempotent lazy monthly grants; scheduled job not installed
6. [x] Onboarding wizard + business profile
7. [~] Documents + facts (DOCX/XLSX verified; PDF/TXT/MD/CSV existing, not retested this session)
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

## Autonomous customer release
- [x] Shared design/navigation/themes/mobile verified; public homepage redesign remains in later polish.
- [x] Website-first discovery, editable sourced suggestions and atomic confirmation verified; draft persistence remains.
- [x] DOCX/XLSX processing and upload FileList fix verified.
- [x] Verified-only context, recommendation history and conversation boundaries implemented; real chat exercised.
- [~] Lazy monthly credits and lifecycle denial verified; reservation/refund, quotas and add-ons remain.
- [x] PWA manifest/icons and private offline fallback verified; native install prompt not exercised.
- [x] Vitest 41/41, isolation 39/39, monthly 6/6; authenticated desktop/phone and docs completed.
- [B] Personal Platform Owner initialization explicitly deferred by the user.

## Blocked on you
- [B] Platform owner initialization (explicitly deferred) · [B] Real prices (D3) · [B] Stripe account (payments)
## Next customer tasks
Reservation/refund state machine; server quotas/rate limits; discovery draft persistence; full document-format/accessibility matrix; policies/module toggles; connector OAuth; public homepage polish. These remain unimplemented in this bounded session.

## Later
MFA, SSO/SCIM, account deletion, agency client orgs, growth modules (SEO, social, ads, CRM, email, revenue)
