# Security helpers

- All AI surfaces get business context from `business-context.ts`: every read goes through its org+workspace-scoped helper, every section carries an evidence class, and the rendered text is hard-capped at 12,000 characters (background sections shortened, then dropped, before essential or question-focused ones), so modules stay consistent and prompts stay bounded.
- Growth Officer questions get a focus from pure keyword rules in `src/lib/ai/question-focus.ts` (EN/NL/FR, no AI, no credits) that orders and protects the matching sections; focus never widens access, since every section is already read under the asker's RLS.
- Context reads fail closed; only a not-installed table/column (PGRST205/PGRST204/42P01/42703) renders as "unavailable", never as empty, so a lagging database cannot masquerade as "no data".
- Platform Owner operations pass `platformOwnerGate` (exact role + verified `aal2` claim) in server functions and `session_mfa_verified()` in SQL, so a stolen password or an organization role alone never reaches platform administration.
- Outbound website fetches started by users must target a host registered for the business (`outbound.ts`), on top of `fetchPublic`'s public-host checks, so members cannot point the server at arbitrary sites.
