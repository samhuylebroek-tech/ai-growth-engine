import { describe, expect, it } from "vitest";
import { computeKpis, type Input } from "@/lib/bi/kpis";
import { formulaText, KPI_DEFINITIONS } from "@/lib/bi/kpi-definitions";

const inp = (value: number, unit = "count", currency: string | null = null): Input => ({ value, cls: "manual", source: "manual", currency, unit });
const inputs = new Map<string, Input>([
  ["clicks", inp(50)], ["impressions", inp(1000)], ["ad_spend", inp(200, "currency", "EUR")], ["leads", inp(20)],
  ["conversions", inp(5)], ["qualified_leads", inp(10)], ["new_customers", inp(4)], ["churned_customers", inp(2)],
  ["active_customers", inp(40)], ["returning_customers", inp(8)], ["marketing_cost", inp(400, "currency", "EUR")], ["gross_margin", inp(50, "percent")],
]);
const deals = [
  { stage: "won", value: 1000, currency: "EUR", created_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-11T00:00:00Z" },
  { stage: "lost", value: 500, currency: "EUR", created_at: "2026-10-02T00:00:00Z", closed_at: "2026-10-12T00:00:00Z" },
  { stage: "proposal", value: 300, currency: "EUR", created_at: "2026-10-03T00:00:00Z", closed_at: null },
];
const kpis = computeKpis({ inputs, deals, attributed: new Map([["EUR", 1200]]), models: [], from: "2026-10-01", to: "2026-10-31" });

describe("canonical KPI definitions", () => {
  it("define every indicator the calculation produces", () => {
    expect(kpis.map((k) => k.key).sort()).toEqual(Object.keys(KPI_DEFINITIONS).sort());
  });
  it("name exactly the inputs the calculation reads, so definition and figure cannot drift apart", () => {
    for (const k of kpis) expect([...KPI_DEFINITIONS[k.key].inputs].sort(), k.key).toEqual([...k.inputs].sort());
  });
  it("only use recorded inputs the definition declares", () => {
    for (const d of Object.values(KPI_DEFINITIONS))
      for (const t of d.formula) if (typeof t === "object" && "in" in t) expect(d.inputs, d.key).toContain(t.in);
  });
  it("match the calculated values for a known example", () => {
    const v = (k: string) => kpis.find((x) => x.key === k)?.value;
    expect(v("ctr")).toBe(5);            // 50 ÷ 1000 × 100
    expect(v("roas")).toBe(6);           // 1200 ÷ 200
    expect(v("roi")).toBe(200);          // (1200 − 400) ÷ 400 × 100
    expect(v("retention_rate")).toBe(95); // 100 − 2 ÷ 40 × 100
    expect(v("win_rate")).toBe(50);
  });
  it("render a readable formula", () => {
    expect(formulaText(KPI_DEFINITIONS.roi)).toBe("(attributed_revenue − marketing_cost) ÷ marketing_cost × 100");
  });
});

import { kpiContextLines, lastFullMonth } from "@/lib/bi/kpi-context";
describe("Growth Officer growth indicators", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const m = (id: string, key: string, unit = "count", currency: string | null = null) => ({ id, key, unit, currency });
  const row = (metric_id: string, value: number) => ({ id: `r${metric_id}`, metric_id, kind: "manual_actual", value, period_start: "2026-10-01", period_end: "2026-10-31", created_at: "2026-11-01T00:00:00Z", corrects: null }) as never;
  it("uses the last full month", () => expect(lastFullMonth(now)).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("states the same value and formula as the screen and lists what cannot be calculated", () => {
    const lines = kpiContextLines({ metrics: [m("a", "clicks"), m("b", "impressions")], measurements: [row("a", 50), row("b", 1000)], revenue: [], touches: [], deals: [] }, now);
    expect(lines).toContain("- ctr = 5% [manual] — formula: clicks ÷ impressions × 100; higher is better");
    expect(lines.find((l) => l.startsWith("not calculable"))).toContain("cac (missing marketing_cost, new_customers)");
  });
  it("never reports an indicator when nothing is recorded", () => {
    expect(kpiContextLines({ metrics: [], measurements: [], revenue: [], touches: [], deals: [] }, now)).toContain("no growth indicator can be calculated for this period");
  });
});
