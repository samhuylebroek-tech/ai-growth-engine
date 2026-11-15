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
- Owner-center server reads require the exact Platform Owner role and fail closed, so general platform staff cannot access owner operations.
