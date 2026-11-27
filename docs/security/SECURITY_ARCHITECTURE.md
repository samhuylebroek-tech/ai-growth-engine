# Security architecture

Status: staging. Proposal 0088 is applied on staging only; the live database has none of proposals 0063–0088 until the owner approves a rollout.

## Trust boundaries
1. **Browser** — untrusted. Holds only the publishable key and the user's own session. Every write is re-checked by RLS, a SECURITY DEFINER function or a server function.
2. **Server functions (TanStack, Worker runtime)** — authenticated with `requireSupabaseAuth`; the token is verified server-side (`getClaims`), so claims such as `aal` cannot be forged. No service-role client in app code.
3. **Database** — final authority. RLS on every public table, restrictive workspace policies, role checks inside SECURITY DEFINER functions with a fixed `search_path`. Grants are minimal: no TRUNCATE/REFERENCES/TRIGGER for API roles, internal helpers not executable through the API.
4. **Outside services** — AI gateway, ECB rates, websites. Responses are untrusted: website/document text is quoted with `quoteUntrusted`, website fetches go through `fetchPublic` (public hosts only, redirects re-checked, size/time caps).

## Identity and roles
- Organization roles: owner > admin > editor > member > viewer (`organization_members`), capped per workspace by `workspace_members`.
- Platform roles (`platform_roles`) are separate and have no insert path for users. Platform Owner operations need the exact `platform_owner` role **and** a session at assurance level `aal2` (verified authenticator code).
- Two-step verification: TOTP factors managed by the auth service; enrollment, removal and "sign out other devices" are in Settings → Sign-in.

## Integrity
- `audit_logs` is append-only (update/delete/truncate triggers). From 0088 on, each new row carries `prev_hash` and `row_hash` (SHA-256) in a single serialized chain; `verify_audit_chain()` (Platform Owner) re-computes it. Older rows stay unchained and are reported as such.
- Admin changes (membership roles/removal, organization updates, policies, subscriptions) are audited by database triggers; direct `log_audit` from the browser is revoked.

## Emergency stops
Three independent tiers — workspace (business admin), organization (org admin) and platform (Platform Owner, aal2). A business is paused when any tier is active; lifting one tier never lifts another. Task runs, cycles and outside actions check the effective pause in the database.

## Limits
Plan entitlements are enforced in the database for documents (storage policy + document trigger), seats, workspaces and AI credits. Per-minute rate limits are **not** implemented (owner decision: document only).
