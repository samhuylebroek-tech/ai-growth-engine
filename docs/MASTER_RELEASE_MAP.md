# Master product architecture and dependency map

Baseline: Master Product Vision 1.0, 16 November 2026. This is the implementation target, not a completion claim. Actual existing routes, registries, AI server functions, migrations and tests were inspected. Historical delivery reports are evidence pointers, not fresh test results.

## Architecture boundaries

| Layer | Existing foundation | Expansion contract |
| --- | --- | --- |
| Identity/tenancy | Organizations, explicit workspace assignments, separate platform roles, restrictive RLS | Every new workspace record has immutable organization/workspace identity; personal records add author/ACL checks |
| Business intelligence | Profiles, confirmed sourced facts, private documents, bounded web discovery | Source versions, review/expiry, categorized knowledge and bounded explicit source selection; semantic retrieval only with measured relevance |
| AI | Metered server wrapper, private dispatch receipts, single request ledger, two-specialist/synthesis coordination | Domain schemas/manifests, bounded request claims, provenance; never recursive dispatch or unmetered calls |
| Execution | Projects/tasks/campaigns, typed notes, scoped links, conversion/recurrence RPCs | Content/SEO/CRM recommendations link through typed source references and explicit user conversion |
| Governance | Pending action proposals, blocked capability policies, immutable audit | Content/action approval binds exact version and execution parameters; any material change invalidates it |
| Measurement | AI usage, credit ledger and estimated provider costs | KPI definitions and dated source-backed measurements; business metrics separate from platform usage |
| Commercial | Plans, entitlements, subscriptions, seats/workspace quotas | Brands/agency/client ACLs, configurable entitlements, test billing; live payments still unauthorized |
| Integrations | Code manifests, honest unconfigured states | OAuth/scopes/private credentials, verified connections, sync receipts, revoke/disconnect; no implied connections |

Shared page metadata and light/dark semantic tokens remain authoritative. Compact navigation exposes only operational destinations; contextual tabs reuse the navigation manifest. No twenty-agent menu or generic mock dashboard.

## Dependency graph

```text
R0 reliability/security/performance
  -> R1 approved source intelligence
      -> R2 authorized writing identities + versioned Content Studio
          -> R3 campaign/editorial recurrence + exact-version approvals
      -> R4 measured SEO + competitor findings -> R2 briefs / R3 plans
      -> R5 CRM/sales/customer records -> execution tasks / campaigns
R0 + governance + R2/R3/R5 -> R6 workflow engine + authorized workers
R1 + real integrations + R3/R4/R5 -> R7 measurements / executive reporting
R7 + evidence-backed opportunities -> R8 scenarios / CRO / growth intelligence
R0 + tested cross-client ACLs + entitlements -> R9 commercial / agency
```

Releases can share stable contracts; do not introduce duplicate project, campaign, approval, user or organization models. Staged expansion is additive. No release is done without persistence, auth, error recovery, module links, executed tests and responsive workflows.

## Controlled release scope and exit gates

| Release | Deliverable | Current state / required gate |
| --- | --- | --- |
| 0 | Reliable existing AI, receipts, recovery, idempotency, concurrency/revocation, integrity, server pagination and design foundation | Partial. Fresh 136 regression tests pass. Revoked delivery preservation and shared active-dispatch serialization implemented; expired-auth transport, complete concurrent matrix and server pagination remain |
| 1 | Onboarding, discovery, approved knowledge, file processing, retrieval and context | Partial existing implementation. Full format/hostile-input matrix, source versions/expiry and retrieval evaluation remain |
| 2 | Writing profiles/samples, approved style analysis, source-selected generation, rich editor/autosave/version compare/restore, quality/library | Not started as a dedicated operational module. Content specialist is not Content Studio |
| 3 | Campaign strategy/content, editorial calendar, recurrence, exact-version approval, social/email planning | Campaign execution foundation exists; content/editorial lifecycle not started. Each occurrence gets independent content/version/approval |
| 4 | Robots/ownership-aware bounded SEO crawl, keywords, real Search Console, competitor registry/reporting | SEO/research prompt specialists exist; measured SEO and competitor workspace not started |
| 5 | Contacts/companies/leads/deals/follow-ups, relationship/customer intelligence, sales specialist | Not started; private contact fields and cross-workspace FK/ACL matrix required |
| 6 | Internal workflow triggers/conditions/actions, worker claims/retries/leases/cancellation, notifications/policy | Notifications/execution exist; durable workers/workflow builder not started. Deployed scheduling must be authorized and tested |
| 7 | KPI definitions, real integrations/history, business analytics/revenue/executive reporting/health | AI usage and evidence-only command center exist; business measurement layer not started |
| 8 | Evidence-backed opportunity ranking, transparent simulator, CRO/website/brand/financial scenarios | Recommendations/conversion exist; dedicated scenario/opportunity/experiment lifecycle not started |
| 9 | Brand/client/agency views, usage intelligence, enterprise readiness and integration marketplace foundation | Tenant quotas/auth foundation exists; agency/brands not started, external providers require configuration |

## Whole-product coverage register

- **Implemented, partially reverified:** authentication, organizations/workspaces, explicit assignments, onboarding, fact confirmation, documents/discovery, Growth Officer, four specialists, bounded team analysis, AI credits/receipts, private conversations, scoped record search, projects/tasks/campaigns, conversion, in-app notifications, activity, general action approvals, command center preferences and scoped summaries. Fresh regression execution is reported per delivery; not every historic browser flow was rerun.
- **Partial:** complete request reliability/security matrix, public website discovery depth, document lifecycle coverage, knowledge retrieval, large-workspace performance/server pagination, team/account lifecycle, plan/usage administration and integration abstraction.
- **Not started:** dedicated Writing Profiles/Content Studio/Library, exact content-version approvals/editorial recurrence/calendar, measured SEO/keyword workspace, competitor registry, internal CRM/sales/customer intelligence, marketing/social/email/advertising operating workspaces, CRO/experiments, revenue records/scenarios, opportunities/health modules beyond actual execution signals, workflow builder/worker, business KPI/reporting/executive briefings, multi-brand/agency UI.
- **External configuration/deployment dependent:** real data integration OAuth and verified synchronization; actual workers/schedulers; enterprise provider rollout. None is represented as connected/deployed without tests.
- **Explicitly unauthorized:** owner initialization/elevation, live payments, production deployment, live customer changes, advertising, outbound messages, social/content publication, automatic recurring publication, irreversible production deletion and unconfigured SSO.

## Current reliability design decision

Dispatch authorization happens before inference through a role-checked immutable receipt claim. A completion write can preserve only that existing run's delivery/outcome with server accounting proof, matching requester identity and dispatch key, plus run/workspace/org/reservation consistency. It returns no private data and grants no read, role, new dispatch, settlement or final-content access. Reads/final saving/recovery still require current member permission. After revocation, paid text can be retained privately while its credit reservation remains open pending authorized reconciliation.

This is not unattended recovery and not permission restoration. Unknown provider execution is never replayed/refunded automatically. A response that fails to reach durable storage still needs investigation; local claims do not prove provider exactly-once semantics.

## Security/performance exit evidence

Use ASVS 5.0 L2 and NIST SSDF as review baselines, not certification claims. Require RLS/grants/RPC negative tests; hostile upload parsing; revoked access; duplicate/active-concurrent dispatch; immutable receipts/tenant links; retention/privacy review; auth/account recovery; browser keyboard/mobile/tablet; server-bounded paginated queries and measured aggregate performance. Each integration requires real authorization and source readback. Synthetic metrics remain test-only and clearly marked.

## Next vertical slices

1. R0 shared active-dispatch serialization and bounded diagnostics delivered; next test cross-user simultaneous claims/revocation and expired-auth delivery, then server pagination.
2. R1 source-version/review and selected-source intelligence, not all-context injection.
3. R2 authorized personal/shared writing profiles and one complete source-selected versioned editing/generation workflow.
4. R3 campaign-linked editorial recurrence and version/channel/account/time approval; external publication disabled until separately authorized.

Progress and executed evidence are tracked in `roadmap.md` and per-release reports. No background work continues after a development turn ends.
## SEO website check — 2026-11-16
Status: TESTED. Deterministic public-page checks (no AI, no estimates), insert-only seo_audits, finding-to-task. Keywords/Search Console: NOT STARTED (needs connection).
