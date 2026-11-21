// Growth Situation Analysis (pure). One structured picture of the business from records already read under the
// caller's RLS: each section has a status, findings with their source and reliability, and what is missing.
// Statuses follow fixed rules; a section without data is "unknown", never "good". Costs no credits.
import { periods, revenueFigures, type RevenueRow } from "@/lib/reports";
import { isExpenditure, isSimulatedSpend } from "@/lib/campaign-spend";

export type SectionKey = "health" | "potential" | "problems" | "financial" | "marketing" | "sales" | "customers" | "execution" | "resources" | "risks";
export type Status = "good" | "attention" | "problem" | "unknown";
export type Reliability = "verified" | "recorded" | "entered" | "estimated" | "simulated" | "computed" | "rule";
export type Finding = { code: string; params?: Record<string, string | number>; source: string; reliability: Reliability; weight: number };
export type Section = { key: SectionKey; status: Status; findings: Finding[]; missing: string[] };
export type Situation = { sections: Section[]; priorities: (Finding & { section: SectionKey })[]; asOf: string };

export type SituationInput = {
  today: string;
  facts: readonly { verified: boolean }[];
  factsComplete: boolean;
  conflicts: number | null;
  opportunities: readonly { status: string; impact: number; confidence: string }[];
  revenue: readonly (RevenueRow & { customer_ref?: string; kind: string })[];
  spend: readonly { kind: string; amount: number | string; currency: string; occurred_on: string; data_class: string }[] | null;
  deals: readonly { stage: string; value: number | string; currency: string }[];
  tasks: readonly { status: string; due_date: string | null; updated_at: string }[];
  runs: readonly { status: string; created_at: string }[];
  /** overBudget: a real overrun from actual entries; simulatedOverBudget: an overrun that exists only with simulated entries. */
  campaigns: readonly { status: string; state: string; overBudget: boolean; simulatedOverBudget?: boolean }[];
  experiments: readonly { status: string; outcome?: string | null; result_data_class?: string | null }[];
  reviews: readonly { verdict: string }[] | null;
  budget: readonly { planned: number; actual: number; currency: string; period_month: string }[];
  metrics: number;
  measuredRecently: number;
  purchaseCostsRecorded: boolean;
};

const open = (s: string) => s !== "done" && s !== "cancelled";
const statusOf = (f: Finding[], hasData: boolean): Status =>
  !hasData ? "unknown" : f.some((x) => x.weight >= 3) ? "problem" : f.some((x) => x.weight === 2) ? "attention" : "good";

export function growthSituation(i: SituationInput): Situation {
  const { current, previous } = periods("30d", i.today);
  const sections: Section[] = [];
  const add = (key: SectionKey, findings: Finding[], missing: string[], hasData: boolean) => sections.push({ key, status: statusOf(findings, hasData), findings, missing });

  // Business health: the confirmed knowledge the analysis can rely on.
  const verified = i.facts.filter((f) => f.verified).length;
  const hf: Finding[] = [{ code: "facts", params: { v: verified, n: i.facts.length }, source: "business_knowledge", reliability: "verified", weight: verified ? 0 : 2 }];
  if (i.conflicts) hf.push({ code: "conflicts", params: { n: i.conflicts }, source: "business_knowledge", reliability: "rule", weight: 2 });
  add("health", hf, [...(i.factsComplete ? [] : ["facts_incomplete"]), ...(verified ? [] : ["verified_facts"])], i.facts.length > 0);

  // Growth potential: open opportunities and what experiments taught.
  const openOpp = i.opportunities.filter((o) => !["rejected", "archived", "completed", "dismissed"].includes(o.status));
  const strong = openOpp.filter((o) => o.impact >= 4).length;
  const won = i.experiments.filter((e) => e.status === "completed" && e.outcome === "successful" && e.result_data_class !== "simulated").length;
  const pf: Finding[] = [{ code: "opportunities", params: { n: openOpp.length, s: strong }, source: "opportunities", reliability: "rule", weight: 0 }];
  if (won) pf.push({ code: "experiments_won", params: { n: won }, source: "experiments", reliability: "recorded", weight: 0 });
  add("potential", pf, openOpp.length ? [] : ["opportunities"], openOpp.length > 0 || won > 0);

  // Execution health: is the plan actually being carried out?
  const openTasks = i.tasks.filter((t) => open(t.status));
  const overdue = openTasks.filter((t) => t.due_date !== null && t.due_date < i.today).length;
  const doneRecently = i.tasks.filter((t) => t.status === "done" && t.updated_at.slice(0, 10) >= current.from).length;
  const failedRuns = i.runs.filter((r) => (r.status === "failed" || r.status === "uncertain") && r.created_at.slice(0, 10) >= current.from).length;
  const ef: Finding[] = [{ code: "tasks", params: { o: openTasks.length, d: doneRecently }, source: "tasks", reliability: "recorded", weight: 0 }];
  if (overdue) ef.push({ code: "overdue", params: { n: overdue }, source: "tasks", reliability: "recorded", weight: overdue >= 3 || overdue > openTasks.length / 3 ? 3 : 2 });
  if (failedRuns) ef.push({ code: "failed_runs", params: { n: failedRuns }, source: "ai_runs", reliability: "recorded", weight: 2 });
  add("execution", ef, i.tasks.length ? [] : ["tasks"], i.tasks.length > 0);

  // Marketing performance: campaign states from their own records and spending.
  const live = i.campaigns.filter((c) => c.status === "active" || c.status === "paused" || c.status === "planned");
  const atRisk = live.filter((c) => c.state === "at_risk").length;
  const over = i.campaigns.filter((c) => c.overBudget).length;
  const overSim = i.campaigns.filter((c) => !c.overBudget && c.simulatedOverBudget).length;
  const mf: Finding[] = [{ code: "campaigns", params: { n: live.length, r: atRisk }, source: "campaigns", reliability: "rule", weight: atRisk ? 3 : live.some((c) => c.state === "needs_attention") ? 2 : 0 }];
  if (over) mf.push({ code: "over_budget", params: { n: over }, source: "spend_ledger", reliability: "recorded", weight: 3 });
  if (overSim) mf.push({ code: "over_budget", params: { n: overSim }, source: "spend_ledger", reliability: "simulated", weight: 1 });
  const mMissing = [...(i.metrics ? [] : ["metrics"]), ...(i.measuredRecently ? [] : ["measurements"])];
  add("marketing", mf, mMissing, i.campaigns.length > 0);

  // Financial position per currency, current 30 days against the 30 before; estimates never count.
  const now = revenueFigures(i.revenue, current).recorded;
  const before = revenueFigures(i.revenue, previous).recorded;
  const ff: Finding[] = Object.entries(now).map(([c, m]) => {
    const b = before[c]?.net ?? 0;
    const rows = i.revenue.filter((r) => r.currency === c && r.data_class !== "estimated");
    const reliability: Reliability = rows.length > 0 && rows.every((r) => r.data_class === "imported") ? "recorded" : "entered";
    return { code: "net_revenue", params: { c, v: m.net, b }, source: "revenue_ledger", reliability, weight: b > 0 && m.net < b * 0.8 ? 2 : 0 };
  });
  if (i.spend) {
    // Actual and simulated expenditure are summed apart (shared rule in campaign-spend.ts).
    const sum = (sim: boolean) => Math.round(i.spend!.filter((s) => s.currency === "EUR" && isExpenditure(s as { kind: "spend" }) && isSimulatedSpend(s as { data_class: "manual" }) === sim && s.occurred_on >= current.from).reduce((n, s) => n + Number(s.amount), 0) * 100) / 100;
    const actual = sum(false), simulated = sum(true);
    if (actual) ff.push({ code: "spend", params: { v: actual }, source: "spend_ledger", reliability: "entered", weight: 0 });
    if (simulated) ff.push({ code: "spend", params: { v: simulated }, source: "spend_ledger", reliability: "simulated", weight: 0 });
  }
  const fMissing = [...(Object.keys(now).length ? [] : ["revenue"]), ...(i.purchaseCostsRecorded ? [] : ["purchase_costs"]), ...(i.spend ? [] : ["spend"])];
  add("financial", ff, fMissing, Object.keys(now).length > 0);

  // Sales: pipeline outcomes.
  const won2 = i.deals.filter((d) => d.stage === "won").length;
  const lost = i.deals.filter((d) => d.stage === "lost").length;
  const openDeals = i.deals.filter((d) => d.stage !== "won" && d.stage !== "lost").length;
  const sf: Finding[] = i.deals.length ? [{ code: "deals", params: { o: openDeals, w: won2, l: lost }, source: "pipeline", reliability: "entered", weight: lost > won2 && lost >= 3 ? 2 : 0 }] : [];
  add("sales", sf, i.deals.length ? [] : ["deals"], i.deals.length > 0);

  // Customers: repeat buyers, only when sales carry a customer reference.
  const sales = i.revenue.filter((r) => r.kind === "sale" && r.data_class !== "estimated");
  const withRef = sales.filter((r) => (r.customer_ref ?? "").trim());
  const counts = new Map<string, number>();
  for (const r of withRef) counts.set(r.customer_ref!, (counts.get(r.customer_ref!) ?? 0) + 1);
  const repeat = [...counts.values()].filter((n) => n > 1).length;
  const cf: Finding[] = withRef.length ? [{ code: "customers", params: { n: counts.size, r: repeat }, source: "revenue_ledger", reliability: "recorded", weight: 0 }] : [];
  add("customers", cf, withRef.length ? [] : ["customer_refs"], withRef.length > 0);

  // Resources: budget lines and the quality of AI work.
  const rf: Finding[] = [];
  const month = i.today.slice(0, 7);
  for (const b of i.budget.filter((x) => x.period_month.slice(0, 7) === month)) {
    if (b.planned > 0 && b.actual > b.planned) rf.push({ code: "budget_line_over", params: { c: b.currency, a: b.actual, p: b.planned }, source: "budget", reliability: "entered", weight: 2 });
  }
  if (i.reviews) {
    const unreliable = i.reviews.filter((r) => r.verdict === "unreliable").length;
    rf.push({ code: "reviews", params: { n: i.reviews.length, u: unreliable }, source: "quality_control", reliability: "rule", weight: unreliable ? 2 : 0 });
  }
  add("resources", rf, i.budget.length ? [] : ["budget"], i.budget.length > 0 || (i.reviews?.length ?? 0) > 0);

  // Problems and risks collect the weighted findings above, so nothing is counted twice in the priorities.
  const all = sections.flatMap((s) => s.findings.map((f) => ({ ...f, section: s.key })));
  const problems = all.filter((f) => f.weight >= 2);
  sections.splice(2, 0, { key: "problems", status: problems.length ? (problems.some((p) => p.weight >= 3) ? "problem" : "attention") : "good", findings: problems.map(({ section: _s, ...f }) => f), missing: [] });
  const riskFindings: Finding[] = [];
  const missingCore = sections.filter((s) => s.status === "unknown").length;
  if (missingCore >= 3) riskFindings.push({ code: "blind_spots", params: { n: missingCore }, source: "situation", reliability: "rule", weight: 2 });
  if (i.conflicts) riskFindings.push({ code: "disputed_facts", params: { n: i.conflicts }, source: "business_knowledge", reliability: "rule", weight: 2 });
  if (over) riskFindings.push({ code: "budget_risk", params: { n: over }, source: "spend_ledger", reliability: "recorded", weight: 3 });
  sections.push({ key: "risks", status: riskFindings.length ? (riskFindings.some((r) => r.weight >= 3) ? "problem" : "attention") : "good", findings: riskFindings, missing: [] });
  const priorities = [...problems, ...riskFindings.filter((r) => r.code === "blind_spots").map((f) => ({ ...f, section: "risks" as const }))]
    .sort((a, b) => b.weight - a.weight).slice(0, 3);
  return { sections, priorities, asOf: i.today };
}
