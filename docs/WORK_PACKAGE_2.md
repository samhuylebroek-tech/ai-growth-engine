# AI Growth Engine — Work Package 2 progress

16 November 2026. This delivery completes a bounded P0 reliability slice, **not the complete Content Intelligence & Writing Engine**. The requested order is preserved: P1/P2 were not started while material P0 gates remain.

## Implemented and tested

- Growth Officer and all four specialist calls use the same private request ledger and scope: organization, workspace, requesting user, immutable request key and exact input. Duplicate input under the same key returns the original run/result; changing input under that key is rejected.
- Browser attempt identities persist in session storage across errors/reloads and are scoped by user/organization/workspace/call surface. These are not authorization credentials. Server authorization remains mandatory.
- Stored provider receipts are reused for manual single-call recovery. Recovery never invokes the provider. Unknown execution outcomes retain reservations; only confirmed unstarted calls or expired requests without a dispatch receipt may refund.
- Final conversation, user/assistant messages, run status, request result and Growth Officer pending proposals are saved atomically. Blocked organization capabilities are omitted. Repeated completion does not duplicate messages, proposals or usage.
- Saved-request controls appear on Growth Officer and Specialists, support reopening/download, and refresh after failed submissions. Paid output remains available for recovery if final saving fails.
- A dispatch guard prevents closed/expired requests from beginning inference after recovery. It uses the same organization lock order as request close/finish.
- Explicit write revocation prevents browser mutation of request records. An initial test found UPDATE was granted despite the intended read-only design; migration 0033 removes those permissions. The repeated test passes.

## Executed tests and observations

| Check | Result |
| --- | --- |
| Full Vitest regression run | 133 passed, 18 files |
| Persistent attempt tests | 3, included in 133: interrupted/reloaded identity, workspace separation, input changes |
| `tests/sql/single_ai_recovery.sql` | 19 passed, 0 failed |
| `tests/sql/single_ai_revocation.sql` | 8 passed, 0 failed |
| Tenant isolation checks from `tests/sql/rls_isolation.sql` | 39 passed, 0 failed |
| Signed-in Growth Officer | Real answer saved, reload/reopen succeeded |
| Concurrent repeated completed RPC | Two simultaneous identical repeats returned HTTP 200; readback found exactly one answer and one usage event per original request |
| Single-answer interruption | Synthetic delivered receipt recovered through the actual button, reopened after reload and on Specialists; zero credits charged |
| Phone | 390×844, closed navigation, no horizontal overflow; desktop 1280×1800 |
| Browser runtime | No page errors in executed checks |
| Current preview error check | Build OK before final documentation save; final log checked separately |

Rollback-only SQL suites terminate deliberately with result exceptions so all fixtures and temporary verifier changes are discarded. The first recovery SQL attempt had a dollar-quote syntax error; the next exposed excessive UPDATE rights. Both were corrected before reporting the passing result. No test secret bypass remains installed.

Two separate real test runs created two original requests. Replaying the second request twice concurrently created no additional request, answer or usage. This is **completed-request concurrency**, not a claim of a comprehensive simultaneous in-flight dispatch matrix.

One zero-credit, clearly marked QA synthetic recovery conversation remains in development data. It did not call a provider and must not be treated as authentic business content. Real test questions and their measured AI usage also remain. No production deletion occurred.

## Remaining P0 gates and limits

1. Revocation during execution is fail-closed: delivery persistence, final saving and reads are denied when member access is removed. Credits remain reserved. However, a response arriving after revocation cannot currently be durably recorded by the caller, so its text may be unavailable to ordinary receipt recovery. A narrowly server-attested ingestion/accounting path must be designed without granting users access or using a service-role app client. This gate is **not complete**.
2. Provider transport ambiguity still requires investigation using retained diagnostic IDs. No external-status resolver or autonomous investigator was added.
3. No scheduled worker/unattended recovery exists. Users start recovery explicitly. This is deployment-dependent only for the worker, not for the internal manual recovery controls.
4. Full simultaneous active-dispatch, multiple-user/workspace and permission-revocation browser matrices remain unverified. SQL guards and the specific executed checks above are not substitutes for the complete matrix.
5. Request-level idempotency is added for Growth Officer/specialists, not every website/document AI workflow. Historic pre-ledger single calls have receipts but no new request record, so this UI cannot reconstruct all historic final conversations.
6. Request history shows the latest 20 rows; durable rows remain in storage. Unknown outcomes can conservatively block new requests until investigated. Invalid structured specialist output remains in the receipt, but automatic valid-document reconstruction is not guaranteed.
7. Receipt delivery itself can still fail; completed inference is never blindly refunded or replayed. No claim of exactly-once remote provider execution beyond the local dispatch claim is made.

## Content scope status

| Requested area | Current status |
| --- | --- |
| Business knowledge integration | Existing confirmed facts/documents/web discovery preserved; dedicated selected content-source layer not started |
| Writing profile architecture, authorized samples, analysis/approval | Not started |
| Content generation | Existing single-call Content specialist preserved; not a Content Studio |
| Rich editor, autosave, draft/version compare/restore | Not started |
| Quality and source checking | Existing evidence-aware specialist outputs preserved; dedicated content checks not started |
| Campaign content strategy/editorial integration | Not started |
| Recurrence and Thursday LinkedIn workflow | Not started |
| Exact content-version approval lifecycle | Not started; existing general action approvals are not represented as content-version approval |
| Editorial calendar and dashboard synchronization | Not started |
| Publishing | Disabled; no provider connection or manual publication completion added |
| SEO opportunities and measured performance | Existing SEO specialist preserved; no measured SEO/content integration added |

## Database and code

- 0031: private single request ledger, begin/finish/close authenticated server-attested functions.
- 0032: atomic Growth Officer proposal completion.
- 0033: explicit authenticated/anonymous write revocation.
- 0034: single-request receipt dispatch lease guard.
- Existing AI metering/provider model/output caps remain unchanged. All inference still goes through `meteredGenerate` in `src/lib/ai.functions.ts`.
- New shared input/persistent-attempt helper, reusable recovery controls, unit and rollback SQL tests. Existing caller pages were adapted, not rebuilt.
- Generated database declarations/journal/snapshots updated through migration tooling. Shared route metadata remains intact; no new content routes were added.

## Next priorities

Complete revoked-caller paid-output preservation, live-dispatch concurrency and diagnostic investigation first. Then implement one complete authorized writing-profile and source-selected/versioned Content Studio slice, followed by campaign/editorial planning and exact-version approvals. Do not present planned screens as operational functionality.

Platform Owner initialization, live payments, production deployment, advertising, social publication, outbound communications, automatic recurring publication, production deletion and unconfigured SSO remain deferred. Nothing was published or externally sent.