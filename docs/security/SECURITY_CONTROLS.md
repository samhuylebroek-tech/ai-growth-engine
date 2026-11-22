# Security controls (proposal 0088 and earlier)

| Control | Where | Verified by |
| --- | --- | --- |
| Platform Owner = role + aal2 | `src/lib/security/owner.ts`, `session_mfa_verified()` | `src/test/security-hardening.test.ts`, 0088 SQL suite, browser (admin/member refused, owner asked for code) |
| TOTP enrollment / challenge / removal / sign out others | `src/components/security/*` | Browser on staging (owner enrolled and re-challenged) |
| Hash-chained audit log | `audit_chain_head`, `audit_chain_insert` trigger, `verify_audit_chain()` | 0088 SQL suite (tamper detection), owner panel |
| Trigger-based admin audit | `audit_admin_change()` | 0088 SQL suite, staging audit rows |
| Refused-access signals | `record_security_event()` (allowlisted, ≤30/hour/caller), `security_overview()` | Owner panel on staging |
| Emergency stops (workspace/org/platform) | `execution_stops`, `set_org_execution_stop`, `set_platform_execution_stop` | 0088 SQL suite, browser stop/resume per tier |
| Document plan limits | storage INSERT restrictive policy, `documents` trigger, `document_capacity()` | 0088 SQL suite |
| SEO outbound restriction | `src/lib/security/outbound.ts`, `seo.functions.ts` | Unit tests, browser refusal for an unregistered site |
| Minimal grants | 0088 revokes | `tests/sql/privilege_hardening.sql` |
| Credit grants bounded + aal2 | `admin_grant_credits` | 0088 SQL suite |
| Dependencies | `package.json` overrides (seroval, js-yaml, source-map-js) | Dependency scan with no accepted exceptions; zod 4.6.6 (`src/test/zod-upgrade.test.ts` guards the version and the lenient ID check). Remaining: two moderate development-only advisories |
