# Implementation bottleneck — evidence and delivered work

26 November 2026. Feature-branch development only; no production schema changes, deployment, merge, email, publication, advertising spend or paid AI inference.

## Staging migration investigation

The guarded staging connection is **available**, not broken. Preflight derived the approved target from the connection, verified its in-database identity marker, and reported 109 public tables, five auth users, two storage buckets and an existing migration ledger. Inherited production PG variables are stripped by the existing connection helper.

Available mechanisms were inspected:

| Mechanism | Actual target/capability | Decision |
| --- | --- | --- |
| Platform migration tool | Connected project backend; SQL/name/description, no target override | Not invoked because the connected backend is production |
| Lovable database CLI | Read-only diagnostics for connected project; no staging migration command | Cannot apply staging proposals |
| `scripts/staging/migrate.ts` | Guarded staging; committed migration journal | Not executed |
| `try-proposal.ts` / `apply-proposal.ts` | Guarded staging with identity marker; rollback trial / proposal hash ledger | Technically available, but mandatory platform schema-write instructions prohibit a shell substitute |
| Existing staging SQL test runner | Guarded staging, rollback-only suites | Executed: 57/57 pass, user/org/workspace counts unchanged |

**Exact limitation:** possession of a working staging connection is not permission to bypass the required schema-change mechanism. There is no permitted targetable migration action in this session. SQL containing a target assertion would not redirect a production-targeted tool; it would only fail on production. No such call was made.

**Concrete requirement:** a platform-supported migration action bound to the approved staging database, or a platform-authorized staging execution facility that explicitly permits the existing guarded proposal scripts. The current project must not be rebound to staging: its preview/backend and production isolation must remain intact.

Proposal 0093 remains unapplied. Public submission → persisted consent → CRM contact → qualification → internal follow-up is **not operationally verified or complete**. Its new SQL suite was not run against an absent schema.

## Authenticated staging test access

The isolated staging app is reachable. Staging QA email/password environment variables and the temporary staging credential file are absent. The inspected auth-session CLI mints sessions for the connected project, with no staging target. Its test-user option would create an account in the wrong database and was not invoked.

The existing seed-users script directly changes auth records and rotates existing passwords on rerun; it is not a safe substitute under the current restrictions. No script was used to change auth, MFA, roles, secrets or RLS, and no temporary Platform Owner was created.

**Concrete requirement:** a staging-scoped test-session facility for an authorized isolated QA account, or an existing authorized staging browser session. No production session should be transplanted, no MFA weakened, and no credentials logged or requested in chat.

## Independent product work delivered

### Customer care connected to execution
- Sales pipeline now includes retention/referrals, reactivation and sales-follow-up work.
- Explicitly chosen recorded sales become internal tasks with a brief and optional due date; they are assigned to the requesting member.
- Server refetches the sale under caller access with explicit organization/workspace scope and checks its current stage.
- Stable request IDs and complete input fingerprints let acknowledgement retries recover the same task without overwriting different work.
- Preparation succeeds only after exact scoped read-back. UI preserves an unconfirmed submitted draft and retries the same snapshot.
- History links to existing task execution/review screens. Prepared, overdue, in progress, awaiting review, cancelled and team-marked done remain distinct; none proves a sent message or customer outcome.
- An existing open task disables additional preparation in the UI; this is not a database uniqueness claim for independent new requests.

### Campaigns connected to Content Studio
- Campaign content shows original linked assets and the latest exact version decision, with direct links to the original editor.
- Changed title/body never inherits approval from a recorded version.
- Campaign-specific creation stays linked through the existing tenant-checked foreign key; no duplicate content store was introduced.
- Existing campaign note drafts remain intact, separate from versioned Studio assets.

### Content persistence and library UX
- Scoped keyset reads replace silent first-100 truncation for assets, versions, decisions, campaign choices and writing profiles.
- Library search and display pagination operate on collected records; campaign filtering and calendar scope agree.
- Draft writes are serialized and compare the last acknowledged revision before updating, so out-of-order requests cannot overwrite newer acknowledged edits.
- Failed or zero-row updates remain unconfirmed, retain local text and block creating/restoring versions until saving is confirmed.
- Explicit retry, duplicate-action guards, transport recovery and navigation warnings added. Pending saves may still finish after a user deliberately leaves; the warning states this.
- Cross-editor conflicts deliberately fail closed; conflict merging and recovery across browser restarts are not claimed.

### Integration architecture/read reliability
- Connections, actions, tasks, specialist assignments, goals and plans traverse complete scoped keysets rather than silently truncating or refusing the hub above 500 actions.
- Referenced finished-task titles are read in bounded, scoped batches without the previous first-200 omission.
- Later-page failures reject the summary instead of silently hiding approvals; failed actions restore their controls.
- No provider was activated and no external action executed.

## Verification

| Check | Result | What it does not prove |
| --- | --- | --- |
| Fresh starting Vitest baseline | 1,068 tests / 134 files pass | Not historical 1,001-test inference |
| Final full Vitest run | 1,101 tests / 141 files pass | Mocked boundary/interaction tests are not authenticated E2E |
| Full ESLint | Zero errors, 58 existing warnings | Warnings remain visible |
| Platform compilation | Latest entry: build OK | No production deployment |
| Staging SQL suites | 57/57 pass; counts stay 5 users, 2 organizations, 3 workspaces | Excludes unapplied 0093 |
| Browser, staging tablet/phone | Content deep links reach sign-in; no overflow/page errors/production requests; screenshots inspected | Customer-care/content signed-in screens NOT verified |
| Metadata | All content routes retain individual head metadata; content route retains shared localized helper | No fabricated OG image or new marketing claims |

No authenticated onboarding, campaign preparation/run/review, lead persistence, customer-care write, content save/review or financial-impact journey was completed through the staging browser. This limitation remains explicit.

## Credits and repository evidence

- Completed requests since the resumed mandate at 26 November 15:05 UTC: **58.01 chat credits** (tool total; excludes this in-flight request).
- All completed requests in this chat since inception: **1,315.98 credits**, including 0.02 media credits and 11.43 daily-free chat credits; this is a whole-chat total, not an implementation-only subtotal.
- Current request recorded so far at the latest lookup: **15.60 chat credits**, not its eventual final cost.
- Workspace balance at that lookup: **27.21 credits**. Workspace balances and request costs are separate measurements; neither is estimated or presented as the final post-turn balance.
- No app AI call, credit grant, secret change or provider execution was performed.
- Starting saved HEAD `86009ec5d25514a443a8eb1f404df1c09273b748` was synchronized; all five checks passed: dependency audit, production build, ESLint, secret scan, unit tests.
- New work is committed on the same authorized feature branch. The platform pushes after the turn; latest-commit synchronization and CI must be read independently rather than inferred from that starting green run.

## Still incomplete

Operational lead persistence and its full consent/tenant/CRM journey; authenticated verification of all changed workflows; application-wide page-by-page UX transformation; remaining Growth Officer orchestration and optimization; end-to-end measured business impact; real authorized integration adapters/activation. These are not marked complete by passing unit tests or prepared tasks. The full programme remains active, but nothing runs in the background after this turn.