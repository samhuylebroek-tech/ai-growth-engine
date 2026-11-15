# Commercial foundation — 2026-11-15
No live billing, Stripe activation, charges or payment refunds. Published plan amounts remain indicative placeholders and are labeled in pricing and account pages.

## Credits and usage
- Plans, entitlements, subscriptions, an append-only credit ledger and estimated provider costs are persisted separately.
- `reserve_ai_credits` locks the organization, verifies the run owner and workspace member role, checks subscription/trial state and available balance, and records one reservation per AI run.
- `settle_ai_credits` atomically records actual token/provider usage, charges additional usage or returns the unused reservation, and closes the reservation. Repeating settlement does not double-charge or duplicate usage.
- `refund_ai_credits` returns the full reservation after provider failure and is idempotent. Settled usage cannot be refunded through the provider-failure path.
- Additional settlement is capped at the remaining balance to prevent overdrafts. This is not hard maximum-cost pre-budgeting: if actual usage exceeds reservation plus balance, the recorded charge is capped and the difference is a commercial risk.
- Direct authenticated inserts into AI usage history and credit reservations are denied. The UI reads usage and ledger records but cannot forge them through those tables.
- Monthly grants lock the organization, use configured plan credits, exclude trials/inactive subscriptions and grant once per UTC calendar month. Grants are lazy on overview, billing and entitled AI use; there is no scheduler, idle backfill or reset of rollover credits.

## Invitations and entitlements
Seat entitlement is checked atomically at invitation creation and acceptance. Pending unexpired invitations reserve available seats at creation. Acceptance requires the matching confirmed email and does not create workspace assignments. Workspace creation separately checks its active plan quota atomically.

## Verification
Fresh rollback-only checks: monthly credits 6/6, credit reservation/settlement/refund 14/14, invitation lifecycle 12/12. A real signed-in Growth Officer call produced a −3 reservation and +2 unused-reservation refund visible in Plan & usage. No payment provider was called.

Remaining: per-minute/concurrency limits, hard maximum-cost pre-budgeting, add-ons, owner pricing editor, provider-rate verification, upgrade/downgrade automation and payment webhook/test-mode architecture. Live payments remain deferred.
