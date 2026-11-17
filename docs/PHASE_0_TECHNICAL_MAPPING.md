# AI Growth Engine — Phase 0 Technical Mapping
Status: source-code inspection only; no runtime tests executed in this audit
Branch: `product/operating-system-experience-blueprint`
Date: 2026-11-17

## 1. Confirmed existing product building blocks

| Product concept | Existing implementation | What it supports today | Main limitation for the target experience |
|---|---|---|---|
| Business context | `business_profiles`, `business_facts`, profile/onboarding and intelligence routes | Business profile, extracted facts, user confirmation and evidence display | Not yet a complete adaptive business model or continuous intelligence graph |
| Goals | `growth_goals` (migration 0039) | Objective, metric, baseline, target, current value, due date, priority and status | No visible measurement source/freshness model in this table |
| Budgets | `budget_lines` (migration 0039) | Monthly planned/actual amount, hard cap, currency and optional goal link | Actuals are manually entered; no ad-account spend sync in the connector registry |
| Strategies | `growth_strategies` (migration 0040) | Goal-linked saved AI strategy JSON and summary | Saved result is not a versioned, approved plan aggregate |
| Work | `projects`, `campaigns`, `tasks`, `execution_notes` (migration 0017) | Linked operational work, statuses, owners, dates, notes, dependencies and history | The product journey does not yet consistently originate and navigate from a strategic initiative |
| Goal-to-work links | `projects.goal_id`, `campaigns.goal_id` (migration 0040) | Projects and campaigns can link directly to a goal | No first-class initiative/strategy-version link in the inspected schema |
| CRM | `crm_contacts`, `crm_deals` (migration 0041) | Contacts and deals with stages, value, close date and optional goal link | No verified external CRM connector; inspect actual route/workflows before presenting it as a synced CRM |
| SEO | `seo_audits` (migration 0042) | Stored website audit data: robots, sitemap, pages, findings | No measured search performance or Search Console sync shown in connector registry |
| AI orchestration | `agent_runs`, specialist functions, coordinated analyses, accounting/receipt migrations | Metered AI requests, bounded two-specialist coordination, synthesis and checkpoint/recovery foundations | Current user-facing specialist workbench still exposes agent selection; the full autonomous planner is not established |
| Approvals | `approvals`, capability registry, policy table and `decide_approval` RPC | Risk-labelled proposals, policy checks and authorized decisions | Approval and actual external execution must remain distinct; most external connectors are planned |
| Content | Content Studio and migrations 0037–0038 | Content records, version/locking foundation, review/drafting workflows | Publishing and outbound channel execution are not available from the connector registry |

## 2. Important UX and implementation findings

### 2.1 Strategy generation remains a guided, user-started workflow

In `src/components/growth/strategy-panel.tsx`:
- The user opens the strategy panel from a goal.
- The user chooses a 4/8/12/26-week horizon and starts generation.
- The user chooses which generated actions to include.
- The strategy must be saved before it can be converted into Work.

This is intentionally still a guided workflow; it is not yet the target “tell the Growth Officer the outcome and let it organize the work” experience.

### 2.2 Strategy-to-work conversion now has an atomic, idempotent database path on this branch

Migration `0043_atomic_growth_strategy_conversion.sql` adds a conversion register and the `create_growth_strategy_project` RPC. It locks the saved strategy, checks workspace membership and selected action indices, then creates the project, selected tasks and conversion receipt in one database transaction. The unique strategy conversion record makes retries return the original project/task receipt rather than create duplicates, including after a page reload.

The Strategy Panel now saves/recovers the strategy ID and calls this RPC instead of issuing separate client-side project and task inserts. This is branch code only: the migration has not been applied to a database and no runtime or integration test has been run.

### 2.3 Goal and budget are separate manual planning surfaces

The current goals/budget component:
- loads goals and monthly budget lines separately;
- lets the user manually add goals and budget lines;
- allows manual actual-spend entry;
- links projects/campaigns directly to goals;
- displays strategy generation within the goal workflow;
- now shows a per-goal monthly plan snapshot: linked project/campaign count and budget-line count, plus planned and manually recorded spend when all linked lines use the same currency. Mixed-currency totals are deliberately not combined.

This can be evolved rather than replaced. The target UX should guide the user through one goal and its budget envelope, then expose the underlying records in contextual detail.

### 2.4 Existing AI orchestration is bounded, but its UX is too technical

The specialist coordination component previously asked the user to select exactly two specialists. On this branch, the coordination panel is removed from the standard Growth Officer page and the Specialists entry is removed from primary navigation. The underlying server capability and advanced route remain in the code for diagnostics; no autonomous specialist selection has been implemented yet.

A user-opt-in Deep analysis mode has now been added to the Growth Officer. In that mode, the server selects two specialist capabilities from the request topic using deterministic routing rules, then runs the existing two-specialist-plus-synthesis workflow under its 150-credit reservation ceiling. The normal Growth Officer path remains a single metered call. Full autonomous selection based on business state, goal priority or expected value is not implemented; the user explicitly chooses Deep analysis, sees its credit ceiling, and submits the request.


### 2.6 Growth Officer recommendations can now become goal-linked work

On this branch, the chat recommendation review now lets a member choose an active/draft growth goal before creating a project or campaign. The conversion RPC validates that goal against the same organization and workspace, then writes the goal link, parent record, tasks and idempotency receipt in one transaction. A task-only conversion remains unlinked because the current task schema has no direct goal foreign key.

The Command Center's active-work summary now resolves and displays the linked goal title for projects/campaigns. This is a first bridge between chat recommendations, the goal record and visible work; it is not yet a versioned initiative/strategy aggregate, and it does not make the Growth Officer autonomous. Migration `0046_link_chat_execution_to_growth_goal.sql` replaces the prior RPC signature. The migration journal also registers the earlier atomic strategy-conversion migration, which was present on the branch but absent from the journal.

This remains branch-only. No migration was applied and no app build, database integration test or browser/mobile test was run.

### 2.7 Saved strategies now become versioned Growth Plans

Migration `0047_versioned_growth_plans.sql` adds:
- `growth_plan_versions`: one immutable snapshot per saved strategy, with a per-goal version number and explicit draft/approved/superseded/rejected state;
- `growth_initiatives`: ordered initiative records derived from the saved strategy actions;
- `create_growth_plan_draft`: an idempotent RPC that snapshots a saved strategy into a draft and creates its initiatives in one transaction;
- `approve_growth_plan`: an admin/owner-only decision that approves the draft and supersedes the previous approved version for that goal.

The goal workspace now displays the latest plan version and its initiatives. Members can create a draft from a saved strategy; only workspace admins/owners can approve it. Approval metadata is retained on superseded versions. Plan content is immutable after draft creation; changes require a new strategy and version.

This is a human-approved planning layer, not an autonomous Growth Plan. Approval applies to the plan version rather than each initiative; budget lines remain separate records but can be attached to approved initiatives. Approved initiatives can create a linked project and starter task through an idempotent RPC. Operational ownership and outcome fields are stored separately so the approved strategy snapshot remains immutable. The migrations are branch-only and have not been applied or tested against a live database.

### 2.5 Measurement is not yet a business KPI platform

The Command Center's performance section explicitly reports traffic, leads/conversions and revenue as not configured. The connector registry marks Analytics, Search Console, ad platforms, LinkedIn, HubSpot, Mailchimp, Stripe and Shopify as planned. This means the initial vertical slice must use goal definitions and manually supplied/verified measurements where appropriate, and must not manufacture live ROI.

## 3. Suggested route-to-experience transition

| Existing route | Target placement | Migration behavior |
|---|---|---|
| `/app` | Command Center | Rework hierarchy; preserve route |
| `/app/growth-officer` | Persistent Growth Officer workspace | Keep conversation history; add structured result links |
| `/app/intelligence` | Business context within Business; strategic diagnosis within Growth Plan | Preserve page during staged migration |
| `/app/goals` | Growth Plan | Reuse goal and budget records; replace isolated entry point with contextual goal flow |
| `/app/projects`, `/app/tasks`, `/app/campaigns` | Work | Preserve underlying execution records and URLs |
| `/app/content`, `/app/seo`, `/app/pipeline` | Work, contextual to initiative | Keep route and capabilities; do not claim unavailable sync/publishing |
| `/app/approvals` | Command Center decision queue + Work review | Preserve approval records and decision RPC |
| `/app/activity` | Work history / audit | Preserve history and filters |
| `/app/profile`, `/app/documents`, `/app/integrations` | Business | Preserve facts, private documents and connection state |
| `/app/settings`, `/app/billing` | Business administration | Keep role-based access and billing flows |
| `/app/agents` | Advanced administration/diagnostics | Hide from standard navigation, retain for authorized troubleshooting |

## 4. Data and security constraints for the redesign

- Do not replace organization/workspace identity or relax RLS.
- Keep all new reads and writes scoped to both organization and workspace where the underlying entity is workspace-owned.
- Preserve creator/owner immutability and server-side permission checks.
- AI work must continue to reserve credits before dispatch, record delivery receipts and reconcile/refund correctly.
- A strategy or plan accepted by the user must have a durable record and audit trail; chat text alone is not a source of truth.
- A plan-to-work conversion must be idempotent and atomic or safely resumable.
- Any external action needs an exact preview and explicit approval, then a separate execution receipt.
- Data source states must distinguish connected, syncing, stale, failed, planned and not supported.
- Any KPI must record its source, period, unit, freshness and whether it is manually entered, imported or calculated.

## 5. Phase 1 implementation proposal

The first code slice should avoid schema changes if possible:

1. Introduce a new Command Center presentation that reuses current goal, execution, approvals and AI run queries.
2. Choose one primary goal and present its actual status; if there is no goal, show a guided goal-start action.
3. Show up to three prioritized work/decision items, with each item linking to the existing underlying record.
4. Add a contextual Growth Officer entry that carries the goal identifier and concise goal context, without auto-submitting or spending credits.
5. Keep the current detailed dashboard data accessible under a “More activity and history” disclosure or Work history.
6. Add tests for the hierarchy, no-goal state, missing metric state, approval permissions, tenant scoping and mobile overflow.

The first Command Center/goal slice, atomic strategy-to-work conversion, a goal-linked chat-to-work path, a per-goal budget/work snapshot, and a versioned Growth Plan with initiatives and admin approval are present on this branch. Approved initiatives can now be converted idempotently into a linked project and starter task. Budget lines can be attached to approved initiatives, with database checks enforcing matching goal and workspace scope. The Command Center labels active projects with their source initiative. This is still a human-triggered internal-work flow: it does not schedule or autonomously execute campaigns, spend, publishing or external CRM actions. The next step is to validate the complete journey in a real preview/database, then add outcome measurement and policy-governed orchestration.

## 6. Verification boundary

The initial mapping was produced by reading repository source files and migrations on the default branch. Subsequent implementation commits were made on `product/operating-system-experience-blueprint`; they have not been merged to `main`. No database migration has been applied, no app preview was launched, and no test/build command has been run in this work session. Historical test counts in existing reports are not fresh verification.


### 2.8 Approved initiatives now have an operational layer

Migration `0050_growth_initiative_operations.sql` adds a separate operational record for each initiative. It keeps the approved strategy snapshot intact while allowing workspace members to record an owner, deadline, success metric, baseline, target, current result and blocker. Writes pass through a workspace-scoped RPC; owner assignment is validated against workspace membership. The Growth Plan UI exposes these fields only for approved initiatives. Measured progress is calculated only when baseline, target and current result are supplied; it is not presented as connected analytics. The migration and UI are branch-only and have not been applied or runtime-tested.


### 2.9 Initiative attention now feeds the Command Center

The Command Center now reads initiatives from the currently approved Growth Plan versions, including initiatives that do not yet have a generated project. It combines initiative status with operational owner, due date, blocker and outcome fields. A deterministic, tested rule set ranks blockers first, then overdue and near-term deadlines, active work without an owner, and active work without a complete outcome measure. The view shows up to six records and reports the total number requiring follow-up. The ranking is a transparent rule-based signal, not an AI prediction.

Each attention item can prefill a workspace-scoped Growth Officer conversation with its plan, goal, status, owner, deadline, metric and blocker context. The prompt is not submitted automatically: the member must review and send it, which retains the normal AI credit and permission boundary. Viewers cannot start the AI request. No specialist is selected or run automatically.

Migration `0052_guard_initiative_operations.sql` also enforces at the database layer that operational metadata can only be changed while the linked Growth Plan is approved, and revalidates workspace owner access on every write. This complements the RPC checks in migration `0050_growth_initiative_operations.sql`.

The pulse and priority logic are implemented on the feature branch. Unit tests for deterministic ranking have been added but were not executed here. No build, lint, database migration or browser/mobile test has been run.


### 2.10 Growth Officer deep analysis uses bounded internal routing

The Growth Officer composer now offers an optional Deep analysis mode. Standard questions continue through the existing single-call, metered Growth Officer path. When the user explicitly enables Deep analysis, the request is routed to exactly two specialists selected server-side from the request topic, followed by one Growth Officer synthesis call. The routing rules are deterministic and tested; they do not spend a separate AI call, and specialist names are not exposed in the ordinary conversation UI.

The workflow reuses the existing three-call coordinated-analysis protocol: 150 credits are reserved across the three calls, actual use is settled and unused reservation is returned. The user sees the maximum before submission. There is no recursive dispatch, no external tool use by the specialists, and no publishing, spending or CRM write. The Growth Officer synthesis retains the existing Plan Review path. The current conversation is included as bounded, untrusted context, and the saved result opens as a separate analysis thread. A compact recovery surface in the Growth Officer checks incomplete automatically routed analyses and reuses the existing receipt/recovery protocol without starting a duplicate request.

The advanced manual coordination workbench remains available in the hidden/advanced Agents route for diagnostics. Automatic routing is currently request-topic based; it does not yet plan across multiple initiatives, choose specialists based on live performance or goal state, create work autonomously, or schedule recurring orchestration. Those remain later-phase capabilities. Tests for the routing rules and input boundaries have been added but not run. No build, live AI request, database migration or browser/mobile test has been performed.


### 2.11 Growth Officer context now includes the approved operating plan

The shared server-side `workspaceContext` now reads current active/paused goals, approved plan versions, their initiatives, initiative operations, linked projects and project tasks, plus recent budget entries in addition to verified business facts and prior recommendations. Each read is explicitly scoped to organization and workspace. The AI receives plan and budget records as untrusted planning context, separate from verified facts. Owner identifiers are deliberately not passed to the model; only whether an initiative, project or task has an owner is included. Budget entries are identified as manual inputs, currencies are kept separate, and actuals are not represented as synced advertising or payment data.

The Growth Officer instructions now direct recommendations to take blockers, due dates, ownership and missing outcome measurements into account, and to explain trade-offs before suggesting a change to an approved plan. This context is shared with the existing specialist analysis workflow as well. It does not trigger agent runs, create projects, change budgets or execute external actions by itself.
