# Next development phase — 16 November 2026

## Delivery and verification

This is a bounded continuation, not a completed ten-phase product. No publishing, owner initialization, live payments, advertising, outbound messages or SSO activation occurred.

Implemented:
- Explicit coordination of two distinct specialists followed by one Growth Officer synthesis. Three sequential metered calls, no recursive dispatch or automatic inference replay. Atomic scoped request claims reserve 150 credits; unused reservations return after settlement.
- Private saved team results, history readback, Markdown download and existing recommendation-to-work review. Session-scoped attempt keys survive reload and are keyed by user/organization/workspace.
- Completed step output checkpoints preserve paid work before parsing or final conversation saving. Checkpoints are immutable and private; automatic recovery is not implemented.
- Scoped record search across work, documents, verified facts and the caller's conversations; at most five matches per source. It augments navigation search rather than claiming complete search totals.
- Server-attested settlement/refund and coordination mutations. Previously authenticated owners of reservations could directly forge accounting. Legacy accounting execution is now revoked; checked wrappers require both authenticated scope and a private app-only proof. App code continues using the caller's RLS client, never a service-role client.
- Growth Officer checks question, answer and successful-run persistence errors instead of silently claiming success.

## Concrete evidence

- Full Vitest: **128 passed across 17 files**, including coordination bounds, source quoting, no replay, accounting uncertainty and search scope.
- Tenant isolation SQL earlier in this session: **39 passed**. Coordination baseline: **16 passed**; follow-up lock/grant checks: **15 passed**. Final accounting/checkpoint/input/RLS verification after hardening: **13 passed**. These SQL suites end with deliberate exceptions to roll back fixtures; they are not production errors. Earlier tests do not establish final permission compatibility for every existing SQL suite.
- Signed-in team analysis completed and persisted, then reopened after reload; final flow succeeded again after server-attested accounting. Initial observed usage was **8 credits across three calls**; this is a real test result, not an estimated future price.
- Thirteen authenticated pages opened with unique product titles and no page errors. Saved analysis downloaded as a nonempty Markdown file. Scoped search opened an actual task detail. Phone (390 × 844) and tablet (768 × 1024) checks found no horizontal overflow.
- Latest preview compilation reported `build OK`; no separate manual build was run.
- Database inspection confirmed RLS on all public tables, no anonymous coordination/checkpoint execution and revoked direct coordination writes. Migration changes were inspected in the actual database.

## Functional status

| Area | Status | Evidence or missing scope |
|---|---|---|
| Home / command center | Implemented, partially retested | Real scoped work and activity; page/navigation checks, no measured analytics without data |
| Projects, tasks, campaigns | Implemented, partially retested | Existing execution suites and unit tests; this session opened pages/search details, not every CRUD path |
| Strategy, Research, SEO, Content specialists | Implemented, tested within analysis boundary | Separate domain prompts and schemas; team execution exercised Strategy/Research; all schema tests rerun |
| Coordination | Implemented, tested normal path; partial reliability | Durable claims, paid checkpoints, saved synthesis, accounting; crash reconciliation and concurrent-session stress remain |
| Knowledge/context/documents | Implemented, partially retested | Scoped verified context and bounded parser tests; no new full hostile-file/browser matrix |
| Notifications | Implemented, partially retested | Derived in-app activity and deadlines, device-local read state; no push/email delivery |
| Content operational suite | Partial / not started | AI concepts and work conversions exist; dedicated editor/library/versioning/calendar/publishing absent |
| SEO operational suite | Partial / externally blocked | AI analysis exists; crawl, robots/sitemap/indexability audit, measured keywords/rankings and monitoring absent |
| CRM / pipeline | Not implemented | Contacts, deals, qualification and CRM execution absent |
| Automation / background workflows | Architectural preparation only | No durable worker, trigger/action runner, leases, pause/resume or scheduler |
| Business intelligence | Partial | Real operational summaries; KPI history/source ingestion/trends/revenue comparisons absent |
| Integrations | Mostly blocked / planned | Website/document tools exist; advertising, analytics, CRM and email connectors not operational |
| Billing and identity | Partial | Credits/quotas and existing auth; payments off, MFA/account lifecycle and full enterprise sign-in matrix unfinished |
| Platform owner | Deferred | Exact server owner gate exists; no account promoted |

## Database and architecture

`0024_bounded_specialist_coordination.sql` adds private durable coordination and begin/finish/fail transactions. `0025` fixes organization-before-analysis lock ordering and direct-write grants. `0026` adds input/reference validation and paid output checkpoints. `0027_server_attested_ai_accounting.sql` closes direct settlement/refund and fabricated-coordination mutation paths. Generated declarations were refreshed by migration tooling.

Core code: `src/lib/coordination.ts`, `src/lib/ai.functions.ts`, `src/lib/ai-accounting.ts`, `src/components/app/coordination-workbench.tsx`, `src/lib/workspace-search.ts`. New tests live in `src/test/coordination.test.ts`, `ai-accounting.test.ts`, `workspace-search.test.ts` and `tests/sql/coordinated_analyses.sql`. Existing credit SQL fixtures were updated to distinguish administrator simulation from untrusted authenticated execution; the entire updated SQL matrix was not rerun after final hardening.

## Security and reliability findings still open

1. Worker termination or settlement uncertainty can strand a running coordination and block the organization-wide slot. No automatic refund/replay is attempted; reconciliation is required before production coordination rollout.
2. Checkpoints mitigate later failure loss but do not atomically couple provider delivery, settlement and output storage. Partial results are retained in Cloud; no partial-result recovery UI is shipped.
3. Provider transport ambiguity before a successful response needs request-log reconciliation rather than assuming generation never happened. Existing failure refunds do not prove remote cancellation.
4. General Growth Officer/single-specialist calls lack durable request-key deduplication and shared throttling. Coordination alone has an organization gate and three starts/minute.
5. Owner overview has bounded reads (1,000 organizations / 10,000 usage rows) and can understate totals at scale. Owner initialization is deferred; this was not repaired here.
6. Recurrence lock-order concurrency requires a two-session reproduction. Coordinated conversation deletion can be blocked by the result reference; no deletion lifecycle was added.
7. Full revocation/concurrency/browser role matrix, API-failure injection, accessibility, audit retention/export and account lifecycle remain unverified or unfinished.

## Performance and next priorities

Execution keysets preserve the earlier complete-list strategy; 3,507-row synthetic traversal was tested previously, not rerun as a real dataset this session. Current lists still collect records before client filtering/pagination; server filtering and consistent aggregate totals remain next-stage scaling work. Search is intentionally bounded, not semantic retrieval.

Priority order: (1) durable settlement/output reconciliation and leases, fault injection and complete SQL/browser role matrix; (2) complete single-call idempotency and owner aggregate completeness; (3) versioned content workspace and measured technical SEO with work links; (4) real source connectors/KPI definitions; (5) CRM and controlled workflows.

Differentiators evaluated: opportunity ranking and executive briefings are feasible using verified facts/work checkpoints; health monitoring can extend real deadline/failure signals; strategy simulator must label assumptions and wait for reliable budget models; competitor radar needs permitted crawl/source ingestion; revenue/customer/conversion intelligence require real CRM/analytics; brand intelligence needs approved identity artifacts; semantic knowledge search needs scoped embeddings/retrieval. None of these is claimed as shipped. An additional useful proposal is evidence-backed experiment review: compare approved hypotheses with actual outcomes, without fictional attribution.

External dependencies: permission to configure source accounts and payments/SSO when requested, authentic customer measurements, finalized prices, and approved deployment for unattended callbacks. These are not bypassed or fabricated.