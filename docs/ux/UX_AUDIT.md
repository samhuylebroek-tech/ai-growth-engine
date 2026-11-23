# UX/UI audit and redesign log

Staging only (`tvfbvzytjpizqwixkecx`), branch `product/operating-system-experience-blueprint`. Measured with an automated
browser sweep of every signed-in page as an organization administrator in English on desktop (1440×900), tablet
(820×1180) and phone (390×844), plus screenshots, then fixed and re-measured. Production untouched.

## Phase A — inventory (34 pages)

Height is the page length in pixels (desktop / phone); words and buttons are desktop counts. Long pages are the main
density problem.

| Page | Destination | Purpose | Primary action | Height D/P | Words | Buttons |
| --- | --- | --- | --- | --- | --- | --- |
| `/app` | Home | See what needs attention and the one next step | Open the next step | 6490 / 12691 | 1141 | 59 |
| `/app/notifications` | Home | Read alerts about your business | Open the related item | 3613 / 5991 | 1051 | 45 |
| `/app/approvals` | Home | Decide on work waiting for approval | Approve / reject | 900 / 844 | 49 | 7 |
| `/app/activity` | Home | See what was done and its results | Open a record | 6902 / 7088 | 630 | 42 |
| `/app/growth-officer` | AI team | Ask the Growth Officer a business question | Ask a question | 1797 / 2608 | 385 | 44 |
| `/app/agents` | AI team | Start a specialist or coordinated analysis | Run an analysis | 3542 / 7077 | 579 | 36 |
| `/app/profile` | Business | Confirm what the platform knows about the business | Confirm / add a fact | 4993 / 8919 | 802 | 60 |
| `/app/intelligence` | Business | Read the growth situation per area | Ask about a finding | 3772 / 6251 | 1317 | 8 |
| `/app/documents` | Business | Upload documents the AI may use | Upload a document | 900 / 844 | 47 | 6 |
| `/app/seo` | Business | Check the website | Start a check | 900 / 844 | 72 | 5 |
| `/app/competitors` | Business | Follow competitors | Add a competitor | 900 / 967 | 79 | 15 |
| `/app/onboarding` | Business | Answer the setup questions | Save answers | 900 / 844 | 36 | 6 |
| `/app/goals` | Plan | Set goals, budget and approved plans | Create a goal | 7435 / 13174 | 2624 | 70 |
| `/app/opportunities` | Plan | Decide on discovered opportunities | Make it a goal | 900 / 1465 | 187 | 10 |
| `/app/modules` | Plan | See which growth areas are switched on | Open an area | 1554 / 2345 | 223 | 7 |
| `/app/experiments` | Plan | Design and read experiments | Create an experiment | 900 / 4823 | 25 | 4 |
| `/app/campaigns` | Execution | Run campaigns within their budget | Create a campaign | 1215 / 1498 | 197 | 29 |
| `/app/tasks` | Execution | See and finish tasks | Create a task | 1243 / 1783 | 258 | 32 |
| `/app/projects` | Execution | Group work into projects | Create a project | 1225 / 1361 | 135 | 31 |
| `/app/content` | Execution | Draft and review content | Create a draft | 900 / 844 | 36 | 8 |
| `/app/pipeline` | Execution | Follow contacts and deals | Add a deal | 900 / 1253 | 106 | 7 |
| `/app/actions` | Execution | Review external actions (simulated until connected) | Approve an action | 1790 / 3196 | 579 | 20 |
| `/app/business` | Results | Executive view of recorded figures | Filter period/unit | 4588 / 8959 | 1769 | 27 |
| `/app/performance` | Results | KPIs, starting points and targets | Record a result | 1105 / 1768 | 539 | 8 |
| `/app/revenue` | Results | Revenue ledger and attribution | Record revenue | 1400 / 2158 | 326 | 7 |
| `/app/economics` | Results | Costs, AI credits and returns per level | Read a rollup | 2588 / 4252 | 1012 | 7 |
| `/app/costs` | Results | Costs and ROI per goal/campaign | Read a rollup | 1175 / 1840 | 287 | 11 |
| `/app/reports` | Results | Periodic business reports | Open a report | 1308 / 1979 | 384 | 32 |
| `/app/improvements` | Results | What was learned from recommendations | Review a learning | 2886 / 4139 | 804 | 19 |
| `/app/organization` | Organization | Compare businesses in the organization | Open a business | 1483 / 2491 | 385 | 10 |
| `/app/settings` | Organization | Workspaces, team, sign-in | Invite / assign | 900 / 844 | 37 | 10 |
| `/app/integrations` | Organization | Data sources (not configured until connected) | Connect a source | 3330 / 5997 | 629 | 22 |
| `/app/integrations/google` | Organization | Google connection details | Connect | 900 / 844 | 20 | 4 |
| `/app/billing` | Organization | Plan and credits | Read usage | 2185 / 3011 | 277 | 4 |
## Findings (round 1 measurement, before fixes)

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Menu grouped by module, not by how a business grows: "Work & approvals" held 13 tabs, "Growth intelligence" 8; tabs overflowed on 13 desktop pages and were clipped ("Revue &") | sweep: `tabsOverflow` on 13/34 desktop pages | Fixed: 7 destinations in journey order, max 7 tabs; desktop overflow 0/34, tablet only the 7-tab Results area |
| 2 | AI specialists page was not in the menu at all (only reachable from a Growth Situation link) | `navigation.ts` | Fixed: AI team = Growth Officer + AI specialists |
| 3 | The active tab was never highlighted, so the tab bar did not show where you are | screenshots; `activeProps` class lost to `border-transparent` | Fixed: active state via `data-status`, Home tab exact |
| 4 | On phones the current tab could sit off-screen | phone screenshots | Fixed: current tab scrolls into view, edges fade to show more tabs |
| 5 | "Performance" and "Business performance" side by side; NL "Resultaten" collided with the new Results destination | labels | Fixed: "KPIs & targets" / "KPI's & doelwaarden" / "KPI & objectifs" |
| 6 | Goals page: 70 form fields without a programmatic name (initiative follow-up: metric, starting point, target, current, blocker) | sweep `unlabeled=70` | Fixed: labels linked to fields; now 0 |
| 7 | Business knowledge "Add fact" used placeholders as the only field names | sweep `unlabeled=2` | Fixed: visible field names (`Field`) |
| 8 | Organization overview opened without a title for several seconds while loading or on error | sweep `h1=0` | Fixed: title shown in loading and error states |
| 9 | Statement labels in AI answers (17 px) and "Postpone / Dismiss" links were below the 24 px target size (WCAG 2.2 2.5.8) | sweep `small=27` on Reports, 16 on Business performance | Fixed: larger hit areas without changing the look |
| 10 | Home is 6.5k px on desktop and 12.7k px on phone (1,100–2,000 words): every section is shown at once; activity rows showed raw AI Markdown ("## Wat er gebeurt [recommendation] …"); two sections were both called opportunities | sweep, screenshots | Fixed: attention → goal → priorities → active work first; activity, results, recommendations and upcoming fold (choice remembered per user/business); readable previews and labelled answers in the detail; "Strategy recommendations"; guide compact on phone. Phone (member NL) 12.7k → 9.6k px, folded sections 86 px each |
| 11 | Goals & budget is 7.4k / 13.2k px with 2,600 words: goals, strategy, plans, budget and initiatives on one page | sweep | Fixed: each goal shows its summary, progress and quick edits; plan, growth chain, budget and linked work open per goal (primary goal open). Desktop 7.4k → 3.4k px (admin EN), tablet viewer FR 2.7k px; every action kept |
| 12 | Growth Officer answer structure is good (labels, sections) but evidence and "convert to work" sit below a long answer | live answer screenshot | Open — P2 |
| 13 | Tasks page shows 13 filter chips that wrap to four rows on phone | phone screenshot | Open — P2 |
| 14 | Cards, borders and section labels are mostly consistent (one token set, one `PageHeader`); some pages still use their own small-text sizes (10–11 px) | code review | Open — P3 |
| 15 | No console errors, no document-level horizontal overflow and exactly one page title on every page after fixes | sweep | Verified |

Not flagged as problems after inspection: the hidden native checkboxes behind the AI specialist selectors (decorative
inputs of an accessible control), and the Growth Officer "deep analysis" checkbox (named by its label).

## Phase B — information architecture (implemented)

```text
Home            Home · Notifications · Review & approvals · Activity & results
AI team         Growth Officer · AI specialists
Your business   Business knowledge · Growth intelligence · Documents · Website check · Competitors
Growth plan     Goals & budget · Growth opportunities · Growth areas · Experiments
Execution       Campaigns · Tasks · Projects · Content Studio · Sales pipeline · External actions
Results         Business performance · KPIs & targets · Revenue & attribution · Growth economics · Costs & ROI · Business reports · Improvements
Organization    Organization overview · Organization & team · Data sources · Plan & credits
```

All URLs are unchanged, so saved links keep working. The rules (journey order, ≤ 7 tabs, every page once, AI
specialists beside the Growth Officer, approvals on Home) are guarded by `src/test/navigation.test.ts`.

## Phase C — design system (existing, consolidated)

There is one design system; no second one is introduced.

- Tokens: `src/styles.css` (oklch light/dark: background, surface, card, primary green, success, warning,
  destructive, border, muted; Manrope; radius 0.5 rem; flat, no gradients or glows).
- Components: `PageHeader`, `Panel`, `EmptyState`, `StatusChip` (`components/app/status.tsx`), `SectionHeading`,
  `Field` (visible field names), `AiMarkdown` + claim labels, shadcn `ui/*` for controls.
- Rules: one `h1` per page via `PageHeader`; status is always text plus color, never color alone; interactive targets
  ≥ 24 px (tabs 44 px); forms use `Field`.

## Backlog (prioritized)

- Done: Home (see finding 10). Next on Home: the business summary and signals still repeat "next best actions"; merge into one list.
- Done: Goals & budget (finding 11). Next there: budget table as cards on phones.
- P2 Growth Officer: conclusion and actions first, evidence expandable, sticky ask box on phone.
- P2 Tasks: collapse the 13 filters into primary filters plus "More".
- P2 Tablet: the Results area has 7 tabs and scrolls at 820 px.
- P3 Unify small text sizes (10/11 px) to the token scale; review card density on Business performance.
- P3 Re-run persona sweeps (member NL phone, viewer FR tablet, owner EN desktop) after each P1 change.
