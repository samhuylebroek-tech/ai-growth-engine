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

### 2.1 Strategy generation currently has a manual multi-step conversion

In `src/components/growth/strategy-panel.tsx`:
- The user opens the strategy panel from a goal.
- The user chooses a 4/8/12/26-week horizon and manually starts generation.
- The user chooses which generated actions to include.
- The user separately saves the strategy and/or creates a project with tasks.

This is a useful foundation, but it is not yet the target “tell the Growth Officer the outcome and let it organize the work” experience.

### 2.2 Strategy-to-work creation is not atomic in the inspected client flow

The current `toPlan` flow inserts a project and then inserts tasks in a separate request. If task creation fails, the project remains and the UI reports that tasks could not be added. This must be redesigned or wrapped in a server-side transactional operation before it becomes a core autonomous workflow. A retry must not create duplicate projects or tasks.

### 2.3 Goal and budget are separate manual planning surfaces

The current goals/budget component:
- loads goals and monthly budget lines separately;
- lets the user manually add goals and budget lines;
- allows manual actual-spend entry;
- links projects/campaigns directly to goals;
- displays strategy generation within the goal workflow.

This can be evolved rather than replaced. The target UX should guide the user through one goal and its budget envelope, then expose the underlying records in contextual detail.

### 2.4 Existing AI orchestration is bounded, but its UX is too technical

The specialist coordination component asks the user to select exactly two specialists and describe a team assignment. The server implementation includes metered calls and bounded coordination, but the user-facing workflow leaks internal orchestration decisions. The next design should have the Growth Officer decide whether one or more specialist capabilities are needed.

Do not remove the current specialist route immediately: retain it as an advanced diagnostics/operations view until the new orchestrator is proven.

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

Only after the Command Center and goal journey are accepted should the team design a durable strategy-plan aggregate and server-side idempotent conversion workflow.

## 6. Verification boundary

This document was produced by reading repository source files and migrations on the default branch. No code was changed in the application, no database was queried, no app preview was launched, and no test/build command was run by this audit. Historical test counts in existing reports are not fresh verification.
