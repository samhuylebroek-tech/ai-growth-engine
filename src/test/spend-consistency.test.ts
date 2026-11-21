// Regression: every component that judges campaign money must agree that simulated spending is never a real
// overrun, that reservations are not expenditure and that a missing ledger is not zero.
import { describe, expect, it } from "vitest";
import { isRealOverrun, spendSummary } from "@/lib/campaign-spend";
import { campaignHealth } from "@/lib/campaign-health";
import { campaignIntel, type IntelInput } from "@/lib/campaign-intel";
import { campaignLines, spendFigures } from "@/lib/reports";
import { growthSituation } from "@/lib/situation";
import { detectSignals } from "@/lib/signals";
import type { BusinessDomains } from "@/lib/security/business-context";

const TODAY = "2026-11-20";
const camp = { id: "c1", title: "Autumn", status: "active", category: "advertising", budget_eur: 300, results: "", start_date: "2026-11-01", end_date: "2026-12-31", goal_id: "g", objective: "", audience: "Offices", channels: ["linkedin"] };
const row = (kind: "spend" | "commitment" | "release" | "correction", amount: number, data_class: "manual" | "simulated") => ({ campaign_id: "c1", kind, amount, currency: "EUR", occurred_on: "2026-11-10", data_class });
const SIM = [row("spend", 310, "simulated"), row("commitment", 50, "simulated")];
const REAL = [row("spend", 310, "manual")];
const tasks = [{ status: "todo", due_date: "2026-12-10", campaign_id: "c1" }];

function judge(ledger: ReturnType<typeof row>[]) {
  const s = spendSummary(camp.budget_eur, ledger);
  const health = campaignHealth(camp, tasks, TODAY, s);
  const intel = campaignIntel({ campaign: camp, tasks, spend: s, metrics: [], measurements: [], attributed: null, experiments: [], others: [], today: TODAY } as IntelInput);
  const line = campaignLines([camp], tasks.map((t) => ({ ...t, id: "t" })) as never, ledger, TODAY)[0]!;
  const situation = growthSituation({ today: TODAY, facts: [{ verified: true }], factsComplete: true, conflicts: 0, opportunities: [], revenue: [], spend: ledger, deals: [], tasks: [], runs: [],
    campaigns: [{ status: camp.status, state: health.state, overBudget: isRealOverrun(s), simulatedOverBudget: s.simulatedWarnings.includes("budget_over") }],
    experiments: [], reviews: null, budget: [], metrics: 0, measuredRecently: 0, purchaseCostsRecorded: false });
  const ok = <T,>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
  const d = { workspace: { id: "w", name: "Main" }, objectives: null, facts: [], goals: [], recommendations: [], plans: ok([]), initiatives: [], operations: [], projects: [], tasks: [],
    budget: ok([]), deals: ok([]), competitors: ok([]), observations: [], seo: ok([]), content: ok([]), versions: [], decisions: [], campaigns: ok([camp]), connections: ok([]), metrics: ok([]), measurements: [],
    campaignSpend: ok(ledger) } as unknown as BusinessDomains;
  const signals = detectSignals(d, new Date(`${TODAY}T08:00:00Z`)).map((x) => x.code);
  return { s, health, intel, line, situation, signals, figures: spendFigures(ledger, { from: "2026-11-01", to: "2026-11-30" } as never) };
}

describe("campaign money is classified the same everywhere", () => {
  it("a simulated overrun is never a real overrun in any component", () => {
    const j = judge(SIM);
    expect(j.s.warnings).toEqual([]);
    expect(j.s.simulatedWarnings).toEqual(["budget_over"]);
    expect(j.health.state).not.toBe("at_risk");
    expect(j.intel.problems).not.toContain("budget_over");
    expect(j.intel.figures.spent.value).toBeNull();
    expect(j.intel.simulated).toEqual({ entries: 2, spent: 310, committed: 50, warnings: ["budget_over"] });
    expect(j.line.over).toBe(false);
    expect(j.line.spentEur).toBe(0);
    expect(j.line.simulatedEur).toBe(310);
    expect(j.situation.priorities.map((p) => p.code)).not.toContain("over_budget");
    expect(j.signals).not.toContain("campaign_budget_over");
    expect(j.figures.spent).toEqual({});
    expect(j.figures.simulatedSpent).toEqual({ EUR: 310 });
  });
  it("the same amounts entered as actual spending are a real overrun in every component", () => {
    const j = judge(REAL);
    expect(j.s.warnings).toEqual(["budget_over"]);
    expect(j.health.state).toBe("at_risk");
    expect(j.intel.problems).toContain("budget_over");
    expect(j.line.over).toBe(true);
    expect(j.situation.priorities.map((p) => p.code)).toContain("over_budget");
    expect(j.signals).toContain("campaign_budget_over");
    expect(j.figures.spent).toEqual({ EUR: 310 });
  });
  it("a reservation is not expenditure and a missing ledger is not zero", () => {
    const s = spendSummary(300, [row("commitment", 250, "manual")]);
    expect(s.eur.spent).toBe(0);
    expect(s.warnings).toEqual(["budget_near"]);
    expect(campaignLines([camp], [], null, TODAY)[0]!.spentEur).toBeNull();
    const intel = campaignIntel({ campaign: camp, tasks, spend: null, metrics: [], measurements: [], attributed: null, experiments: [], others: [], today: TODAY } as IntelInput);
    expect(intel.figures.spent).toMatchObject({ value: null, missing: "no_ledger" });
  });
});
