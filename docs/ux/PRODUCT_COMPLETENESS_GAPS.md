# Product completeness — connected campaign evidence round

26 November 2026. Scope: source review, guarded staging schema inspection, frontend/pure logic changes and automated verification. No production database changes, permissions changes, paid AI, credential resets, external writes or publication.

## Evidence standard

The directive lists **26** capability areas, including multi-business management. Existing pages/tables are not completion evidence. The 126-file regression suite validates rules and component interactions; it does not establish authenticated end-to-end completeness or provider connectivity. Staging read-only identity/schema inspection found 109 public tables with RLS enabled and 57 Drizzle ledger entries; this does **not** establish that every policy is correct, nor that pending proposals are applied. No new SQL suites were run: no schema or permission changes were made.

## Capability review

Each row separates implemented source from the still-disconnected business outcome. Shared records/readers are to be reused; none requires a parallel page, ledger, AI dispatcher or calculation model.

| # | Area | Present in source / rule coverage | Gap, complexity and next meaningful value |
|---|---|---|---|
| 1 | Business intelligence and understanding | Confirmed facts, conflict history, understanding and KPI definitions; pure-function regressions | Complete records and authenticated edit/read-back still needed; keep one confirmed knowledge store rather than profile mirrors. |
| 2 | Market and competitor intelligence | Scoped competitors, website discovery and source-linked snapshots | Coverage is limited to retrieved sources, not a complete market. Connect relevant findings to the campaign proposal, not another competitor dashboard. |
| 3 | Growth opportunities | Deterministic signals, next step and scoped opportunities | Show evidence and one priority; opportunity-to-campaign handoff still needs lifecycle validation. |
| 4 | Growth strategy and prioritization | Versioned plans, goal linkage, priorities and comparisons | Proposal approval is not yet a coherent assignment-to-work transition. Reuse plan/task links. |
| 5 | Campaign management | Guided objectives, scoped campaigns, plan/content/budget/work/results/approval tabs | Proposal 0092 remains a rollout dependency; approval-to-specialist/task preparation is not complete. Do not portray draft status storage as validated execution. |
| 6 | Advertising | Integration registry, campaign channels, simulated external-write preparation | No live advertising execution validated or authorized. Connected account permissions, exact action approval and actual spending reconciliation are required. |
| 7 | Content strategy/production | Content drafts, review, repurposing and calendar | Draft approval is not publication. Connect approved versions and recorded outcomes; retain exact-version approval. |
| 8 | SEO/website optimization | Bounded website checks, history, findings-to-task and source guards | Technical findings do not prove traffic growth. Validate configured Search Console reads before comparison. |
| 9 | Website conversion optimization | CRO specialist and conversion diagnosis | This round withholds conversion ratios for mismatched periods and connects advice to campaign context; controlled changes and outcomes remain separate authorized work. |
| 10 | Leads and qualification | CRM contacts/deals and recorded lead measurements | Qualified-lead quality is not inferred from total enquiries or task completion. Source mapping and lead-stage evidence remain necessary. |
| 11 | Sales follow-up/conversion | Sales pipeline and internal task preparation | No complete approved outreach-to-response lifecycle. Avoid adding a second CRM; use contact/deal/task references and authorized providers. |
| 12 | Retention/reactivation | CRM context, content and campaign preparation | No validated retention cohort or approved reactivation-to-outcome chain. Do not invent eligibility, send messages or label repeat sales as retained customers without records. |
| 13 | Upsell/cross-sell/referrals | Existing campaign/CRM preparation primitives | Advisory only; product/customer relationships and consent-dependent outreach remain missing. |
| 14 | AI specialist collaboration | Specialist runs, two-specialist coordination, QC, role checks and single-request accounting | Specialists still require explicit user-started requests. Approval-to-task assignments must use those records rather than a duplicate agent engine. |
| 15 | Growth Officer | Scoped confirmed business context, question-bound record references and metered responses | This round adds tailored per-improvement campaign handoffs; sending is still explicit and paid AI was not tested. Continuous autonomous coordination is not claimed. |
| 16 | Execution/automation | Task runs, recorded attempts, reconciliation and admin-started due cycles | No unattended signed-in system actor or silent external execution. Campaign work must share these gates. |
| 17 | Integrations/external actions | Manifests, approvals, probes; read-only GA4, Search Console, Stripe and HubSpot adapters exist | Adapter source is not a configured integration. External writes remain simulated/unvalidated; show Not configured when absent. |
| 18 | Analytics/attribution | Metrics, measurements, corrections, recorded touchpoints, linear attribution | This round prevents ambiguous/overlapping totals and period-mismatched ratios; dated campaign spend is matched to measurement windows. Attribution is allocation, not causation. |
| 19 | Finance/budgets | Spend ledger, allocation, canonical economics, credit prices and per-currency rollups | Profit/CAC/customer value need real customer/COGS/attribution inputs. Lifetime attribution ratios remain labelled and must not become profit claims. |
| 20 | Experiments/A-B tests | Experiment lifecycle, observation history, SQL significance gate and pure screen rules | This round connects campaign-linked, database-recorded experiment classifications to Results and AI explanations. Simulation, correlation, incomplete and unclassified outcomes remain distinct. No second significance calculation. |
| 21 | Forecasting/scenarios | Estimated planning, budget alternatives and simulations | No validated calibrated growth forecast. Scenarios remain estimates; avoid projecting sales without evidenced assumptions. |
| 22 | Reporting/decisions | Period reports, source/formula labels, strategy comparisons and organization summaries | Canonical-finance consolidation, completion timestamps and organization report selection remain unfinished in the existing roadmap. |
| 23 | Data reliability | Verified facts, freshness, conflict handling, provenance, bounded complete reads | This round adds campaign metric source/date/window visibility. Manual input is not independent verification; missing reads are not zero. |
| 24 | Security/governance | Organization/workspace RLS, roles, MFA-owner controls, accounting proof, rate limits and approval boundaries | No policy/security mutation here; source tests and RLS-enabled inventory are not a fresh full security audit. Live rollout remains separately authorized. |
| 25 | Onboarding/UX | Guided questions, translated screens, progressive campaign tabs, explicit empty/error states | Three signed-out staging sizes/locales checked; authenticated scenarios, six-persona usability and formal WCAG validation remain open. |
| 26 | Multi-business/organization | Workspace assignments, org views/intelligence, reporting-currency conversions | Cross-business decisions still need each business's rights and recorded inputs; no organization-wide approval shortcut. Authenticated cross-workspace browser validation not run here. |

## Delivered connections

1. **Recorded measurements → reliable campaign diagnosis.** One active counting definition per metric key; corrected history and shared evidence priority; overlapping windows rejected; clicks and conversions must cover identical periods. Cost-per-lead/acquisition and rising-cost comparisons use only actual dated spending in the corresponding periods; rising-cost comparisons require completed equal-length windows. No simulated spending enters actual cost figures.
2. **Diagnosis → practical next step.** Three initial priorities, additional advice behind an explicit control. Each improvement prepares a campaign-scoped question containing its actual rule/recommendation. The Growth Officer refetches current records, is told not to upgrade advice into evidence, and starts work only after the user sends. Existing internal-task creation remains available to permitted members.
3. **Experiments → campaign results and explanation.** Existing scoped BI reads supply the campaign's own experiments. Their database-recorded evidence strength is reused; simulation and unclassified source rows cannot become verified growth evidence. Other campaigns' experiments are excluded. Results link back to the existing experiment workflow.
4. **Evidence → understandable numbers.** Source kind, recorded/corrected date and measured periods are available next to Results. Attribution/lifetime scope and the distinction between revenue ROI and profit are explicit. No new data model or external action introduced.

## Verification

| Check | Result | Actual coverage |
|---|---|---|
| Full Vitest suite | PASS | 1,001 tests in 126 files, including new measurement guards and experiment classification. |
| Campaign component interactions | PASS | Three synthetic unit-fixture tests: scoped experiment wiring, scoped improvement handoff, failed-read suppression. These are not authenticated E2E tests. |
| Guidance and language regression | PASS | Scoped one-time references, role-aware actions and EN/NL/FR key coverage. |
| Isolated staging browser | PASS, limited | EN 1280×1800, NL 822×698, FR 390×844: protected campaign URL redirected to sign-in; localized title, zero horizontal overflow and zero page errors. French phone screenshot inspected. |
| Authenticated campaign Results → Growth Officer → persisted output | NOT RUN | No temporary staging credentials/session available. No password reset, MFA change, account creation or paid inference attempted. |
| Real provider reads/writes | NOT RUN | Requires configured authorized connection; live writes are outside this delivery. |
| Production rollout / paid AI / outreach | EXCLUDED | Requires separate authorization; no claims of execution, growth or production deployment. |

Platform compilation: PASS (latest build OK at 09:09:11 UTC). Changed-source formatting and ESLint: PASS. Post-format campaign regressions: 22/22 PASS. Code saved as `879b562763f4b03b50ddf02b7671a6829ab67a82`; the read-only GitHub check immediately after commit returned **Not synchronized**, with no CI run for that commit yet. The platform sends commits after the turn; previous green CI does not validate this code. The documentation update is committed separately and its final synchronization status is checked again before the closing response.

## Next connected delivery

The largest remaining in-scope product gap is **approved campaign proposal → explicit specialist assignments and internal task preparation**, without approving external execution. First establish proposal 0092's persistent staging availability and authenticated save/read-back; do not add a second proposal table. Retention/follow-up and real customer economics remain dependent on the actual connected customer/source data and external-action authorization. A complete product or complete growth lifecycle is **not** claimed.