// Growth performance indicators derived from tracked metrics, the revenue ledger and the sales pipeline. Pure.
// An indicator is computed only when every input exists for the same period and currency; otherwise it says what
// is missing. Indicators that do not fit the business model are hidden, never shown as zero.
import { effectiveMeasurements, isActual, type Measurement } from "@/lib/performance";
import { measurementClass, weakestClass, type DataClass } from "./provenance";

export type Category = "marketing" | "sales" | "retention" | "financial" | "website" | "other";
export type StdMetric = {
  key: string;
  category: Category;
  unit: "count" | "currency" | "percent";
  direction: "increase" | "decrease";
};
/** Standard metric keys the indicators understand. Teams can still track any other metric. */
export const STANDARD_METRICS: StdMetric[] = [
  { key: "impressions", category: "marketing", unit: "count", direction: "increase" },
  { key: "reach", category: "marketing", unit: "count", direction: "increase" },
  { key: "clicks", category: "marketing", unit: "count", direction: "increase" },
  { key: "ad_spend", category: "marketing", unit: "currency", direction: "decrease" },
  { key: "conversions", category: "marketing", unit: "count", direction: "increase" },
  { key: "leads", category: "sales", unit: "count", direction: "increase" },
  { key: "qualified_leads", category: "sales", unit: "count", direction: "increase" },
  { key: "new_customers", category: "sales", unit: "count", direction: "increase" },
  { key: "active_customers", category: "retention", unit: "count", direction: "increase" },
  { key: "returning_customers", category: "retention", unit: "count", direction: "increase" },
  { key: "churned_customers", category: "retention", unit: "count", direction: "decrease" },
  { key: "marketing_cost", category: "financial", unit: "currency", direction: "decrease" },
  { key: "gross_margin", category: "financial", unit: "percent", direction: "increase" },
  { key: "sessions", category: "website", unit: "count", direction: "increase" },
];

export type ModelTag =
  | "b2b"
  | "b2c"
  | "services"
  | "subscription"
  | "ecommerce"
  | "licensing"
  | "transactions"
  | "events";
const TAGS: [ModelTag, RegExp][] = [
  ["b2b", /\bb2b\b|business[- ]to[- ]business|zakelijk|entreprises?\b|bedrijven/i],
  ["b2c", /\bb2c\b|consumer|consument|particulier|grand public|particuliers/i],
  ["services", /servic|dienst|consult|agency|bureau|agence|prestation/i],
  [
    "subscription",
    /subscri|abonne|abonnement|saas|recurring|terugkerend|récurrent|membership|lidmaatschap/i,
  ],
  [
    "ecommerce",
    /e-?commerce|webshop|web shop|online (shop|store|winkel)|boutique en ligne|retail|winkel/i,
  ],
  ["licensing", /licen[cs]|royalt/i],
  [
    "transactions",
    /transaction|transactie|commission|provisie|marketplace|marktplaats|per (sale|order)/i,
  ],
  ["events", /\bevents?\b|evenement|événement|ticket|conference|congres|congrès|festival/i],
];
/** Business model tags read from the business's own description. Empty means "not stated": show every indicator with data. */
export function detectModels(texts: readonly (string | null | undefined)[]): ModelTag[] {
  const s = texts.filter(Boolean).join(" ");
  return TAGS.filter(([, re]) => re.test(s)).map(([t]) => t);
}

export type KpiKey =
  | "ctr"
  | "cpc"
  | "cpm"
  | "cost_per_lead"
  | "cost_per_acquisition"
  | "lead_qualification_rate"
  | "lead_to_customer_rate"
  | "win_rate"
  | "average_deal_value"
  | "sales_cycle_days"
  | "pipeline_value"
  | "closed_won_value"
  | "churn_rate"
  | "retention_rate"
  | "repeat_rate"
  | "cac"
  | "roas"
  | "roi"
  | "payback_months";
/** Which business models an indicator is meaningful for; undefined = every model. */
const RELEVANT: Partial<Record<KpiKey, ModelTag[]>> = {
  win_rate: ["b2b", "services", "licensing"],
  sales_cycle_days: ["b2b", "services", "licensing"],
  churn_rate: ["subscription", "services", "licensing", "b2b"],
  retention_rate: ["subscription", "services", "licensing", "b2b"],
  repeat_rate: ["b2c", "ecommerce", "transactions", "events"],
  payback_months: ["subscription", "services", "licensing", "b2b"],
};
export const KPI_CATEGORY: Record<KpiKey, Category> = {
  ctr: "marketing",
  cpc: "marketing",
  cpm: "marketing",
  cost_per_lead: "marketing",
  cost_per_acquisition: "marketing",
  lead_qualification_rate: "sales",
  lead_to_customer_rate: "sales",
  win_rate: "sales",
  average_deal_value: "sales",
  sales_cycle_days: "sales",
  pipeline_value: "sales",
  closed_won_value: "sales",
  churn_rate: "retention",
  retention_rate: "retention",
  repeat_rate: "retention",
  cac: "financial",
  roas: "financial",
  roi: "financial",
  payback_months: "financial",
};

export type Input = {
  value: number;
  cls: DataClass;
  source: string;
  currency: string | null;
  unit: string;
};
export type Kpi = {
  key: KpiKey;
  category: Category;
  unit: "percent" | "currency" | "count" | "ratio" | "days" | "months";
  value: number | null;
  currency: string | null;
  inputs: string[];
  missing: string[];
  reason: "ok" | "missing_inputs" | "currency_mismatch" | "zero_denominator" | "no_attribution";
  cls: DataClass | null;
};

type MetricLite = {
  id: string;
  key: string;
  unit: string;
  currency: string | null;
  archived?: boolean;
  campaign_id?: string | null;
  channel?: string;
  unit_id?: string | null;
};
/**
 * Value per metric key for a period: flow metrics (counts, money) add up the best actual per month inside the period;
 * percentages use the latest month. Only actual kinds count; plans and forecasts never become inputs.
 */
export function metricInputs(
  metrics: readonly MetricLite[],
  rows: readonly (Measurement & { source?: string })[],
  from: string,
  to: string,
): Map<string, Input> {
  const eff = effectiveMeasurements(rows).filter(
    (r) => isActual(r.kind) && r.period_start >= from && r.period_end <= to,
  );
  const out = new Map<string, Input>();
  const RANK: Record<string, number> = { verified_actual: 3, imported_actual: 2, manual_actual: 1 };
  for (const m of metrics) {
    if (m.archived) continue;
    const mine = eff.filter((r) => r.metric_id === m.id);
    if (!mine.length) continue;
    const best = new Map<string, (typeof mine)[number]>();
    for (const r of mine) {
      const k = r.period_start;
      const cur = best.get(k);
      if (!cur || (RANK[r.kind] ?? 0) > (RANK[cur.kind] ?? 0)) best.set(k, r);
    }
    const chosen = [...best.values()].sort((a, b) => a.period_start.localeCompare(b.period_start));
    const flow = m.unit === "count" || m.unit === "currency";
    const value = flow
      ? chosen.reduce((s, r) => s + Number(r.value), 0)
      : Number(chosen[chosen.length - 1]!.value);
    const cls = weakestClass(chosen.map((r) => measurementClass(r.kind).cls)) ?? "manual";
    const sources = [...new Set(chosen.map((r) => r.source ?? "manual"))].join(", ");
    const prev = out.get(m.key);
    // Same key in several metrics (e.g. per campaign): add flows in the same currency.
    if (prev && flow && prev.currency === m.currency)
      out.set(m.key, {
        ...prev,
        value: prev.value + value,
        cls: weakestClass([prev.cls, cls])!,
        source: [...new Set([prev.source, sources])].join(", "),
      });
    else if (!prev)
      out.set(m.key, { value, cls, source: sources, currency: m.currency, unit: m.unit });
  }
  return out;
}

export type DealLite = {
  stage: string;
  value: number | string;
  currency: string;
  created_at: string;
  closed_at: string | null;
};
export type KpiContext = {
  inputs: Map<string, Input>;
  deals: readonly DealLite[];
  /** Attributed revenue per currency for the same period (from attribute()). */
  attributed: Map<string, number>;
  models: readonly ModelTag[];
  from: string;
  to: string;
};

const OPEN = new Set(["lead", "qualified", "proposal", "negotiation"]);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeKpis(c: KpiContext): Kpi[] {
  const I = c.inputs;
  const out: Kpi[] = [];
  const add = (
    key: KpiKey,
    unit: Kpi["unit"],
    need: string[],
    f: (v: Record<string, Input>) => {
      value: number | null;
      currency?: string | null;
      reason?: Kpi["reason"];
    },
  ) => {
    const rel = RELEVANT[key];
    if (rel && c.models.length && !rel.some((t) => c.models.includes(t))) return;
    const missing = need.filter((k) => !I.has(k));
    const base = { key, category: KPI_CATEGORY[key], unit, inputs: need, missing };
    if (missing.length) {
      out.push({ ...base, value: null, currency: null, reason: "missing_inputs", cls: null });
      return;
    }
    const v = Object.fromEntries(need.map((k) => [k, I.get(k)!]));
    const money = need
      .map((k) => v[k]!)
      .filter((x) => x.unit === "currency")
      .map((x) => x.currency);
    if (new Set(money).size > 1) {
      out.push({ ...base, value: null, currency: null, reason: "currency_mismatch", cls: null });
      return;
    }
    const r = f(v);
    out.push({
      ...base,
      value: r.value === null || !Number.isFinite(r.value) ? null : r2(r.value),
      currency: r.currency ?? null,
      reason:
        r.reason ?? (r.value === null || !Number.isFinite(r.value) ? "zero_denominator" : "ok"),
      cls: weakestClass(need.map((k) => v[k]!.cls)),
    });
  };
  const div = (a: number, b: number) => (b === 0 ? null : a / b);
  add("ctr", "percent", ["clicks", "impressions"], (v) => ({
    value: (div(v["clicks"]!.value, v["impressions"]!.value) ?? NaN) * 100,
  }));
  add("cpc", "currency", ["ad_spend", "clicks"], (v) => ({
    value: div(v["ad_spend"]!.value, v["clicks"]!.value),
    currency: v["ad_spend"]!.currency,
  }));
  add("cpm", "currency", ["ad_spend", "impressions"], (v) => ({
    value: (div(v["ad_spend"]!.value, v["impressions"]!.value) ?? NaN) * 1000,
    currency: v["ad_spend"]!.currency,
  }));
  add("cost_per_lead", "currency", ["ad_spend", "leads"], (v) => ({
    value: div(v["ad_spend"]!.value, v["leads"]!.value),
    currency: v["ad_spend"]!.currency,
  }));
  add("cost_per_acquisition", "currency", ["ad_spend", "conversions"], (v) => ({
    value: div(v["ad_spend"]!.value, v["conversions"]!.value),
    currency: v["ad_spend"]!.currency,
  }));
  add("lead_qualification_rate", "percent", ["qualified_leads", "leads"], (v) => ({
    value: (div(v["qualified_leads"]!.value, v["leads"]!.value) ?? NaN) * 100,
  }));
  add("lead_to_customer_rate", "percent", ["new_customers", "leads"], (v) => ({
    value: (div(v["new_customers"]!.value, v["leads"]!.value) ?? NaN) * 100,
  }));
  add("churn_rate", "percent", ["churned_customers", "active_customers"], (v) => ({
    value: (div(v["churned_customers"]!.value, v["active_customers"]!.value) ?? NaN) * 100,
  }));
  add("retention_rate", "percent", ["churned_customers", "active_customers"], (v) => ({
    value: (1 - (div(v["churned_customers"]!.value, v["active_customers"]!.value) ?? NaN)) * 100,
  }));
  add("repeat_rate", "percent", ["returning_customers", "active_customers"], (v) => ({
    value: (div(v["returning_customers"]!.value, v["active_customers"]!.value) ?? NaN) * 100,
  }));
  add("cac", "currency", ["marketing_cost", "new_customers"], (v) => ({
    value: div(v["marketing_cost"]!.value, v["new_customers"]!.value),
    currency: v["marketing_cost"]!.currency,
  }));

  // Revenue-based ratios use attributed revenue in the cost's currency only.
  const viaAttribution = (
    key: KpiKey,
    cost: string,
    f: (rev: number, costV: number) => number | null,
  ) => {
    const rel = RELEVANT[key];
    if (rel && c.models.length && !rel.some((t) => c.models.includes(t))) return;
    const base = {
      key,
      category: KPI_CATEGORY[key],
      unit: (key === "payback_months"
        ? "months"
        : key === "roi"
          ? "percent"
          : "ratio") as Kpi["unit"],
      inputs: [cost, "attributed_revenue"],
    };
    const cv = I.get(cost);
    if (!cv) {
      out.push({
        ...base,
        value: null,
        currency: null,
        missing: [cost],
        reason: "missing_inputs",
        cls: null,
      });
      return;
    }
    const rev = cv.currency ? c.attributed.get(cv.currency) : undefined;
    if (rev === undefined || rev === 0) {
      out.push({
        ...base,
        value: null,
        currency: cv.currency,
        missing: ["attributed_revenue"],
        reason: "no_attribution",
        cls: null,
      });
      return;
    }
    const value = f(rev, cv.value);
    out.push({
      ...base,
      value: value === null || !Number.isFinite(value) ? null : r2(value),
      currency: cv.currency,
      missing: [],
      reason: value === null ? "zero_denominator" : "ok",
      cls: weakestClass([cv.cls, "manual"]),
    });
  };
  viaAttribution("roas", "ad_spend", (rev, cost) => div(rev, cost));
  viaAttribution("roi", "marketing_cost", (rev, cost) => {
    const d = div(rev - cost, cost);
    return d === null ? null : d * 100;
  });

  // Payback: CAC divided by monthly gross profit per active customer (needs margin and revenue per customer).
  {
    const rel = RELEVANT.payback_months!;
    if (!c.models.length || rel.some((t) => c.models.includes(t))) {
      const need = ["marketing_cost", "new_customers", "gross_margin", "active_customers"];
      const missing = need.filter((k) => !I.has(k));
      const cur = I.get("marketing_cost")?.currency ?? null;
      const rev = cur ? c.attributed.get(cur) : undefined;
      const months = Math.max(1, monthsBetween(c.from, c.to));
      if (missing.length || rev === undefined)
        out.push({
          key: "payback_months",
          category: "financial",
          unit: "months",
          value: null,
          currency: null,
          inputs: [...need, "attributed_revenue"],
          missing: rev === undefined ? [...missing, "attributed_revenue"] : missing,
          reason: "missing_inputs",
          cls: null,
        });
      else {
        const cac = div(I.get("marketing_cost")!.value, I.get("new_customers")!.value);
        const perCustomerMonth = div(rev / months, I.get("active_customers")!.value);
        const gp =
          perCustomerMonth === null
            ? null
            : perCustomerMonth * (I.get("gross_margin")!.value / 100);
        const v = cac === null || !gp ? null : cac / gp;
        out.push({
          key: "payback_months",
          category: "financial",
          unit: "months",
          value: v === null ? null : r2(v),
          currency: null,
          inputs: [...need, "attributed_revenue"],
          missing: [],
          reason: v === null ? "zero_denominator" : "ok",
          cls: weakestClass(need.map((k) => I.get(k)!.cls)),
        });
      }
    }
  }

  // Pipeline indicators come from the team's deal entries (manual class), per currency, first currency shown.
  const inP = (iso: string | null) =>
    !!iso && iso.slice(0, 10) >= c.from && iso.slice(0, 10) <= c.to;
  const won = c.deals.filter((d) => d.stage === "won" && inP(d.closed_at));
  const lost = c.deals.filter((d) => d.stage === "lost" && inP(d.closed_at));
  const open = c.deals.filter((d) => OPEN.has(d.stage));
  const dealKpi = (
    key: KpiKey,
    unit: Kpi["unit"],
    value: number | null,
    currency: string | null,
    enough: boolean,
  ) => {
    const rel = RELEVANT[key];
    if (rel && c.models.length && !rel.some((t) => c.models.includes(t))) return;
    out.push({
      key,
      category: "sales",
      unit,
      value: enough && value !== null ? r2(value) : null,
      currency,
      inputs: ["deals"],
      missing: enough ? [] : ["deals"],
      reason: enough ? "ok" : "missing_inputs",
      cls: enough ? "manual" : null,
    });
  };
  const mainCur = (rows: readonly DealLite[]) =>
    rows.length
      ? [
          ...rows.reduce(
            (m, d) => m.set(d.currency, (m.get(d.currency) ?? 0) + 1),
            new Map<string, number>(),
          ),
        ].sort((a, b) => b[1] - a[1])[0]![0]
      : null;
  dealKpi(
    "win_rate",
    "percent",
    won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null,
    null,
    won.length + lost.length > 0,
  );
  const wc = mainCur(won);
  const wonIn = won.filter((d) => d.currency === wc);
  dealKpi(
    "average_deal_value",
    "currency",
    wonIn.length ? wonIn.reduce((s, d) => s + Number(d.value), 0) / wonIn.length : null,
    wc,
    wonIn.length > 0,
  );
  dealKpi(
    "closed_won_value",
    "currency",
    wonIn.reduce((s, d) => s + Number(d.value), 0),
    wc,
    wonIn.length > 0,
  );
  const cycles = won
    .map((d) => (new Date(d.closed_at!).getTime() - new Date(d.created_at).getTime()) / 86_400_000)
    .filter((x) => x >= 0);
  dealKpi(
    "sales_cycle_days",
    "days",
    cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
    null,
    cycles.length > 0,
  );
  const oc = mainCur(open);
  dealKpi(
    "pipeline_value",
    "currency",
    open.filter((d) => d.currency === oc).reduce((s, d) => s + Number(d.value), 0),
    oc,
    open.length > 0,
  );
  return out;
}

export function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`),
    b = new Date(`${to.slice(0, 10)}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

export type PeriodKey =
  "this_month" | "last_month" | "last_3_months" | "last_12_months" | "year_to_date";
export const PERIODS: PeriodKey[] = [
  "last_month",
  "this_month",
  "last_3_months",
  "year_to_date",
  "last_12_months",
];
/** Inclusive date range for a period choice, in UTC calendar months. */
export function periodRange(p: PeriodKey, now: Date = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear(),
    m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const start = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1));
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0));
  switch (p) {
    case "this_month":
      return { from: iso(start(y, m)), to: iso(end(y, m)) };
    case "last_month":
      return { from: iso(start(y, m - 1)), to: iso(end(y, m - 1)) };
    case "last_3_months":
      return { from: iso(start(y, m - 3)), to: iso(end(y, m - 1)) };
    case "year_to_date":
      return { from: iso(start(y, 0)), to: iso(end(y, m)) };
    case "last_12_months":
      return { from: iso(start(y, m - 12)), to: iso(end(y, m - 1)) };
  }
}
