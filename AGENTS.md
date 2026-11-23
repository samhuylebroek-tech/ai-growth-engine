<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Tenant data is isolated by `org_id` + RLS; app code never uses the service-role client — privileged changes go through SECURITY DEFINER SQL functions with explicit role checks.
- Platform roles (`platform_roles`) and org roles (`organization_members.role`) are separate tables; never derive one from the other.
- Every AI call goes through `meteredGenerate` in `src/lib/ai.functions.ts` (entitlement → credits → provider → usage event); never call the gateway directly from elsewhere.
- AI credit reservation, settlement/refund and usage insertion go through the role-checked SQL functions; clients never insert usage or reservation records directly.
- Untrusted content (profile, documents, websites) enters prompts only via `quoteUntrusted`; AI may only create pending approvals for registered capability keys.
- Agents, capabilities, connectors and modules are code manifests in `src/lib/registry/`; external-write capabilities must require approval.
- Never show sample or invented metrics; unconnected integrations show "Not configured".
- Run `tests/sql/rls_isolation.sql` (via SQL tool; it self-rolls back) and `bunx vitest run` after schema or permission changes.
- Website discovery returns schema-validated, source-allowlisted findings; confirmation is explicit and only verified facts enter approved AI context.
- Office files are parsed with bounded ZIP expansion and XML entity rejection; parsing modules are dynamically imported inside authenticated server handlers.
- The service worker caches only the static offline fallback, never authenticated pages, tenant data, API responses, or files.
- Leaf routes use the shared pageHead helper for unique metadata; visual roles come from global light/dark design tokens.
- Profile confirmation uses one role-checked SQL transaction for profile, facts and audit; repeated key/source confirmations update rather than duplicate facts.
- Tenant/workspace associations are immutable on mutable AI knowledge records, preventing cross-workspace reassignment through UPDATE.
- AI context readers require explicit organization/workspace scope, fail closed on read errors, and use verified facts rather than descriptive profile mirrors; this prevents stale edits from bypassing confirmation.
- Key customer content by organization/workspace to remount local drafts and in-flight handlers on switching; document extraction requires both identifiers and validates immutable storage identity.
- Monthly plan credits are lazily granted by a role-checked SQL function before usage and account reads, with a unique organization/month ledger key; no idle polling or duplicate grants.
- Workspace access requires explicit workspace assignments capped by organization role; organization owners retain all-workspace administration, and restrictive policies also protect storage and scoped RPCs.
- Workspace creation goes through the atomic quota-checked SQL function, not direct inserts, to prevent concurrent plan-limit bypasses.
- Shared code navigation drives the drawer and page-search dialog so visible destinations remain consistent and implemented.
- Group navigation into primary destinations with contextual tabs from the same manifest; retain existing route URLs so saved links remain valid.
- Home and intelligence share one scoped summary query; question handoffs are session-only and keyed by organization/workspace so drafts never cross contexts.
- Conversation messages are loaded only after verifying their parent conversation belongs to the active organization/workspace and authenticated user, because messages have no workspace column.
- Owner-center server reads require the exact Platform Owner role and fail closed, so general platform staff cannot access owner operations.
- The command center normalizes workspace-filtered runs, documents and approvals into typed, entity-deduplicated events; bounded foreground polling avoids fictional realtime and never polls credit grants.
- Home display preferences are keyed by user, organization and workspace; attention and active work stay visible while secondary sections can move or hide.

- Execution work uses workspace-scoped projects/tasks/campaigns and typed parent-scoped execution_notes; composite foreign keys and triggers prevent cross-workspace links.
- Recommendation conversion and explicit next recurrence use role-checked atomic SQL RPCs with unique source/request keys; no scheduler or external execution is implied.
- Execution collections traverse scoped ID keysets under a creation watermark and reject incomplete/non-advancing reads; list filters run over the collected set before display pagination.
- AI execution context accepts only bounded explicit record references, refetches as the caller and quotes operational text separately from verified facts.
- Specialist analyses are single user-started metered calls with validated domain output and private source-linked conversation results; they never recursively dispatch agents.
- Coordinated analyses are explicit two-specialist plus one-synthesis requests; role-checked SQL claims reserve the capped budget atomically and persist private results without recursive dispatch or blind retries.
- Workspace record search reads at most five matches per category under caller RLS and explicit organization/workspace scope; conversation matches additionally require the requesting user.
- Settlement, refunds and coordination mutations require server-only accounting proof in addition to caller role checks; browser callers cannot forge paid execution. Completed coordination output is checkpointed before parsing.
- Metered AI dispatch is claimed once; private receipts precede settlement. Single requests use scoped immutable keys and atomic answer/proposal persistence. Recovery never replays inference; unknown outcomes retain reservations.
- Claimed delivery/outcome writes require server proof, caller/key and immutable run/reservation identity; revocation still denies reads, settlement, recovery and new dispatch, preserving paid output without restoring access.
- A declared APP_ENVIRONMENT is checked on every request by `src/lib/environment.ts`; mixed or production-referencing staging settings return 503 instead of serving, so staging can never silently fall back to live configuration.
- Proactive signals come from deterministic rules in `src/lib/signals.ts` over the same scoped business context the Growth Officer reads, so Home and AI agree and cost no credits; signals point to evidence, never to a cause.
- An uncertain AI outcome is closed only by the requester or an org admin through a proof-checked SQL function that counts the reserved credits as used; it never refunds or replays, because the provider may already have run and billed.
- AI task execution (proposal 0063): each attempt is a database-owned task_runs row using single-request accounting under the run key; outcomes come from recorded AI/credit state, leases expire into reconciliation, uncertain runs are never retried, so nothing is charged or run twice.
- Task-run eligibility is one SQL gate (task_run_gate, proposal 0064) shared by manual runs and bounded admin-started cycles that log a reason per task; schedules only mark cycles due, since runs need a signed-in session.
- Business intelligence (proposal 0066): revenue is a permanent per-currency ledger, attribution is pure `src/lib/bi/` over RLS reads; see `src/lib/bi/AGENTS.md`.
- Multi-business organizations (proposals 0067–0070): businesses are workspaces, org reporting and org intelligence are pure over RLS reads, and organization decisions only take effect through each business's own rights; see `src/lib/org/AGENTS.md`.
- Rate limits (proposal 0090) are enforced in the database: triggers on run/upload inserts, `consume_rate_limit` before outside fetches, insert-only hidden counters; refusals surface via `src/lib/rate-limit.ts`, so no path can skip a limit and no credits are reserved for a refused request.
- Home recommends one next step from pure `src/lib/next-step.ts` over the records Home already reads, in fixed priority and only steps the viewer's role permits; it costs no credits and unknown reads are never treated as absent.
- IDs are validated with `z.guid()` (Zod 4), not the strict RFC UUID check, because the database derives some keys from md5; `src/test/zod-upgrade.test.ts` guards this and the minimum Zod version.
- Guided onboarding (proposal 0091): questions are a code manifest in `src/lib/onboarding/questions.ts` whose keys the SQL allowlist must equal; answers are confirmed business facts (source "Onboarding answer") saved only through `save_business_answers`, so Business Knowledge, the Growth Officer and the next step read one store.
- AI answers label each statement (fact, calculated, estimate, hypothesis, recommendation, missing) via the shared `CLAIM_RULE` and render through `AiMarkdown`; a 'fact' worded as uncertain is shown as a hypothesis and untagged text is never upgraded.
- CI ESLint enforces Prettier on every source file: run `scripts/ci/format-changed.sh` before each commit (platform-generated `src/integrations/supabase/` is excluded via `.prettierignore`), so the pull-request check never accumulates formatting debt again.
- GitHub sync is verified, never assumed: after each round run `bun scripts/ci/github-status.ts` (read-only, public API) and report Synchronized / Not synchronized / Unknown with the CI result per check; CI pins its Bun version to match local.
