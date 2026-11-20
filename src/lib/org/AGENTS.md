# Multi-business organization

- A business is a workspace; brands and units are `business_units` inside it. Never add a parallel business table, because every existing module is already isolated per workspace.
- Organization reporting is pure (`consolidation.ts`, `coordination.ts`) over the caller's own RLS reads, so it covers only businesses the caller can open; nothing crosses businesses in SQL.
- Money stays per currency. A converted total exists only when a stored official ECB rate (or a dated manual rate) covers every currency; otherwise it is withheld and the missing pairs are named.
- Official rates are fetched only by the server (`exchange-rates.functions.ts`) and stored once per org/currency/date through a proof-checked SQL function, on the first visit of the day; no scheduler or system account.
- Business editors (role rank between admin and member) confirm facts/profile and manage budgets; per-business specialist allocation is enforced inside the shared `task_run_gate`, not in a separate dispatcher.
- Organization intelligence (opportunities, allocation, monitoring, priorities) is deterministic and credit-free over the same view the UI shows; it never compares customer-level records across businesses, and every opportunity stays a hypothesis with classified evidence.
- The Organization Growth Officer is one admin-started metered request needing access to every analysed business, anchored to one of them for accounting; its strategy is a draft until an org admin approves it and never replaces a business's own approved strategy.
- Shared initiatives, budget shifts and specialist caps take effect only through per-business decisions in SQL (business admin for commitments and caps, budget editors of both businesses for shifts), so the organization layer can never override a business.
- AI credits are one organization pool (`credit_ledger.org_id`); per-business and per-specialist figures are usage attribution from the aggregate `org_credit_overview` read, which details only businesses the caller can open and books Organization Growth Officer requests apart from their anchor business.
- Organization strategy text is stored as generated with its B-number reference map; business names are filled in at display time, so renames and duplicate names never rewrite history.
- Moving budget between lines goes through one locked SQL function checking business, month, currency, editor role and the amounts the caller saw; the browser never writes the two lines separately.
