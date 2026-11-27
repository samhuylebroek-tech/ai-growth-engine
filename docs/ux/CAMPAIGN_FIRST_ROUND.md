# Campaign-first entry round — 25 November 2026

## Implemented

- `/app` is the campaign entry; `/app/campaigns` retains saved record links and the same shared workspace. The old command center is preserved at `/app/overview`.
- Navigation retains each destination once, with at most seven contextual tabs. Campaigns precede strategy, AI, execution, results and business/organization settings.
- Campaign cards show objective, lifecycle status, recorded KPI, separate actual/reserved money per currency, EUR budget availability, and recorded task completion. No tasks means unknown progress, not 0%. A missing spending read means unavailable, not zero. Explicitly simulated spending cannot reduce the real budget.
- Creation starts with an objective, including custom text. Manual drafting and a workspace-scoped editable Growth Officer question are separate actions. Neither choice dispatches AI or approves/executes a campaign.
- Campaign creation/edit and detail pages disclose planning, measurement, spending and specialist analysis progressively, retaining the existing controls.
- New labels and unique entry-page metadata exist in EN/NL/FR.
- The existing CI error was a ledger-row `any` in the staging credit-grant utility. Only that type was corrected; the utility was not executed.

## Verified and not verified

- Full Vitest suite after the custom-objective addition: 975/975 passed across 123 files. Focused campaign/navigation/locale/routing interaction checks: 53/53 passed.
- Full ESLint: zero errors after the ledger-row correction; existing warnings remain visible.
- Platform build signal: latest entries report `build OK`; no manual project build was run.
- Isolated staging app passed its database marker and publishable-key separation guards. Browser opening `/app` on 1280/820/390 px redirects to sign-in, with no runtime errors or horizontal overflow. This is **not** an authenticated campaign-flow test.
- Authenticated campaign creation → save → reload, five-persona sweeps and paid AI proposal execution: **NOT RUN**. The sandbox restart removed the existing temporary QA credential file. No passwords or MFA were reset and no authentication or business rows were changed.
- No AI credits, ads, outbound messages, production migrations, deployments or publication were used.

## Remaining

- Complete structured campaign proposal/review and contextual follow-ups; existing editable question handoff is only the first part.
- Explicit QA record classification/exclusion through scoped UI, AI and reporting readers, with inspectable history. Do not infer QA identity from titles or delete history.
- Finish strategy/execution/results/settings presentation and repeat authenticated role/language/device journeys once staging sign-in is available.
- Check GitHub sync and CI for the new commit after platform synchronization; earlier remote CI results do not validate this working tree.