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

## Security review — 2026-11-20

| Area | Finding | Status |
| --- | --- | --- |
| Google sign-in for data sources | The return address was taken from the browser's origin; a forged origin could have received the authorization code. | Fixed: only origins listed in `APP_PUBLIC_ORIGINS` (https, or localhost); re-checked on return. Tests in `src/test/oauth.test.ts`. |
| Google sign-in | No PKCE; state signature compared with `!==`. | Fixed: PKCE S256 with the verifier in a one-time HttpOnly cookie bound to the state nonce; constant-time comparison; state with extra parts rejected. |
| Environments | A staging runtime could in theory start with live settings mixed in. | Fixed: `checkRuntimeEnvironment` refuses (503) on wrong backend, production reference, service-role key, missing secrets or mismatched labels; staging sends `X-Robots-Tag: noindex` and a robots meta tag. Tests in `src/test/environment.test.ts`. |
| Secrets in browser code / logs | Searched for `VITE_*SECRET/TOKEN/SERVICE`, secret-bearing console output and raw HTML rendering. | None found (only the standard chart style block). |
| Platform scan | Automated backend checks. | No issues reported. |
| Tenant isolation | 23 staging SQL suites incl. RLS isolation, privilege hardening, owner initialization, connectors. | 23/23 pass. |

Open risks (documented, not yet fixed):
- No per-user rate limit on "connect with token" attempts; only workspace admins can try, and each attempt is one read-only provider request. A database-backed limit needs a schema proposal.
- `read_connector_credential_verified` is executable by signed-in users but requires the server-only accounting proof; moving it to a dedicated server role would remove that dependency.
- Proposals 0057–0059 and 11 committed migrations are applied on staging only; the live database still has the older connector table permissions until the owner approves.
- Password policy, sign-in rate limits and leaked-password protection are platform auth settings that were not changed in this review.

## Security hardening review — 2026-11-21 (staging, proposal 0088)

| Area | Finding | Status |
| --- | --- | --- |
| Documents | Plan document limits were only checked in the browser. | Fixed in the database: storage upload policy and document trigger refuse when documents are not in the plan or the limit is reached. |
| SEO check | Any member could make the server fetch any public website. | Fixed: only the business's own website or a registered competitor; sitemaps stay on the same site. |
| Platform Owner | Owner operations needed only the role. | Now also need a session confirmed with an authenticator app (`aal2`), in server functions and SQL. |
| Audit log | Rows were append-only but not tamper-evident; the browser could write audit rows. | New rows are hash-chained and verifiable by the owner; admin changes are audited by database triggers; direct browser writes revoked. |
| Emergency stop | Only a per-business pause. | Organization and platform stops added, independent tiers, audited. |
| Grants | API roles had TRUNCATE/REFERENCES/TRIGGER and could call internal helpers. | Revoked. |
| Dependencies | seroval, js-yaml, source-map-js advisories. | Updated via overrides. Nested `zod` 4.6.5 inside build tooling remains. |

Open risks (documented decisions):
- **No per-user/per-business rate limits** (owner decision 2026-11-21: document only). Existing caps: credits, reservations, parallel runs, monthly grants, 30 security events/hour.
- Members can register competitor websites, which then become valid SEO targets (public hosts only).
- Audit rows from before 0088 are not chained; a database superuser could rebuild the chain.
- Document storage policy counts files without a lock; two simultaneous uploads at the limit may both store a file, but the document record trigger is serialized, so the extra file is never registered.
- Two-step verification is required only for platform administration, not for organization admins.
- Proposal 0088 is staging-only; live rollout of 0063–0088 needs separate approval.
- Details: `docs/security/`.
