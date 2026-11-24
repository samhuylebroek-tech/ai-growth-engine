# AI Growth OS — Task Queue
## Round 6 — complete UX/UI workstream, phase A–B (2026-11-23, staging only)
- [x] Phase A audit: automated sweep of all 34 signed-in pages × desktop/tablet/phone + screenshots; inventory, findings and backlog in `docs/ux/UX_AUDIT.md`.
- [x] Phase B navigation: 7 destinations in journey order (Home, AI team, Your business, Growth plan, Execution, Results, Organization), max 7 tabs, AI specialists added, URLs unchanged; EN/NL/FR; rules tested.
- [x] Active tab visible again; current tab scrolls into view on phones; 44 px tab targets.
- [x] Accessibility: 70 unnamed fields on Goals and 2 on Business knowledge named; Organization overview title shown while loading/failing; AI statement labels and recommendation links meet 24 px target size.
- [x] "Performance" renamed "KPIs & targets" (NL/FR) so it no longer reads like Business performance.
- [x] P1 Home: attention, goal, priorities and active work first; four secondary sections fold (remembered); readable activity previews (no raw AI Markdown); phone 12.7k → 9.6k px.
- [x] Home: merge the two "next best actions" lists (business summary + signals).
- [x] P1 Goals & budget: plan, budget and linked work fold per goal (primary open); 7.4k → 3.4k px desktop.
- [x] P2 Growth Officer: conclusion + actions first, evidence/reasoning folds (label-based, tested); question box pinned on all sizes; clean conversation titles. Browser: admin desktop/tablet, member phone.
- [x] P2 Tasks filters: one scrolling row on phones (36 px), chosen filter kept in view. Results tabs fit at 820 px; overflow arrows elsewhere.
- [x] P3 One smallest type step `text-2xs` (11 px) replaces 268 ad-hoc 10/11 px sizes (tested with tailwind-merge).
## Round 7 — maximum autonomous mission (2026-11-24, staging only)
- [x] Home: one "Next best actions" list — signals to act on first, then the top 3 growth actions; business summary is figures only ("Revenue and spend"). Browser: admin desktop, member phone.
- [x] Sweep 2 (33 pages × desktop admin / tablet viewer FR / phone member): no horizontal overflow, one h1 everywhere, no console errors; standalone links ≥ 24 px (Home, Situation, Business, Revenue, Improvements, task titles).
- [x] AI specialists: capability table folds (phone 6.6k → 4.4k px). Notifications: translated titles/details per kind (were English-only), AI summaries as 2-line previews (6.0k → 3.8k px). Knowledge base: first 8 facts + show all (7.6k → 5.3k). Business performance: top 4 growth actions, comparison and growth levers fold (8.9k → 6.0k).
- [x] Experiments: lifecycle as one line + quiet progress bar (chips looked like buttons); hypothesis first, full design on request (phone 5.0k → 2.9k px). Growth intelligence: fact source shown in words ("Confirmed · Entered by your team"), not the raw value "user"; valid description-list markup.
- [ ] Remaining page redesign sweep: Business profile/knowledge, Situation, Opportunities, Strategies, Campaigns, KPIs, Economics, Reports, Experiments, Organization, Integrations, Approvals, Settings, Owner center, Billing.
## Round 5 (complete UX finish)
- [x] Server refusals (no credits, another request open, request still active) read in EN/NL/FR on every AI screen, kept under the 200-character display cap.
- [x] Strategy panel offers recovery of an open/refused request; closed requests leave the "unfinished" list.
- [ ] Strategy request end to end in French (generate, save, reload, reopen, credits): blocked — staging test business has 0 of 200 credits this month; awaiting owner decision on extra staging test credits.
- [ ] Re-run the full growth cycle with new records after credits are available.
- [ ] Persona re-sweep (5 roles × EN/NL/FR × desktop/tablet/phone) after the redesign.
- [x] Full lifecycle run on staging through the interface (admin, EN): goal → AI strategy (saved) → Growth Plan draft → approved → initiative turned into a project → campaign linked to goal/strategy/initiative with KPI → awaiting approval → approved → active → task → done → €120 hand-entered spending → Growth economics shows €120 → metric + October result → growth chain shows the result. Found and fixed on the way: strategies came back in the business-facts language instead of the interface language; new campaigns could not pick a goal; campaign progress always said spending was "not recorded"; a search inside "My tasks" gave no way to search all work; long strategies were one wall of text; goal cards had no heading and their fields repeated the same names; the results step said "done" instead of "measured".
- [x] GitHub sync + CI: round-4 commits synchronized at 4e5655a, all five CI checks passed (checked at start of round 5).
## Round 5 — ultimate master build: CI stabilization + lifecycle validation (2026-11-23, staging only)
- [x] GitHub audit: branch product/operating-system-experience-blueprint, local HEAD a280a0c = GitHub branch HEAD (Synchronized), PR #1 open → main; CI 4/5 green, ESLint red.
- [x] ESLint root cause (reproduced on a clean install of the PR merge commit): 16,266 Prettier findings in 470 files + one `any`; formatted with the project's own settings, generated backend client excluded from formatting, local build cache excluded from lint. Lint: 0 errors, 58 warnings left visible (react-refresh structure, 2 intentional id-keyed effects).
- [x] CI reproducibility: Bun pinned 1.4.4 (= local), checkout v5 (Node 24 warning). Routines: `scripts/ci/format-changed.sh`, read-only `scripts/ci/github-status.ts`.
- [x] Performance: workspace list and learning list were re-created every render (organization context re-rendered all consumers); memoized.
- [x] "My tasks" empty state: says nothing is assigned to you and offers all tasks (EN/NL/FR), browser-checked EN/FR.
- [x] Personas B–E page sweeps on staging: B admin EN desktop (12 lifecycle pages), C member NL phone, D viewer FR tablet (no create/plan buttons, AI starters disabled with reason), E owner EN desktop (organization overview). One h1 per page, no overflow, no console errors.
- [x] Growth Officer on the latest code: member NL phone, campaign-attention question; structured, labelled answer; 6 credits = usage event = ledger delta.
- [ ] CI result for the new commit: visible only after the platform pushes; check with `bun scripts/ci/github-status.ts` next round.
- [ ] Full lifecycle run that creates new records (goal → strategy → initiative → campaign → tasks → KPI → report) end to end on staging.
- [ ] Old QA records with broken titles ("{", answer headings as campaign names) remain on staging; deletion not authorized.
## Round 4 — product excellence, intelligence, consistency, validation (2026-11-23, staging only)
- [x] Verify branch, HEAD, GitHub, staging (HEAD c84969a = GitHub branch, compare identical; staging ledger 57, 58 files: 0057 is the live-only 0088a subset, already in staging via proposal 0088).
- [x] P2 Growth Officer: question focus (relevant context first, background shortened before dropping), answer structure (happening / evidence / why / cause / uncertain / next / measure), trade-offs, no needless questions. Real staging runs: NL owner campaigns 7 credits, FR member mobile blocked work 6 credits (= usage events = ledger).
- [x] P1 One page header pattern on every module (title, purpose, actions), localized titles; menu labels match titles; 32 pages aligned (NL admin desktop, FR viewer mobile).
- [x] P4 Persona journeys A–E on staging (A round 4; B–E page sweeps round 5).
- [x] P5 Security: 39/39 server functions authenticated, no API routes, basic scan clean, 55/55 staging SQL suites (0090 25/25), minimatch fixed, esbuild (drizzle-kit CLI only) analysed and accepted.
- [x] Forms show their field names (goal, budget, competitor forms); plain words for 'starting point', 'target' and 'spending limit'; persona A goal journey checked EN tablet + NL mobile.
- [ ] P6 Lifecycle handover review (business → … → optimization).
- [x] GitHub sync check routine (script + rule) — round 5.
## Round 3 — continuous master development (2026-11-23, staging only)
- [x] E Connected growth journey: 12 steps from onboarding to "what happens next", per role, unknown when a read fails, contradictions counted; compact on Home, full under the business summary (EN/NL/FR, tested, browser-checked).
- [x] A Evidence per AI statement: each label opens the cited records (looked up under the viewer's access), what the answer itself says about source/formula/period, and a plain support verdict; no invented confidence. Real staging conversation: 5 credits = usage event = ledger.
- [x] B Same labels on every report figure (business, economics, initiative, strategy, learning) with source, formula and period; estimated gross profit labelled estimate.
- [x] C Organization Growth Officer: same labels for objectives, priorities, recommendations, risks, KPIs, gaps and opportunity evidence; facts need a cited business record; business vs organization level shown. Real staging run: 12 reserved, 4 refunded, 8 charged = usage event.
- [ ] D Visual consistency pass across modules.
- [ ] F Growth Officer intelligence improvements.
- [ ] G Five persona journeys re-run on the new screens.
- [ ] H Security revalidation after this round (no schema changes this round).
- [ ] J GitHub sync: commits are pushed by the platform after the turn; verify next round.
## Round 2 — onboarding, trustworthy answers, journeys (2026-11-22, staging only)
- [x] Verify branch, HEAD, clean tree, staging project and ledger before work (HEAD 0f9fc65, ledger 57, proposals to 0090).
- [x] A Onboarding: customers, sales process, challenges, resources, ambitions, time horizon, constraints; short skippable steps, saved progress, editable, EN/NL/FR, mobile; reuse existing facts/knowledge (no second store).
- [x] A Business understanding summary after onboarding (confirmed vs assumption, missing), editable; connect to Growth Officer, knowledge, goals, next step.
- [x] B Growth Officer + specialist/team answers: claim-level labels (EN/NL/FR), fact worded uncertain → hypothesis, legend.
- [x] B Evidence drill-down per labelled statement; same labels in reports and organization officer (round 3).
- [x] B Five controlled staging Growth Officer scenarios; 27 credits = usage events = ledger.
- [x] C Persona journeys (page walkthroughs A–E + member/viewer; fixes: read-only onboarding overview for non-editors, economics main title) A–E (simulated), roles, languages, devices.
- [x] D First-growth journey after onboarding: summary → fill gaps → growth situation → prepared Growth Officer question → goal (per role, tested).
- [x] E Next step aware of onboarding progress, approvals and warnings; members told proposals wait for an administrator (tested).
- [x] F Website-check limit refusal in the browser NL/EN/FR (reserved domain, no fetch, nothing saved); unregistered target counted as failure.
- [ ] G UX consistency pass across modules.
- [x] H Revalidation: 55/55 staging SQL suites incl. 0091 (stale edits, repeats, unauthorized edits), production packages clean.
- [ ] H Two moderate advisories in developer tools only (esbuild via drizzle-kit, minimatch via eslint/gateway tooling): upstream packages, not in the app.
- [ ] GitHub sync status checked honestly.
## Grand master mission, round 1 (UX, guidance, Zod 4) — 2026-11-22
- [x] Environment verified (branch, HEAD 48f1206, clean, staging ledger 57, proposals to 0090; no migrations this round).
- [x] Home: one clear next step for the person's role (pure `next-step.ts`, no AI/credits), with up to two alternatives.
- [x] Home: short "How it works" guide that teaches through the real pages; dismiss per person, reopen from the header.
- [x] Home: extra figure tiles behind one "Show all figures" button (remembered per person and business).
- [x] Fix: members were sent to the business setup that only editors can confirm (Home warning and quick action).
- [x] Business details: "What we know about your business" per topic (confirmed / found / AI guess / contradicting / older than a year / missing / not checked), with what to do and who can do it.
- [x] Zod 4.6.6 upgrade (GHSA-mrhx-c7xc-m3w5 fixed); IDs validated with the same lenient check as before; CI audit no longer ignores the advisory.
- [x] Data source connections: refused keys explained in the user's language ("not accepted", "no read permission", wrong format, outage); connect limit browser-tested (6th attempt refused, NL).
- [x] Website-check limit refusal in the browser (done in round 2).
- [x] Onboarding: customers, sales, challenges, resources, time horizon, constraints (round 2).
- [x] Growth Officer: answers labelled per statement (round 2).
- [x] Persona journeys A–E page walkthroughs (round 2; simulated, not human usability studies).
- [B] Rate-limit values and proposals 0063–0090 into the live database: owner approval.
## Phase 8.8 final completion & financial integrity — 2026-11-21
- [x] Environment verified (branch, HEAD 4586721, clean, staging marker, ledger 57/57, proposals to 0086).
- [x] A AI cost per campaign/initiative/strategy/goal at the historical credit price; per specialist, task, run, retries, second reviews; pending/unknown apart.
- [x] B Organization economics in a reporting currency: month-by-month closing rates (ECB, weekends/holidays, max 7 days old, ECB cross rate), withheld with reasons; ECB 90-day history import (proposal 0087, staging).
- [x] C Canonical formulas documented (docs/FINANCIAL_RULES.md); months reconcile with the period summary; refunds in the sale month.
- [x] F Growth Officer and reports carry campaign AI cost from the same summary.
- [x] Tests: Vitest, SQL suites 51/51, staging browser checks (owner/admin/member/viewer, EN/NL/FR, desktop/tablet/phone).
- [x] Weekly/initiative/strategy/AI-execution/learning report types (exist in `reports.ts` / `growth-reports.ts`).
- [x] Organization overview converts only the current month (today's closing rate); longer periods point to the month-by-month Economics view.
- [ ] Converted figures on Home and in the Growth Officer context: still per currency (by design so far).
- [B] Real profit, CAC, ROAS: need real cost of goods, customer references and sales (staging has QA data only).
- [B] Proposals 0063–0087 into the live database: owner approval.
## Phase 8.8 third stage — unified growth intelligence — 2026-11-21
- [x] Environment verified (branch, HEAD 5d2de9e, clean, staging marker, ledger 57/57, 0084/0085 hashes match, RLS on all 103 tables).
- [x] A Platform Owner credit pricing screen (history, future prices, currencies, reasons; credits only until a price exists). Proposal 0086 (staging) limits history to the Platform Owner.
- [x] B Economics: formulas and exact missing-input explanations; channel spending; shared summary.
- [x] C Organization economics across businesses (original currency; no conversion shown yet).
- [x] D Growth Officer reads the economics summary (budget, allocation, spend, costs, AI cost, learning outcomes).
- [x] E Home financial alerts from the same figures.
- [x] F Report economics section reconciled with Growth economics (tests).
- [x] G Measurement follow-up for recommendations (Home alert when the app is opened; no background monitoring).
- [x] H Campaign/initiative AI cost: money value per campaign and level (final completion round).
- [x] Tests (727), browser checks owner/admin/member/viewer, EN/NL/FR, phone width.
## Phase 8.8 — unified campaign economics — 2026-11-22
- [x] Environment verified (branch, HEAD 9567347, staging marker, ledger 57/57, RLS on all tables).
- [x] Proposal 0084 (staging only): shared budget-line allocations, insert-only allocation events, member requests with editor decisions, spend linked to a line and refused above the allocation; rollback 40/40, SQL suites 48/48, real two-session concurrency check.
- [x] Budget allocation screens (business budget per currency, per-line split, requests, history, goal drill-down) and spend line selection, EN/NL/FR.
- [x] Campaign specialists and AI costs panel (recorded credits only, no invented money value).
- [x] KPI measurement periods: comparable before/after with confidence, measurement quality per metric.
- [x] Second stage: proposal 0085 (staging only; rollback 40/40, SQL suites 49/49): budget-decision hardening, spend categories, insert-only business costs and versioned cost models, Platform-Owner credit price history, recommendation learnings.
- [x] Growth economics page (/app/economics): business money, campaign table, initiative/strategy/goal rollups counted once, cost model and cost ledger with corrections, AI credits priced only by a set price; EN/NL/FR, roles, phone.
- [x] Possible duplicate budget lines flagged (never merged or deleted); a lookalike line needs "separate budget" plus a note.
- [x] Campaign spend cost category selection.
- [x] Recommendation learning on Improvements: stages, lessons checked against the recorded measurement, patterns only from 3+ actual learnings over 2+ campaigns.
- [x] Credit price editor for the Platform Owner.
- [x] Growth Officer context, Home alerts and reports using the economics figures.
- [x] Organization-level economics across businesses.
- [B] Campaign profit, ROAS, CAC with real figures: need recorded cost of goods, customer references and a credit price (inputs now exist; staging has only QA data).
- [B] Proposals 0063–0085 into the live database: owner approval.
## Phase 8.2 extended sprint — 2026-11-20
- [x] Environment verified (branch, HEAD a53b2d6, staging marker, ledger 57, proposals to 0073).
- [x] Evidence freshness (type-aware; historical records never expire; source unavailable / verification required).
- [x] Fact conflicts: detection with sources/authority, atomic resolution (staging proposal 0074), Growth Officer context + alert.
- [x] Recommendations: duplicate detection, explanation completeness.
- [x] Stability stress test (context/language/user switching, rapid navigation, network interruption).
- [x] Localization sweep of every route in NL/FR; fix English leftovers.
- [x] Staging test-data inventory from live staging queries.
- [x] Final regression, report, commit.
## Phase 8.2 — product completion, evidence governance & quality — 2026-11-20
- [x] B1 Audit: 20 systems, findings + checklist in docs/PHASE_8_2_REPORT.md.
- [x] B2 Evidence governance (proposal 0073): six evidence types, lifecycle with history and versions, proposal levels (observation/formal/execution), admin inspects evidence before approval, AI text never counts as independent evidence.
- [x] B3 Evidence quality labels on opportunities, proposals, org opportunities, strategy/Growth Officer recommendations, experiments, next best actions; transparent ranking factors; duplicate explanations; standard recommendation stages.
- [x] B4 Strategy integrity: versions, approval references, task origin traceability (validate; fix gaps).
- [x] B5 Financial integrity: credits, revenue, budgets, currencies (validate with tests).
- [x] B6 Localized browser tab titles/descriptions EN/NL/FR on every route.
- [x] B7 Security: evidence tables in the access matrix; role refusals with exact codes.
- [x] B8 Integration safety: simulated lifecycle validation.
- [x] B9 Staging end-to-end walkthroughs (business, organization, roles, finance, external actions).
- [x] B10 Test-data inventory refresh, final report, commit.
- [x] Owner center and remaining deeper module texts in NL/FR.
- [B] Proposal 0073 into the live database: owner approval.
## Phase 8.1 — finalization & operational readiness — 2026-11-20
- [x] Org Growth Officer: real business names in stored drafts (display-only, original kept), refs stored for new drafts, similar names distinguishable.
- [x] Organization AI credit overview (proposal 0071): pool balance, reserved/consumed/released, month, per business/specialist/Org Growth Officer, drill-down.
- [x] Financial consolidation audit + tests (rate dates, weekends/holidays, missing rates, ECB outage, credits ≠ money, ad vs AI costs, unattributed revenue).
- [x] Integration-audit fixes: atomic budget transfer (0072), single-currency move suggestions, improvement→task origin shown, revenue label made explicit.
- [x] Require evidence on improvement proposals: decided by Phase 8.2 (three proposal levels).
- [x] Staging test-data inventory + cleanup proposal (no deletion).
- [x] Security matrix test across businesses/brands/roles.
- [x] Localization gaps (onboarding, profile, billing).
- [x] Full regression: Vitest, SQL suites, browser EN/NL/FR desktop/tablet/phone; report.
## Phase 8 — organization growth intelligence — 2026-11-20
- [x] Audit: branch, staging identity, hierarchy, Growth Officer, org reporting, specialists, budgets/credits/goals/strategies/performance.
- [x] Proposal 0070 (staging only): org strategies, cross-business opportunities, shared initiatives with per-business commitments, allocation proposals, org AI request accounting; SQL assertions.
- [x] Pure org intelligence: opportunity rules, resource allocation, specialist orchestration, monitoring, ranked next best actions.
- [x] Organization Growth Officer (metered, admin-started) drafting an organization strategy and AI opportunities.
- [x] Organization Command Center upgrade: objectives, officer summary, comparison, opportunities, initiatives, budgets, specialists, actions, risks, pending decisions, history.
- [x] Context switcher: organization / business / brand-unit; single-business stays simple.
- [x] EN/NL/FR; Vitest + SQL suites + staging browser checks (desktop/tablet/phone).
- [x] Organization-level AI credit total on the Resources tab; stored drafts show business names (8.1).
## Phase 6 — business intelligence, revenue & attribution — 2026-11-20
- [x] Proposal 0066 on staging only (88 SQL checks): brands/units, metric links, permanent revenue ledger, verified imports needing read permission, touchpoints, experiments, improvement proposals.
- [x] Business performance overview: per-currency figures with source/period/class, standard KPIs per business model, strategy/campaign/channel comparisons, six attribution models, next best actions, business knowledge map.
- [x] Revenue & attribution page, Improvements (admin approval → task), Experiments (significance-checked evidence), Home summary; EN/NL/FR.
- [x] Growth Officer context: revenue by class, attribution, experiment learnings, proposals and unverified business areas.
- [x] Staging walkthrough: owner/member/viewer/outsider roles, NL phone and FR tablet layouts.
- [B] Real revenue/attribution imports need real connector credentials and your approval; production migration needs separate approval.

## Phase 5 — autonomous growth orchestration — 2026-11-20
- [x] Scheduler: bounded, traceable execution cycles ranked by priority/deadline/goal/plan; dependency-, credit-, cap-, window-, approval- and parallel-aware; idempotent; one open cycle; history with a reason per task (staging proposal 0064, 49 SQL checks).
- [x] Governance: emergency pause, daily cap, parallel limit, retry limit, allowed specialists, execution hours, schedule; audit-logged.
- [x] Scheduled cycles become due and an admin starts them (user decision: no unattended system account).
- [x] Growth Officer next best actions, duplicates, bottlenecks (deterministic, no credits).
- [x] Costs & ROI page: credits per goal, plan, initiative, campaign, project, task, specialist; budgets per currency; revenue/ROI not attributed without a source.
- [x] Integration Hub (Phase 5B, proposal 0065, 66 SQL checks): six permission levels per connection, health/freshness, simulated providers for 11 platforms, revoke, sync history.
- [x] External actions: one lifecycle recommendation → draft → review → approval → execution → verification → result; simulated execution with timeout/denial/expiry/drift scenarios; specialist boundaries; Home and approvals overview.
- [ ] Real provider write adapters (Google Ads, Meta, LinkedIn, HubSpot writes, Salesforce, Mailchimp, WordPress): need credentials, provider app approval and the owner's permission.
- [ ] Planned-vs-actual comparison and optimisation proposals over verified results (links are stored; comparison not built).
- [ ] Continuous optimisation loop and strategy version comparison.
- [ ] Multi-business / brand units within an organisation.
- [ ] Command Center: add budget deviations, spend and opportunities to Home tiles.
- [B] Proposals 0063–0064 into the live database: owner approval.
## Master build directive Phase 4 (execution engine) — 2026-11-20
- [x] B1 Task data model: specialist assignment, task type, per-run records with stable keys, one open run per task, max 3 attempts (staging proposal 0063, 47 SQL checks).
- [x] B2 15 AI specialists with structured results through the existing metered single-request accounting; verified with 4 real staging runs.
- [~] B3 Runtime: queue, start, pause/resume/cancel before start, lease expiry + settlement from recorded AI state, uncertain never retried. No background scheduler: runs start from the user's action or the mode-4 batch (needs a deployed URL + cron, blocked on staging URL).
- [x] B4 Modes 1–4 per workspace, task-level approval requirement (stricter wins), admin approve/reject with reason; external actions never run by AI.
- [~] B5 Credits: per-run estimate, per-run and monthly caps, reserved/used, cost per task and per specialist. Open: cost per initiative/campaign/strategy views.
- [x] B6 Tasks: AI work tab, filters (AI, awaiting approval, running, failed, blocked, completed), list badges, run history.
- [x] B7 Home: 10 execution tiles from records.
- [x] B8 Signals: overdue plan tasks, initiatives behind their week, repeated AI failures, runs awaiting approval, uncertain runs.
- [ ] B9 Connector execution interfaces with mocks (no real activation).
- [ ] Approval "edit parameters" for a run; strategy-level mode setting.
- [B] Proposal 0063 into the live database: owner approval.
## Master continuation directive (Phase 3: opportunities → execution) — 2026-11-20
- [x] P1 NL/FR: tasks, projects, campaigns, pipeline, SEO, competitors, Content Studio (incl. AI draft/review/repurpose/calendar), data sources, app frame, home/pricing/sign-in with language choice.
- [x] P2 Command Center number tiles: 15 tiles from real records with kind/source/period/definition; revenue only from an imported source; verified against staging data.
- [x] P3 Opportunity → strategy → approved plan → initiatives/campaigns/tasks, with visible chain and duplicate prevention.
- [ ] P4 Task orchestration: specialist assignment, execution states, history, cost, retry/cancel/pause.
- [ ] P5 Autonomy levels (1–4) with external actions always needing explicit authorization.
- [ ] P6 Proactive Growth Officer signals (stalled tasks, budget deviation, behind target) in Command Center + notifications.
- [ ] P7 Multiple strategies side by side with conflict/duplicate-spend checks.
- [ ] P8 Credit visibility: available/reserved/consumed/failed, traceable to strategy/initiative/specialist.
- [ ] P9 End-to-end test of the full chain on staging, all languages, desktop/mobile, light/dark.
## Master build directive (revenue opportunities) — 2026-11-20
- [x] Revenue Opportunity Engine: user-started AI discovery across 9 growth areas, scores/budget/evidence/KPIs/risks, shortlist/dismiss/convert-to-goal, Home card, Growth Officer context; staging proposal 0060 (22 SQL checks).
- [x] Uncertain AI outcomes: in-app close step (requester or org admin) counting reserved credits as used — no refund, no replay; staging proposal 0061 (14 SQL checks). Verified on staging.
- [ ] Root cause of the one cancelled 61 s AI call on staging is unknown (later 87 s call succeeded); output cap lowered to keep calls short.
- [B] Proposals 0060/0061 into the live database: owner approval.
## Master development directive — 2026-11-20
- [x] A: branch/commits/staging verified; runtime environment guard (staging refuses mixed/production config, noindex, staging label); Cloudflare plan with minimal token rights.
- [x] B: security review — OAuth redirect allowlist, PKCE, constant-time state check; regression tests; open risks in docs/SECURITY.md.
- [x] C/D: rule-based signals shared by Growth Officer context and Command Center next best actions; verified on staging in NL/FR/EN.
- [x] I: central NL/EN/FR language for navigation, header/menu, statuses, Command Center frame and signals.
- [x] J: unit 290/290, staging SQL 23/23, browser phone/tablet/desktop light/dark, docs.
- [x] NL/FR for Growth Officer, Goals & budget, Performance, Growth intelligence, all of Start and Organization settings; Start/activity/notifications never show raw AI JSON.
- [ ] Next: DB-backed rate limit for token connects (proposal); Command Center health/budget/plan tiles from signals.
- [B] Backup branch on GitHub: cannot be created from here (no push); platform snapshots exist.
- [B] Staging URL: Cloudflare token. Live migrations/proposals: owner approval. Real integrations: owner credentials + permission.
## Afronding staging en verdere ontwikkeling — 2026-11-19
- [x] Staging reference confirmed by owner; branch and commits 045b82a/9facd9f verified on GitHub.
- [x] Platform Owner: direct staging insert investigated, retired with audit, re-initialized via the one-time procedure (proposal 0058, append-only audit).
- [x] Proposals 0057–0059 applied to staging only with a recorded ledger; SQL suites 23/23.
- [x] Read-only connections: Stripe/HubSpot token check, Google OAuth flow, encrypted credentials, health states, import runs + history, Track-as-metric; error path tested on staging.
- [x] Performance: imported values show their source and cannot be corrected by hand.
- [x] Growth Officer: coordinator rules, outcomes of completed initiatives, imported-source labels.
- [x] Command Center: approved plan/initiative summary; connection problems counted.
- [x] Full re-test on latest code: journey, roles, desktop light + phone dark; staging QA data cleaned up.
- [B] Reachable staging URL: Cloudflare API token for a protected staging Worker.
- [B] Live migrations and proposals 0057–0059: owner approval.
- [B] Real integration reads: owner's read-only credentials and Google OAuth client, plus permission.
## Continue master build (phase B/C) — 2026-11-19
- [x] Separate sandbox-local staging app with allowlisted environment; staging test accounts, Platform Owner and growth seed.
- [x] Performance: filters, status overview, charts, initiative links, detail page with monthly table and correction history; staging E2E incl. roles and phone.
- [x] Growth Officer reads metrics with source labels, trends and forecast deviations; verified on staging in Dutch.
- [x] Home: performance overview, linked metrics under primary goal, behind-plan attention, budget per currency.
- [x] Read-only integration groundwork: mappers for GA4, Search Console, Stripe, HubSpot (tested); integrations page shows real status and what each would import; proposal 0057 verified on staging (rolled back).
- [B] Staging reference mismatch: owner must confirm `tvfbvzytjpizqwixkecx` is the intended staging project.
- [B] Public staging hosting: not available from the sandbox.
- [B] Proposal 0057 and pending migrations on live: owner approval.
- [B] Real integration reads: owner's accounts and read-only credentials.
## Master build & execution — 2026-11-18
- [x] Phase A: staging initialized (56 migrations, buckets, separate AI accounting secret), 19/19 SQL suites incl. growth plan end-to-end, storage and privilege checks.
- [x] Privilege hardening migrations 0054/0055 (tested on staging only).
- [B] Staging app + staging test sign-ins/Platform Owner: needs separate hosting and the staging project URL + publishable key.
- [B] Applying 10 pending migrations to the live database: needs owner approval.
- [x] Performance measurement layer (0056): metric definitions, insert-only planned/forecast/entered values, corrections, idempotency; Performance page; Growth Officer context reads it with evidence labels. Tested on staging (39 SQL checks) + unit tests.
- [B] Performance page live use: waits on applying 0056 to the live database (owner approval); shows "not switched on" until then.
- [ ] Next: Command Center tiles from measurements, Growth Officer orchestration/action proposals, EN/NL/FR interface, read-only integrations (GA4, Search Console, Stripe) — each needs its own work package.
## Goal directive: stability + unified business context — 2026-11-17
- [x] M0: five failing tests fixed (coordination conversation selection, context query mock); 8 type errors and an undefined prompt variable in specialist analyses fixed.
- [x] M0: migration journal checked read-only (54 entries, contiguous, ordered; 8 committed but unapplied); forward-only policy in docs/MIGRATION_POLICY.md.
- [x] M1: one evidence-labelled, workspace-scoped business context (facts, goals, plans, pipeline per currency, budget, sourced competitors, SEO, Content Studio, campaigns, integrations) capped at 12,000 characters, used by every AI surface.
- [x] Verified: 221 tests, production build, no substantive lint errors; signed-in Growth Officer cross-area answers in English, Dutch and French; answer tables on desktop and phone.
- [x] Type check clean: growth plan screens type against the pending-schema extension until the 8 database changes are applied.
- [ ] Formatting: ~5,700 pre-existing Prettier formatting warnings across the code base; cosmetic, not reformatted to keep the history readable.
- [B] Growth Plans/initiatives in the AI context and screens: waits on owner approval to apply the 8 pending database changes.
- [B] Measured performance (traffic, ads, revenue): waits on real integrations being connected.
## Growth planning & content expansion — 2026-11-16
- [x] Link projects/campaigns to goals; linked work shown and editable on each goal (0040).
- [x] AI growth strategy per goal (metered, saved insert-only, convert chosen actions into a goal-linked project with tasks).
- [x] Rule-based budget reallocation suggestions within hard caps.
- [x] Content repurposing into other channels as new draft pieces; editorial calendar tab.
- [x] Tests: 156 Vitest, growth SQL 13/13, signed-in strategy/project/calendar/repurpose flow.
- [x] Sales pipeline: workspace contacts and deals by stage, goal links, entered-value summary (0041).
- [x] Guided setup ends with an optional first measurable goal (primary) and opens Goals.
- [x] SEO website check: robots, sitemap, up to 15 pages, on-page findings saved as permanent history, findings become tasks (0042).
- [ ] Next: competitor workspace; SEO keyword data waits on Search Console connection. (done: website snapshots, change tracking, review, tasks, briefs, goals, strategy input)
- [B] Social/ads/email operations and measured performance need real integrations the user must connect.
## Accelerated product delivery — 2026-11-16
- [x] P1 Content Studio: library, autosaved drafts, immutable numbered versions, compare, restore-as-new-version, campaign/date/writing-profile links (0037, 0038).
- [x] Writing Profiles with explicit authorization attestation for examples.
- [x] Exact-version approval by workspace admins only; one permanent decision per version; 14 SQL checks (tests/sql/content_studio.sql), 139 Vitest, signed-in browser flow.
- [x] AI drafting in Content Studio
- [ ] Next: content quality review, repurposing, editorial calendar, SEO workspace, competitors, CRM (Acceleration directive Parts 4–8) (done: website snapshots, change tracking, review, tasks, briefs, goals, strategy input)
- [B] External publication stays disabled until explicitly authorized.
## Resume autonomous master — 2026-11-16
- [x] Fresh baseline inspection and regression run: 133 tests passed; existing architecture preserved.
- [x] Release 0: close the cross-request active-dispatch race at the shared claim boundary, including document/website/team calls (0036).
- [x] Preserve bounded provider diagnostic identifiers when outcome recording fails; explicit pre-dispatch denials are distinct from unknown outcomes; never replay inference.
- [x] Persistent SQL checks: active dispatch 11, tenant isolation 39, coordination 18; 136 Vitest tests; signed-in two-session request, 1 usage event/credit, saved answer reload, phone/tablet verified.
- [B] Full Release 0 transport identity, server pagination/performance and security gates remain; later releases wait on those gates.

## Master blueprint — controlled releases, 2026-11-16
- [x] Full architecture/dependency map and capability status register: docs/MASTER_RELEASE_MAP.md; existing modules and URLs preserved.
- [x] Release 0 slice: Store server-attested delivery/outcome for an already claimed dispatch after revocation; keep all reads, settlement, recovery and new dispatch role-checked.
- [x] Persistent revocation/identity/immutability tests (16), receipt security (12), tenant isolation (39), full regression suite (133); real signed-in request/reload and desktop/phone/tablet verified.
- [B] Remaining Release 0: full cross-user simultaneous/revocation and expired-auth transport matrix, large-workspace server pagination and full security matrix before claiming completion.
- [B] Releases 1–9 depend on prior release gates and the architecture map; no empty modules or unconfigured integrations.
- [x] Release 0 progress report and exact next steps: docs/RELEASE_0_PROGRESS.md; prohibited external actions stay disabled.

## Work package 2 — 2026-11-16
- [x] P0 slice: Shared Growth Officer/specialist request keys, atomic result/proposal persistence and explicit receipt recovery; persistent duplicate/fault/revocation/expiry tests.
- [x] Signed-in real request/reload, two concurrent completed-request repeats and synthetic interrupted-answer recovery; 133 unit tests, 19 recovery SQL checks, 8 revocation SQL checks and 39 tenant isolation checks pass.
- [~] Revoked-delivery preservation addressed in migration 0035, tested in the Master Blueprint Release 0 slice. Full active-dispatch concurrency matrix and provider-log investigation remain incomplete; no unattended worker is deployed.
- [B] P1: Business knowledge selection, authorized writing profiles and versioned Content Studio wait on the remaining P0 safety gate; not started here.
- [B] P2: Campaign/editorial recurrence and exact-version content approvals wait on the complete P1 slice; external publication remains disabled.
- [x] Delivery report with actual tests, limitations and next priorities: docs/WORK_PACKAGE_2.md.

## Master product expansion — 2026-11-16
- [x] P0 work package: Once-only dispatch claims, immutable private delivery receipts, atomic settlement/checkpoint reconciliation, 15-minute leases and explicit interrupted-team recovery. Real team analysis/reload and injected delivery/unknown-outcome recovery exercised.
- [~] P0 remaining: Full concurrent/revocation matrix, autonomous worker, remote-log investigation and single-call request-level deduplication/recovery UI. Do not describe reliability as complete.
- [B] P1/P2 content profiles/editor/versioning/recurrence/approval wait on the remaining P0 reliability gate; not implemented in this work package.
- [B] P3–P7 SEO, growth intelligence, CRM, automation/BI and agency expansion wait on preceding complete vertical slices; no new module shipped here.
- [x] Factual implementation/test/dependency report: docs/MASTER_EXPANSION.md. Continue at remaining P0 reliability gate, then content profiles.
- [B] Deployment, owner initialization, live payments, social publication, outbound actions and unconfigured SSO remain explicitly prohibited.

## Next development phase — 2026-11-16
- [x] Audit existing product and classify gaps; 128 automated tests and signed-in navigation/search/team-result checks. Report: docs/NEXT_DEVELOPMENT_PHASE.md.
- [x] Deliver bounded specialist coordination, private checkpoints, server-attested accounting and saved synthesis; direct accounting forgery blocked.
- [x] Verify signed-in normal coordination, reload, download, SQL duplicate/refund guards and mobile/tablet layout.
- [~] Crash/settlement reconciliation, complete final SQL matrix and multi-session fault/concurrency tests remain unfinished; coordination is not production-reliability complete.
- [B] Owner initialization, publishing, live payments, outbound marketing and unconfigured SSO remain prohibited without explicit permission.

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

- [x] Content quality review with source-checked claims and individually applied suggestions
- [ ] Multi-channel repurposing (derivative content linked to source)
- [ ] Editorial calendar and recurring plans
- [ ] Campaign content intelligence, relationship view, measurement foundation

## Growth OS directive (Nov 16)
- [x] Business goals + monthly marketing budget (manual spend, caps, alerts)
- [ ] Goal links on projects/campaigns
- [ ] Guided onboarding: products, audiences, existing marketing, resources
- [ ] AI growth strategy from a goal (explained costs, assumptions, risks)
- [ ] Budget reallocation proposals; social/SEO/ads/email operations (need integrations)

## Phase 7 — multi-business organization (Nov 20)
- [x] Editor role, reporting currency, brand links, specialist allocation (proposals 0067/0068, staging)
- [x] Organization overview: consolidated per-currency figures, comparison, coordination findings, next actions, specialist network
- [x] Official daily ECB exchange rates fetched automatically (user choice, replaces admin-typed rates)
- [x] Staging browser checks EN/NL/FR, desktop/phone
- [ ] Organization-level AI Growth Officer strategy (metered AI over several businesses)
- [B] Proposals 0067–0069 on the live database: needs separate approval

## Phase 8.3 sprint (2026-11-20)
- [x] Evidence freshness by source kind; outdated evidence downgraded and shown.
- [x] Fact conflicts: status, insert-only history, affected proposals, review/reopen/resolve (staging proposal 0075).
- [x] Remembered recommendation decisions (postpone/dismiss/restore), blockers and rank explanation.
- [x] Growth Officer: fifteen growth levers, structured recommendations, conflict rule; levers panel EN/NL/FR.
- [ ] Production rollout of proposals 0063–0075 — needs the owner's separate approval.
- [x] Facts are read completely in pages (ceiling 5,000, reported when reached).

## Phase 8.4 sprint (2026-11-20)
- [x] Complete paged fact reads on profile and business overview (old 200 cap removed).
- [x] Recorded business checks with change tracking, frequency and due state (staging proposal 0076); no AI credits.
- [x] Signals and checks see overdue tasks outside growth initiatives.
- [x] Campaign progress states and warnings on list and detail (EN/NL/FR).
- [ ] Automatic background checks: needs an unattended runner, which the autonomy rules exclude (admin-started only).
- [x] Per-campaign spend tracking with budget warnings (staging proposal 0077).
- [x] Task re-planning: reasons, options, dependency chain, editor decisions, history (staging proposals 0077–0078).
- [x] Business reports: weekly, monthly, financial, campaign, AI execution, experiments (with previous period and missing data).
- [x] Home signals and Growth Officer context include campaign budget overruns and waiting re-planning proposals.
- [x] Experiment management 2.0: full lifecycle, sample size, stop/guardrail, cumulative results, data-checked outcomes, follow-ups, Growth Officer drafts (staging 0079–0080).
- [x] Specialist quality control and second review (staging proposal 0081).
- [x] Report types: daily summary and specialist performance (runs, credits, second-review scores, decisions).
- [ ] Report types: initiative and organization growth — not started.
- [ ] Financial KPIs needing cost of goods and customer data (gross margin, CAC, CLV, ROAS) — need cost/customer records that do not exist yet.
- [x] AI-written re-planning analysis on top of the planning rules (staging proposal 0082).
- [ ] Production rollout of proposals 0063–0078 — needs the owner's separate approval.

## Phase 8.5 (overnight mission)
- [x] Experiment management 2.0 (0079–0080)
- [x] Specialist quality control with independent second review (0081): free checks, 10-dimension review by a different specialist, explainable score, editor decision
- [x] AI-written re-planning analysis on top of the planning rules (0082)
- [x] Daily summary and specialist performance reports
- [ ] Initiative and organization growth reports
- [ ] Campaign diagnostics 2.0 and financial KPIs where source data exists
- [ ] Command Center and end-to-end journeys across roles, languages and screens

## Phase 8.6 (unified growth department, 2026-11-21)
- [x] A Re-planning 2.0: Growth Officer analysis (cause, consequences, affected tasks, option assessment, recommendation, further ideas, risks, cost, approval, verification), stale detection, editor still decides (0082)
- [x] E/J Second-review credits in the specialist report; all reviews/decisions read page by page (no 500 cap); reviews bound to their own paid request (0082)
- [x] B Campaign Intelligence 2.0: figures with source (spend ledger, linked metrics, linear attribution), CPL/CPA/conversion/ROAS/ROI only when computable, 14 rule-based problems, advice → internal task (no credits)
- [ ] B AI-written campaign advice (metered) on top of the rule diagnosis
- [x] C Growth Situation Analysis: ten sections (health, potential, problems, financial, marketing, sales, customers, execution, resources, risks) with status, source, reliability, missing data and top-3 priorities on Intelligence (no credits)
- [ ] C Situation: include open fact conflicts (needs conflict events read), AI-written narrative on top of the rules
- [ ] C Growth Situation Analysis (sources, dates, reliability per section)
- [ ] D Strategy Engine 2.0: versions/statuses, strategy vs. reality
- [ ] F Experiment portfolio and learning from finished experiments
- [ ] G Financial KPIs where source data exists (purchase costs/customer data missing → shown as not computable)
- [ ] H Initiative health overview; J initiative, organization, campaign diagnostic, Growth Officer activity, specialist quality reports
- [ ] K Monitoring 2.0 (compare checks, resolved/recurring findings, unchecked areas)
- [ ] L Command Center 2.0; M evidence links on recommendations; N execution-state distinctions
- [ ] O Scalability review (task_runs read capped at 3000 in BI data); Q end-to-end scenarios 1–9; R regression/security sweep

## Phase 8.6 completion / 8.7 (master directive)
- [x] P1 One classification of campaign money (actual vs simulated, reservations, releases, missing ≠ zero) used by campaign page, diagnosis, situation, reports, signals and Growth Officer context; cross-component regression test
- [x] P1 Situation: conflicts, freshness, conflicting/outdated statuses, reasons, confidence, next step
- [x] P1 AI-written situation explanation (metered, cites findings, fact downgrade, stale marker)
- [x] P1 Priorities with impact/urgency/confidence/effort/time/owner/measure/dependency/next action (goal link not yet in records)
- [x] P2 AI campaign advisory (metered, cites diagnosis findings, approval stated, nothing changed)
- [x] P2 Campaign ↔ strategy/initiative links, lifecycle and structure (staging proposal 0083)

## Four-hour deep development (campaign OS, budgets, goals)
- [x] A Walkthrough of all 31 app pages: admin NL phone + viewer FR desktop, no errors/overflow
- [x] B Campaign links to goal/strategy/initiative (must match goal), KPI and hypothesis; 14-status lifecycle with role checks, reasons and insert-only history; completion needs result + outcome; filters and phase board
- [x] C Hard daily/weekly/monthly/lifetime limits, reserve, emergency stop, audited refusals, forecast from actual spend only, limit signals and AI context
- [x] D Goals measurable only with metric + measured baseline + target; gap, days left, pace; editors fill missing values
- [ ] C Channel allocation across campaigns; a shared business budget split over campaigns (no duplicate allocation check yet)
- [ ] D Measurement periods per KPI and business-specific KPI catalogue
- [ ] E Specialist assignment per campaign; campaign-level credit totals
- [ ] F Outcome measurement and learning cycle per accepted recommendation
- [ ] Production rollout of proposals 0063–0083 (needs separate approval)
- [ ] P3–P9 budgets/goals, strategy versions, initiative/org reporting, financial data (COGS, customers), commercial foundations, security/scale regression

- [x] Refunds count in the period of their sale everywhere (user decision 21 Nov): reports and situation analysis use the same rule as economics/Home.

## Security hardening (proposal 0088, staging)
- [x] Server-side document plan limits; SEO checks limited to registered sites
- [x] Platform Owner needs authenticator code (aal2); TOTP setup, challenge, removal, sign out other devices
- [x] Hash-chained audit log + owner verification; trigger-based admin audit; refused-access signals
- [x] Organization and platform emergency stops (independent tiers)
- [x] Minimal grants; dependency updates (seroval, js-yaml, source-map-js)
- [x] Security docs in docs/security/
- [x] Rate limits — built on staging (0090) after owner changed the decision
- [x] Nested build-tool zod advisory — tooling now on zod 4.6.6
- [ ] Re-run deep scan after these changes are saved; live rollout of 0063–0088 needs approval

## Phase 9 — growth lifecycle, reports, canonical financials (staging)
- [x] Initiative, strategy and recommendation-learning reports on the canonical economics rollup (counted once, classes and currencies apart)
- [x] Strategy version comparison (previous vs current/draft), read-only for viewers
- [x] Reports count approved task re-plans per period (was always 0)
- [x] Home: figures converted to the reporting currency at monthly ECB closing rates when several currencies occur
- [x] Growth Officer context: same converted totals, labelled as a reporting view
- [ ] Organization report type in the report selector (organization page has the figures; report type not yet added)
- [x] KPI catalogue: formula, better direction and counting rule per KPI (EN/NL/FR), tested against the calculation; Growth Officer reads the same indicators
- [x] KPI starting points and targets (staging proposal 0089): from a recorded result or entered with source, insert-only history, editors only; progress/change/missing months on the KPI page and in the Growth Officer
- [ ] Reports and BI still compute revenue/spend separately; consolidate on econ/read + econ/summary
- [ ] Campaign status sets differ between database and app code; align in a reviewed proposal
- [ ] Task completion date: reports use the last update time; needs a recorded completion time (schema proposal)
- [ ] Live rollout of staging proposals 0063–0088 needs separate approval

## Additional master mission (staging only)
- [x] Request body limit (1 MB) on server calls; static security boundary tests
- [x] CI: full-history secret scan and production dependency audit
- [x] Dependency fixes within allowed versions (19 advisories); Zod 3 advisory mitigated by the body limit, documented
- [x] KPI definitions shown per KPI and shared with the Growth Officer
- [x] Blocked work: Growth Officer sees tasks waiting on unfinished tasks; business check counts them (was always 0)
- [x] Zod 4 upgrade (major) — done 2026-11-22 (4.6.6)

## Master development mission (staging only)
- [x] KPI starting points, targets, progress, trend and missing months (0089), EN/NL/FR, browser-verified
- [x] Real staging Growth Officer conversation using blocked work and KPI progress (6 credits)
- [x] Blocked-task detail: cause, downstream tasks, campaign risk and suggested steps in the task panel (EN/NL/FR, browser-verified)
- [x] Command Center warnings: what happened, why it matters, what to do, if nothing is done (all 37 warning types, EN/NL/FR) + new blocked-work warning
- [x] Rate limiting on staging (0090): AI, uploads, website checks, connections, failed-attempt pause; EN/NL/FR messages; browser-verified AI + upload
- [x] Zod 4 — upgraded 2026-11-22
