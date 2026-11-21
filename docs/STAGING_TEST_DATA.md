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

## Cleanup proposal (needs separate approval)

1. Archive (status change, not delete) the five QA-named goals/campaigns/tasks through the normal app screens.
2. Leave every accounting, audit, AI-receipt and simulated-action record untouched.
3. If a clean demo business is wanted, create a new staging organization instead of deleting history.
4. Production: nothing to clean; none of this data exists there.
