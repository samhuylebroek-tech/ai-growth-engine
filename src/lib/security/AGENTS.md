# Security helpers

- All AI surfaces get business context from `business-context.ts`: every read goes through its org+workspace-scoped helper, every section carries an evidence class, and the rendered text is hard-capped at 12,000 characters, so modules stay consistent and prompts stay bounded.
- Context reads fail closed; only a not-installed table/column (PGRST205/PGRST204/42P01/42703) renders as "unavailable", never as empty, so a lagging database cannot masquerade as "no data".
