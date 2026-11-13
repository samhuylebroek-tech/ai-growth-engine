# Security

## Controls in place
- **Tenant isolation**: RLS on every public table; every tenant row carries `org_id`; helper functions are SECURITY DEFINER with fixed `search_path`. `anon` has no privileges except `plans`/`plan_entitlements` of public plans.
- **Roles**: owner > admin > member > viewer. Owner cannot be granted via update (trigger). Platform roles live in a separate table with no insert path for users.
- **Server enforcement**: server functions re-check role and entitlement; DB re-checks again.
- **Credits**: ledger is append-only; only `consume_credits` (member+, ≤1000, row-locked) and `admin_grant_credits` (platform owner) write to it.
- **Approvals**: only `decide_approval` can change status (admin+, pending only, audited).
- **Uploads**: extension/MIME allowlist, 20 MB cap (client + bucket), private bucket, path scoped by org id, storage RLS by org membership.
- **SSRF**: website analysis allows only public http(s) hosts on 80/443, blocks private/loopback/link-local IPs and IP literals, re-validates every redirect hop, 8 s timeout, 600 KB cap.
- **Prompt injection**: all customer/document/website content is wrapped in `<untrusted>` blocks; instructions tell the model to treat it as data; AI cannot execute actions — it can only create pending approvals for registered capabilities.
- **Auth**: email verification on, password reset page, Google sign-in, redirect targets sanitized to same-origin paths.

## Tests
- `tests/sql/rls_isolation.sql` — 33 database-level checks with three temporary users (two tenants + a viewer). Self-rolls back. Last result: **33 pass, 0 fail** (2026-11-13).
- `src/test/rules.test.ts` — 31 unit tests (roles, approval transitions, credit math, SSRF, uploads, registry rule). Last result: **31 pass**.

## Known gaps / risks
- MFA, SSO/SCIM, session revocation UI, account deletion flow: not built.
- Leaked-password (HIBP) check: not verified as enabled.
- Rate limiting of AI calls is credit-based only; no per-minute limiter yet.
- DNS-rebinding: hostnames resolving to private IPs are not resolved/checked (Workers has no DNS API); mitigated by no internal network on Workers.
- Word/Excel parsing not implemented (files stored, not read).
- Credits are reserved before the AI call and not refunded if the provider fails.
