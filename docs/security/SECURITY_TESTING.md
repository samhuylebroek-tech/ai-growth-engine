# Security testing

- `bunx vitest run` — includes `src/test/security-hardening.test.ts` (outbound host rules, owner gate with/without aal2, refusal recording) and earlier owner/OAuth/environment tests.
- Staging SQL suites via `scripts/staging` (rollback-only): `tests/sql/*.sql` and `tests/proposals/*.test.sql`, including `0088_security_hardening.test.sql` (40 assertions: grants, aal2 gates, audit chain tamper detection, stop tiers, document limits, event cap).
- Browser checks on the staging app (`scripts/staging/app.ts`): admin and member refused from the owner center; owner asked for an authenticator code after each fresh sign-in; organization and platform stop/resume with the notice visible to members; SEO check refused for an unregistered website; EN/NL/FR and phone width.
- Platform scans: quick backend scan and dependency scan; deep scan to be re-run after merge to confirm the two fixed error-level findings.
