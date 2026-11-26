// Campaign Intelligence 2.0 (pure). Diagnoses one campaign from what is recorded: its own record and tasks, the
// campaign spend ledger, metrics linked to the campaign with their measurements, revenue attributed to it and its
// experiments. Every figure carries its source and data class; a figure whose inputs are missing is null with a
// reason, never zero. Problems and advice follow fixed, documented rules, cost no credits and change nothing.
import { campaignHealth, type HealthWarning } from "@/lib/campaign-health";
import type { SpendSummary } from "@/lib/campaign-spend";
import {
  effectiveMeasurements,
  isActual,
  summarizeMetric,
  type Measurement,
} from "@/lib/performance";

export type CampaignInput = {
  id: string;
  title: string;
  status: string;
  objective: string;
  audience: string;
  channels: string[];
  budget_eur: number;
  start_date: string | null;
  end_date: string | null;
  goal_id: string | null;
  results: string;
};
export type MetricLite = {
  id: string;
  key: string;
  label: string;
  campaign_id: string | null;
  archived: boolean;
};
export type Attributed = { currency: string; amount: number; sales: number };
export type IntelInput = {
  campaign: CampaignInput;
  tasks: readonly { status: string; due_date: string | null }[];
  /** Spend summary from a complete ledger read, or null when the ledger is unavailable. */
  spend: SpendSummary | null;
  metrics: readonly MetricLite[];
  measurements: readonly Measurement[];
  /** Net revenue attributed to this campaign (actual sales only), or null when attribution is unavailable. */
  attributed: readonly Attributed[] | null;
  experiments: readonly {
    id: string;
    title: string;
    campaign_id?: string | null;
    status: string;
    evidence_strength: string | null;
    result_data_class?: string | null;
  }[];
  /** EUR spend entries (spend and corrections) of this campaign with their dates, for cost trends. */
  spendRows?: readonly { occurred_on: string; amount: number }[];
  others: readonly Pick<
    CampaignInput,
    "id" | "title" | "status" | "channels" | "start_date" | "end_date" | "audience"
  >[];
  today: string;
};

export type Source = "campaign" | "tasks" | "spend_ledger" | "metric" | "attribution" | "computed";
export type Figure = {
  key: FigureKey;
  value: number | null;
  currency?: string;
  source: Source;
  actual: boolean;
  missing?: MissingReason;
  periods?: readonly Period[];
};
export type Period = { start: string; end: string };
export type MetricEvidence = {
  key: string;
  metricId: string | null;
  label: string | null;
  value: number | null;
  missing?: MissingReason;
  periods: Period[];
  kinds: string[];
  updatedAt: string | null;
  observations: { period: Period; value: number }[];
};
export type FigureKey =
  | "budget"
  | "spent"
  | "reserved"
  | "remaining"
  | "leads"
  | "clicks"
  | "conversions"
  | "revenue"
  | "cpl"
  | "cpa"
  | "conversion_rate"
  | "roas"
  | "roi"
  | "duration"
  | "progress";
export type MissingReason =
  | "no_budget"
  | "no_ledger"
  | "no_metric"
  | "no_actuals"
  | "no_spend"
  | "zero_base"
  | "no_attribution"
  | "no_revenue"
  | "no_dates"
  | "no_tasks"
  | "ambiguous_metric"
  | "overlapping_periods"
  | "period_mismatch"
  | "no_dated_spend"
  | "invalid_result";
export type Problem =
  | "budget_near"
  | "budget_over"
  | "overdue_tasks"
  | "behind_schedule"
  | "no_kpi"
  | "no_results"
  | "low_conversion"
  | "rising_cost"
  | "no_leads"
  | "no_audience"
  | "weak_evidence"
  | "no_goal"
  | "overlap"
  | "ended_without_results";
export type AdviceKind =
  | "define_kpis"
  | "measure_results"
  | "improve_conversion"
  | "review_budget_split"
  | "review_budget"
  | "review_audience"
  | "compare_channels"
  | "adjust_message"
  | "connect_source"
  | "link_goal"
  | "replan_tasks"
  | "evaluate_campaign";
export type Advice = {
  kind: AdviceKind;
  problem: Problem;
  specialist: string | null;
  kpi: FigureKey | null;
  risk: "low" | "medium" | "high";
};
/** simulated: what simulated ledger entries add (EUR), kept out of every figure, problem and advice. */
export type Intel = {
  figures: Record<FigureKey, Figure>;
  problems: Problem[];
  advice: Advice[];
  overlaps: string[];
  estimatesExcluded: number;
  health: ReturnType<typeof campaignHealth>;
  simulated: {
    entries: number;
    spent: number;
    committed: number;
    warnings: SpendSummary["simulatedWarnings"];
  } | null;
  measurementEvidence: MetricEvidence[];
  experimentEvidence: {
    id: string;
    title: string;
    evidence:
      "pending" | "simulated" | "controlled" | "correlational" | "inconclusive" | "unclassified";
  }[];
};

/** Rule thresholds, named so the screen and tests can explain them. */
export const RULES = {
  lowConversionRate: 0.01,
  lowConversionMinClicks: 100,
  risingCost: 0.2,
  resultsExpectedAfter: 0.5,
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const fig = (
  key: FigureKey,
  value: number | null,
  source: Source,
  actual: boolean,
  extra: Partial<Figure> = {},
): Figure => ({ key, value, source, actual, ...extra });
const overlapsDates = (
  a: { start_date: string | null; end_date: string | null },
  b: { start_date: string | null; end_date: string | null },
) =>
  (a.start_date ?? "0000") <= (b.end_date ?? "9999") &&
  (b.start_date ?? "0000") <= (a.end_date ?? "9999");

/** One counting definition per key. Distinct definitions may describe the same people; never silently add them. */
function measured(key: string, i: IntelInput): MetricEvidence {
  const defs = i.metrics.filter(
    (m) => !m.archived && m.campaign_id === i.campaign.id && m.key === key,
  );
  const def = defs.length === 1 ? defs[0] : undefined;
  const empty: MetricEvidence = {
    key,
    metricId: def?.id ?? null,
    label: def?.label ?? null,
    value: null,
    periods: [],
    kinds: [],
    updatedAt: null,
    observations: [],
  };
  if (!defs.length) return { ...empty, missing: "no_metric" };
  if (!def) return { ...empty, missing: "ambiguous_metric" };
  const live = effectiveMeasurements(i.measurements.filter((m) => m.metric_id === def.id));
  const actuals = live.filter((m) => isActual(m.kind) && m.period_start <= i.today);
  if (!actuals.length) return { ...empty, missing: "no_actuals" };
  const periods = [
    ...new Map(
      actuals.map((m) => [
        `${m.period_start}|${m.period_end}`,
        { start: m.period_start, end: m.period_end },
      ]),
    ).values(),
  ].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  if (
    periods.some(
      (p) =>
        !Number.isFinite(Date.parse(p.start)) ||
        !Number.isFinite(Date.parse(p.end)) ||
        p.end < p.start,
    )
  )
    return { ...empty, missing: "invalid_result" };
  if (periods.some((p, n) => n > 0 && p.start <= (periods[n - 1]?.end ?? "")))
    return { ...empty, periods, missing: "overlapping_periods" };
  // The shared measurement reader picks verified > imported > entered for the exact period,
  // after correction history has been removed. Multiple evidence versions are not extra results.
  const observations = periods.map((period) => {
    const rows = live.filter((m) => m.period_start === period.start && m.period_end === period.end);
    const actual = summarizeMetric({ id: def.id, direction: "increase" }, rows).actual;
    return {
      period,
      value: actual?.value ?? NaN,
      kind: actual?.kind ?? "",
      updatedAt:
        rows
          .filter((m) => m.kind === actual?.kind)
          .map((m) => m.created_at)
          .sort()
          .at(-1) ?? null,
    };
  });
  if (observations.some((o) => !Number.isFinite(o.value) || o.value < 0))
    return { ...empty, periods, missing: "invalid_result" };
  return {
    ...empty,
    value: observations.reduce((n, o) => n + o.value, 0),
    periods,
    kinds: [...new Set(observations.map((o) => o.kind))],
    updatedAt:
      observations
        .flatMap((o) => (o.updatedAt ? [o.updatedAt] : []))
        .sort()
        .at(-1) ?? null,
    observations: observations.map(({ period, value }) => ({ period, value })),
  };
}

const samePeriods = (a: MetricEvidence, b: MetricEvidence) =>
  a.periods.length === b.periods.length &&
  a.periods.every((p, n) => p.start === b.periods[n]?.start && p.end === b.periods[n]?.end);

/** The caller supplies only actual EUR expenditure, classified by the canonical spend reader. */
function spendInPeriods(i: IntelInput, periods: readonly Period[]): number | null {
  if (!i.spend || !i.spendRows || !periods.length) return null;
  const rows = i.spendRows.filter(
    (s) =>
      s.occurred_on <= i.today &&
      periods.some((p) => s.occurred_on >= p.start && s.occurred_on <= p.end),
  );
  if (!rows.length || rows.some((r) => !Number.isFinite(r.amount))) return null;
  return r2(rows.reduce((n, s) => n + s.amount, 0));
}

export function campaignIntel(i: IntelInput): Intel {
  const c = i.campaign;
  const health = campaignHealth(
    {
      status: c.status,
      start_date: c.start_date,
      end_date: c.end_date,
      goal_id: c.goal_id,
      results: c.results,
    },
    i.tasks,
    i.today,
    i.spend ?? undefined,
  );
  // Actual entries only: simulated spending never enters a figure (see campaign-spend.ts).
  const spentEur = i.spend && i.spend.eur.entries > 0 ? i.spend.eur.spent : null;
  const leads = measured("leads", i);
  const clicks = measured("clicks", i);
  const conv = measured("conversions", i);
  const custom = measured("new_customers", i);
  const acq = conv.missing === "no_metric" ? custom : conv;
  const eurRevenue = i.attributed?.find((a) => a.currency === "EUR") ?? null;
  const ratio = (
    num: number | null,
    den: number | null,
    numMissing?: MissingReason,
    denMissing?: MissingReason,
  ): { value: number | null; missing?: MissingReason } => {
    if (num === null) return { value: null, missing: numMissing ?? "no_actuals" };
    if (den === null) return { value: null, missing: denMissing ?? "no_actuals" };
    if (den === 0) return { value: null, missing: "zero_base" };
    return { value: r2(num / den) };
  };
  const spendMissing: MissingReason = !i.spend ? "no_ledger" : "no_spend";
  const spentKnown = spentEur !== null && spentEur > 0 ? spentEur : null;
  const periodCost = (m: MetricEvidence) => {
    if (m.value === null)
      return { value: null, missing: m.missing ?? ("no_actuals" as MissingReason) };
    const cost = spendInPeriods(i, m.periods);
    return ratio(
      cost !== null && cost > 0 ? cost : null,
      m.value,
      !i.spend ? "no_ledger" : !i.spendRows ? "no_dated_spend" : "no_spend",
      m.missing,
    );
  };
  const cpl = periodCost(leads);
  const cpa = periodCost(acq);
  const cr =
    conv.value !== null && clicks.value !== null && clicks.value > 0
      ? samePeriods(conv, clicks)
        ? { value: Math.round((conv.value / clicks.value) * 10000) / 10000 }
        : { value: null, missing: "period_mismatch" as MissingReason }
      : { value: null, missing: (conv.missing ?? clicks.missing ?? "zero_base") as MissingReason };
  const revMissing: MissingReason = i.attributed === null ? "no_attribution" : "no_revenue";
  const roas = eurRevenue
    ? ratio(eurRevenue.amount, spentKnown, revMissing, spendMissing)
    : { value: null, missing: revMissing };
  const roi =
    roas.value !== null && spentKnown && eurRevenue
      ? { value: r2((eurRevenue.amount - spentKnown) / spentKnown) }
      : { value: null, missing: roas.missing };
  const duration =
    c.start_date && c.end_date
      ? Math.round((Date.parse(c.end_date) - Date.parse(c.start_date)) / 86_400_000) + 1
      : null;

  const figures: Record<FigureKey, Figure> = {
    budget: fig("budget", c.budget_eur > 0 ? c.budget_eur : null, "campaign", true, {
      currency: "EUR",
      ...(c.budget_eur > 0 ? {} : { missing: "no_budget" as const }),
    }),
    spent: fig("spent", spentEur, "spend_ledger", true, {
      currency: "EUR",
      ...(i.spend
        ? spentEur === null
          ? { missing: "no_spend" as const }
          : {}
        : { missing: "no_ledger" as const }),
    }),
    reserved: fig(
      "reserved",
      i.spend && i.spend.eur.entries > 0 ? i.spend.eur.committed : null,
      "spend_ledger",
      true,
      {
        currency: "EUR",
        ...(i.spend
          ? i.spend.eur.entries > 0
            ? {}
            : { missing: "no_spend" as const }
          : { missing: "no_ledger" as const }),
      },
    ),
    remaining: fig("remaining", i.spend?.remaining ?? null, "computed", true, {
      currency: "EUR",
      ...(i.spend?.remaining == null
        ? { missing: (i.spend ? "no_budget" : "no_ledger") as MissingReason }
        : {}),
    }),
    leads: fig("leads", leads.value, "metric", true, {
      periods: leads.periods,
      ...(leads.missing ? { missing: leads.missing } : {}),
    }),
    clicks: fig("clicks", clicks.value, "metric", true, {
      periods: clicks.periods,
      ...(clicks.missing ? { missing: clicks.missing } : {}),
    }),
    conversions: fig("conversions", acq.value, "metric", true, {
      periods: acq.periods,
      ...(acq.missing ? { missing: acq.missing } : {}),
    }),
    revenue: fig("revenue", eurRevenue?.amount ?? null, "attribution", true, {
      currency: "EUR",
      ...(eurRevenue ? {} : { missing: revMissing }),
    }),
    cpl: fig("cpl", cpl.value, "computed", true, {
      currency: "EUR",
      periods: leads.periods,
      ...(cpl.missing ? { missing: cpl.missing } : {}),
    }),
    cpa: fig("cpa", cpa.value, "computed", true, {
      currency: "EUR",
      periods: acq.periods,
      ...(cpa.missing ? { missing: cpa.missing } : {}),
    }),
    conversion_rate: fig("conversion_rate", cr.value, "computed", true, {
      periods: conv.periods,
      ...(cr.missing ? { missing: cr.missing } : {}),
    }),
    roas: fig("roas", roas.value, "computed", true, roas.missing ? { missing: roas.missing } : {}),
    roi: fig("roi", roi.value, "computed", true, roi.missing ? { missing: roi.missing } : {}),
    duration: fig(
      "duration",
      duration,
      "campaign",
      true,
      duration === null ? { missing: "no_dates" } : {},
    ),
    progress: fig(
      "progress",
      health.total ? Math.round((health.done / health.total) * 100) : null,
      "tasks",
      true,
      health.total ? {} : { missing: "no_tasks" },
    ),
  };

  const problems: Problem[] = [];
  const w = (x: HealthWarning) => health.warnings.includes(x);
  if (w("budget_over")) problems.push("budget_over");
  else if (w("budget_near") || w("committed_over")) problems.push("budget_near");
  if (w("overdue_tasks")) problems.push("overdue_tasks");
  if (w("behind_schedule")) problems.push("behind_schedule");
  if (w("ended_without_results")) problems.push("ended_without_results");
  const linked = i.metrics.some((m) => !m.archived && m.campaign_id === c.id);
  const live = ["active", "needs_attention", "optimizing", "paused"].includes(c.status);
  if (!linked && c.status !== "archived") problems.push("no_kpi");
  const anyResult =
    [leads, clicks, conv, custom].some((x) => x.value !== null) ||
    !!eurRevenue ||
    c.results.trim().length > 0;
  const late =
    (health.elapsed ?? 0) >= RULES.resultsExpectedAfter || (!!c.end_date && c.end_date < i.today);
  if (live && !anyResult && late && !problems.includes("ended_without_results"))
    problems.push("no_results");
  if (
    cr.value !== null &&
    (clicks.value ?? 0) >= RULES.lowConversionMinClicks &&
    cr.value < RULES.lowConversionRate
  )
    problems.push("low_conversion");
  if (leads.value === 0 && late) problems.push("no_leads");
  // Rising cost: cost per lead of the latest measured period against the one before, with spend from the ledger
  // dated in each period. Only when both periods have leads and spend.
  const [previous, latest] = leads.observations.slice(-2);
  if (
    previous &&
    latest &&
    latest.period.end < i.today &&
    Date.parse(previous.period.end) - Date.parse(previous.period.start) ===
      Date.parse(latest.period.end) - Date.parse(latest.period.start)
  ) {
    const a = spendInPeriods(i, [previous.period]);
    const b = spendInPeriods(i, [latest.period]);
    if (
      a !== null &&
      b !== null &&
      a > 0 &&
      b > 0 &&
      previous.value > 0 &&
      latest.value > 0 &&
      b / latest.value > (a / previous.value) * (1 + RULES.risingCost)
    )
      problems.push("rising_cost");
  }
  if (!c.audience.trim()) problems.push("no_audience");
  if (!c.goal_id && c.status !== "archived") problems.push("no_goal");
  const simulatedOnly = !!i.spend && i.spend.simulatedEntries > 0 && i.spend.eur.entries === 0;
  if (
    simulatedOnly ||
    (anyResult && ![leads, clicks, conv, custom].some((x) => x.value !== null) && !eurRevenue)
  )
    problems.push("weak_evidence");
  const overlaps = i.others
    .filter(
      (o) =>
        o.id !== c.id &&
        ["active", "planned"].includes(o.status) &&
        o.channels.some((ch) => c.channels.includes(ch)) &&
        overlapsDates(o, c),
    )
    .map((o) => o.title);
  if (overlaps.length && live) problems.push("overlap");

  const ADVICE: Record<Problem, Advice> = {
    budget_over: {
      kind: "review_budget",
      problem: "budget_over",
      specialist: "revenue_analyst",
      kpi: "remaining",
      risk: "high",
    },
    budget_near: {
      kind: "review_budget",
      problem: "budget_near",
      specialist: "revenue_analyst",
      kpi: "remaining",
      risk: "medium",
    },
    overdue_tasks: {
      kind: "replan_tasks",
      problem: "overdue_tasks",
      specialist: null,
      kpi: "progress",
      risk: "medium",
    },
    behind_schedule: {
      kind: "replan_tasks",
      problem: "behind_schedule",
      specialist: null,
      kpi: "progress",
      risk: "medium",
    },
    ended_without_results: {
      kind: "evaluate_campaign",
      problem: "ended_without_results",
      specialist: "business_analyst",
      kpi: null,
      risk: "medium",
    },
    no_kpi: {
      kind: "define_kpis",
      problem: "no_kpi",
      specialist: "business_analyst",
      kpi: "leads",
      risk: "low",
    },
    no_results: {
      kind: "measure_results",
      problem: "no_results",
      specialist: "revenue_analyst",
      kpi: "conversions",
      risk: "medium",
    },
    low_conversion: {
      kind: "improve_conversion",
      problem: "low_conversion",
      specialist: "cro",
      kpi: "conversion_rate",
      risk: "medium",
    },
    rising_cost: {
      kind: "review_budget_split",
      problem: "rising_cost",
      specialist: "advertising",
      kpi: "cpl",
      risk: "medium",
    },
    no_leads: {
      kind: "adjust_message",
      problem: "no_leads",
      specialist: "copywriter",
      kpi: "leads",
      risk: "medium",
    },
    no_audience: {
      kind: "review_audience",
      problem: "no_audience",
      specialist: "market_research",
      kpi: null,
      risk: "low",
    },
    weak_evidence: {
      kind: "connect_source",
      problem: "weak_evidence",
      specialist: null,
      kpi: null,
      risk: "low",
    },
    no_goal: { kind: "link_goal", problem: "no_goal", specialist: null, kpi: null, risk: "low" },
    overlap: {
      kind: "compare_channels",
      problem: "overlap",
      specialist: "marketing",
      kpi: "cpl",
      risk: "low",
    },
  };
  const seen = new Set<string>();
  const advice = problems
    .map((p) => ADVICE[p])
    .filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  const metricIds = new Set(i.metrics.filter((m) => m.campaign_id === c.id).map((m) => m.id));
  const estimatesExcluded = i.measurements.filter(
    (m) => metricIds.has(m.metric_id) && !isActual(String(m.kind)),
  ).length;
  const simulated =
    i.spend && i.spend.simulatedEntries > 0
      ? {
          entries: i.spend.simulatedEntries,
          spent: i.spend.simulatedEur.spent,
          committed: i.spend.simulatedEur.committed,
          warnings: i.spend.simulatedWarnings,
        }
      : null;
  return {
    figures,
    problems,
    advice,
    overlaps,
    estimatesExcluded,
    health,
    simulated,
    measurementEvidence: [leads, clicks, conv, custom],
    // Use database-recorded evidence strength, never a second significance calculation.
    // Legacy/unclassified and simulated results must not become proof of improvement.
    experimentEvidence: i.experiments
      .filter((e) => e.campaign_id === c.id)
      .map((e) => ({
        id: e.id,
        title: e.title,
        evidence:
          e.result_data_class === "simulated"
            ? "simulated"
            : e.status !== "completed"
              ? "pending"
              : !["manual", "imported"].includes(e.result_data_class ?? "")
                ? "unclassified"
                : e.evidence_strength === "controlled"
                  ? "controlled"
                  : e.evidence_strength === "correlational"
                    ? "correlational"
                    : "inconclusive",
      })),
  };
}
