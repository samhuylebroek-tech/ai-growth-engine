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

## Cleanup proposal (needs separate approval)

1. Archive (status change, not delete) the five QA-named goals/campaigns/tasks through the normal app screens.
2. Leave every accounting, audit, AI-receipt and simulated-action record untouched.
3. If a clean demo business is wanted, create a new staging organization instead of deleting history.
4. Production: nothing to clean; none of this data exists there.
