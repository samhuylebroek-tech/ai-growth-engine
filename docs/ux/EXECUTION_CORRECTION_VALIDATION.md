# Execution correction — 26 November 2026

## Implemented, not an end-to-end completion claim
- Approved campaign text has stable version-linked task IDs. One batch insert is atomic; duplicate primary keys cannot partially create a batch. Lost acknowledgements are checked against exact persisted IDs.
- Each task retains bounded campaign/audience/objective/approved-proposal context. Specialist assignment uses the existing role-checked RPC; partial assignment can resume without creating more tasks. Concurrent assignment and proposal modification are not one transaction with task creation; tasks represent the approved snapshot read by the request. Legacy unversioned tasks block automatic conversion.
- Created, assigned, executing, uncertain, delivered, corrections, rejected/rework and human-accepted deliverables are distinguished. A manual done status is not execution evidence. Exact recorded result decisions gate completion controls and next-step links; external authorization remains separate.
- Explicit capped rework includes the previous human decision/corrections in quoted context. Unknown outcomes never offer retry. Recorded material can be downloaded.
- CRM offers scoped sales, retention/referral and reactivation questions, without inference until the user sends them. Contact email/phone are excluded from selected AI projections. Pipeline amounts remain per currency; a won deal is not received revenue.
- Selected campaign context includes at most six task-result samples, explicitly labelled incomplete; selected task references include exact run/decision evidence. Read failures do not become empty or approved states.

## Evidence
| Check | Result |
|---|---|
| Authorized branch / staging identity | Verified |
| Baseline | 1,005 tests / 127 files passed |
| Final unit/component regression | 1,026 tests / 129 files passed |
| Staging SQL suites | 57/57 passed; user/org/workspace counts unchanged after rollback |
| New batch / assignment SQL checks | 8 passed; no AI run created by assignment |
| RLS isolation | 39 assertions passed |
| Task engine / specialist QC | 47 / 26 assertions passed |
| Formatting / changed-source ESLint | Passed |
| Browser | Staging sign-in redirect only, desktop/tablet/phone; screenshots inspected; no overflow/runtime errors |
| Authenticated proposal → paid execution → review → reload | NOT RUN: existing temporary staging credentials unavailable; no password/MFA/security reset performed |
| New server request over browser transport / concurrent sessions | NOT RUN; SQL batch assertions and deterministic-key unit tests are not substitutes |
| Full new campaign/CRM usability | NOT VERIFIED without authenticated staging access |
| Production, provider writes, paid AI tests | Not performed |

The full A–H development mandate remains incomplete. Real provider execution needs separately authorized connections; broader UX, lead intake and operational retention/referrals still need implementation and authenticated verification. Available workspace credits do not establish a guaranteed scope or cost; recorded figures are reported separately in chat.