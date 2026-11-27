// Organization strategy monitoring. Pure and credit-free over the same organization view: it flags businesses behind or
// ahead of their targets, conflicts, shared bottlenecks, budget imbalances, specialist capacity problems, coordination that
// waits, and risks that touch several businesses. It only produces recommendations; approved plans are never changed.
import type { BusinessRow } from "@/lib/org/consolidation";
import type { Finding } from "@/lib/org/coordination";
import type { SpecialistInsight } from "@/lib/org/allocation";
import { monthElapsed } from "@/lib/org/allocation";

export type MonitorCode =
  | "behind_target"
  | "exceeding"
  | "conflicting_strategies"
  | "shared_bottleneck"
  | "budget_imbalance"
  | "specialist_capacity"
  | "coordination_waiting"
  | "validated_without_initiative"
  | "multi_business_risk"
  | "priority_without_goal"
  | "execution_paused";
export type MonitorItem = {
  key: string;
  code: MonitorCode;
  severity: "high" | "medium" | "low";
  businesses: string[];
  params: Record<string, string>;
};
export type MonitorInput = {
  rows: readonly BusinessRow[];
  findings: readonly Finding[];
  insights: readonly SpecialistInsight[];
  today: string;
  initiatives: readonly {
    id: string;
    title: string;
    status: string;
    created_at: string;
    business_ids: readonly string[];
  }[];
  opportunities: readonly {
    id: string;
    title: string;
    status: string;
    business_ids: readonly string[];
  }[];
  priorities: readonly { business_id: string }[];
  activeGoals: Readonly<Record<string, number>>;
  paused: readonly string[];
};
const SEV = { high: 0, medium: 1, low: 2 } as const;

export function monitorOrganization(m: MonitorInput): MonitorItem[] {
  const out: MonitorItem[] = [];
  for (const r of m.rows) {
    if (r.goals.behind > 0)
      out.push({
        key: `bt:${r.id}`,
        code: "behind_target",
        severity: r.goals.behind >= 2 ? "high" : "medium",
        businesses: [r.id],
        params: { n: String(r.goals.behind), active: String(r.goals.active) },
      });
    const allOn = r.goals.active > 0 && r.goals.behind === 0 && r.goals.unmeasured === 0;
    if (r.goals.achieved > 0 || allOn)
      out.push({
        key: `ex:${r.id}`,
        code: "exceeding",
        severity: "low",
        businesses: [r.id],
        params: { achieved: String(r.goals.achieved), on: String(r.goals.onTrack) },
      });
  }
  for (const f of m.findings) {
    if (f.code === "campaign_conflict" || f.code === "budget_overlap")
      out.push({
        key: `cs:${f.key}`,
        code: "conflicting_strategies",
        severity: "high",
        businesses: f.businesses,
        params: { subject: f.subject, kind: f.code },
      });
    if (f.code === "shared_bottleneck")
      out.push({
        key: `sb:${f.key}`,
        code: "shared_bottleneck",
        severity: "high",
        businesses: f.businesses,
        params: { subject: f.subject },
      });
  }
  // Budget imbalance: one business over plan while another barely spends, in the same currency, after 40% of the month.
  if (monthElapsed(m.today) >= 0.4) {
    const cur = new Set(m.rows.flatMap((r) => Object.keys(r.utilization)));
    for (const c of cur) {
      const hi = m.rows.filter((r) => (r.utilization[c] ?? -1) >= 100),
        lo = m.rows.filter((r) => r.utilization[c] != null && r.utilization[c]! <= 30);
      if (hi.length && lo.length)
        out.push({
          key: `bi:${c}`,
          code: "budget_imbalance",
          severity: "medium",
          businesses: [...hi, ...lo].map((r) => r.id),
          params: {
            cur: c,
            high: hi.map((r) => r.name).join(", "),
            low: lo.map((r) => r.name).join(", "),
          },
        });
    }
  }
  for (const s of m.insights)
    if (s.code === "bottleneck" || s.code === "high_demand")
      out.push({
        key: `sp:${s.code}:${s.specialist}`,
        code: "specialist_capacity",
        severity: s.code === "bottleneck" ? "high" : "medium",
        businesses: s.businesses,
        params: { specialist: s.specialist, kind: s.code, open: String(s.open) },
      });
  const weekAgo = new Date(Date.parse(`${m.today}T00:00:00Z`) - 7 * 86_400_000).toISOString();
  for (const i of m.initiatives)
    if (i.status === "awaiting_commitments" && i.created_at < weekAgo)
      out.push({
        key: `cw:${i.id}`,
        code: "coordination_waiting",
        severity: "medium",
        businesses: [...i.business_ids],
        params: { title: i.title },
      });
  for (const o of m.opportunities)
    if (o.status === "validated")
      out.push({
        key: `vo:${o.id}`,
        code: "validated_without_initiative",
        severity: "low",
        businesses: [...o.business_ids],
        params: { title: o.title },
      });
  const risky = m.rows.filter((r) => r.uncertainRuns > 0 || r.overCap > 0);
  if (risky.length >= 2)
    out.push({
      key: "mr",
      code: "multi_business_risk",
      severity: "high",
      businesses: risky.map((r) => r.id),
      params: { names: risky.map((r) => r.name).join(", ") },
    });
  for (const p of m.priorities)
    if (m.rows.some((r) => r.id === p.business_id) && !(m.activeGoals[p.business_id] ?? 0))
      out.push({
        key: `pg:${p.business_id}`,
        code: "priority_without_goal",
        severity: "medium",
        businesses: [p.business_id],
        params: {},
      });
  for (const id of m.paused)
    if (m.rows.some((r) => r.id === id))
      out.push({
        key: `ep:${id}`,
        code: "execution_paused",
        severity: "low",
        businesses: [id],
        params: {},
      });
  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.key.localeCompare(b.key));
}
