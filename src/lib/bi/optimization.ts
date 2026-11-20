// Continuous improvement: deterministic checks over recorded performance that produce improvement candidates.
// Pure and free (no AI credits). A candidate only becomes a proposal when someone saves it; an administrator
// approves it; only then does it become a task. Nothing here changes strategies, budgets or campaigns.
import { effectiveMeasurements, isActual, type Measurement } from "@/lib/performance";
import type { Attribution } from "./attribution";
import type { EvidenceDraft } from "@/lib/evidence";

export type CandidateCode =
  | "metric_behind"
  | "metric_ahead"
  | "budget_overspent"
  | "cost_per_lead_rising"
  | "best_channel"
  | "unattributed_revenue"
  | "roll_out_experiment"
  | "goal_without_metric";
export type Category = "immediate" | "strategic" | "opportunity" | "problem" | "experiment";
export type Level = "none" | "read" | "draft" | "modify" | "execute" | "publish" | "budget";
export type Evidence = {
  type: "metric" | "budget" | "revenue" | "experiment" | "goal" | "channel";
  id: string;
  label: string;
};
export type Candidate = {
  sourceKey: string;
  code: CandidateCode;
  category: Category;
  vars: Record<string, string | number>;
  evidence: Evidence[];
  requiredLevel: Level;
  metricId?: string;
  goalId?: string;
  campaignId?: string;
  initiativeId?: string;
  /** 0–1: how sure the underlying data is (actual vs entered, number of periods). */
  confidence: number;
  /** Evidence this finding records when saved (proposal 0073): record-backed reads, estimates or named gaps. */
  records: EvidenceDraft[];
};

type Metric = {
  id: string;
  key: string;
  label: string;
  unit: string;
  currency: string | null;
  direction: string;
  goal_id: string | null;
  campaign_id?: string | null;
  initiative_id?: string | null;
  archived?: boolean;
};
export type OptInput = {
  metrics: readonly Metric[];
  measurements: readonly Measurement[];
  budget: readonly {
    id?: string;
    channel: string;
    period_month: string;
    planned: number;
    actual: number;
    currency: string;
    goal_id: string | null;
  }[];
  goals: readonly { id: string; title: string; status: string }[];
  attribution: readonly Attribution[];
  experiments: readonly {
    id: string;
    title: string;
    status: string;
    evidence_strength: string | null;
    variant_value: number | null;
    control_value: number | null;
    updated_at: string;
    started_at?: string | null;
    ended_at?: string | null;
  }[];
  proposals: readonly { source_key: string; status: string }[];
  now: Date;
};

const endOfMonth = (m: string) => {
  const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};
const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));
const lastMonth = (now: Date) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
};

const measuredDraft = (
  r: { id: string; period_start: string; period_end: string; value: number | string },
  label: string,
): EvidenceDraft => ({
  type: "measured_observation",
  description: `${label}: ${Number(r.value)} (${r.period_start} – ${r.period_end})`.slice(0, 1000),
  source_kind: "measurement",
  source_ref: r.id,
  period_start: r.period_start.slice(0, 10),
  period_end: r.period_end.slice(0, 10),
});

export function detectImprovements(i: OptInput): Candidate[] {
  const out: Candidate[] = [];
  const eff = effectiveMeasurements(i.measurements);
  const month = lastMonth(i.now);
  const byMetric = (id: string, kinds: (k: string) => boolean) =>
    eff.filter((r) => r.metric_id === id && kinds(r.kind));
  for (const m of i.metrics) {
    if (m.archived) continue;
    const actual = byMetric(m.id, isActual)
      .filter((r) => r.period_start.startsWith(month))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const plan = byMetric(m.id, (k) => k === "planned").find((r) =>
      r.period_start.startsWith(month),
    );
    if (actual && plan && Number(plan.value) !== 0) {
      const dev = pct(Number(actual.value), Number(plan.value))!;
      const good = m.direction === "decrease" ? dev <= 0 : dev >= 0;
      const conf = actual.kind === "manual_actual" ? 0.6 : 0.85;
      if (!good && Math.abs(dev) >= 10)
        out.push({
          sourceKey: `metric_behind:${m.id}:${month}`,
          code: "metric_behind",
          category: "problem",
          vars: {
            metric: m.label,
            month,
            dev: Math.abs(dev),
            actual: Number(actual.value),
            plan: Number(plan.value),
          },
          evidence: [{ type: "metric", id: m.id, label: m.label }],
          requiredLevel: "none",
          metricId: m.id,
          ...(m.goal_id ? { goalId: m.goal_id } : {}),
          ...(m.campaign_id ? { campaignId: m.campaign_id } : {}),
          ...(m.initiative_id ? { initiativeId: m.initiative_id } : {}),
          confidence: conf,
          records: [measuredDraft(actual, m.label)],
        });
      if (good && Math.abs(dev) >= 20)
        out.push({
          sourceKey: `metric_ahead:${m.id}:${month}`,
          code: "metric_ahead",
          category: "opportunity",
          vars: { metric: m.label, month, dev: Math.abs(dev) },
          evidence: [{ type: "metric", id: m.id, label: m.label }],
          requiredLevel: "none",
          metricId: m.id,
          ...(m.campaign_id ? { campaignId: m.campaign_id } : {}),
          confidence: conf * 0.8,
          records: [measuredDraft(actual, m.label)],
        });
    }
  }
  // Cost per lead rising: ad_spend / leads, last month vs the month before, same currency metric.
  const spend = i.metrics.find((m) => m.key === "ad_spend" && !m.archived),
    leads = i.metrics.find((m) => m.key === "leads" && !m.archived);
  if (spend && leads) {
    const prev = new Date(Date.UTC(i.now.getUTCFullYear(), i.now.getUTCMonth() - 2, 1))
      .toISOString()
      .slice(0, 7);
    const row = (id: string, mo: string) =>
      byMetric(id, isActual)
        .filter((x) => x.period_start.startsWith(mo))
        .at(-1);
    const v = (id: string, mo: string) => {
      const r = row(id, mo);
      return r ? Number(r.value) : null;
    };
    const s1 = v(spend.id, month),
      l1 = v(leads.id, month),
      s0 = v(spend.id, prev),
      l0 = v(leads.id, prev);
    if (s1 !== null && l1 && s0 !== null && l0) {
      const c1 = s1 / l1,
        c0 = s0 / l0,
        dev = pct(c1, c0)!;
      if (dev >= 20)
        out.push({
          sourceKey: `cost_per_lead_rising:${month}`,
          code: "cost_per_lead_rising",
          category: "problem",
          vars: {
            dev,
            now: Math.round(c1 * 100) / 100,
            before: Math.round(c0 * 100) / 100,
            currency: spend.currency ?? "",
          },
          evidence: [
            { type: "metric", id: spend.id, label: spend.label },
            { type: "metric", id: leads.id, label: leads.label },
          ],
          requiredLevel: "none",
          metricId: spend.id,
          confidence: 0.6,
          records: [
            measuredDraft(row(spend.id, month)!, spend.label),
            measuredDraft(row(leads.id, month)!, leads.label),
            measuredDraft(row(spend.id, prev)!, spend.label),
            measuredDraft(row(leads.id, prev)!, leads.label),
          ],
        });
    }
  }
  // Budget lines over plan last month.
  for (const b of i.budget) {
    if (!b.period_month.startsWith(month) || Number(b.planned) <= 0) continue;
    const dev = pct(Number(b.actual), Number(b.planned))!;
    if (dev >= 10)
      out.push({
        sourceKey: `budget_overspent:${b.channel.toLowerCase()}:${b.currency}:${month}`,
        code: "budget_overspent",
        category: "immediate",
        vars: {
          channel: b.channel,
          dev,
          actual: Number(b.actual),
          planned: Number(b.planned),
          currency: b.currency,
          month,
        },
        evidence: [{ type: "budget", id: `${b.channel}:${month}`, label: b.channel }],
        requiredLevel: "none",
        ...(b.goal_id ? { goalId: b.goal_id } : {}),
        confidence: 0.6,
        records: b.id
          ? [
              {
                type: "measured_observation",
                description: `${b.channel} ${month}: ${Number(b.actual)} ${b.currency} spent of ${Number(b.planned)} planned (entered)`,
                source_kind: "budget_line",
                source_ref: b.id,
                period_start: b.period_month.slice(0, 10),
                period_end: endOfMonth(b.period_month),
              },
            ]
          : [],
      });
  }
  // Best channel by attributed revenue per spend — a shift is only a proposal and needs budget permission.
  for (const a of i.attribution) {
    const spendBy = new Map<string, number>();
    for (const b of i.budget)
      if (b.currency === a.currency && b.channel)
        spendBy.set(
          b.channel.trim().toLowerCase(),
          (spendBy.get(b.channel.trim().toLowerCase()) ?? 0) + Number(b.actual),
        );
    const ratios = a.credits
      .filter((c) => c.key.startsWith("channel:"))
      .map((c) => ({
        ch: c.key.slice(8),
        r: (spendBy.get(c.key.slice(8)) ?? 0) > 0 ? c.amount / spendBy.get(c.key.slice(8))! : null,
        c,
      }))
      .filter((x) => x.r !== null) as { ch: string; r: number; c: (typeof a.credits)[number] }[];
    if (ratios.length >= 2) {
      ratios.sort((x, y) => y.r - x.r);
      const best = ratios[0]!,
        second = ratios[1]!;
      if (best.r >= second.r * 1.5)
        out.push({
          sourceKey: `best_channel:${best.ch}:${a.currency}`,
          code: "best_channel",
          category: "opportunity",
          vars: {
            channel: best.ch,
            ratio: Math.round(best.r * 100) / 100,
            other: second.ch,
            otherRatio: Math.round(second.r * 100) / 100,
            currency: a.currency,
            model: a.model,
          },
          evidence: [
            { type: "channel", id: best.ch, label: best.ch },
            { type: "channel", id: second.ch, label: second.ch },
          ],
          requiredLevel: "budget",
          confidence: best.c.confidence === "high" ? 0.7 : 0.4,
          // Attribution is a model of recorded sales, so its channel ratios are estimates, not measurements.
          records: [
            {
              type: "estimate",
              description: `${a.model} attribution: ${best.ch} ${Math.round(best.r * 100) / 100} vs ${second.ch} ${Math.round(second.r * 100) / 100} ${a.currency} revenue per spend`,
              source_kind: "other",
              source_ref: `attribution:${a.model}:${a.currency}`,
            },
          ],
        });
    }
    if (a.total > 0 && a.unattributed / a.total >= 0.5)
      out.push({
        sourceKey: `unattributed_revenue:${a.currency}`,
        code: "unattributed_revenue",
        category: "strategic",
        vars: {
          share: Math.round((a.unattributed / a.total) * 100),
          currency: a.currency,
          amount: a.unattributed,
        },
        evidence: [{ type: "revenue", id: a.currency, label: a.currency }],
        requiredLevel: "none",
        confidence: 0.9,
        records: [
          {
            type: "missing_information",
            description: `${Math.round((a.unattributed / a.total) * 100)}% of recorded ${a.currency} revenue has no recorded touchpoint`,
            source_kind: "other",
            source_ref: `unattributed:${a.currency}`,
          },
        ],
      });
  }
  for (const x of i.experiments) {
    if (
      x.status !== "completed" ||
      x.evidence_strength !== "controlled" ||
      x.variant_value === null ||
      x.control_value === null ||
      Number(x.variant_value) <= Number(x.control_value)
    )
      continue;
    out.push({
      sourceKey: `roll_out_experiment:${x.id}`,
      code: "roll_out_experiment",
      category: "strategic",
      vars: { title: x.title },
      evidence: [{ type: "experiment", id: x.id, label: x.title }],
      requiredLevel: "none",
      confidence: 0.75,
      records: [
        {
          type: "measured_observation",
          description: `${x.title}: variant ${Number(x.variant_value)} vs control ${Number(x.control_value)} (controlled)`,
          source_kind: "experiment",
          source_ref: x.id,
          period_start: (x.started_at ?? x.updated_at).slice(0, 10),
          period_end: (x.ended_at ?? x.updated_at).slice(0, 10),
        },
      ],
    });
  }
  const measured = new Set(i.metrics.filter((m) => !m.archived && m.goal_id).map((m) => m.goal_id));
  for (const g of i.goals)
    if (g.status === "active" && !measured.has(g.id))
      out.push({
        sourceKey: `goal_without_metric:${g.id}`,
        code: "goal_without_metric",
        category: "immediate",
        vars: { goal: g.title },
        evidence: [{ type: "goal", id: g.id, label: g.title }],
        requiredLevel: "none",
        goalId: g.id,
        confidence: 1,
        records: [
          {
            type: "missing_information",
            description: `Goal "${g.title}" has no metric, so progress cannot be measured`.slice(0, 1000),
            source_kind: "other",
            source_ref: `goal:${g.id}`,
            goal_id: g.id,
          },
        ],
      });
  // A finding that already has an open proposal is not suggested again.
  const open = new Set(
    i.proposals
      .filter((p) => ["proposed", "approved", "converted"].includes(p.status))
      .map((p) => p.source_key),
  );
  return out.filter((c) => !open.has(`rule:${c.sourceKey}`));
}

/** Observed change of the success metric after the work, for the team's outcome decision. Never a causal claim. */
export function observedOutcome(
  direction: string,
  before: number | null,
  after: number | null,
): "improved" | "no_change" | "worse" | "inconclusive" {
  if (before === null || after === null) return "inconclusive";
  const d = pct(after, before);
  if (d === null) return "inconclusive";
  if (Math.abs(d) < 5) return "no_change";
  return (direction === "decrease" ? d < 0 : d > 0) ? "improved" : "worse";
}

/** Two-proportion z-test for A/B results given as rates (0–1 or 0–100) and group sizes; null when it cannot apply. */
/** Two-proportion z-test on conversion rates entered as percentages (0–100); mirrors advance_experiment in SQL. */
export function abSignificance(
  variantPct: number,
  controlPct: number,
  nV: number,
  nC: number,
): { z: number; significant: boolean } | null {
  if (
    nV < 30 ||
    nC < 30 ||
    variantPct < 0 ||
    variantPct > 100 ||
    controlPct < 0 ||
    controlPct > 100
  )
    return null;
  const p1 = variantPct / 100,
    p2 = controlPct / 100;
  const p = (p1 * nV + p2 * nC) / (nV + nC);
  if (p <= 0 || p >= 1) return null;
  const z = (p1 - p2) / Math.sqrt(p * (1 - p) * (1 / nV + 1 / nC));
  return { z: Math.round(z * 100) / 100, significant: Math.abs(z) >= 1.96 };
}
