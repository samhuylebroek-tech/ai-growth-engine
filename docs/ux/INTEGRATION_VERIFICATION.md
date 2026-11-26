# Integration verification — 26 November 2026

## Implemented this round

- Enquiry recovery: explicitly retry a failed session or renew an explicitly expired session without clearing typed details. Unconfirmed transport retries retain their request identity; no automatic replay.
- Inbox triage: search enquiries and filter qualification-needed, qualified, internal-follow-up-prepared and not-fit records. The latest human decision wins; a prepared task never proves execution.
- Enquiry → CRM: open the exact contact within the active business. An unavailable contact does not fall back to another contact. Start a new sale with that contact already selected; no automatic sale creation.
- Sales decisions: an accessible loss confirmation replaces the browser prompt. Cancel performs no write. Confirm records the reason under organization/workspace/record filters and requires a returned row. Failed decisions stay open.
- CRM errors: unsaved contact/sale input survives transport failures, controls recover, archiving requires a returned row, and failed reads offer retry.
- EN/NL/FR text and existing route URLs are preserved. No new AI dispatch, external write, notification or production change.

## Precise staging storage blocker

The existing guarded staging connection is available. Preflight verified the allowlisted staging target and its in-database identity marker. Read-only checks found:

- 109 public tables, all with RLS enabled.
- 57 migration-ledger entries; every existing hash/timestamp matches the corresponding repository prefix of 58 files. The overall count check is false, not an all-migrations-applied claim.
- The applied-proposal ledger includes 0092 but not 0093.
- No `lead_*` tables exist.

The platform migration tool's schema was inspected: it accepts SQL/name/description but no explicit staging target. It applies to the connected project backend, which is production here. It was not invoked. Current platform instructions require schema changes through that tool and prohibit a shell substitute, including the repository's staging proposal-applier. Reachable staging credentials do not remove this execution-method restriction.

No schema, migration history, auth records or credentials were changed. Proposal 0093 remains unapplied. Its new SQL suite and actual public submission → persisted consent → CRM contact → qualification → follow-up read-back remain blocked. There is no operational lead-delivery or owner-email claim.

## Authenticated verification blocker

The isolated staging app is reachable. Staging QA email/password variables are absent. The `auth-session --help` command was inspected without requesting a session: it targets the connected project and has no staging-backend option. Minting a session there would not verify staging and was not attempted. Existing users were not promoted, reset or bypassed; no temporary owner was created.

Authenticated onboarding, campaign creation/approval, specialist dispatch, deliverable review, CRM writes, retention/reactivation and performance journeys are **not browser-verified this round**. Safe staging access and operational lead storage are still required. Provider execution additionally needs separately authorized connections/actions.

## Evidence, separated by kind

| Check | Actual outcome | Limits |
|---|---|---|
| Fresh baseline | 1,056 tests / 134 files pass | Automated, not business-user E2E |
| Final regression | 1,068 tests / 134 files pass | Includes mocked transport/caller-data interaction tests |
| ESLint | Zero errors, 58 existing warnings | No lint-clean claim for warnings |
| Formatting | Changed-source formatter/check passes | Existing configuration retained |
| Platform preview compilation | Latest entry reports build OK | Not a production deployment |
| Existing staging SQL | 57/57 pass, rollback counts unchanged (5 users, 2 organizations, 3 workspaces) | Excludes unapplied 0093 |
| Browser | Nine EN/NL/FR × desktop/tablet/phone checks pass | Unavailable form, explicit retry, metadata, contact deep-link auth gate only |
| Browser layout/runtime | No overflow or page errors in those checks; tablet/phone screenshots inspected | Not a full authenticated UX/WCAG assessment |
| Content metadata | All 45 inspected content-route files have head metadata | Shared page-head emits title/description/OG/type/card |
| GitHub at start | 7f992e8 synchronized; all five checks success | New local changes require post-commit verification |

Scripts and raw test/browser evidence are under `/tmp`; they are not permanent credentials or product records. No paid product AI request was made.

## Remaining programme

This is an integrated improvement round, not completion of AI Growth Engine 2.0. The full authenticated page-by-page UX transformation, operational lead journey, campaign/specialist/result review journey, retention/reactivation execution, live-provider integration and measured financial-impact validation remain open. Existing canonical accounting, permissions and capability boundaries were preserved rather than rebuilt.