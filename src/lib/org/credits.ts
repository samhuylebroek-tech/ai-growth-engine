// Organization AI credit overview (proposal 0071). Credits belong to the organization as one shared pool; businesses
// do not own balances, so "per business" is usage, never a balance. This module validates the SQL aggregate and adds
// the derived views the screen needs. Credits are AI platform units, never money.
import { z } from "zod";

const n = z.number().int().catch(0);
const bucket = z
  .object({ consumed: n, consumed_month: n, reserved_pending: n })
  .catch({ consumed: 0, consumed_month: 0, reserved_pending: 0 });
export const creditOverviewSchema = z.object({
  month: z.string(),
  balance: n,
  granted: n,
  reserved_pending: n,
  consumed: n,
  consumed_month: n,
  released: n,
  direct_used: n,
  other_debits: n,
  runs: n,
  reconciles: z.boolean().catch(false),
  org_officer: bucket.and(z.object({ runs: n }).catch({ runs: 0 })),
  businesses: z
    .array(
      z.object({
        workspace_id: z.string(),
        consumed: n,
        consumed_month: n,
        reserved_pending: n,
        released: n,
        runs: n,
      }),
    )
    .catch([]),
  specialists: z
    .array(
      z.object({
        workspace_id: z.string(),
        agent_key: z.string(),
        consumed: n,
        consumed_month: n,
        reserved_pending: n,
        runs: n,
      }),
    )
    .catch([]),
  not_visible: bucket,
});
export type CreditOverview = z.infer<typeof creditOverviewSchema>;

export type SpecialistTotal = {
  agent_key: string;
  consumed: number;
  consumed_month: number;
  reserved_pending: number;
  runs: number;
  businesses: number;
};

/** Specialist totals across the businesses in view. Each run belongs to exactly one business row, so summing is safe. */
export function specialistTotals(o: CreditOverview): SpecialistTotal[] {
  const m = new Map<string, SpecialistTotal>();
  for (const s of o.specialists) {
    const t = m.get(s.agent_key) ?? {
      agent_key: s.agent_key,
      consumed: 0,
      consumed_month: 0,
      reserved_pending: 0,
      runs: 0,
      businesses: 0,
    };
    t.consumed += s.consumed;
    t.consumed_month += s.consumed_month;
    t.reserved_pending += s.reserved_pending;
    t.runs += s.runs;
    t.businesses += 1;
    m.set(s.agent_key, t);
  }
  return [...m.values()].sort(
    (a, b) => b.consumed - a.consumed || a.agent_key.localeCompare(b.agent_key),
  );
}

/** Usage that the caller can attribute plus what stays unattributed; together they always equal the organization total. */
export function attribution(o: CreditOverview) {
  const businesses = o.businesses.reduce((s, b) => s + b.consumed, 0);
  return {
    businesses,
    orgOfficer: o.org_officer.consumed,
    notVisible: o.not_visible.consumed,
    direct: o.direct_used,
    total: businesses + o.org_officer.consumed + o.not_visible.consumed + o.direct_used,
    matches:
      businesses + o.org_officer.consumed + o.not_visible.consumed + o.direct_used === o.consumed,
  };
}
