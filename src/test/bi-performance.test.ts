import { describe, expect, it } from "vitest";
import { computeKpis, detectModels, metricInputs, periodRange } from "@/lib/bi/kpis";
import { compare, progressOf, type CompareRow } from "@/lib/bi/comparison";
import { abSignificance, detectImprovements, observedOutcome } from "@/lib/bi/optimization";
import { nextGrowthActions, scoreOf } from "@/lib/bi/growth-actions";
import { understand } from "@/lib/bi/understanding";

const metric = (
  id: string,
  key: string,
  unit = "count",
  currency: string | null = null,
  extra = {},
) => ({
  id,
  key,
  label: key,
  unit,
  currency,
  direction: "increase",
  goal_id: null,
  archived: false,
  ...extra,
});
const m = (
  id: string,
  metric_id: string,
  kind: string,
  month: string,
  value: number,
  extra = {},
) => ({
  id,
  metric_id,
  kind,
  period_start: `${month}-01`,
  period_end: `${month}-28`,
  value,
  corrects_id: null,
  created_at: `${month}-28T00:00:00Z`,
  source: "manual",
  ...extra,
});

describe("indicators", () => {
  const metrics = [
    metric("a", "ad_spend", "currency", "EUR"),
    metric("b", "clicks"),
    metric("c", "impressions"),
    metric("d", "leads"),
  ];
  const rows = [
    m("1", "a", "manual_actual", "2026-10", 500),
    m("2", "b", "imported_actual", "2026-10", 250),
    m("3", "c", "imported_actual", "2026-10", 10000),
    m("4", "a", "planned", "2026-10", 400),
  ];
  const inputs = metricInputs(metrics, rows, "2026-10-01", "2026-10-31");
  it("computes CTR, CPC and CPM from actual values only", () => {
    expect(inputs.get("ad_spend")!.value).toBe(500);
    const k = computeKpis({
      inputs,
      deals: [],
      attributed: new Map(),
      models: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const by = (key: string) => k.find((x) => x.key === key)!;
    expect(by("ctr").value).toBe(2.5);
    expect(by("cpc").value).toBe(2);
    expect(by("cpm").value).toBe(50);
    expect(by("cpc").cls).toBe("manual");
  });
  it("says what is missing instead of showing a number", () => {
    const k = computeKpis({
      inputs,
      deals: [],
      attributed: new Map(),
      models: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(k.find((x) => x.key === "cost_per_acquisition")!).toMatchObject({
      value: null,
      reason: "missing_inputs",
      missing: ["conversions"],
    });
    expect(k.find((x) => x.key === "roas")!).toMatchObject({
      value: null,
      reason: "no_attribution",
    });
  });
  it("uses attributed revenue in the cost currency for ROAS", () => {
    const k = computeKpis({
      inputs,
      deals: [],
      attributed: new Map([
        ["EUR", 1500],
        ["USD", 9000],
      ]),
      models: [],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(k.find((x) => x.key === "roas")!.value).toBe(3);
  });
  it("hides indicators that do not fit the business model", () => {
    const shop = computeKpis({
      inputs,
      deals: [],
      attributed: new Map(),
      models: ["ecommerce"],
      from: "2026-10-01",
      to: "2026-10-31",
    }).map((x) => x.key);
    expect(shop).toContain("repeat_rate");
    expect(shop).not.toContain("churn_rate");
    expect(shop).not.toContain("sales_cycle_days");
    const saas = computeKpis({
      inputs,
      deals: [],
      attributed: new Map(),
      models: ["subscription"],
      from: "2026-10-01",
      to: "2026-10-31",
    }).map((x) => x.key);
    expect(saas).toContain("churn_rate");
    expect(saas).not.toContain("repeat_rate");
  });
  it("detects business models in English, Dutch and French", () => {
    expect(detectModels(["Abonnement voor zakelijke klanten"])).toEqual(["b2b", "subscription"]);
    expect(detectModels(["Boutique en ligne pour particuliers"])).toEqual(["b2c", "ecommerce"]);
    expect(detectModels([null, ""])).toEqual([]);
  });
  it("derives sales indicators from closed deals in the period", () => {
    const deals = [
      {
        stage: "won",
        value: 1000,
        currency: "EUR",
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-11T00:00:00Z",
      },
      {
        stage: "won",
        value: 3000,
        currency: "EUR",
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-21T00:00:00Z",
      },
      {
        stage: "lost",
        value: 500,
        currency: "EUR",
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-05T00:00:00Z",
      },
      {
        stage: "proposal",
        value: 800,
        currency: "EUR",
        created_at: "2026-10-01T00:00:00Z",
        closed_at: null,
      },
    ];
    const k = computeKpis({
      inputs: new Map(),
      deals,
      attributed: new Map(),
      models: ["b2b"],
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const by = (key: string) => k.find((x) => x.key === key)!.value;
    expect([
      by("win_rate"),
      by("average_deal_value"),
      by("sales_cycle_days"),
      by("pipeline_value"),
    ]).toEqual([66.67, 2000, 15, 800]);
  });
  it("builds calendar periods", () => {
    expect(periodRange("last_month", new Date("2026-11-20T00:00:00Z"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(periodRange("last_3_months", new Date("2026-01-10T00:00:00Z"))).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });
});

describe("comparison", () => {
  const row = (
    id: string,
    objective: string | null,
    progress: number | null,
    extra: Partial<CompareRow> = {},
  ): CompareRow => ({
    id,
    label: id,
    objective,
    horizonDays: 60,
    budget: {},
    credits: 10,
    expected: null,
    actual: null,
    progress,
    attributed: {},
    daysToFirstResult: null,
    tasksDone: 0,
    tasksTotal: 0,
    runs: { succeeded: 0, failed: 0 },
    evidence: null,
    ...extra,
  });
  it("ranks only rows with the same objective and horizon, by progress not revenue", () => {
    const g = compare("plan", [
      row("a", "leads", 40, { attributed: { EUR: 9000 } }),
      row("b", "leads", 80),
      row("c", "revenue", 99),
    ]);
    const leads = g.find((x) => x.objective === "leads")!;
    expect(leads.comparable).toBe(true);
    expect(leads.rows.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
    expect(leads.rows[0]!.reasons[0]).toEqual({ code: "higher_progress", vars: { a: 80, b: 40 } });
    expect(g.find((x) => x.objective === "revenue")!.comparable).toBe(false);
  });
  it("does not rank across different horizons", () => {
    const g = compare("initiative", [
      row("a", "leads", 40, { horizonDays: 20 }),
      row("b", "leads", 80, { horizonDays: 300 }),
    ]);
    expect(g.every((x) => !x.comparable)).toBe(true);
  });
  it("computes progress from baseline to target", () => {
    expect(progressOf(100, 200, 150)).toBe(50);
    expect(progressOf(null, 10, null)).toBeNull();
  });
});

describe("continuous improvement", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const base = { budget: [], goals: [], attribution: [], experiments: [], proposals: [], now };
  it("flags a metric 10% or more behind plan as a problem", () => {
    const c = detectImprovements({
      ...base,
      metrics: [metric("x", "leads")],
      measurements: [
        m("1", "x", "manual_actual", "2026-10", 80),
        m("2", "x", "planned", "2026-10", 100),
      ],
    });
    expect(c.map((x) => [x.code, x.category, x.vars["dev"]])).toEqual([
      ["metric_behind", "problem", 20],
    ]);
  });
  it("respects the metric direction", () => {
    const c = detectImprovements({
      ...base,
      metrics: [metric("x", "ad_spend", "currency", "EUR", { direction: "decrease" })],
      measurements: [
        m("1", "x", "manual_actual", "2026-10", 80),
        m("2", "x", "planned", "2026-10", 100),
      ],
    });
    expect(c.map((x) => x.code)).toEqual(["metric_ahead"]);
  });
  it("does not suggest a finding that already has an open proposal", () => {
    const input = {
      ...base,
      goals: [{ id: "g", title: "Grow", status: "active" }],
      metrics: [],
      measurements: [],
    };
    expect(detectImprovements(input).map((x) => x.sourceKey)).toEqual(["goal_without_metric:g"]);
    expect(
      detectImprovements({
        ...input,
        proposals: [{ source_key: "rule:goal_without_metric:g", status: "approved" }],
      }),
    ).toEqual([]);
  });
  it("proposes a budget shift only with budget permission required", () => {
    const attribution = [
      {
        model: "last_touch" as const,
        currency: "EUR",
        total: 3000,
        attributed: 3000,
        unattributed: 0,
        unattributedSales: 0,
        estimatedExcluded: 0,
        credits: [
          {
            key: "channel:search",
            amount: 2000,
            sales: 2,
            confidence: "high" as const,
            evidence: {},
          },
          {
            key: "channel:social",
            amount: 1000,
            sales: 1,
            confidence: "high" as const,
            evidence: {},
          },
        ],
      },
    ];
    const budget = [
      {
        channel: "Search",
        period_month: "2026-10-01",
        planned: 500,
        actual: 500,
        currency: "EUR",
        goal_id: null,
      },
      {
        channel: "Social",
        period_month: "2026-10-01",
        planned: 1000,
        actual: 1000,
        currency: "EUR",
        goal_id: null,
      },
    ];
    const c = detectImprovements({
      ...base,
      metrics: [],
      measurements: [],
      attribution,
      budget,
    }).find((x) => x.code === "best_channel")!;
    expect([c.vars["channel"], c.vars["ratio"], c.requiredLevel]).toEqual(["search", 4, "budget"]);
  });
  it("reports observed change without claiming a cause", () => {
    expect([
      observedOutcome("increase", 100, 120),
      observedOutcome("decrease", 100, 120),
      observedOutcome("increase", 100, 102),
      observedOutcome("increase", null, 5),
    ]).toEqual(["improved", "worse", "no_change", "inconclusive"]);
  });
  it("tests A/B significance only with enough data", () => {
    expect(abSignificance(12, 9, 400, 410)).toEqual({ z: 1.39, significant: false });
    expect(abSignificance(18, 9, 400, 410)).toEqual({ z: 3.75, significant: true });
    expect(abSignificance(12, 6, 1000, 1000)!.significant).toBe(true);
    expect(abSignificance(50, 20, 10, 10)).toBeNull();
    expect(abSignificance(120, 20, 100, 100)).toBeNull();
  });
});

describe("next best growth actions", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const empty = {
    candidates: [],
    proposals: [],
    experiments: [],
    opportunities: [],
    goalPriority: new Map(),
    budgetLeft: new Map(),
    creditBalance: 100,
    openWork: 0,
    grantedBudgetLevel: false,
    now,
  };
  it("score is the visible weighted sum of its components", () => {
    expect(
      scoreOf({ value: 5, importance: 5, urgency: 5, confidence: 5, feasibility: 5, risk: 0 }),
    ).toBe(100);
    expect(
      scoreOf({ value: 0, importance: 0, urgency: 0, confidence: 0, feasibility: 0, risk: 5 }),
    ).toBe(-10);
  });
  it("ranks an urgent problem on a high-priority goal above a low-confidence opportunity and names blockers", () => {
    const a = nextGrowthActions({
      ...empty,
      goalPriority: new Map([["g", "high"]]),
      candidates: [
        {
          sourceKey: "metric_behind:x",
          code: "metric_behind",
          category: "problem",
          vars: {},
          evidence: [],
          requiredLevel: "none",
          goalId: "g",
          confidence: 0.85,
          records: [
            { type: "measured_observation", description: "m", source_kind: "measurement", source_ref: "m1" },
          ],
        },
        {
          sourceKey: "best_channel:s",
          code: "best_channel",
          category: "opportunity",
          vars: {},
          evidence: [],
          requiredLevel: "budget",
          confidence: 0.4,
          records: [{ type: "estimate", description: "a", source_kind: "other", source_ref: "attribution" }],
        },
      ],
    });
    expect(a.map((x) => x.code)).toEqual(["metric_behind", "best_channel"]);
    expect(a[1]!.blockers).toEqual(["no_budget", "needs_permission", "needs_approval"]);
    expect(a[0]!.delay).toBe("target_missed");
  });
  it("asks to close experiments that ran their full duration", () => {
    const a = nextGrowthActions({
      ...empty,
      experiments: [
        {
          id: "e",
          title: "Form",
          status: "running",
          started_at: "2026-10-01T00:00:00Z",
          duration_days: 14,
        },
      ],
    });
    expect(a.map((x) => x.kind)).toEqual(["close_experiment"]);
  });
});

describe("business understanding", () => {
  it("separates verified, indicated and missing knowledge", () => {
    const k = understand({
      facts: [
        { key: "business_model", verified: true },
        { key: "pricing", verified: false },
      ],
      profile: {
        business_model: "x",
        offerings: [],
        audiences: ["SMB"],
        objectives: null,
        monthly_budget_eur: null,
      },
      hasRevenue: true,
      hasDeals: false,
      hasRetentionMetric: false,
      hasMarginMetric: false,
      hasBudget: false,
      hasMarketingMetric: false,
      hasGoals: true,
    });
    const by = Object.fromEntries(k.map((x) => [x.area, x.status]));
    expect([
      by["business_model"],
      by["segments"],
      by["revenue_model"],
      by["pricing"],
      by["retention"],
      by["objectives"],
    ]).toEqual(["verified", "indicated", "indicated", "missing", "missing", "indicated"]);
  });
});
