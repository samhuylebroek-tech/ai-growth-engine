# AI Growth Engine — autonomous expansion delivery

Date: 15 November 2026 (UTC). This is a completed bounded execution session, not an unattended overnight process. Nothing continues automatically after the session ends.

## Delivered and tested

### 1. Complete execution collections and display pagination
- Projects, tasks, campaigns, execution notes and approvals now traverse deterministic ascending ID keysets, always scoped by organization and workspace.
- Each traversal captures a creation-time watermark to exclude later new rows, continues after short pages (including a provider-imposed lower cap), and rejects errors or non-advancing cursors instead of returning partial data.
- Existing sorting is reapplied after collection. List views show 50 rows per page, matching totals and previous/next controls. Search and status/priority/personal/deadline filters run before display pagination; calendar and Kanban still use the complete collection.
- Applied `0023_execution_keyset_indexes.sql`: five `(org_id, workspace_id, id)` indexes on projects, tasks, campaigns, notes and approvals. All five were read back from the database.
- No existing tables, grants, policies or data were replaced. No new privileged client.

**Limit:** This removes silent 1,000-row truncation but is not the final large-workspace architecture: all execution rows are still collected into browser memory, including on existing foreground refresh. Five source collections are not a database snapshot; concurrent updates/deletes can affect the read. The creation watermark is browser-clock based. New records appear on refresh. Follow up with server-filtered bounded list queries, separate scoped aggregate/detail queries and database-issued snapshots where strict consistency is required. Synthetic traversal covers 3,507 rows, not a persisted 3,507-row production browser benchmark. Activity history remains bounded separately.

### 2. Explicit operational AI context
- Growth Officer and specialist assignments include a selectable work picker with search: projects, tasks, campaigns, approved/executed decisions and recent typed activity references.
- Maximum 12 unique references; no messages, arbitrary tables or client-provided record bodies.
- Server reads every selected record again using caller access, explicit organization/workspace predicates and workspace member authorization. Missing/deleted/revoked or failed reads stop before generation.
- Operational text is quoted through existing `quoteUntrusted`, separately labeled from verified business facts. Selected approvals must actually be approved/executed at read time.
- Selection is local to the scoped mounted workspace. No automatic whole-workspace prompt injection or private conversation sharing.

**Limit:** Recent activity choices are the existing 200-event window. Verified-fact/objective context follows the existing business-context reader. This is not semantic retrieval.

### 3. Four useful independent specialists
- **Strategy:** evidence-aware prioritized strategy and experiments.
- **Research:** audience/market hypotheses, evidence gaps and customer research plans; no live research claims.
- **SEO:** suggested keyword intent clusters, candidate pages and action plans; no fabricated rankings, volume or crawl measurements.
- **Content:** actual drafts, briefs and factual review checklists; no publishing.
- Each assignment is one authenticated user-started `meteredGenerate` call with workspace permission and plan entitlement checks, existing atomic reservation/settlement/refund, a registered run key, depth zero, bounded input and 2,500 output tokens.
- Structured JSON is validated with domain-independent bounded title/section/gap/action schemas. Invalid output produces a failed run and no blind retry; completed inference remains accounted for.
- Results persist in the requesting user's existing private conversations, with explicit selected-source references in the answer. The workbench supports Markdown download and existing editable review-to-project/task/campaign conversion.
- Run success/failure remains visible in existing activity and Home aggregation.

**Limit:** These are independent domain prompt specialists, not a multi-agent orchestrator. Tools are limited to authorized evidence reads; no external search, SEO crawler, external writing or automatic agent handoffs. Output schemas share a shape rather than domain-specific claim validators. No single-flight/rate limiter or inference-request idempotency was added; the button prevents ordinary same-view double clicks only. Cross-tab concurrent requests remain possible and are metered. Source citations identify selected records, not claim-level proof. Private specialist result persistence uses existing sequential conversation/message/run writes, not a new atomic result transaction.

### 4. Central in-app notifications
- New `/app/notifications` destination under Home and a notification-bell link.
- Derived real overdue/due-today tasks, pending approvals, recent completed/failed AI work, failed documents and known failed/expired integrations.
- Priority ordering, unread/all/attention views, source links, individual/all read actions and user/org/workspace keyed device-local read persistence.
- No invented integration failures or external delivery. Read dismissal never completes a task or approves a decision.

**Limit:** Recent AI/document events use the existing last-50-per-source query window; the UI identifies recent activity. Device-local read state is not synchronized across devices and retains at most 2,000 IDs. No durable notification inbox, scheduled reminders, future-date alerts, email or push delivery.

## Tests actually executed

| Evidence | Result |
| --- | --- |
| Baseline Vitest | 96 passed |
| Final Vitest | 119 passed, 14 files |
| Existing rollback-only tenant RLS suite | 39 passed, 0 failed |
| Existing rollback-only execution suite | 30 passed, 0 failed |
| Database index verification | All five keyset indexes exist |
| Synthetic keyset tests | 3,507 exact rows, lower provider cap, later-page failure, non-advancing cursor, filtered total and stale page clamp |
| Context adversarial tests | Cross-workspace selection, revoked access, read failure, pending approval exclusion, arbitrary-table/duplicate/13-record rejection |
| Signed-in Content generation | Actual generated draft saved, selected source retained, reloaded in Growth Officer; 2 application credits |
| Signed-in Strategy / Research / SEO | Each generated and saved a real structured analysis; 2 application credits each |
| Signed-in Growth Officer | Explicit selected project summarized with current status and no invented results |
| Signed-in notifications | Real events loaded; mark-all-read persisted after reload |
| Responsive checks | Specialist and stable notification layouts at 390×844; no horizontal overflow |
| Browser errors | Zero page errors in successful checks |
| Latest preview compilation | Build OK |

The SQL suites deliberately raise terminal result exceptions to roll back every temporary fixture; these result exceptions are successful test evidence, not production errors. Initial CLI attempts were read-only and could not run fixtures; successful write-enabled SQL-tool runs are the evidence above. A new context test initially expected escaping while the existing quote helper strips delimiter tags; corrected to assert one wrapper and removed injected delimiter. Full rerun passed. Early browser checks had selector ambiguity; successful reruns are reported, not those attempts.

Real AI test conversations/runs remain in the development workspace as actual test activity, not customer metrics. Notification read state was marked read in the verification browser only. No test account was promoted and no live payment, email, campaign or deployment was activated.

## Asynchronous architecture assessment — prepared in documentation only

Supported platform option: an authenticated managed HTTP schedule calling a stable TanStack `/api/public/jobs/...` server route, using generated `authenticateCronRequest`. Ordinary database-only work can use transactional SQL functions/triggers; overdue display is derived instead of scheduled.

A safe AI job implementation must add durable tenant/workspace-scoped jobs, unique idempotency keys, bounded batch/depth, database lease with expiry, source permission rechecks, pending/running/paused/failed/cancelled/completed states, per-item progress, credit accounting and terminal refusal/denial handling. Wake on enqueue; arm retries only while work remains; unschedule after drain. Never add an idle polling sweeper or dispatch inference on page render. Credits/policy denial must pause automation; unknown inference outcomes must not be replayed blindly.

**Not implemented or activated:** job table, worker, lease, scheduler, retries, cancellation, automatic workflows or recurring analysis. No callback reachability has been established: this project has no published URL, and production deployment is explicitly deferred. No schedule tools were used and no background execution is claimed. The surfaced background/batch AI skill shaped this safety assessment only.

## Integration, security and operational status

- New live external integrations: **none**. OAuth token storage/sync/provider mapping remain unimplemented.
- Existing tenant/workspace RLS and exact Platform Owner separation retained. New AI function uses authenticated caller reads, not service role. Existing bearer and CSRF middleware retained.
- No new role grants or Platform Owner initialization. No irreversible deletion or production publishing.
- New long-running server handlers: none. Specialists remain synchronous user requests, using the existing runtime-compatible provider.
- Metadata reviewed: every content route including index retains app-specific title/description/Open Graph/card metadata; the notification route uses shared `pageHead`.
- MFA UX, comprehensive audit export/retention, rate limiting, concurrency limits, request idempotency, token-expiry/browser multi-account matrix and large-workspace SQL performance benchmarks are not completed by this session.

## Continuation priorities

1. Finish bounded server-filtered execution list/aggregate/detail retrieval and permission-aware global record search; benchmark concurrent large workspaces.
2. Durable jobs only after a verified reachable authorized deployment target exists; implement lease/dedup/pause rules before enabling AI automation.
3. Dedicated content library with editable drafts, revision history, explicit approvals, linked campaign/tasks and editorial calendar. Current specialist conversations are not a content OS.
4. Measured public-page SEO audits with bounded safe fetch and real checks, then source-backed keyword providers.
5. Internal CRM vertical slice, followed by authorized event-driven internal automation and real-data BI.
6. Provider OAuth/sync integrations, agency/multi-brand workflows and permission-preserving semantic retrieval after core boundaries are verified.

CRM, customer intelligence, workflows, BI metrics history, executive reporting, financial forecasting, agency portal and embeddings were **not started** here. No empty module was created to imply completion.