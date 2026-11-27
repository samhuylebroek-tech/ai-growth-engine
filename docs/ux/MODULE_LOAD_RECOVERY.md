# Failed page-module recovery — 24 November 2026

## User-facing rule
If a required page file fails to download, the user must get a visible recovery action rather than a blank page or a retry of the same cached import.

## Diagnosis and scope
The reported error names a JavaScript route chunk. Its original HTTP response cannot be independently established: the external preview asset request is unauthorized, and no live preview viewer was connected. A controlled browser test reproduced the same TypeError through a failed route import. The existing root-only retry invalidated the route but did not reload the browser document, and the router had no shared default error screen.

The fix eagerly shares recovery between the root and every route. A recognized module failure offers a full document reload on the same URL; ordinary data errors await invalidation before resetting. It adds no automatic reload loop. TanStack's existing once-per-error reload remains unchanged. A full reload does not resend any AI request. No database, permissions, settings, credentials, existing records or production deployment changed.

## All page loading paths inspected
Read the route declarations for every route below. None defines an overriding error component; all now use the shared router default. The root also explicitly uses it. This is a source check, not a claim that all authenticated screens were exercised.

| Route ID | Source inspected | Result after change |
| --- | --- | --- |
| `/_authenticated/admin` | `src/routes/_authenticated/admin.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/actions` | `src/routes/_authenticated/app.actions.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/activity` | `src/routes/_authenticated/app.activity.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/agents` | `src/routes/_authenticated/app.agents.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/approvals` | `src/routes/_authenticated/app.approvals.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/billing` | `src/routes/_authenticated/app.billing.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/business` | `src/routes/_authenticated/app.business.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/campaigns` | `src/routes/_authenticated/app.campaigns.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/competitors` | `src/routes/_authenticated/app.competitors.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/content` | `src/routes/_authenticated/app.content.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/costs` | `src/routes/_authenticated/app.costs.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/documents` | `src/routes/_authenticated/app.documents.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/economics` | `src/routes/_authenticated/app.economics.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/experiments` | `src/routes/_authenticated/app.experiments.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/goals` | `src/routes/_authenticated/app.goals.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/growth-officer` | `src/routes/_authenticated/app.growth-officer.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/improvements` | `src/routes/_authenticated/app.improvements.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/` | `src/routes/_authenticated/app.index.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/integrations` | `src/routes/_authenticated/app.integrations.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/integrations_/google` | `src/routes/_authenticated/app.integrations_.google.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/intelligence` | `src/routes/_authenticated/app.intelligence.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/modules` | `src/routes/_authenticated/app.modules.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/notifications` | `src/routes/_authenticated/app.notifications.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/onboarding` | `src/routes/_authenticated/app.onboarding.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/opportunities` | `src/routes/_authenticated/app.opportunities.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/organization` | `src/routes/_authenticated/app.organization.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/performance` | `src/routes/_authenticated/app.performance.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/performance_/$metricId` | `src/routes/_authenticated/app.performance_.$metricId.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/pipeline` | `src/routes/_authenticated/app.pipeline.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/profile` | `src/routes/_authenticated/app.profile.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/projects` | `src/routes/_authenticated/app.projects.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/reports` | `src/routes/_authenticated/app.reports.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/revenue` | `src/routes/_authenticated/app.revenue.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/seo` | `src/routes/_authenticated/app.seo.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/settings` | `src/routes/_authenticated/app.settings.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app/tasks` | `src/routes/_authenticated/app.tasks.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/app` | `src/routes/_authenticated/app.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated/invite/$token` | `src/routes/_authenticated/invite.$token.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/_authenticated` | `src/routes/_authenticated/route.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/auth` | `src/routes/auth.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/` | `src/routes/index.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/pricing` | `src/routes/pricing.tsx` | Uses the eager router-default recovery; no overriding error boundary. |
| `/reset-password` | `src/routes/reset-password.tsx` | Uses the eager router-default recovery; no overriding error boundary. |

## Other loading paths inspected
- `src/routes/__root.tsx`, `src/router.tsx`: shared eager recovery, including failure of the authenticated layout or app shell; fixed.
- `src/routes/_authenticated/route.tsx`: authentication runs before protected pages; existing redirect and access checks preserved. Recovery does not bypass sign-in.
- `public/sw.js`, `public/offline.html`: worker caches only the public offline page and handles failed document navigation; it does not cache JavaScript chunks, private pages or tenant data. Already follows the rule for offline document navigation; unchanged.
- `src/server.ts`, `src/start.ts`, `src/lib/error-page.ts`: server bootstrap and request failures already return a standalone error page with document reload, independent of route chunks; unchanged.
- `src/lib/ai.functions.ts`: provider, Office parser, task execution/review/recovery, organization strategy parsing and organization-context imports run server-side, not through browser asset URLs. No changes to accounting, completed results or dispatch behavior.
- `src/components/`: runtime-import search found no separately implemented `React.lazy`/dynamic-import UI flow bypassing the route recovery. Type-only imports do not fetch files at runtime.
- `vite.config.ts`: retains standard route code splitting. No deployment or cache-setting changes.
- Database functions and due-cycle jobs do not fetch browser JavaScript assets; no database changes or historical data repair are needed for this error.

## Verification
- 966 tests passed (121 files), including eight module-recovery regressions.
- Changed-source ESLint passed; automatic preview build reports build OK.
- Browser: injected the reported TypeError during real client-side navigation to Pricing, observed the recovery screen, removed the induced failure, clicked Reload page, and verified the actual plan list returned on the same URL. English at 822×698 and French at 1280×1800 passed.
- Authenticated Growth Officer execution was not rerun in this fix; its route declaration and its shared app shell were inspected. The original remote asset availability remains unverified.
