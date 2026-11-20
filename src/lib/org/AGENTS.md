# Multi-business organization

- A business is a workspace; brands and units are `business_units` inside it. Never add a parallel business table, because every existing module is already isolated per workspace.
- Organization reporting is pure (`consolidation.ts`, `coordination.ts`) over the caller's own RLS reads, so it covers only businesses the caller can open; nothing crosses businesses in SQL.
- Money stays per currency. A converted total exists only when a stored official ECB rate (or a dated manual rate) covers every currency; otherwise it is withheld and the missing pairs are named.
- Official rates are fetched only by the server (`exchange-rates.functions.ts`) and stored once per org/currency/date through a proof-checked SQL function, on the first visit of the day; no scheduler or system account.
- Business editors (role rank between admin and member) confirm facts/profile and manage budgets; per-business specialist allocation is enforced inside the shared `task_run_gate`, not in a separate dispatcher.
