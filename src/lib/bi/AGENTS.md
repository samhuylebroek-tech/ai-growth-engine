# Business intelligence

- Reuse the metric/measurement layer (0056) rather than parallel reporting tables; every figure carries source, period and data class, and currencies are never summed together.
- Revenue enters only through `record_revenue_event` (manual/estimated) or `import_revenue_event_verified` (server proof + connected connector with read permission); the ledger is permanent and refunds/corrections are linked rows capped at the sale.
- Attribution, KPIs, comparisons, findings and next actions are pure functions here so the UI, Home and the Growth Officer context agree and cost no credits; unattributed revenue stays visible.
- "Controlled" evidence is set only by `advance_experiment` in SQL (controlled method, ≥30 per group, |z| ≥ 1.96 on percentage rates); before/after and observation are correlation, never cause.
