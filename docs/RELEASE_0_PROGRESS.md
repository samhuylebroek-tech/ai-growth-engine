# AI Growth Engine — Master Blueprint, Release 0 progress

16 November 2026. **Release 0 remains partial.** This delivery creates the full ten-release architecture/dependency map and completes the narrow revoked-access paid-output preservation slice. It does not deliver Content Studio, SEO, CRM, automation or the entire product transformation.

## Scope and actual implementation

- Inspected the master directive in full, current AI server code, dispatch/receipt/request SQL functions, role checks, existing routes/registries, tests and architecture/status documents. Historical reports were used as baselines, not assumed to be current proof.
- Added `docs/MASTER_RELEASE_MAP.md`: all layers, releases 0–9, dependency graph, module coverage/status, exit criteria, governance/integration boundaries and exact next vertical slices.
- Migration **0035_preserve_claimed_ai_delivery_after_revocation** changes only delivery/outcome persistence for an existing dispatch claim. A legitimate server-controlled completion may store its paid response even after the caller's organization/workspace membership is removed.
- This write still requires server accounting proof, an authenticated original requesting user, original dispatch key, matching run/user/org/workspace, a real reserved/settled credit reservation and valid bounded immutable delivery data. No new claim is minted and no private data is returned by the write.
- Organization locking precedes receipt locking, preserving the accounting lock order. Identical delivery is idempotent; changed text/usage/model/provider/credits/request ID is rejected.
- **No read or action privileges are restored.** Current membership remains required for receipt/request reads, settlement, request recovery, final conversation saving, new dispatch and subsequent coordination steps. Revoked paid text is preserved privately; credits remain reserved until an authorized original caller can reconcile.
- Updated the persistent revoked-execution SQL regression to distinguish safe private delivery preservation from forbidden read/settlement/final persistence. Updated architecture docs and root technical rules.
- Existing metered provider flow, selected model and output limits remain unchanged. The server still invokes `meteredGenerate`; no service-role app client, public owner endpoint, provider replay or unattended worker was added.

## Executed evidence

| Check | Result and scope |
| --- | --- |
| Full Vitest before and after changes | 133 passed across 18 files |
| `tests/sql/single_ai_revocation.sql` | 16 passed, 0 failed: delivery retained after revocation, wrong key rejected, immutable output, revoked reads/settlement/final saving denied, reservation retained, another caller denied, final saving after explicit assignment restored in rollback fixture, unknown outcome recorded after revocation, new dispatch blocked, expired request rejected/refunded only before dispatch |
| `tests/sql/ai_receipt_security.sql` | 12 passed, 0 failed: direct writes denied, forged accounting proof denied, tenant/viewer reads denied, anonymous settlement/recovery denied |
| `tests/sql/rls_isolation.sql` | 39 passed, 0 failed |
| Signed-in Growth Officer | Real user-started request succeeded; saved answer reopened after reload, 1 measured AI credit |
| Desktop/phone/tablet | 1280×1800 / 390×844 / 768×1024; screenshots inspected, no phone/tablet horizontal overflow |
| Browser runtime | No page errors in the exercised flow |
| Permission inspection | Anonymous delivery execute false; authenticated direct receipt UPDATE false |
| Preview compilation | Latest observed entry: build OK |

SQL tests deliberately raise their result sentinel to roll back all test users, assignments, records and the temporary fixture-only verifier. No verifier bypass remains deployed. Synthetic revoked-output tests call **no provider**. The single real browser test added a development conversation and real usage; no customer account permissions were changed by that test.

The browser test verifies ordinary authorized request/result persistence after the change. Revocation itself was exercised by the rollback SQL test, **not** a claimed real multi-user browser revocation run. No broad end-to-end audit of every existing feature or ASVS certification is claimed.

## Remaining Release 0 gates

1. **Active-dispatch multi-session concurrency:** completed-request duplicate tests from Work Package 2 and SQL claim guards exist, but the comprehensive simultaneous active execution/revocation matrix is not done.
2. **Expired/invalid session token after inference:** the completion still requires a valid authenticated identity. If the token expires or is invalidated before delivery, persistence can fail. A properly scoped transport identity/delegation design requires further review; no auth bypass was introduced.
3. **Transport ambiguity and provider investigation:** diagnostic IDs and private receipts exist. There is no provider-status resolver or autonomous investigator; unknown requests retain reservations and can block new work.
4. **Delivery transport failure:** a completed answer that never reaches receipt storage may still be unavailable. Never automatically replay or refund this ambiguous execution.
5. **Revoked-member accounting:** private delivery is now retained, but settlement/final recovery remain denied while revoked. No organization-admin impersonation or new reader was added. An authorized accounting reconciliation design must be reviewed separately if access will never return.
6. **Performance/scalability:** existing execution collections traverse keysets but still collect before display pagination. Server-side list filters/aggregates, benchmarked large-workspace queries and complete search coverage remain unfinished.
7. **Security/UX matrix:** complete retention/account lifecycle/hostile file-format/auth/accessibility/multi-workspace tests and security linter review are not complete. The listed tests are the actual evidence, not a complete security audit.
8. **Unattended jobs:** no authorized worker/scheduler was deployed; manual recovery remains the supported path. Deployment is still explicitly deferred.

## Product status and next releases

Existing authentication, tenancy, fact/document intelligence, four specialists, bounded teamwork, receipts/idempotency, execution/campaigns, approvals, notifications/search and command center remain in place. Their full current coverage and future module dependencies are recorded in `docs/MASTER_RELEASE_MAP.md`.

Release 1 source version/review/retrieval is partial. Dedicated writing profiles/Content Studio (Release 2), campaign-editorial content planning/recurrence/exact-version approval (Release 3), measured SEO/competitors (4), CRM/sales (5), workflows/workers (6), business measurement/reporting (7), advanced growth/scenarios (8) and agency/brands (9) are **not completed by this delivery**. No placeholder modules were added to navigation.

**Exact next step:** add persistent multi-session active-dispatch tests and investigate expired-auth/unknown delivery transport without replaying inference; then implement server-bounded execution pagination and finish remaining Release 0 gates. Move to approved source intelligence and the complete writing-profile/editor slice only after those gates are addressed.

## External boundaries

No Platform Owner initialization/elevation, live payments, production deployment, live customer changes, advertising, social/content publication, outbound emails/messages, recurring automatic publication, irreversible production deletion or SSO activation occurred. Actual external integrations remain configuration-dependent and never show connected without verification. No fabricated business metrics or customer data were introduced.