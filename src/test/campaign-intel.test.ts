import { describe, expect, it } from "vitest";
import { campaignIntel, type IntelInput } from "@/lib/campaign-intel";
import { spendSummary } from "@/lib/campaign-spend";

const today = "2026-11-21";
const campaign = { id: "c1", title: "Lunch", status: "active", objective: "B2B lunches", audience: "Offices", channels: ["LinkedIn"], budget_eur: 1000, start_date: "2026-11-01", end_date: "2026-11-30", goal_id: "g", results: "" };
const base: IntelInput = { campaign, tasks: [{ status: "todo", due_date: "2026-11-25" }], spend: null, metrics: [], measurements: [], attributed: null, experiments: [], others: [], today };
const metric = (id: string, key: string) => ({ id, key, label: key, campaign_id: "c1", archived: false });
const m = (metric_id: string, value: number, period_start = "2026-11-01", kind = "manual_actual") => ({ id: `${metric_id}-${period_start}-${kind}`, metric_id, kind, period_start, period_end: period_start, value, corrects_id: null, created_at: "2026-11-02T00:00:00Z" });
const spend = (amount: number, data_class: "manual" | "simulated" = "manual") => ({ kind: "spend" as const, amount, currency: "EUR", data_class });

describe("campaign diagnosis", () => {
  it("never shows missing figures as zero: no ledger, no metrics, no attribution", () => {
    const r = campaignIntel(base);
    expect(r.figures.spent).toMatchObject({ value: null, missing: "no_ledger" });
    expect(r.figures.leads).toMatchObject({ value: null, missing: "no_metric" });
    expect(r.figures.roas).toMatchObject({ value: null, missing: "no_attribution" });
    expect(r.problems).toContain("no_kpi");
    expect(r.advice.find((a) => a.problem === "no_kpi")?.specialist).toBe("business_analyst");
  });

  it("computes cost per lead, cost per acquisition, conversion rate and ROAS only from recorded inputs", () => {
    const r = campaignIntel({ ...base, spend: spendSummary(1000, [spend(400)]),
      metrics: [metric("L", "leads"), metric("K", "clicks"), metric("C", "conversions")],
      measurements: [m("L", 40), m("K", 2000), m("C", 10), m("C", 99, "2026-11-01", "forecast")],
      attributed: [{ currency: "EUR", amount: 1200, sales: 3 }, { currency: "USD", amount: 50, sales: 1 }] });
    expect(r.figures.cpl.value).toBe(10);
    expect(r.figures.cpa.value).toBe(40);
    expect(r.figures.conversion_rate.value).toBe(0.005);
    expect(r.figures.roas.value).toBe(3);
    expect(r.figures.roi.value).toBe(2);
    expect(r.estimatesExcluded).toBe(1);
    expect(r.problems).toContain("low_conversion");
  });

  it("detects budget pressure, missing results after half the period and overlapping campaigns", () => {
    const r = campaignIntel({ ...base, spend: spendSummary(1000, [spend(850)]), metrics: [metric("L", "leads")],
      others: [{ id: "c2", title: "Breakfast", status: "active", channels: ["LinkedIn", "Email"], start_date: "2026-11-15", end_date: "2026-12-15", audience: "Offices" }] });
    expect(r.problems).toEqual(expect.arrayContaining(["budget_near", "no_results", "overlap"]));
    expect(r.overlaps).toEqual(["Breakfast"]);
  });

  it("detects rising cost per lead between the last two measured periods", () => {
    const r = campaignIntel({ ...base, spend: spendSummary(1000, [spend(100), spend(300)]), metrics: [metric("L", "leads")],
      measurements: [m("L", 20, "2026-11-01"), m("L", 20, "2026-11-11")],
      spendRows: [{ occurred_on: "2026-11-05", amount: 100 }, { occurred_on: "2026-11-15", amount: 300 }] });
    expect(r.problems).toContain("rising_cost");
  });

  it("treats a campaign whose spending is only simulated as weak evidence", () => {
    const r = campaignIntel({ ...base, spend: spendSummary(1000, [spend(100, "simulated")]) });
    expect(r.problems).toContain("weak_evidence");
  });
});
