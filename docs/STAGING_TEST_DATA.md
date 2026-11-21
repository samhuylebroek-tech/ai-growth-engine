# Staging test-data inventory (Phase 8.1)

Read-only inventory of the staging database (`tvfbvzytjpizqwixkecx`), taken during Phase 8.1. **Nothing was
deleted or changed.** Production holds none of this data. Counts are rows at inventory time.

## What exists

| Organization / business | Goals | Campaigns | Projects | Tasks | Revenue records | Brands | Conversations | AI runs | Task runs | External actions |
|---|---|---|---|---|---|---|---|---|---|---|
| Staging Bakery / Main workspace | 4 | 1 | 4 | 12 | 2 | 1 | 12 | 17 | 5 | 6 |
| Staging Bakery / Staging Catering | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Staging Rival Co / Rival workspace | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Organization level (Staging Bakery): 1 organization strategy (draft), 4 organization opportunities, 1 shared
initiative (committed), 29 exchange-rate rows (official ECB + earlier manual test rates), 30 credit-ledger entries,
4 members. Staging Rival Co exists only to prove isolation (1 ledger entry, 1 member). 5 staging auth users.

## Classification

- **Fixtures needed for isolation tests** — Staging Rival Co, the two Staging Bakery businesses, the five staging
  users and their memberships. The SQL suites create their own rolled-back fixtures, but browser checks and
  `scripts/staging/preflight.ts` rely on these. *Keep.*
- **QA-named records** — goals "QA Journey: more online bookings" (archived) and "QA: Grow qualified leads",
  campaigns "QA office breakfast boxes" and "QA catering lunch offer", task "QA align calendar". *Candidates for
  archiving.*
- **Records produced by real staging AI runs** — the Dutch goals/projects/tasks from the growth plan, the
  organization strategy draft, its opportunities, and the shared LinkedIn initiative with its two projects. They
  are the only end-to-end evidence that paid AI output was stored and converted correctly. *Keep until the release
  review is closed.*
- **Simulated external actions** — six actions on `sim.wordpress` / `sim.hubspot`, all marked simulated. Never sent
  anywhere. *Keep as lifecycle evidence.*
- **Accounting history** — credit ledger, reservations, usage events, AI receipts, audit log: append-only by design
  and protected by triggers. *Never delete* — removing them would break the reconciliation the credit overview
  checks.
- **Manual exchange rates** — earlier manual test rates next to official ECB rates. Official rates already win on
  the same date. *Keep*; they document the manual-rate path.

- **Phase 8.2 evidence walkthrough (2026-11-20)** — one team proposal "QA-E2E evidence …" (formal level,
  approved by the QA admin) with one linked evidence item pointing at the manual "Qualified leads" measurement
  (now "used in a decision"). Evidence items and their history are insert-only by design. *Keep as approval
  evidence; the proposal can be withdrawn through the app if a clean list is wanted.*

- **Phase 8.2 extended sprint (2026-11-20, re-counted by read-only query)** — business counts are unchanged from the
  table above, plus two business facts "QA delivery fee …" in Main workspace (one confirmed, one returned to review
  by the conflict-resolution walkthrough) and one `facts.conflict_resolved` audit entry. Ledger 57, 5 auth users.
  *Keep as conflict-resolution evidence; the unconfirmed value can be deleted in the business profile if wanted.*

- **Phase 8.3 sprint (2026-11-20)** — staging proposal 0075 added two insert-only tables. Browser walkthroughs created
  four business facts "QA openingsuren …" (two topics, both currently "disputed again"), their conflict history
  (review started, value chosen, reopened) and one recommendation dismissed then restored, each with audit entries.
  *Keep as decision-memory evidence; unwanted fact values can be deleted in the business profile; history stays.*

- **Phase 8.4 sprint (2026-11-20)** — staging proposal 0076 added `business_checks` (insert-only) and
  `business_check_settings`. Browser walkthroughs recorded four business checks in Main workspace (one weekly,
  three manual), set the check frequency to weekly, and created one task "QA achterstallige controletaak"
  (deadline 2 Nov 2026, so it is overdue on purpose) with matching audit entries. *Keep as monitoring evidence;
  the task can be completed or cancelled in the app if wanted; checks stay.*

- **Phase 8.4 sprint 2 (2026-11-20)** — staging proposals 0077–0078 added `task_replan_proposals`,
  `task_replan_decisions` and `campaign_spend_entries` (all insert-only). Browser walkthroughs in Main workspace:
  "QA achterstallige controletaak" was re-planned twice (2 Nov → 23 Nov, then → 18 Dec with priority high) and now
  waits on "QA align calendar" (one dependency note); campaign "QA office breakfast boxes" got budget EUR 300 and four
  simulated spend entries (EUR 200 ref SIM-QA-1, reservation EUR 50, EUR 120 ref SIM-QA-2, correction −EUR 10), so it
  shows a budget overrun on purpose. *Keep as test evidence; entries are permanent history by design.*

- **Phase 8.5 experiments (2026-11-20)** — staging proposals 0079 (experiment lifecycle, observations, history) and 0080
  (simulated results are never evidence). Main workspace: "QA checkout reassurance banner" went through the whole
  lifecycle with simulated observations (12/12 then 30/30 per group) and was completed as "successful"; 0080 relabelled
  its evidence strength from "controlled" to "inconclusive" because the data was simulated. One Growth Officer draft
  ("Toets of een herbestelherinnering …", 5 credits) was created from a real AI request. *Keep; history is insert-only.*

- **Phase 8.5 specialist quality control (2026-11-20)** — staging proposal 0081. Main workspace task "Zoekwoorden voor de
  zakelijke cateringpagina" (SEO, high priority): one real second review by the Content Specialist (7 credits, score
  75/100, acceptable, five findings) and an admin decision "accepted with corrections". *Keep; reviews and decisions are
  insert-only.*

- **Phase 8.6 re-planning analysis (2026-11-21)** — staging proposal 0082. Main workspace task "Analyseer de vraag naar
  zakelijke lunches in de buurt" (overdue): a rule-based re-planning proposal prepared by QA Member and one real Growth
  Officer analysis (5 credits, recommends option A). The proposal is intentionally left undecided so no task dates
  changed. Test-account passwords were rotated by `seed-users.ts` after a sandbox restart (no other change). *Keep.*

- **Phase 8.6 campaign diagnosis (2026-11-21)** — QA Member created one task from the diagnosis of "QA office
  breakfast boxes" ("Review the remaining budget…", labels `campaign-advice`, `advice:review_budget`). *Keep.*

- **Phase 8.7 situation explanation (2026-11-21)** — QA Admin requested one Growth Officer explanation of the growth
  situation (5 credits, private request record with purpose `situation_narrative`). *Keep.*

- **Phase 8.7 campaign advice (2026-11-21)** — QA Member requested one Growth Officer advice for "QA office breakfast
  boxes" (5 credits, private request record with purpose `campaign_advice`). The campaign itself was not changed. *Keep.*

- **Campaign operating system, proposal 0083 (2026-11-22)** — "QA office breakfast boxes"
  (`5ceb24e7-277e-4a5e-b2fc-9427a792c58e`) is linked to goal "QA: Grow qualified leads", strategy "QA: Lead plan", a
  qualified-leads KPI (start 4, target 10) and a hypothesis; it has EUR limits of 150 per week and 300 in total (reason
  "QA 8.7 limit test (staging)"), one refused simulated spend attempt in the audit log, and status history
  active → needs attention → active with QA reasons. A second campaign "QA 8.7 lifecycle campaign" was created by QA Member,
  submitted for approval and approved by QA Admin. *Keep (history is insert-only).*

- **Goal measurement (2026-11-22)** — goal "QA: Grow qualified leads" was given the metric "gekwalificeerde leads",
  starting value 4, target 10 and current value 6 through the goals screen (entered values, not a connected source). *Keep.*

- **Unified budget allocation, proposal 0084 (2026-11-22)** — Concurrency check (`scripts/staging/concurrency-budget.ts`):
  budget line `qa_concurrency` (EUR 100, `ca4e36bd-2d23-462f-87fd-73e7a542aeff`) with EUR 60 allocated to "QA office
  breakfast boxes" and one refused concurrent allocation event. Browser checks: two `paid_social` EUR 10,000 lines for
  the same month (the second came from a re-run of the screen test), EUR 4,000 → 3,500 allocated to "QA office breakfast
  boxes" and EUR 3,000 → 3,500 to "QA 8.7 lifecycle campaign"; one refused over-allocation; one QA Member move request
  (EUR 500, reason "QA 8.8 move request (staging)") approved by QA Admin; one simulated EUR 250 spend linked to the
  `paid_social` line on "QA 8.7 lifecycle campaign" and one refused EUR 3,600 attempt. Allocation events and spend are
  insert-only. *Keep.*

## Cleanup proposal (needs separate approval)

1. Archive (status change, not delete) the five QA-named goals/campaigns/tasks through the normal app screens.
2. Leave every accounting, audit, AI-receipt and simulated-action record untouched.
3. If a clean demo business is wanted, create a new staging organization instead of deleting history.
4. Production: nothing to clean; none of this data exists there.
