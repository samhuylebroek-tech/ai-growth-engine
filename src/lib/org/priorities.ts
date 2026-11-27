// Organization-level Next Best Actions. Pure: candidates from monitoring, opportunities, allocation recommendations,
// coordination findings and pending decisions are scored on nine named factors and ranked; each action explains the
// factors that put it on top and where to go. Problems that belong to one business are summarised once per business
// ("open its Home") instead of repeating that business's own Growth Officer recommendations.
export const FACTORS = [
  "importance",
  "impact",
  "revenue",
  "confidence",
  "cost",
  "speed",
  "risk",
  "resources",
  "dependencies",
] as const;
export type Factor = (typeof FACTORS)[number];
/** 1 (unfavourable) … 5 (favourable). Cost 5 = cheap, speed 5 = fast, risk 5 = low risk, dependencies 5 = none. */
export type Factors = Record<Factor, number>;
export const WEIGHTS: Factors = {
  importance: 3,
  impact: 3,
  revenue: 2,
  confidence: 2,
  cost: 1,
  speed: 1,
  risk: 1,
  resources: 1,
  dependencies: 1,
};
export type OrgTarget =
  | {
      kind: "business";
      to: "/app" | "/app/goals" | "/app/campaigns" | "/app/tasks" | "/app/costs" | "/app/approvals";
      business: string;
    }
  | { kind: "tab"; tab: "strategy" | "opportunities" | "initiatives" | "resources" | "risks" };
export type Candidate = {
  key: string;
  code: string;
  businesses: string[];
  params: Record<string, string>;
  factors: Factors;
  target: OrgTarget;
};
export type RankedAction = Candidate & { rank: number; score: number; why: Factor[] };

const clamp = (v: number) => Math.min(5, Math.max(1, Math.round(v)));
export function score(f: Factors): number {
  let s = 0,
    max = 0;
  for (const k of FACTORS) {
    s += WEIGHTS[k] * clamp(f[k]);
    max += WEIGHTS[k] * 5;
  }
  return Math.round((s / max) * 100);
}
/** The three factors contributing most above neutral (3), strongest first. */
export function explain(f: Factors): Factor[] {
  return [...FACTORS]
    .map((k) => [k, WEIGHTS[k] * (clamp(f[k]) - 3)] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || FACTORS.indexOf(a[0]) - FACTORS.indexOf(b[0]))
    .slice(0, 3)
    .map(([k]) => k);
}
export function rankActions(cands: readonly Candidate[], limit = 10): RankedAction[] {
  const seen = new Set<string>();
  const uniq: Candidate[] = [];
  for (const c of cands)
    if (!seen.has(c.key)) {
      seen.add(c.key);
      uniq.push(c);
    }
  return uniq
    .map((c) => ({ ...c, score: score(c.factors), why: explain(c.factors), rank: 0 }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}
const F = (p: Partial<Factors>): Factors => ({
  importance: 3,
  impact: 3,
  revenue: 3,
  confidence: 3,
  cost: 3,
  speed: 3,
  risk: 3,
  resources: 3,
  dependencies: 3,
  ...p,
});

type Mon = {
  key: string;
  code: string;
  severity: "high" | "medium" | "low";
  businesses: string[];
  params: Record<string, string>;
};
type Opp = {
  ruleKey: string;
  kind: string;
  businesses: string[];
  subject: string;
  confidence: "low" | "medium" | "high";
  impact: string;
  cost: string;
  strategic: number;
  dependencies: readonly string[];
};
type Rec = { key: string; kind: string; confidence: "low" | "medium" };
type Row = { id: string; name: string; attention: number; reasons: string[] };
export type CandidateInput = {
  rows: readonly Row[];
  monitor: readonly Mon[];
  opportunities: readonly Opp[];
  recs: readonly Rec[];
  pending: {
    strategyDrafts: number;
    commitmentsToDecide: { id: string; business: string; title: string }[];
    proposals: { id: string; title: string; businesses: string[] }[];
    validated: { id: string; title: string; businesses: string[] }[];
  };
};
const conf = { low: 2, medium: 3, high: 4 } as const;

export function orgCandidates(x: CandidateInput): Candidate[] {
  const out: Candidate[] = [];
  // Decisions waiting on the organization come first in importance: nothing moves until someone decides.
  for (const c of x.pending.commitmentsToDecide)
    out.push({
      key: `dc:${c.id}`,
      code: "decide_commitment",
      businesses: [c.business],
      params: { title: c.title },
      factors: F({ importance: 5, speed: 5, dependencies: 2, resources: 4 }),
      target: { kind: "tab", tab: "initiatives" },
    });
  for (const p of x.pending.proposals)
    out.push({
      key: `dp:${p.id}`,
      code: "decide_allocation",
      businesses: p.businesses,
      params: { title: p.title },
      factors: F({ importance: 4, speed: 5, cost: 4 }),
      target: { kind: "tab", tab: "resources" },
    });
  if (x.pending.strategyDrafts)
    out.push({
      key: "ds",
      code: "review_strategy",
      businesses: [],
      params: { n: String(x.pending.strategyDrafts) },
      factors: F({ importance: 5, impact: 4, speed: 4 }),
      target: { kind: "tab", tab: "strategy" },
    });
  for (const v of x.pending.validated)
    out.push({
      key: `vi:${v.id}`,
      code: "propose_initiative",
      businesses: v.businesses,
      params: { title: v.title },
      factors: F({ importance: 4, impact: 4, revenue: 4, confidence: 4 }),
      target: { kind: "tab", tab: "initiatives" },
    });
  for (const m of x.monitor) {
    const sev = m.severity === "high" ? 5 : m.severity === "medium" ? 4 : 2;
    if (
      m.code === "behind_target" ||
      m.code === "exceeding" ||
      m.code === "execution_paused" ||
      m.code === "validated_without_initiative"
    )
      continue; // per business / handled above
    const target: OrgTarget =
      m.code === "conflicting_strategies"
        ? { kind: "business", to: "/app/campaigns", business: m.businesses[0]! }
        : m.code === "shared_bottleneck"
          ? { kind: "business", to: "/app/tasks", business: m.businesses[0]! }
          : m.code === "budget_imbalance" || m.code === "specialist_capacity"
            ? { kind: "tab", tab: "resources" }
            : m.code === "priority_without_goal"
              ? { kind: "business", to: "/app/goals", business: m.businesses[0]! }
              : m.code === "coordination_waiting"
                ? { kind: "tab", tab: "initiatives" }
                : { kind: "tab", tab: "risks" };
    if (target.kind === "business" && !target.business) continue;
    out.push({
      key: `m:${m.key}`,
      code: m.code,
      businesses: m.businesses,
      params: m.params,
      factors: F({
        importance: sev,
        risk: m.code === "multi_business_risk" ? 2 : 3,
        speed: 4,
        impact: sev - 1,
        dependencies: m.businesses.length > 1 ? 2 : 4,
      }),
      target,
    });
  }
  for (const o of x.opportunities)
    out.push({
      key: `o:${o.ruleKey}`,
      code: `opp_${o.kind}`,
      businesses: o.businesses,
      params: { subject: o.subject },
      factors: F({
        importance: o.strategic,
        impact: o.impact === "revenue" ? 4 : 3,
        revenue: o.impact === "revenue" ? 4 : 2,
        confidence: conf[o.confidence],
        cost: o.cost === "low" ? 4 : 3,
        speed: o.cost === "low" ? 4 : 2,
        risk: 3,
        dependencies: o.dependencies.length ? 2 : 4,
      }),
      target: { kind: "tab", tab: "opportunities" },
    });
  for (const r of x.recs)
    out.push({
      key: `r:${r.key}`,
      code: `rec_${r.kind}`,
      businesses: [],
      params: {},
      factors: F({ importance: 3, impact: 3, confidence: conf[r.confidence], cost: 5, speed: 5 }),
      target: { kind: "tab", tab: "resources" },
    });
  // One entry per business needing attention, pointing at its Home (its Growth Officer has the details).
  for (const r of [...x.rows]
    .filter((r) => r.attention > 0)
    .sort((a, b) => b.attention - a.attention)
    .slice(0, 2))
    out.push({
      key: `ab:${r.id}`,
      code: "attend_business",
      businesses: [r.id],
      params: { reason: r.reasons[0] ?? "" },
      factors: F({ importance: clamp(2 + r.attention / 4), speed: 4, dependencies: 4 }),
      target: { kind: "business", to: "/app", business: r.id },
    });
  return out;
}
