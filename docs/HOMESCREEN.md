# Business command center — 2026-11-15

## Delivered
- Workspace and organization selection in the global header, shared page search, permission-aware quick actions, pending-decision notifications and settings access.
- Real business status, exact active-run/pending-approval counts, visible attention queue, active assignments and Growth Officer question handoff.
- Typed, deduplicated, workspace-filtered AI/document/approval activity with source/status filters, detail dialogs and direct run-detail navigation.
- Foreground activity synchronization every 30 seconds; manual refresh refreshes status too. Credit-grant/account queries are not polled.
- Recent recorded results, pending strategic recommendations with reasoning/expected impact, and explicitly unavailable scheduling/performance states.
- Per-user, organization and workspace section visibility/order and compact activity preferences. Attention and active work cannot be hidden.
- Activity history loads older records in batches of 50 per source, with search/status/source filtering over loaded records. A selected run is read with explicit organization/workspace filters even outside loaded pages.

## Verification
- 83 Vitest tests passed across nine files, including six new data rules for empty activity, deduplication/time ordering, risk priority, preference isolation, scoped query identity and large streams.
- Signed in as the requesting user's existing account; no role changes. Home rendered actual records and zero pending approvals/active runs for the selected workspace.
- Recorded run opened in a detail dialog, then its exact run detail opened in activity history.
- Home question transferred correctly; one real Growth Officer call saved an answer. The new run read back in Home and history; credits changed from 190 to 189. No external action was executed.
- Section hiding persisted after reload; section reordering persisted; resetting restored defaults.
- Document-source filter showed the correct empty state. Global notifications opened. Switching between the user's two organizations remounted the page and cleared local questions.
- Desktop 1280×1800, tablet 823×698 and phone 390×844 had no horizontal overflow and no browser page errors. Dark appearance exposed low-contrast ghost/outline buttons, corrected in shared semantic variants.
- Build/typecheck errors encountered during editing were corrected; latest automatic build passed.

## Honest limits
- No projects, campaigns, tasks, calendars, external workflows or business analytics sources exist yet. They were not invented or newly activated.
- No synthetic health scores, deadlines, progress percentages, revenue or integrations appear.
- Activity records are current entity states, not a new immutable lifecycle event store. Document timestamps represent upload time, not inferred processing-completion time.
- Home shows the latest 50 entries per source; active work separately reads/counts all running/pending assignments. Attention uses up to 50 loaded pending decisions with an exact total, and recent failures, not a global unresolved-incident ledger.
- A recorded recommendation's reasoning is shown as an AI estimate, not independently validated evidence. Growth Officer retains existing verified-context security; no new campaign/project/analytics context or provider paths were added.
- Real multiple-campaign, high-concurrency, failed-workflow, restricted-user and same-organization multi-workspace browser scenarios were not available in the user's selected workspace and were not claimed as tested. Large-volume/priority/cache isolation were tested using explicitly labeled unit fixtures only.
- Favorite-module/metric selection, scheduled work creation and turning opportunities into projects/tasks remain unavailable. Opportunity review and AI-question handoff are functional.
- Owner initialization, live payments, external emails and publishing remain deferred.