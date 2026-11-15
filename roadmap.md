# AI Growth OS — Task Queue
## Overnight expansion — 2026-11-15
- [x] P0: Baseline 96 tests, 39 tenant RLS checks and 30 execution SQL checks passed; working execution preserved.
- [~] P1: Silent execution limits removed with scoped ID keysets, five indexes and 50-row list display; 3,507-row synthetic traversal tested. Server-filtered bounded queries and snapshot consistency remain next-stage performance work.
- [x] P1: Explicit selection of at most 12 authorized operational records for AI; refetched as caller, quoted as untrusted, denied/revoked reads fail closed.
- [x] P1: Central derived in-app notifications and device-local read state; supported asynchronous architecture documented, not activated.
- [x] P2: Four independent single-call specialist analyses, validated structured results, metering, private saved conversations, download and existing review-to-work action.
- [x] Signed-in Content, Strategy, Research, SEO and Growth Officer selected-context replies; notification read/reload; phone layouts; 119 automated tests. Report: docs/OVERNIGHT_EXPANSION.md.
- [B] Unattended scheduling depends on a verified reachable deployed callback; no publishing is authorized.
- [B] External integrations, outbound delivery, payments, owner setup and SSO activation remain deferred.
- [~] Future expansion outside this bounded delivery: dedicated versioned content library, measured SEO audits, CRM, automation, BI, integrations, agency and retrieval; not started here.

## Phase 1 — Business execution layer
- [x] Secure workspace-scoped projects, tasks, campaigns, assignments, dependencies, comments, files and immutable activity.
- [x] Shared work views and details: list, Kanban, calendar, timeline, filters and personal deadlines.
- [x] Editable, atomic and idempotent Growth Officer conversions with source relationships.
- [x] Real Home priorities, attention, active work, upcoming deadlines and notifications.
- [x] Vitest, rollback-only SQL/RLS checks, signed-in desktop/mobile journeys and factual delivery report.
- [~] Large-workspace pagination and full concurrent/multi-account browser matrix remain unverified; unattended agents, scheduling and external execution are not part of this internal release. Report: docs/PHASE_1_EXECUTION.md.
## Ultimate homescreen — delivered available-data experience 2026-11-15
- [x] Unified scoped activity stream/history, active AI work, attention, results and honest unavailable scheduling/performance states.
- [x] Global context/actions/attention access and user-scoped section order, visibility and density preferences.
- [x] Signed-in detail navigation, real AI question/result readback, org switching, preference reload and desktop/tablet/phone; 83 tests passed. Report: docs/HOMESCREEN.md.
- [~] Projects/tasks/campaign planning and calendars delivered in Phase 1; connected analytics and full concurrent/multi-account browser matrix remain unavailable or unverified.

## Complete product remake — delivered frontend, 2026-11-15
- [x] Replace tool-first navigation with six primary destinations, contextual tabs and shared search.
- [x] Rebuild Home around verified intelligence, priorities, scoped Growth Officer question and display preferences.
- [x] Redesign existing conversations/export, growth directories, knowledge, sources, activity, settings and onboarding presentation.
- [x] Verify real signed-in AI/result readback/export, organization draft reset, private document lifecycle and 13 phone pages; automated regressions passed.
- [x] Record actual changes, evidence and unfinished definition-of-done journeys in docs/PRODUCT_REMAKE.md.
- [~] Complete same-organization multi-workspace and multi-account/signup/approval/extraction browser matrix; structured editable results and specialist coordination are not implemented.
- [B] Owner setup, payments, publishing, external campaigns and unapproved SSO activation remain deferred.

## Foundation completion, workspace authorization and enterprise authentication — active 2026-11-15
- [~] Re-audit workspace authorization and complete the remaining customer journey, including invitations, roles and account lifecycle.
- [x] Add atomic AI credit reservation, settlement/refund and regression tests; rate/concurrency limits and hard cost pre-budgeting remain open.
- [~] Microsoft sign-in enabled and OIDC path added; external-account sign-in, organization-specific mapping and SAML/SCIM remain unverified or unconfigured.
- [~] Fold the final quality directive's customer, SAML, workflow, agent and integration requirements into the current foundation work.
- [x] Re-run 59 automated and 119 database checks plus signed-in browser verification; update handover with exact evidence and remaining limits.
- [B] Personal Platform Owner initialization, live payments, production publishing and real external marketing actions remain explicitly deferred.
- [B] Controlled SAML configuration was declined; no SAML provider was configured or activated, and no SAML success is claimed.

## Ultimate product completion — active 2026-11-15
- [x] Refine shell, collapsible navigation, global page search and evidence-based overview.
- [x] Explicit workspace access assignments, database/storage authorization and adversarial tests.
- [~] Atomic workspace creation and owner-managed access UI implemented; scoped approvals/activity improved. Multi-user assignment UI, invitations and full lifecycle verification remain.
- [x] Signed-in desktop/tablet/phone navigation, saved knowledge → real AI → history readback, regression suites and handover.
- [ ] Complete remaining customer, commercial, enterprise, connector and agent phases after core verification.
- [B] Personal owner initialization, payments, outbound communications and publishing are explicitly deferred.

Plan: .lovable/plan.md · Report: docs/HANDOVER.md · Status: [x] done+verified · [~] partial · [ ] open · [B] blocked

1. [x] Cloud, design tokens, public site + Pricing
2. [x] Auth (email + Google, verification, reset) + profiles
3. [x] Orgs/workspaces/members/invites + RLS helpers + audit
4. [x] RLS isolation suite (tests/sql/rls_isolation.sql) — 39/39 (2026-11-14)
5. [x] Plans/entitlements/credit ledger/metering — [x] idempotent lazy monthly grants; scheduled job not installed
6. [x] Onboarding wizard + business profile
7. [~] Documents + facts (DOCX/XLSX verified; PDF/TXT/MD/CSV existing, not retested this session)
8. [x] AI provider + Growth Officer (verified end-to-end)
9. [x] Approvals and enforced organization policies done; automatic external execution remains unavailable
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
- [~] Lazy monthly credits, reservation/settlement/refund and seat/workspace quotas verified; rate limits, hard cost pre-budgeting and add-ons remain.
- [x] PWA manifest/icons and private offline fallback verified; native install prompt not exercised.
- [x] Vitest 41/41, isolation 39/39, monthly 6/6; authenticated desktop/phone and docs completed.
- [B] Personal Platform Owner initialization explicitly deferred by the user.

## Blocked on you
- [B] Platform owner initialization (explicitly deferred) · [B] Real prices (D3) · [B] Stripe account (payments)
## Next customer tasks
Rate/concurrency limits and hard cost pre-budgeting; discovery draft persistence; full document-format/accessibility matrix; module toggles; connector OAuth; public homepage polish. Credit reservation/refund and approval policies are now implemented and verified.

## Later
MFA, SSO/SCIM, account deletion, agency client orgs, growth modules (SEO, social, ads, CRM, email, revenue)

## Critical context isolation and customer completion
- [x] Harden scoped AI readers, verified-only evidence, message/run/document/profile identity and local workspace remounts.
- [x] Adversarial tests: Vitest 50/50; SQL isolation 39/39, context 13/13, monthly 6/6.
- [~] Real website → confirmation → reload → real chat; TXT/CSV/PDF extraction and byte-identical downloads; existing DOCX/XLSX download/readback, Word re-extraction. Fresh Excel extraction and post-save inline edit still need verification.
- [x] Eight customer phone pages checked without horizontal overflow; document download, confirmation and loading/error/retry repaired.
- [x] Handover records root causes, exact changes/evidence, test fixture effects and limitations.
- [x] Explicit workspace membership/ACL model, restrictive content/storage authorization and owner-managed assignments implemented (2026-11-15).
- [~] Storage-policy read/upload authorization suite passed; successful Storage API deletion lifecycle, canonical fact conflict resolution, persistent discovery drafts and full document hostile-input checks remain.
- [~] Atomic credits/refunds, seat quotas and approval policies verified; server rate limits, account lifecycle and connector completion remain.
- [B] Owner initialization, live payments and deployment remain explicitly deferred.
