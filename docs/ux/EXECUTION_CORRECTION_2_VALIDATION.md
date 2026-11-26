# Execution correction 2 — evidence and remaining gates

## Environment and original commit
- Authorized feature branch: `product/operating-system-experience-blueprint`.
- Original local commit `3acf535d2d4cb4971a63f17a69217ca99d5df88e` was also GitHub branch HEAD at the start; clean worktree.
- Its CI: unit tests, production build, dependency audit and secret scan passed; ESLint failed on six Prettier errors. These formatting errors are corrected in this round.
- Existing isolated staging target and in-database marker verified through the guarded staging connection; production database untouched.

## Implemented source, not an operational lead-intake release
- Public `/enquire/$formKey` page, SSR-safe form configuration read, EN/NL/FR language selector and per-business copy.
- Visible labeled inputs, required consent, privacy notice, honeypot, server-owned sessions and minimum-time gate, loading/error/confirmed-success states.
- Identical transport retries retain their request key and exact displayed consent/privacy snapshot. An uncertain transport result is never described as definitely unsaved.
- Narrow publishable-key SQL RPC transport; all new lead operations refuse non-staging environments. No service-role client or accounting-secret reuse.
- Proposal 0093: isolated form association, bounded sessions and submissions, server-side time checks, normalized daily duplicate policy, immutable consent/source snapshots, serialized CRM email matching across forms and other CRM writers, preservation of original contact source, qualification decisions and once-only internal follow-up task creation.
- Private lead inbox, form settings, consent/source details, contextual Growth Officer handoff, qualification and internal task controls use one scoped store.
- No owner notifications, external emails, marketing messages, provider writes or payments are enabled.

### Storage blocker
The available platform migration tool targets the connected production backend and has no authorized staging target parameter. It was not called. Higher-priority migration rules prohibit applying schema through a shell substitute. Consequently **proposal 0093 is not applied to either database**. Its new SQL test suite is **pending and not executed**. Offline PostgreSQL parsing accepts its 61 statements, but does not establish PL/pgSQL behavior, RLS, concurrency or complete lead delivery. The public page correctly reports unavailable rather than accepting an enquiry that would go nowhere.

**Lead intake is NOT complete. No submission has been demonstrated to persist and read back into CRM.** Required gate: apply through an authorized staging-targeted migration tool, run the new SQL suite and concurrency checks, configure a real staging business form, submit through the browser, read the immutable submission and CRM contact back, record qualification and reopen the resulting task.

## UX source changes
- Four primary domains: Overview & Growth Officer, Campaigns & Execution, Leads & Customers, Business Impact & Performance.
- Contextual groups retain all previous URLs and capabilities; strategy, business knowledge, SEO, competitors, content, finance and integrations are discoverable. Settings are separate, not hidden.
- CRM starts with open sales, supports closed/all filters and accent-insensitive customer/source search; creation controls disclose labeled forms instead of occupying the first screen permanently. Lead inbox and CRM have reciprocal links.
- Shared mobile drawer isolates background focus, traps keyboard focus while open, and restores focus; hidden drawer links are inert. Tab arrows are named keyboard-accessible design-system controls.
- This is not completion of a full page-by-page UX transformation or a WCAG certification.

## Verification actually run
- Fresh baseline: **1,032 / 1,032 tests** in 130 files.
- Final regression: **1,056 / 1,056 tests** in 134 files.
- New tests cover public form interaction, same-request transport retries, safe server errors, staging refusal, consent/privacy bounds, four-domain reachability and CRM controls. Mocked transport/component tests are explicitly not authenticated E2E.
- ESLint over src/scripts: **0 errors**, **58 existing warnings**. Changed-source formatting passes.
- Platform compilation/typechecking: latest observed entry **build OK**; no manually invoked project build/typecheck.
- Existing staging SQL suites: **57 / 57 pass**; user/organization/workspace counts unchanged after rollback. These include RLS, campaign work, CRM and proposal decisions; they exclude unapplied proposal 0093.
- Isolated staging browser: EN/NL/FR × desktop 1280×1800, tablet 823×698, phone 390×844. Public unavailable state and retry, metadata, and protected lead-page redirect checked; no horizontal overflow or page errors. Representative screenshots inspected.
- Authenticated lead, campaign and CRM read-back: **NOT RUN**. Existing safe staging test credentials were unavailable; no accounts, passwords, MFA or authorization changed or bypassed.

## Outstanding mandate
1. Authorized staging migration path and complete real lead journey verification.
2. Authenticated campaign/CRM regressions and full product-wide UX sweep.
3. Remaining Growth Officer orchestration, specialist/marketing, retention/reactivation, financial/optimization programme remains unfinished; do not treat this release as the whole programme.
4. Actual external integration activation, emails, publishing, advertising spend, payments, production schema/deployment and main merge remain separately unauthorized.

GitHub synchronization for the new commit must be read back after committing; a local commit is not proof that CI has run remotely.
