# Security — 2026-11-15

## Controls in place
- **Tenant/workspace isolation**: RLS on every public table; restrictive workspace policies cover knowledge, documents, conversations/messages, runs, approvals, extensions, scoped connectors, usage and private storage. Explicit assignments are capped by organization role; only organization owners retain all-workspace administration. Removal clears assignments.
- **Roles**: owner > admin > member > viewer. Owner cannot be granted through membership updates. Platform roles live separately with no user insert path; owner-center reads require the exact Platform Owner role.
- **Server enforcement**: authenticated server functions re-check organization/workspace roles and entitlements. Privileged SQL functions use fixed `search_path` and explicit caller/run/workspace checks. No app code uses a service-role client.
- **Credits**: the ledger is append-only. Role-checked SQL functions reserve, settle and refund atomically; final settlement inserts usage in the same transaction. Direct client usage/reservation inserts are denied. Additional settlement cannot overdraw the balance.
- **Invitations**: secured creation/acceptance checks seat entitlement, matching confirmed email, expiry and single use. Acceptance grants no implicit workspace access; direct invitation inserts are revoked.
- **Approvals**: workspace admins decide pending items through an audited SQL function. Blocked organization capabilities cannot be proposed or approved, but can be rejected.
- **Uploads**: extension/MIME allowlist, 20 MB cap, private bucket, immutable org/workspace paths and workspace storage RLS. Office parsing bounds ZIP expansion and rejects XML DTD/entities; document content is untrusted.
- **SSRF**: website analysis permits public HTTP(S) hosts on 80/443, blocks private/loopback/link-local IPs and IP literals, revalidates redirects, times out after 8 seconds and caps reads at 600 KB.
- **Prompt injection**: customer/document/website content is quoted as untrusted data. AI cannot execute actions; it can only propose registered, policy-allowed capabilities for approval.
- **Auth/recovery**: email verification remains on; reset requires a recovery-type link/session; OAuth returns to a same-origin public path and intended destinations are sanitized. Google and managed Microsoft buttons exist; OIDC uses the dedicated custom provider.
- **Offline privacy**: only the static public fallback is cached, never tenant pages, API payloads or documents.

## Fresh verification
- Vitest: **59 passed, 0 failed** across 6 files.
- Rollback-only database checks: **119 passed, 0 failed** — tenant isolation 39, workspace/storage 30, context identity 13, monthly credits 6, credit lifecycle 14, invitations 12 and approval policies 5.
- Signed-in browser: policy persistence/restoration, no-email invitation create/revoke, invalid recovery rejection, real AI response/readback and settled credit history passed with zero page errors. External Microsoft/OIDC/SAML authentication and multi-account UI acceptance were not exercised.

## Known gaps and risks
- MFA, SAML/SCIM, organization-specific OIDC routing, domain verification, group/role mapping, session-revocation UI and account deletion/export are unfinished. SAML configuration was declined; no SAML success is claimed.
- Microsoft sign-in is enabled but not tested with an external account. OIDC requires administrator provider configuration. Enterprise entitlements do not prove provider readiness.
- No per-minute/concurrency AI limiter. Additional credit settlement is capped by remaining balance rather than hard maximum-cost pre-budgeting.
- DNS resolution/rebinding checks are limited by the runtime; public-host validation and redirect revalidation remain in place.
- Full hostile-file coverage, background-job authorization, workspace-specific audit redaction, rate limits and formal OWASP/GDPR/ISO/SOC2 assessment remain open. No compliance certification is claimed.
- Personal Platform Owner initialization, live payments, production publishing and external actions remain deferred; no platform privileges were granted.
