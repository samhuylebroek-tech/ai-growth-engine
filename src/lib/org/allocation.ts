// Organization-level resource recommendations. Pure: it reads budget lines, specialist workload and caps, credit use
// and goal health per business and proposes where budget or specialist capacity (monthly AI credit caps) could move.
// A recommendation changes nothing: turning it into a proposal and applying it goes through the existing business
// rights (budget editors of both businesses; the business administrator for specialists). Money never crosses currencies.
import type { BusinessRow, SpecialistLoad } from "@/lib/org/consolidation";

export type BudgetLineLite = {
  id: string;
  workspace_id: string;
  channel: string;
  period_month: string;
  planned: number;
  actual: number;
  hard_cap: number | null;
  currency: string;
};
export type AllocationRec =
  | {
      kind: "budget_shift";
      key: string;
      from: string;
      to: string;
      lineId: string;
      channel: string;
      currency: string;
      amount: number;
      reasons: { code: string; params: Record<string, string> }[];
      confidence: "low" | "medium";
    }
  | {
      kind: "specialist_capacity";
      key: string;
      business: string;
      specialist: string;
      cap: number | null;
      enabled: boolean;
      direction: "raise" | "lower";
      reasons: { code: string; params: Record<string, string> }[];
      confidence: "low" | "medium";
    };

/** Share of the month elapsed (0–1) for a YYYY-MM-DD date, counting today as half a day. */
export function monthElapsed(today: string): number {
  const d = new Date(`${today}T12:00:00Z`);
  const daysIn = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.min(1, Math.max(0, (d.getUTCDate() - 0.5) / daysIn));
}
const r2 = (v: number) => Math.round(v * 100) / 100;

export function allocationRecommendations(
  rows: readonly BusinessRow[],
  lines: readonly BudgetLineLite[],
  load: readonly SpecialistLoad[],
  today: string,
): AllocationRec[] {
  const out: AllocationRec[] = [];
  const f = monthElapsed(today);
  const row = (id: string) => rows.find((r) => r.id === id);
  // Budget: only once at least 40% of the month has passed, so early-month spending patterns don't trigger moves.
  if (f >= 0.4) {
    const under = lines.filter((l) => l.planned > 0 && l.actual < l.planned * f * 0.5);
    const over = lines.filter(
      (l) =>
        l.planned > 0 &&
        (l.actual / f > l.planned * 1.1 || (l.hard_cap != null && l.actual > l.hard_cap)),
    );
    const used = new Set<string>();
    for (const o of over) {
      const projectedOver = r2(o.actual / f - o.planned);
      if (projectedOver <= 0) continue;
      // Prefer a donor in another business, same currency, with the largest unspent part; growing businesses with goals behind never donate.
      const donor = under
        .filter(
          (u) =>
            u.workspace_id !== o.workspace_id &&
            u.currency === o.currency &&
            !used.has(u.id) &&
            (row(u.workspace_id)?.goals.behind ?? 0) === 0,
        )
        .sort((a, b) => b.planned - b.actual - (a.planned - a.actual))[0];
      if (!donor) continue;
      const amount = Math.floor(Math.min((donor.planned - donor.actual) * 0.5, projectedOver));
      if (amount < 1) continue;
      used.add(donor.id);
      out.push({
        kind: "budget_shift",
        key: `bs:${donor.id}:${o.id}`,
        from: donor.workspace_id,
        to: o.workspace_id,
        lineId: donor.id,
        channel: donor.channel,
        currency: donor.currency,
        amount,
        reasons: [
          {
            code: "why.underPace",
            params: {
              channel: donor.channel,
              spent: String(r2(donor.actual)),
              planned: String(r2(donor.planned)),
              cur: donor.currency,
              pct: String(Math.round(f * 100)),
            },
          },
          {
            code: "why.overPace",
            params: {
              channel: o.channel,
              projected: String(r2(o.actual / f)),
              planned: String(r2(o.planned)),
              cur: o.currency,
            },
          },
          ...((row(o.workspace_id)?.goals.behind ?? 0) > 0
            ? [
                {
                  code: "why.receiverBehind",
                  params: { n: String(row(o.workspace_id)?.goals.behind ?? 0) },
                },
              ]
            : []),
        ],
        confidence: (row(o.workspace_id)?.goals.behind ?? 0) > 0 ? "medium" : "low",
      });
    }
  }
  // Specialist capacity: raise a cap that blocks waiting work; lower an unused cap elsewhere so credits stay available.
  for (const l of load) {
    const blocked = l.businesses.filter(
      (b) => b.cap != null && b.used >= b.cap * 0.8 && b.open > 0,
    );
    for (const b of blocked)
      out.push({
        kind: "specialist_capacity",
        key: `sr:${l.specialist}:${b.id}`,
        business: b.id,
        specialist: l.specialist,
        cap: Math.ceil((b.cap ?? 0) * 1.5),
        enabled: true,
        direction: "raise",
        reasons: [
          {
            code: "why.capNear",
            params: { used: String(b.used), cap: String(b.cap), open: String(b.open) },
          },
        ],
        confidence: "medium",
      });
    if (f >= 0.5 && blocked.length)
      for (const b of l.businesses) {
        if (
          b.cap == null ||
          blocked.some((x) => x.id === b.id) ||
          b.used > b.cap * 0.2 ||
          b.open > 0
        )
          continue;
        out.push({
          kind: "specialist_capacity",
          key: `sl:${l.specialist}:${b.id}`,
          business: b.id,
          specialist: l.specialist,
          cap: Math.max(1, Math.ceil(Math.max(b.used, 1) * 2)),
          enabled: b.enabled,
          direction: "lower",
          reasons: [{ code: "why.capIdle", params: { used: String(b.used), cap: String(b.cap) } }],
          confidence: "low",
        });
      }
    for (const b of l.businesses)
      if (!b.enabled && b.open > 0)
        out.push({
          kind: "specialist_capacity",
          key: `se:${l.specialist}:${b.id}`,
          business: b.id,
          specialist: l.specialist,
          cap: b.cap,
          enabled: true,
          direction: "raise",
          reasons: [{ code: "why.disabledWithWork", params: { open: String(b.open) } }],
          confidence: "medium",
        });
  }
  return out;
}

export type SpecialistInsight = {
  specialist: string;
  code: "high_demand" | "underused" | "contended" | "bottleneck";
  businesses: string[];
  open: number;
  used: number;
};
/** Shared specialist orchestration: demand, idle capacity, contention and bottlenecks across businesses. */
export function specialistInsights(load: readonly SpecialistLoad[]): SpecialistInsight[] {
  const out: SpecialistInsight[] = [];
  const totalOpen = load.reduce((s, l) => s + l.open, 0);
  for (const l of load) {
    const busy = l.businesses.filter((b) => b.open > 0).map((b) => b.id);
    if (totalOpen >= 3 && l.open >= Math.max(3, totalOpen * 0.4))
      out.push({
        specialist: l.specialist,
        code: "high_demand",
        businesses: busy,
        open: l.open,
        used: l.used,
      });
    if (busy.length >= 2)
      out.push({
        specialist: l.specialist,
        code: "contended",
        businesses: busy,
        open: l.open,
        used: l.used,
      });
    const capped = l.businesses
      .filter((b) => b.cap != null && b.used >= b.cap && b.open > 0)
      .map((b) => b.id);
    if (capped.length)
      out.push({
        specialist: l.specialist,
        code: "bottleneck",
        businesses: capped,
        open: l.open,
        used: l.used,
      });
    const idle = l.businesses
      .filter((b) => b.enabled && b.open === 0 && b.used === 0 && b.cap != null)
      .map((b) => b.id);
    if (idle.length)
      out.push({ specialist: l.specialist, code: "underused", businesses: idle, open: 0, used: 0 });
  }
  return out;
}
