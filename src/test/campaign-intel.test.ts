import { describe, expect, it } from "vitest";
import { campaignIntel, type IntelInput } from "@/lib/campaign-intel";
import { spendSummary } from "@/lib/campaign-spend";

const today = "2026-11-21";
const campaign = {
  id: "c1",
  title: "Lunch",
  status: "active",
  objective: "B2B lunches",
  audience: "Offices",
  channels: ["LinkedIn"],
  budget_eur: 1000,
  start_date: "2026-11-01",
  end_date: "2026-11-30",
  goal_id: "g",
  results: "",
};
const base: IntelInput = {
  campaign,
  tasks: [{ status: "todo", due_date: "2026-11-25" }],
  spend: null,
  metrics: [],
  measurements: [],
  attributed: null,
  experiments: [],
  others: [],
  today,
};
const metric = (id: string, key: string) => ({
  id,
  key,
  label: key,
  campaign_id: "c1",
  archived: false,
});
const m = (
  metric_id: string,
  value: number,
  period_start = "2026-11-01",
  kind = "manual_actual",
  period_end = "2026-11-20",
) => ({
  id: `${metric_id}-${period_start}-${kind}`,
  metric_id,
  kind,
  period_start,
  period_end,
  value,
  corrects_id: null,
  created_at: "2026-11-02T00:00:00Z",
});
const spend = (amount: number, data_class: "manual" | "simulated" = "manual") => ({
  kind: "spend" as const,
  amount,
  currency: "EUR",
  data_class,
});

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
    const r = campaignIntel({
      ...base,
      spend: spendSummary(1000, [spend(400)]),
      spendRows: [{ occurred_on: "2026-11-05", amount: 400 }],
      metrics: [metric("L", "leads"), metric("K", "clicks"), metric("C", "conversions")],
      measurements: [m("L", 40), m("K", 2000), m("C", 10), m("C", 99, "2026-11-01", "forecast")],
      attributed: [
        { currency: "EUR", amount: 1200, sales: 3 },
        { currency: "USD", amount: 50, sales: 1 },
      ],
    });
    expect(r.figures.cpl.value).toBe(10);
    expect(r.figures.cpa.value).toBe(40);
    expect(r.figures.conversion_rate.value).toBe(0.005);
    expect(r.figures.roas.value).toBe(3);
    expect(r.figures.roi.value).toBe(2);
    expect(r.estimatesExcluded).toBe(1);
    expect(r.problems).toContain("low_conversion");
  });

  it("detects budget pressure, missing results after half the period and overlapping campaigns", () => {
    const r = campaignIntel({
      ...base,
      spend: spendSummary(1000, [spend(850)]),
      metrics: [metric("L", "leads")],
      others: [
        {
          id: "c2",
          title: "Breakfast",
          status: "active",
          channels: ["LinkedIn", "Email"],
          start_date: "2026-11-15",
          end_date: "2026-12-15",
          audience: "Offices",
        },
      ],
    });
    expect(r.problems).toEqual(expect.arrayContaining(["budget_near", "no_results", "overlap"]));
    expect(r.overlaps).toEqual(["Breakfast"]);
  });

  it("detects rising cost per lead between the last two measured periods", () => {
    const r = campaignIntel({
      ...base,
      spend: spendSummary(1000, [spend(100), spend(300)]),
      metrics: [metric("L", "leads")],
      measurements: [
        m("L", 20, "2026-11-01", "manual_actual", "2026-11-10"),
        m("L", 20, "2026-11-11", "manual_actual", "2026-11-20"),
      ],
      spendRows: [
        { occurred_on: "2026-11-05", amount: 100 },
        { occurred_on: "2026-11-15", amount: 300 },
      ],
    });
    expect(r.problems).toContain("rising_cost");
  });

  it("treats a campaign whose spending is only simulated as weak evidence", () => {
    const r = campaignIntel({ ...base, spend: spendSummary(1000, [spend(100, "simulated")]) });
    expect(r.problems).toContain("weak_evidence");
  });
  it("counts one actual per metric/period using the shared evidence priority", () => {
    const r = campaignIntel({
      ...base,
      metrics: [metric("L", "leads")],
      measurements: [
        m("L", 40),
        m("L", 35, "2026-11-01", "imported_actual"),
        m("L", 30, "2026-11-01", "verified_actual"),
      ],
    });
    expect(r.figures.leads.value).toBe(30);
    expect(r.measurementEvidence[0]?.kinds).toEqual(["verified_actual"]);
  });
  it("does not add overlapping daily and monthly observations", () => {
    const r = campaignIntel({
      ...base,
      metrics: [metric("L", "leads")],
      measurements: [m("L", 40), m("L", 5, "2026-11-05", "manual_actual", "2026-11-05")],
    });
    expect(r.figures.leads).toMatchObject({ value: null, missing: "overlapping_periods" });
    expect(r.problems).not.toContain("no_leads");
  });
  it("does not combine separate counting definitions without proof of disjoint audiences", () => {
    const r = campaignIntel({
      ...base,
      metrics: [metric("L", "leads"), metric("L2", "leads")],
      measurements: [m("L", 40), m("L2", 20)],
    });
    expect(r.figures.leads).toMatchObject({ value: null, missing: "ambiguous_metric" });
  });
  it("withholds conversion rate and its alert when numerator and denominator periods differ", () => {
    const r = campaignIntel({
      ...base,
      metrics: [metric("K", "clicks"), metric("C", "conversions")],
      measurements: [m("K", 1000), m("C", 1, "2026-11-11")],
    });
    expect(r.figures.conversion_rate).toMatchObject({ value: null, missing: "period_mismatch" });
    expect(r.problems).not.toContain("low_conversion");
  });
  it("uses spending only inside the exact measured periods, not lifetime or future spending", () => {
    const r = campaignIntel({
      ...base,
      spend: spendSummary(1000, [spend(900)]),
      metrics: [metric("L", "leads")],
      measurements: [m("L", 20)],
      spendRows: [
        { occurred_on: "2026-10-31", amount: 500 },
        { occurred_on: "2026-11-01", amount: 100 },
        { occurred_on: "2026-11-20", amount: 100 },
        { occurred_on: "2026-11-30", amount: 200 },
      ],
    });
    expect(r.figures.cpl.value).toBe(10);
    expect(r.figures.spent.value).toBe(900);
  });
  it("requires dated spending to compute a period cost", () => {
    const r = campaignIntel({
      ...base,
      spend: spendSummary(1000, [spend(400)]),
      metrics: [metric("L", "leads")],
      measurements: [m("L", 20)],
    });
    expect(r.figures.cpl).toMatchObject({ value: null, missing: "no_dated_spend" });
  });
  it("keeps corrected observations and the original history from counting twice", () => {
    const original = m("L", 40);
    const corrected = {
      ...m("L", 25),
      id: "correction",
      corrects_id: original.id,
      created_at: "2026-11-15T00:00:00Z",
    };
    const r = campaignIntel({
      ...base,
      metrics: [metric("L", "leads")],
      measurements: [original, corrected],
    });
    expect(r.figures.leads.value).toBe(25);
    expect(r.measurementEvidence[0]?.updatedAt).toBe("2026-11-15T00:00:00Z");
  });
  it("does not compare cost trends over unequal or unfinished windows", () => {
    const input = {
      ...base,
      spend: spendSummary(1000, [spend(400)]),
      metrics: [metric("L", "leads")],
      spendRows: [
        { occurred_on: "2026-11-05", amount: 100 },
        { occurred_on: "2026-11-15", amount: 300 },
      ],
    };
    const first = m("L", 20, "2026-11-01", "manual_actual", "2026-11-10");
    expect(
      campaignIntel({
        ...input,
        measurements: [first, m("L", 20, "2026-11-11", "manual_actual", "2026-11-19")],
      }).problems,
    ).not.toContain("rising_cost");
    expect(
      campaignIntel({
        ...input,
        today: "2026-11-19",
        measurements: [first, m("L", 20, "2026-11-11", "manual_actual", "2026-11-20")],
      }).problems,
    ).not.toContain("rising_cost");
  });
  it("keeps future, archived and other-campaign measurements out", () => {
    const r = campaignIntel({
      ...base,
      metrics: [
        metric("L", "leads"),
        { ...metric("L2", "leads"), archived: true },
        { ...metric("L3", "leads"), campaign_id: "other" },
      ],
      measurements: [
        m("L", 4),
        m("L", 90, "2026-12-01", "manual_actual", "2026-12-20"),
        m("L2", 50),
        m("L3", 99),
      ],
    });
    expect(r.figures.leads.value).toBe(4);
  });
  it("withholds invalid count results rather than issuing a performance warning", () => {
    const r = campaignIntel({
      ...base,
      metrics: [metric("L", "leads")],
      measurements: [m("L", -4)],
    });
    expect(r.figures.leads).toMatchObject({ value: null, missing: "invalid_result" });
    expect(r.problems).not.toContain("no_leads");
  });
  it("connects only this campaign's experiments and keeps simulated and unclassified outcomes apart", () => {
    const e = {
      id: "exp",
      title: "Offer test",
      campaign_id: "c1",
      status: "completed",
      evidence_strength: "controlled",
      result_data_class: "manual",
    };
    const r = campaignIntel({
      ...base,
      experiments: [
        e,
        { ...e, id: "other", campaign_id: "c2" },
        { ...e, id: "sim", result_data_class: "simulated" },
        { ...e, id: "legacy", result_data_class: null },
        { ...e, id: "before-after", evidence_strength: "correlational" },
        { ...e, id: "open", status: "running" },
      ],
    });
    expect(r.experimentEvidence.map((row) => [row.id, row.evidence])).toEqual([
      ["exp", "controlled"],
      ["sim", "simulated"],
      ["legacy", "unclassified"],
      ["before-after", "correlational"],
      ["open", "pending"],
    ]);
    expect(r.figures.revenue.value).toBeNull();
    expect(r.figures.conversions.value).toBeNull();
  });
});
