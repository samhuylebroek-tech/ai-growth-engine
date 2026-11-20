# Shared logic
- Evidence freshness is pure `src/lib/evidence-freshness.ts` by source kind: historical records never expire, expired/deleted/unconfirmed sources count only as estimates, and absence is "missing" only when the read was complete, so nothing stale is presented as proof.
- Fact conflicts (proposal 0074) are detected by pure `src/lib/fact-conflicts.ts` using the same topic rule as SQL `fact_topic`, are never auto-resolved, and are decided by an editor through `resolve_fact_conflict`, which keeps every value and audits the choice.
