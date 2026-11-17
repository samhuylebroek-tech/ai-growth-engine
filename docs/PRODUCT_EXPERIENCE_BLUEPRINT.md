# AI Growth Engine — Product Experience Blueprint
Status: proposed product and UX specification
Branch: `product/operating-system-experience-blueprint`
Date: 2026-11-17

## 1. Product north star

AI Growth Engine is an adaptive AI Growth Operating System. The customer describes the business, desired outcomes, constraints and available resources. A central AI Growth Officer coordinates specialist capabilities, turns evidence into a strategy, organizes execution, requests human decisions at the right moments, and learns from measured results.

The user should manage outcomes and boundaries — not agents, modules, prompts, task routing or disconnected tools.

This specification is a target experience, not a claim that every underlying capability is currently implemented.

## 2. Experience principles

1. Outcome-first: organize the experience around the customer's goal and progress, not the internal module that performs a task.
2. One accountable interface: the Growth Officer owns the end-to-end growth workflow and explains what it is doing, why, and what happens next.
3. Progressive disclosure: show the next useful decision first; expose detail, evidence and controls when requested.
4. Autonomy with boundaries: AI may research, plan and prepare within configured limits. External actions, spend, publishing, sending, and material account changes require explicit permission and approval.
5. Evidence before confidence: distinguish confirmed facts, sourced observations, hypotheses, estimates and measured outcomes.
6. Honest capability states: never present a planned connector, unavailable action, simulated metric or unsupported forecast as operational.
7. Business-model adaptation: onboarding and recommendations adapt to company type, stage, goals, audience, budget, team capacity, geography and available data.
8. Continuity: a user can leave a workflow and return without losing its goal, decisions, work or context.
9. Preserve customer trust: retain existing tenant boundaries, RLS, role checks, audit trails, credit reservation/settlement, approval policies and private files.

## 3. Target information architecture

The primary workspace should expose four destinations only:

- **Command Center** — current business priorities, progress against goals, decisions needed, AI work in progress, outcomes and one clear next action.
- **Growth Plan** — the agreed strategy, goals, initiatives, budget envelopes, milestones, assumptions and evidence. This is the plan the system executes against.
- **Work** — the execution timeline and deliverables: projects, tasks, campaigns, content, sales follow-up and review queue. These are views of connected work, not separate operating silos.
- **Business** — business profile, evidence and knowledge, team/workspaces, data connections, policies, usage and account settings. Administrative controls are grouped here and shown according to role.

The Growth Officer is a persistent global entry point, not merely another destination. It is available from the Command Center, Growth Plan and Work with the current context already attached.

Secondary functions are contextual:
- Strategy, objectives and budget belong inside Growth Plan.
- Projects, tasks, campaigns, content, pipeline and SEO appear inside Work when relevant to an initiative or goal.
- Approvals appear in the context of the action and in the Command Center's decision queue.
- Activity is the audit/history view for AI work and decisions, not a competing home page.
- Specialist identities and routing remain internal orchestration details. An advanced operator may inspect them, but ordinary users should not need to select them.
- Documents and verified facts belong to Business knowledge and can be attached to any initiative or task.
- Data connections are presented by the outcome they enable (traffic measurement, search visibility, CRM sync, publishing), with honest availability and setup states.

Existing URLs should initially remain valid and redirect or render the relevant contextual view. Do not delete existing routes or data merely to simplify navigation.

## 4. The central Command Center

The first screen answers five questions in this order:

1. **Are we on track?** Show the primary business goal, current measured value if connected, target, deadline and confidence/coverage of the data. If no measurement exists, state that plainly and show the next step to establish a baseline.
2. **What matters now?** Show at most three prioritized next actions with a short reason, expected outcome, effort, cost envelope (if known), owner and status.
3. **What is the AI doing?** Show a compact progress summary of active work, its purpose, last meaningful update and expected next checkpoint. Do not imply background execution when only an interactive request is running.
4. **What needs my decision?** Show approvals and blockers with clear consequences, risk, cost, reversibility and evidence. Approval controls must continue to use the existing authorized decision workflow.
5. **What changed?** Show a small number of recent verified outcomes, completed deliverables and material plan changes.

The Growth Officer composer is the primary action surface. Suggested prompts should be grounded in current context, such as “What is blocking our lead target?” rather than generic prompt chips.

Do not make the home screen customizable by default. Establish a strong opinionated hierarchy first. Personalization can follow once actual user research demonstrates a need.

### Responsive behavior

- Desktop: readable central content column with a secondary compact activity/decision rail; no dense dashboard grid.
- Tablet: collapse the rail into ordered sections; retain persistent Growth Officer access.
- Mobile: single-column priority stack; sticky but unobtrusive Growth Officer action; decisions and approvals optimized for thumb use; no horizontal tables or hidden conversation history.
- All breakpoints preserve the same information hierarchy and task completion path.

## 5. End-to-end customer journey

### Stage 1 — Understand the business

Ask only for information needed to begin: business name/type, location or market, website (if any), customer type, current stage, one primary ambition and constraints. Allow “I don't know” and skip optional fields.

Then the system:
- researches the public website only when supplied and permitted;
- extracts candidate business facts with source/provenance;
- asks the user to confirm uncertain or consequential facts;
- identifies missing information that materially affects the first plan;
- saves a versioned business brief.

Do not block a user behind a long questionnaire. Gather more context progressively when a decision requires it.

### Stage 2 — Define a measurable outcome

The Growth Officer proposes a small number of goal formulations based on the user's ambition. Each goal has:
- outcome and metric;
- baseline and source, or an explicit “baseline unknown” state;
- target and time horizon;
- importance;
- budget and resource constraints;
- assumptions and confidence;
- owner and review cadence.

The user confirms or edits the goal. No target or forecast is presented as measured fact.

### Stage 3 — Diagnose and recommend

The Growth Officer coordinates relevant specialists internally. The orchestration plan should be capability-driven and bounded:
- select only capabilities relevant to the goal;
- pass scoped, verified context and source references;
- define expected outputs and stop conditions;
- enforce credit and cost ceilings before dispatch;
- prevent recursive dispatch and duplicate execution;
- preserve intermediate results and expose recoverable status.

The user sees one coherent diagnosis with evidence, opportunity hypotheses, trade-offs and recommended priorities — not a form asking them to pick agents.

### Stage 4 — Agree the Growth Plan

Present a short strategy with:
- strategic thesis;
- prioritized initiatives;
- target audience and positioning where relevant;
- channels selected for evidence-based reasons;
- milestones and dependencies;
- budget envelopes and resource assumptions;
- measurement plan;
- risks, open questions and confidence.

The user can approve the whole plan or individual initiatives. Approval creates an immutable decision record and a versioned plan. Changes later must be explainable and auditable.

### Stage 5 — Turn strategy into executable work

Convert approved initiatives into linked projects, tasks, campaigns and deliverables. Each work item has:
- goal and initiative links;
- clear definition of done;
- responsible AI capability or human owner;
- dependencies and due date;
- input evidence and output artifact;
- estimated effort/cost where supported;
- execution state and review gate.

The system should create only the work needed for the approved strategy. Avoid generating large task lists as a substitute for prioritization.

### Stage 6 — Execute with controlled autonomy

AI can prepare research, drafts, plans, analyses and internal work products within permitted capabilities. For any external action (publishing, sending, spending, changing live campaigns, modifying connected CRM records), enforce:
- organization policy;
- workspace role and capability checks;
- explicit action preview;
- target, content, timing and cost;
- approval by an authorized person;
- idempotency and execution receipt;
- result/error and recovery state.

An approval is not proof that the external action succeeded. Show “approved”, “executing”, “completed” and “failed/unknown” as separate states.

### Stage 7 — Measure, learn and adapt

Connect outcomes to the goal and initiative. Show the source, time window, attribution limitations and data freshness. Compare actuals to target only when valid measurements exist.

The Growth Officer recommends plan changes when evidence warrants them. Material changes to goals, budgets or external actions return to the appropriate approval gate. Preserve the previous plan version and explain what changed and why.

## 6. Interaction model for the Growth Officer

The Growth Officer is an accountable orchestrator with a persistent context model:
- selected organization and workspace;
- business brief and verified facts;
- active goals and approved plan version;
- current initiative/task;
- relevant documents and source references;
- action permissions and budget ceilings;
- recent decisions and outcomes.

A typical interaction should look like:
1. User states an outcome in natural language.
2. Growth Officer acknowledges the intended outcome and any critical ambiguity.
3. It determines whether available evidence is sufficient.
4. It performs bounded internal research/analysis and reports progress truthfully.
5. It returns one structured result: recommendation, evidence, assumptions, options, cost/credit estimate where available, and next decision.
6. User accepts, edits or rejects.
7. Accepted work becomes linked product records, not merely a long chat message.

Conversation remains useful for exploration, but durable strategy, goals, approvals and deliverables must be structured records that can be edited, versioned, searched and connected to execution.

## 7. Core domain model to converge toward

Do not create duplicate records if an equivalent table already exists. First map current schema and migrations.

Target concepts:
- BusinessProfile and BusinessFact (with provenance, verification state and timestamps).
- Goal (metric, baseline, target, source, time horizon, status).
- StrategyPlan and PlanVersion.
- Initiative (a prioritized strategic bet linked to one or more goals).
- WorkItem (project/task/campaign/content/deal activity) with typed links and dependencies.
- AIExecution (request, bounded plan, capability calls, checkpoints, usage reservation, result and recovery state).
- Decision/Approval (exact proposed action, policy, approver, decision and audit record).
- Measurement (metric, value, unit, period, source, freshness and attribution metadata).
- IntegrationConnection (provider, scopes, sync health, capabilities and revocation).
- Outcome/Experiment (hypothesis, change, observation and learning).

Every record remains scoped to organization and workspace as appropriate. Enforce tenancy and role authorization server-side; never rely on UI visibility for security.

## 8. Current repository mapping and gaps

Verified in the inspected source:
- The shell currently has six primary destinations and contextual navigation, defined in `src/lib/navigation.ts` and rendered in `src/routes/_authenticated/app.tsx`.
- Command Center data is assembled from agent runs, documents, approvals and connector status in `src/lib/command-center.ts`; it is not yet a complete business event or measurement stream.
- The home view combines priorities, attention, active work, activity, results, opportunities and a performance snapshot in `src/routes/_authenticated/app.index.tsx`.
- Performance currently explicitly says website traffic, leads/conversions and revenue are “Not configured” in the inspected code.
- Growth Officer has a conversation interface in `src/routes/_authenticated/app.growth-officer.tsx`.
- The specialist workbench exposes specialist selection and the coordination workbench requires selecting two specialists in `src/components/app/specialist-workbench.tsx` and `src/components/app/coordination-workbench.tsx`.
- Growth intelligence reads verified facts, objectives, opportunity facts and pending recommendations in `src/routes/_authenticated/app.intelligence.tsx`.
- Growth areas explicitly describe several capabilities as planning-only or not configured in `src/routes/_authenticated/app.modules.tsx`.
- Connector registry marks Website and Document upload implemented; Google Analytics, Search Console, Meta Ads, Google Ads, LinkedIn, HubSpot, Mailchimp, Stripe and Shopify planned in `src/lib/registry/connectors.ts`.
- Existing approvals call the `decide_approval` RPC and apply capability/policy checks in `src/routes/_authenticated/app.approvals.tsx`.
- Organization settings include workspaces, members, invitations and sign-in availability in `src/routes/_authenticated/app.settings.tsx`.

Previously committed product reports describe additional implementation and test results, but those historical test suites were not rerun as part of this blueprint. Treat those reports as historical evidence, not fresh verification.

## 9. Delivery plan

### Phase 0 — Baseline and safety (must precede UX code changes)
- Inventory routes, components, tables, RPCs, policies, RLS, permissions, AI functions and connector capabilities.
- Identify the canonical existing entities for goals, budgets, plans, initiatives, approvals, tasks, campaigns and content.
- Capture current main commit and database migration head.
- Establish test baseline: unit, integration, tenant isolation, role matrix, AI billing/settlement, approval workflow and mobile browser flows.
- Define route compatibility and data preservation requirements.
- No schema changes or production actions before this review.

### Phase 1 — Command Center experience
- Replace the current dashboard hierarchy with goal progress, three next actions, AI work, decisions and verified outcomes.
- Reuse existing scoped queries and records where possible.
- Clearly distinguish missing measurements from zero performance.
- Add contextual Growth Officer entry points with attached goal/initiative context.
- Verify mobile first and desktop; keep old routes functional.

### Phase 2 — Goal-to-plan workflow
- Build a guided, conversational goal definition with structured save.
- Generate a versioned strategy plan and initiatives from evidence.
- Require user confirmation for goals, assumptions, targets and budget.
- Connect accepted initiatives to existing project/task records.

### Phase 3 — Autonomous orchestration
- Move specialist selection behind the Growth Officer.
- Add a capability planner with hard bounds, budgets, idempotency, checkpoints, failure recovery and explicit stop conditions.
- Keep the user informed of meaningful progress without exposing internal agent complexity.
- Retain advanced diagnostic visibility for administrators.

### Phase 4 — Execution and decision loop
- Link content, campaigns, SEO and sales work to initiatives.
- Unify approval previews and execution receipts.
- Add external execution only after connector lifecycle, policy, retries and audit controls are verified.

### Phase 5 — Measurement and learning
- Add source-backed KPI ingestion and metric history.
- Show freshness, attribution limits and missing data.
- Enable evidence-driven recommendations and approved plan revisions.

## 10. Non-negotiable acceptance criteria

A release is not accepted because a screen looks polished. It must demonstrate:

1. A new user can establish a business profile and first measurable goal without understanding modules or AI agents.
2. A user can request a growth outcome in one place and receive one coherent recommendation grounded in scoped evidence.
3. The system never asks an ordinary user to choose specialist agents.
4. An approved recommendation becomes linked, inspectable work with clear ownership and completion criteria.
5. No external action, publication, message or spend happens without the required explicit authorization.
6. Costs/credits are visible before a paid AI operation where estimable; reservation, settlement and refunds remain correct.
7. Failed, timed-out and uncertain AI executions are recoverable without duplicate paid work.
8. Every business fact, metric, recommendation and outcome communicates its evidence status.
9. Tenant isolation and role restrictions pass automated tests for every new read/write path.
10. Existing customer data, workspaces, conversations, approvals, credits, files and audit history remain intact.
11. A 390px mobile viewport supports the complete critical journey without horizontal overflow or hidden essential actions.
12. No planned connector or unsupported metric is represented as active.

## 11. Explicit non-goals for the first vertical slice

- Rebuild every module at once.
- Add more dashboard widgets or navigation destinations.
- Create an elaborate agent marketplace for ordinary users.
- Activate live ads, publishing, outbound email, payments or external CRM writes.
- Invent business metrics or forecasts to make the dashboard look complete.
- Replace the existing tenant/security model.
- Run schema migrations or delete/transform customer data as part of a visual redesign.

## 12. Immediate next engineering action

Before implementation, map the existing database entities and server functions that support goals/budgets, approvals, AI runs, projects, tasks and campaigns. Then produce a route-to-capability matrix and a screen-level interaction prototype for the Phase 1 Command Center and Phase 2 goal-to-plan journey.

The first implementation PR should be a narrow, reversible vertical slice, with automated tests and a documented rollback path. It must not be merged to `main` until preview behavior, data integrity, tenant isolation and mobile acceptance criteria have been reviewed.


## 13. Implemented vertical-slice extension (feature branch)

The current branch adds a versioned Growth Plan approval boundary, idempotent initiative-to-project/task conversion, and approved-initiative budget allocation. A budget line may reference an initiative only when its goal, organization and workspace match; the database rejects links to non-approved plans. Generated projects are linked back to their initiative, and the Command Center displays the initiative alongside active work. This is internal planning/execution scaffolding, not autonomous external execution. All changes remain on the feature branch pending migration, preview, security and mobile validation.


## 14. Initiative operations and proactive attention (feature branch)

Approved Growth Plan initiatives now carry an operational layer without changing the approved strategy snapshot. Workspace members can set an accountable owner, deadline, success metric, baseline, target, current result and blocker. Owner choices are limited to organization members who have eligible access to the active workspace; the database revalidates that access.

The Command Center surfaces follow-up signals from all current approved initiatives, including those not yet converted into projects. The transparent priority order is: recorded blocker, overdue deadline, deadline within seven days, active initiative without an owner, and active initiative without a complete outcome measure. The Command Center presents up to six items while retaining the total follow-up count. These are deterministic workflow rules, not AI forecasts.

A member can pass the issue context into a prefilled Growth Officer question. Nothing is sent or charged until the member explicitly submits the question. The Growth Officer is instructed to identify the next best action, distinguish facts from assumptions, and identify decisions and external approvals. This does not yet implement autonomous specialist selection, automatic task assignment, campaign execution, publishing or budget spend. External actions remain behind explicit approval and separate execution controls.

New migrations 0050–0052 add operational fields, scope and approved-plan guards, plus a safe JSON action-shape check for initiative-to-work conversion. Unit tests for the deterministic attention rules have been added. This branch has not been built or run in a browser, tests have not been executed, and no migration has been applied. The next acceptance gate is a database-backed preview and mobile verification before any merge to `main`.


## 15. Growth Officer deep analysis (feature branch)

The Growth Officer now keeps a standard one-call response as its default. The user may explicitly enable Deep analysis before sending a question. In that mode, the server chooses two relevant specialist capabilities from the request topic using deterministic rules; the user does not choose or manage agents. The specialists perform bounded analysis and the Growth Officer synthesizes one coherent result. Internal specialist outputs are not exposed in the ordinary conversation view.

The deep workflow makes its cost boundary visible before submission: 150 credits are reserved across three calls, actual use is charged and unused credits are returned. The same metering, workspace checks, idempotency, checkpoints and recovery protocol used by the advanced coordination engine are reused. The user must still submit the request; no external action is executed by the analysis.

This is an opt-in deep-analysis mode, not yet the complete autonomous orchestration vision. It does not yet choose the depth of work autonomously, prioritize across all business initiatives, dispatch work in the background or coordinate against live channel performance. Those steps require a measured-value model, verified connector state, plan-aware capability policy and additional preview/approval UX.


## 16. Plan-aware Growth Officer context (feature branch)

The Growth Officer and its bounded specialist workflow now receive one workspace-scoped operating context: verified business facts, current growth goals, approved Growth Plan versions, initiative status and operational fields, plus recent budget entries. Initiative owners are represented only as assigned/unassigned; personal identifiers are not sent to the model. Current and target outcome values remain user-maintained records unless a connected, verified source is explicitly available. Budget actuals are marked as manual inputs and amounts in different currencies are never combined.

Recommendations are instructed to align with approved plans, prioritize recorded blockers and overdue/near-term initiatives, and explain trade-offs before proposing changes to the approved plan. This improves context and consistency; it does not autonomously dispatch specialists, create work, reallocate money, or perform any external action.
