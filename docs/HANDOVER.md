# Autonomous customer release handover — 2026-11-14
## Foundation completion and final-quality follow-up — verified 2026-11-15

### Delivered in this session
- Added database-atomic AI credit reservations, actual-usage settlement, unused-reservation refunds and provider-failure refunds. Reservation, settlement, usage-event insertion and ledger writes share one SQL transaction; direct client writes to AI usage history are revoked. Additional settlement cannot overdraw the organization; if the remaining balance cannot cover the full actual charge, the recorded charge is capped at the reservation plus remaining balance.
- Added server-enforced invitation creation and acceptance. Invitations require a valid unique email, an active seat entitlement and available seats at both creation and acceptance. Acceptance requires the matching confirmed email, is single-use and grants no implicit workspace assignment. Direct invitation inserts are revoked. The settings page uses the secured function and still sends no email.
- Password recovery now requires a recovery-type URL and a recovery session before showing the password form; invalid/incomplete links receive a useful recovery action. No current-password field is sent on the recovery page.
- Microsoft managed sign-in is enabled and visible beside the branded Google button. Organization OIDC uses the platform's dedicated custom provider and same-origin return path. Neither Microsoft nor OIDC was exercised with a real external identity account. OIDC still requires administrator configuration; SAML setup was declined and remains unconfigured; SCIM, domain verification, organization-specific role mapping and session-revocation UI are not implemented.
- Organization action policies are now editable by administrators. Blocked capabilities are rejected by a database trigger on new proposals and cannot be approved; existing pending items can still be rejected. Growth Officer also filters blocked proposals. The browser test restored the verification organization's recommendation policy to Approval required.

### Exact fresh evidence
- **59 Vitest tests passed across 6 files.** Latest automatic application check: **build OK** after the recovery navigation correction.
- **119 database checks passed, 0 failed:** tenant isolation 39, workspace/storage authorization 30, context isolation 13, monthly credits 6, credit reservation/settlement 14, invitation lifecycle 12 and approval policies 5. Each suite deliberately raises its final result to roll back all fixtures. The first credit test exposed test evaluation ordering, then a real settlement variable/column collision; the function was corrected and the complete suite passed afterward.
- Signed-in browser journey: Google, Microsoft and organization-SSO controls were visible; an invalid recovery URL was rejected; a recommendation policy was blocked, reloaded, restored and reloaded; a no-email test invitation was created and revoked; a real Growth Officer answer completed and its conversation survived reload; Plan & usage displayed the resulting **−3 reservation and +2 refund** with **162 credits remaining**. The answer identified existing conflicting verification facts instead of inventing a business identity.
- Desktop screenshots of sign-in, policies, chat and credit history were inspected. Phone-width Approvals and Organization settings had no document-wide horizontal overflow. **Zero browser page errors** occurred. No Microsoft/OIDC external redirect, SAML flow, real invitation email or multi-account UI acceptance was exercised.

### Remaining scope and risks
The full final-quality directive is **not complete**. Rate/concurrency limits and hard maximum-cost pre-budgeting remain open; actual settlement can be capped by available balance as described above. Multi-account UI role assignment/revocation, full signup/email delivery/reset delivery, account deletion, MFA, session revocation and enterprise domain/linking/role-mapping workflows remain incomplete. SAML is not configured and no ACS/entity values or successful SAML validation are claimed. Specialized agents remain honestly Planned; connector OAuth/execution, module toggles, discovery draft persistence/conflict resolution, document versions/hostile-input matrix, accessibility/performance/PWA published testing and public homepage polish remain. No official security/privacy certification is claimed.
Personal Platform Owner initialization, live payments, production publishing, external marketing actions and outbound customer emails remain deferred. No platform role was granted and no production action occurred.

---
## Ultimate completion directive — verified progress 2026-11-15

### Delivered in this bounded session
- Refined shared page headings, collapsible navigation, searchable page dialog, semantic overlay/dark states and tablet drawer. Search navigates only to implemented destinations; no new fake modules or metrics.
- Replaced overview metric cards with sourced credit/knowledge measures, unconfirmed-claim review actions, actual pending recommendations, confirmed objectives and workspace-specific AI activity. Revenue/acquisition/retention remain Not configured. Query failures are not rendered as zero-valued metrics.
- Added explicit workspace memberships and role checks across knowledge, documents, conversations/messages, AI runs, approvals, extensions, scoped connectors, usage and storage. Organization owners explicitly retain all-workspace administration. Non-owner existing sharing is preserved as recorded assignments; newly invited users receive no implicit grants. Owner-only assignment RPC caps workspace roles by organization roles and audits changes. Team removal clears assignments so rejoining cannot restore stale permissions.
- Added atomic active-plan/quota-checked workspace creation; direct authenticated insertion is revoked. Organization/profile/audit creation remains intact. Fixed an initial quota implementation's mismatch with the existing integer entitlement return before verification; trial denial passed in the UI and SQL.
- Added Workspaces & access management to Organization settings, effective workspace roles in controls, scoped approvals/activity and fail-closed AI member checks before provider work. Full multi-user assignment UI has not been exercised; database grant/revoke behavior was tested.
- Hardened owner overview to the exact Platform Owner role. Existing owner mutations already use owner-only RLS/RPC checks. No personal owner or temporary owner was initialized.

### Fresh evidence
- **58 Vitest checks passed**, 6 files: 50 existing tests plus 8 new owner guard tests. Latest automatic application check: build OK.
- **88 database checks passed:** tenant isolation 39, context identity 13, monthly credits 6, explicit workspace/storage authorization 28, removal/rejoin 2. Every suite intentionally raises its result to roll back. The stored workspace suite now incorporates the separately exercised removal/rejoin checks; the whole combined 30-check file was not separately rerun. No failed test fixtures persisted.
- Workspace suite checks organization-admin non-access, effective role caps, hidden workspace/fact/document/history/message/run/approval/object reads, denied insert/update/delete, denied confirmation and approval RPCs, denied self/direct assignments, malformed file paths, owner grant, viewer read-only behavior and revocation. Managed storage forbids direct database deletion before its row policies run; deletion authorization is tested through the same path helper, not represented as a successful Storage API delete.
- Signed-in requesting account: real Foodlo overview readback (193 organization credits, 0 confirmed and 15 unconfirmed facts at that point); page search navigated to settings; attempted extra workspace creation showed the actual plan-limit denial.
- Existing verification organization: added one clearly labeled confirmation fact, reloaded and read it back; real Growth Officer answer recognized the verification purpose and existing conflicting facts, without invented metrics; conversation reloaded from saved history. Organization owner received Platform Owner access required at /admin. Real AI credits were consumed; the verification organization showed 163 credits afterwards. Foodlo profile was not changed.
- Desktop 1280×1800, tablet 823×698 and phone 390×844 exercised. Eight customer pages had no document-wide overflow; overview, settings, dark overview, chat and settled phone drawer inspected. Zero page errors in both browser journeys. Initial screenshot captures were premature (blank page / drawer mid-transition); verified captures waited for data and transition completion.

### Remaining scope and limitations
This directive is **not fully complete**. No continuous background execution is promised. Remaining work includes safe discovery draft persistence and conflict resolution; document versions and hostile-file matrix; full signup/invitation/reset lifecycle; complete workspace access UI with multiple accounts; concurrent revocation during running provider calls; workspace-specific audit redaction; atomic credit refunds/settlement and other quotas/rate limits; policies/module controls; enterprise SSO/MFA/SCIM configuration and tests; real connector lifecycle/OAuth; specialized agents; full accessibility/performance/PWA published testing and public homepage polish. Existing offline code was not changed or freshly tested this session.
No SSO, connector, agent execution, security certification or real revenue is claimed. Organization-level ledgers and audit remain organization-administrative records, not workspace-exclusive records. General platform-staff underlying read policies remain for separate staff duties, but the owner-center server entry denies non-owners. Production publication, personal owner initialization, live payments and external communications remain deferred. Required future provider credentials/authorizations, verified domains and approved prices are external blockers; other listed work is unfinished, not credential-blocked.

---
## Critical context isolation follow-up — 2026-11-14

### Root causes and implemented changes
- **Duplicate trust path:** `workspaceContext` filtered facts by verification, but also serialized descriptive `business_profiles` fields independently. Editing/unconfirming a fact could leave a trusted-looking stale profile mirror. New `src/lib/security/context.ts` excludes descriptive mirrors; approved evidence is verified facts only. Confirmed objectives/budget are labeled customer objectives, not evidence. Previous recommendations and conversation history are explicitly not verified facts.
- **Implicit document scope:** document extraction accepted only a document ID and derived its scope afterwards. Organization RLS prevented cross-organization reads but allowed an authorized same-organization document to be processed from the wrong active workspace. Extraction now requires org/workspace/document IDs, checks all three server-side, validates the workspace and storage prefix before download, and writes explicitly unverified facts with `document:<id>:<name>` provenance.
- **Incomplete identity invariants:** existing update triggers did not validate run/approval insert associations, document storage paths, message parent org identity, or profile reassignment. Migrations `0009_context_identity_guards.sql` and `0010_context_guard_record_fields.sql` add five insert/update guards. Message parent org, run workspace org, approval run org/workspace, immutable profile scope and immutable document storage paths are enforced. The first guard implementation failed an adversarial test because polymorphic trigger records lack some fields; the immediate follow-up uses JSON field access. The full suites passed after correction. No failed test fixtures survived.
- **Stale local UI state:** onboarding did not clear all previous draft fields when switching to an empty workspace; discovery/chat requests could complete after a switch. Customer content is now keyed by org/workspace in the shared shell, remounting page-local state and binding old completions to their original instance. Server context uses explicit org/workspace predicates and fails closed on query errors. Conversation reads require org/workspace/owner before history is loaded.
- **Redirect provenance:** discovery labeled the requested URL even when fetching redirected elsewhere. `safeFetch` now returns the final validated URL; discovery source allowlisting uses the actual fetched URL, with duplicate destinations removed.
- **Customer document gaps:** added private download, scoped deletion with confirmation, loading/error/retry states and surfaced cleanup failures. Query errors no longer masquerade as an empty document list.

### Exact evidence from this follow-up
- Vitest: **50 passed, 0 failed across 5 files** (9 new context tests plus 41 existing tests). Context tests exercise query predicates without mock RLS, including same-user cross-workspace conversation IDs, another user's history, document ID/path attacks, organization mismatch, verified-only context, workspace switching and denied reads.
- SQL: **39 isolation + 13 new context + 6 monthly credit checks = 58 passed, 0 failed**. Two temporary users, two organizations and an additional same-org workspace were used. Each suite intentionally raises its final result to roll back fixtures; the tool's error envelope contains the expected success result. The new stored suite includes an extra B conversation fixture not needed by the executed equivalent assertions.
- Database inspection confirmed all five guards exist and **0 existing documents have mismatched org/workspace storage prefixes**.
- Signed-in browser: real foodloapp.com discovery produced **9 sourced fields**, all initially unconfirmed; source/confidence indicators were visible. Edited the description, explicitly confirmed it, saved objectives and reloaded the saved profile in the verification organization. Foodlo's business profile was not overwritten.
- TXT and CSV were newly uploaded, extracted to Ready and downloaded with byte equality. Existing verification DOCX/XLSX were downloaded successfully; Word was re-extracted successfully. Excel's existing Ready result was read back; the script did not prove a new Excel extraction completed because its Ready status predated the request. Office parser unit tests passed. PDF was newly uploaded, extracted to Ready and downloaded byte-identically. The trial's 5-document limit blocked an extra upload; only the duplicate unprocessed `context.txt` verification upload was deleted to make room, without relaxing limits.
- A real Growth Officer answer identified conflicting **confirmed** verification facts and correctly distinguished approved recommendations from verified evidence; it did not treat the new unconfirmed document claims as evidence. Switching organization cleared the displayed conversation. Organization owner was denied `/admin`. Final journey reported **zero page errors**.
- Desktop 1280×1800 and phone 390×844: profile, documents, onboarding, Growth Officer, organization settings, billing, approvals and integrations had **no document-wide horizontal overflow**. Screenshots of profile, discovery, chat and mobile integrations were inspected.

### Security boundaries and remaining risks — not a full security certification
- Workspace scope is enforced in AI readers and immutable identities; **workspace-specific membership does not exist**. Existing RLS/storage intentionally authorize organization members to shared documents/facts across that organization's workspaces. A user authorized for both workspaces can directly request both through the Data API; selecting a workspace is not an access-control boundary. Restricting members to selected workspaces requires a separate access model and migration, not a frontend-only filter. Same-org conversation history remains private to its creator.
- No background processing queue, cron AI job, embedding memory or vector retrieval exists. Current runs preserve org/workspace identity and are guarded. Future background entry points need authenticated ownership checks and durable scoped job identities; no nonexistent job execution is claimed tested.
- Storage object policies remain org-level; invalid path associations in document records are now rejected, but orphan object path/cleanup and full storage-policy adversarial testing remain. No claims of complete workspace-level storage ACL enforcement.
- Existing historical message/run/profile mismatches were not exhaustively backfilled or certified. Prompt injection is mitigated by untrusted quoting and approval-only capability proposals, not proven impossible.
- Provider failure/refund handling, atomic credit reservation/settlement, server quotas/rate limits, stronger PDF validation, comprehensive hostile-file testing, auth email delivery/settings and workspace-access assignments remain unfinished.
- Old explicitly confirmed custom facts are retained on rediscovery; the real chat exposed conflicting verification descriptions and asked for clarification rather than silently deleting them. Canonical fact replacement/conflict resolution and discovery draft persistence are next priorities.
- Reopening saved profile was verified; post-save inline editing/reconfirmation, invitations/account lifecycle, approval execution/policy editor, connector OAuth/module toggles, full tablet/accessibility and offline re-tests remain pending this session. Previous release evidence is kept below, not represented as fresh tests.

### Test data, deferred work and next priorities
The existing verification organization now contains the confirmed isolation description, website discovery run, new TXT/CSV/PDF documents, unconfirmed extracted facts and one chat. Existing verification Word/Excel files and facts were retained. Real AI calls consumed real credits; no metrics were fabricated. Personal owner initialization, payments, outbound email and publishing stayed deferred.
Next: explicit workspace access assignments if required; storage-policy adversarial suite; canonical fact conflict handling and persistent discovery drafts; atomic credit lifecycle and server quotas; account/invitation completion; approval policies and real connector configuration. The Foundation Release is **not declared complete**.

---
This is a bounded execution session, not four hours of unattended background work. No production deployment, outbound communication, live payment or privilege grant occurred.

## Implemented and exercised
- Shared customer design transformation: light/dark semantic palette, Manrope, refined navigation and controls, smaller radii, phone drawer and scroll-safe tables.
- Website-first AI discovery with editable sourced findings, confidence, extracted/assumption/user-confirmed states and review controls.
- Atomic profile/fact/audit confirmation; duplicate-safe key/source updates.
- Knowledge editing and reconfirmation; only verified facts enter approved AI context.
- Real DOCX/XLSX parsing with ZIP expansion bounds and XML entity rejection; private upload and AI extraction. Fixed a real upload defect: clearing the file input mutated its FileList before the async entitlement check completed.
- Growth Officer uses workspace and previous recommendations; validates a supplied conversation belongs to that organization/workspace. Preserves input after failure; blocks duplicate sends; resets conversation on workspace change.
- Tenant/workspace reassignment blocked on facts, documents, conversations, runs and approvals.
- Duplicate-safe lazy monthly grants; SQL denial for expired trial/past-due credit use.
- Web manifest, raster icons, standalone mode, service worker and static offline fallback. Cache contains only /offline.html, never tenant data.
- Unique leaf metadata and honest unavailable/placeholder pricing labels.

## Exact verification
- Vitest: **41 tests passed across 4 files**; final result includes 33 existing rules, 3 discovery, 4 Office parsing and 1 routing test. Prior handover's 31 total was inaccurate (31 rule tests plus 1 routing test).
- Expanded tenant SQL suite: **39 passed, 0 failed**. The tool reports the deliberate final RLS_RESULT exception because the suite self-rolls back; not an unexpected failure.
- Monthly SQL suite: **6 passed, 0 failed**, also rolled back deliberately.
- Real Foodlo website discovery: 9 findings, 8 opportunities, 9 source links; individual review confirmation worked; no Foodlo profile overwrite.
- Separate verification organization: profile saved and remained after reload; DOCX extracted 1 fact and XLSX 2 facts; both Ready; edited fact persisted and was explicitly confirmed.
- Real Growth Officer answer correctly distinguished confirmed context from assumptions; a subsequent registered internal strategy proposal was persisted, approved and read back in Decided. Audit confirmation entries visible.
- Organization owner denied owner center. No platform roles granted.
- Desktop 1280×1800 and phone 390×844 inspected; overview overflow fixed; light/dark checked after transition completion; seven customer pages showed no document-wide phone overflow.
- Offline navigation rendered static fallback; cache inspection found only /offline.html. Zero page errors during the complete document/PWA flow.
- Latest automatic build status checked before commit; no manual build/typecheck invoked.

## Test data and cost
A clearly named “Verification workspace — autonomous build” organization with test profile, two test documents, extracted facts, conversations and one approved internal proposal remains under the requesting account. It is verification data, not business analytics; not deleted without permission. Real discovery and document/chat checks consumed real AI credits. Foodlo discovery consumed 4 credits.

## Not complete / priorities
1. True credit reservation/settlement/refunds and server-enforced upload/seat/workspace quotas; rate/concurrency limits.
2. Persist discovery drafts, source excerpts, per-fact confirmation actor/timestamp and preserve all custom facts on rediscovery.
3. Full PDF/CSV/TXT extraction retest (existing implementations retained), adversarial document fixtures and thorough accessibility/mobile/tablet coverage.
4. Policies editor and effective policy enforcement; module toggles and real connector OAuth. Unconnected integrations remain Not configured.
5. Public homepage visual transformation, deeper overview data visualization once real sources exist, more empty/loading/error polish.
6. Add-ons, owner price editor, calendar-vs-anniversary credit policy and scheduled grants if desired.
7. Auth signup/verification/reset email delivery and hosted settings were not freshly verified; no auth emails sent.

## Deferred / blocked
- Personal Platform Owner initialization explicitly deferred; existing staff-read owner overview is not owner-only hardened yet. No temporary owner or public owner registration.
- Real prices require explicit approval. Payments require a provider account and explicit activation approval.
- Live connectors need provider authorization/credentials/review; no external writes executed.
- MFA, SSO, deletion/session-revocation UI, agency client organizations and specialized growth modules remain unbuilt.

Nothing is mocked in the new AI flows. Confidence is model-estimated; provider costs and configured contribution margin remain estimates, not collected revenue. No native mobile application or full OWASP ASVS certification is claimed.
