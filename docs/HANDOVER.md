# Autonomous customer release handover — 2026-11-14
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
