# Master product expansion — work package 1

16 November 2026. This delivery implements a meaningful P0 reliability slice, not the entire master directive. It preserves the existing application. No deployment, owner initialization, live payments, SSO, publishing, advertising or outbound messages occurred.

## Implemented functionality and AI improvements

- All existing metered AI entry points now claim dispatch exactly once per run. An already claimed run cannot execute inference a second time.
- Private durable receipts retain the response text, provider/model, native provider response ID, token usage, calculated internal credits, estimated EUR cost and delivery state before settlement.
- Reconciliation atomically settles the stored usage and checkpoints coordinated output. Repeating reconciliation cannot create a second usage event or refund.
- Team analyses use 15-minute leases, renewed before each authorized child dispatch. Explicit recovery never invokes a provider. All paid checkpoints can be downloaded.
- Interrupted new-protocol analyses return only unused/confirmed-unstarted reservations. Unknown transport outcomes remain reserved; historical runs without dispatch evidence are not presumed unstarted.
- Fully checkpointed running analyses can be formatted and saved without a new AI call. Incomplete interrupted analyses are closed with their preserved work available.
- Gateway errors are distinguished by documented outcome: only `not_started` permits an automatic refund. Missing usage, ambiguous failure or remote timeout is not treated as cancellation.
- New team requests are transactionally guarded against unresolved receipts. Existing throttles and organization-wide running gate remain.

## Architecture and references

Migrations:
- `0028_durable_ai_receipts_and_safe_recovery.sql`: private `ai_call_receipts`, dispatch claims, immutable delivery recording, reconciliation and recovery RPCs; lease field.
- `0029_receipt_write_lock_and_legacy_recovery_guard.sql`: revoke direct receipt writes and distinguish historical coordination from receipt-protocol runs.
- `0030_block_unreconciled_organization_dispatch.sql`: prevent another team start while unresolved dispatch/delivery remains reserved.

Mutations require both the existing private accounting proof and authenticated owner-of-run/current workspace membership. No service-role client is introduced. RLS scopes receipt reads to the requesting user, organization and member-authorized workspace. Provider IDs are correlation evidence, not a guarantee of provider idempotency.

Code: `src/lib/ai.functions.ts` (`meteredGenerate`, `recoverCoordinatedAnalysis`), `src/lib/ai/provider.server.ts`, `src/lib/ai-accounting.ts`, `src/components/app/coordination-workbench.tsx`. SDK model declarations were generated, preserving the existing model and output caps. Existing content routes retain unique metadata; no new route or empty screen was added.

## Actually executed tests

- Full Vitest regression suite: **130 passed / 17 files**.
- Existing tenant isolation rollback SQL: **39 passed, 0 failed**.
- Existing credit lifecycle rollback SQL: **14 passed, 0 failed**.
- New `tests/sql/ai_receipt_security.sql`: **12 passed, 0 failed**; own read, outsider/viewer denial, direct receipt insert/update/delete denial, invalid-proof dispatch/settlement/outcome/recovery denial, anonymous RPC denial.
- SQL suites deliberately raise a final result exception to roll back all fixtures; these result sentinels are not product failures.
- Signed-in real Strategy + Research + synthesis completed; Cloud inspection confirmed three settled receipts, three preserved outputs, succeeded analysis, and **8 total credits charged**. Result reopened after reload.
- Injected fixture with no provider call tested duplicate dispatch rejection, idempotent delivery, immutable receipt, delivered-output refund denial and live-lease close denial.
- The same simulated interrupted fixture was expired through controlled administration, then recovered through the actual app: one settled preserved step, two unused refunds, repeat recovery and nonempty preserved-work download. No inference replay.
- Separate explicit unknown-transport fixture retained one uncertain reservation and returned two unused reservations. A subsequent team start was rejected. The exact gate responsible for that rejection was not separately isolated from the existing start throttle. The QA fixture was then attested as genuinely unstarted (no provider was invoked), and reconciled so the test does not leave customer spending blocked.
- Desktop 1280 × 1800, phone 390 × 844 and tablet 768 × 1024 were exercised; no page errors or horizontal overflow observed. Mobile screenshot timing was corrected after the navigation animation; stable screenshots inspected.
- Latest harness output: **build OK**. No manual application build/typecheck was run.

Test effects: one real development team analysis and two clearly labeled simulation histories remain. Synthetic usage is marked `qa-simulation` / `qa-no-inference`, not actual provider spend or verified business data. No unreported test account/owner promotion occurred.

## Full feature status

| Area | Status | Actual boundary |
|---|---|---|
| Command center / operational intelligence | Implemented, partially retested | Existing real workspace work/activity; no newly invented performance/health scores |
| Knowledge / discovery / documents | Existing partial implementation | Verified scoped facts and bounded parsers remain; requested complete intake/style workflow not rerun |
| AI team coordination | Implemented; tested normal + injected recovery | Durable dispatch/receipts/checkpoints; not autonomous reliability-complete |
| Content Writing Engine | Not started as a dedicated module | Existing Content specialist provides analysis, not an editable versioned content library |
| Writing style profiles | Not started | No profile analysis, authorization matrix, correction learning or approved examples shipped |
| Campaigns and execution | Existing implementation, partially retested | No new campaign-content synchronization or generation plan |
| Editorial calendar / recurring Thursday posts | Not started | Existing work calendars do not constitute an editorial content system |
| Exact content-version approval | Not started for dedicated content | Existing action approval remains; no publication enabled |
| Publishing controls | Deferred / disabled | No genuine social connection, publishing queue or verified publish result |
| SEO operating system | Partial existing specialist | No technical crawl, keyword measurements or Search Console connection implemented here |
| Opportunities / competitors / executive briefings | Partial existing intelligence / not started | No new monitoring or fictional metrics |
| CRM / customer intelligence | Not started | No contacts/deals/pipeline/customer metrics |
| Automation | Architecturally prepared only | Explicit recovery is not an unattended worker or scheduler |
| Business Intelligence | Existing operational summary only | No KPI history/attribution/source ingestion added |
| Integrations | External requirements / existing source tools | Website/document ingestion remains; no newly connected OAuth services |
| Commercial / agency | Existing partial foundation | Credits remain distinct from estimated provider cost; no live payments/multi-brand suite |
| Security | Implemented and tested within stated scope | Full multi-account concurrent/revocation matrix remains open |

## Known limitations, security findings and continuation

1. P0 is not complete. There is no unattended lease/reconciliation worker; users explicitly recover team work. Automatic operation requires an approved deployment and verified reachable authenticated scheduling arrangement, which remains prohibited here.
2. A provider may execute even when the local process terminates before durable receipt storage. Such unknown work is not replayed/refunded. Native provider IDs/log references are retained when available; automatic gateway-log resolution and an administrative investigation UI remain open.
3. Per-run dispatch deduplication does not deduplicate separate Growth Officer/single-specialist requests that create different run IDs. Single-call recovery UI and shared request-level limits remain next P0 work.
4. General single-call receipts can be reconciled through the protected RPC, but this work package only ships team recovery controls. Full business-action replay from paid output is intentionally not automated.
5. Concurrent sessions, permission revocation during inference, all-steps final-save recovery, malformed provider contracts and genuine process termination require further adversarial execution. Normal and injected tests do not establish those guarantees.
6. EUR provider cost remains the existing estimate, not invoiced actual cost; unknown inference must not be represented as zero paid activity.
7. Receipt storage/retention/export and long-workspace histories remain bounded; retention/privacy lifecycle needs explicit follow-up.

Precise next step: finish the remaining P0 gates above with persistent fault/concurrency tests and single-call recovery. Then implement the complete P1 vertical slice: authorized writing identities + approved examples/settings + scoped source selection + editable grounded drafts/versioning. P2 follows with campaign-linked occurrences, exact-version human approval and the Thursday LinkedIn planning example. Do not leap to CRM/SEO/BI while these slices remain incomplete.

External dependencies: authorization/configuration for real analytics/social/CRM accounts; actual customer measurement data; finalized commercial prices; separate approval for deployment or any external execution. None is fabricated or bypassed.