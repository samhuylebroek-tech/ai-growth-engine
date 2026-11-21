// Canonical KPI definitions (pure). One entry per indicator computed by `computeKpis` in ./kpis.ts: the inputs it
// reads, its formula as language-neutral tokens, its unit and which direction is better. Screens and the Growth
// Officer show these definitions next to a figure, so a KPI means the same thing wherever it appears. A test checks
// that every definition names exactly the inputs the calculation reports, so the two cannot drift apart.
import type { KpiKey } from "./kpis";

/** A formula token: an operator or constant, a recorded input (bi.input.*) or a derived term (bi.kterm.*). */
export type FormulaToken = string | { in: string } | { term: string };
export type KpiDefinition = { key: KpiKey; inputs: readonly string[]; formula: readonly FormulaToken[]; better: "higher" | "lower" };

const i = (k: string) => ({ in: k });
const term = (k: string) => ({ term: k });
const D = (key: KpiKey, inputs: string[], formula: FormulaToken[], better: "higher" | "lower"): KpiDefinition => ({ key, inputs, formula, better });

export const KPI_DEFINITIONS: Record<KpiKey, KpiDefinition> = {
  ctr: D("ctr", ["clicks", "impressions"], [i("clicks"), "÷", i("impressions"), "× 100"], "higher"),
  cpc: D("cpc", ["ad_spend", "clicks"], [i("ad_spend"), "÷", i("clicks")], "lower"),
  cpm: D("cpm", ["ad_spend", "impressions"], [i("ad_spend"), "÷", i("impressions"), "× 1000"], "lower"),
  cost_per_lead: D("cost_per_lead", ["ad_spend", "leads"], [i("ad_spend"), "÷", i("leads")], "lower"),
  cost_per_acquisition: D("cost_per_acquisition", ["ad_spend", "conversions"], [i("ad_spend"), "÷", i("conversions")], "lower"),
  lead_qualification_rate: D("lead_qualification_rate", ["qualified_leads", "leads"], [i("qualified_leads"), "÷", i("leads"), "× 100"], "higher"),
  lead_to_customer_rate: D("lead_to_customer_rate", ["new_customers", "leads"], [i("new_customers"), "÷", i("leads"), "× 100"], "higher"),
  churn_rate: D("churn_rate", ["churned_customers", "active_customers"], [i("churned_customers"), "÷", i("active_customers"), "× 100"], "lower"),
  retention_rate: D("retention_rate", ["churned_customers", "active_customers"], ["100 −", i("churned_customers"), "÷", i("active_customers"), "× 100"], "higher"),
  repeat_rate: D("repeat_rate", ["returning_customers", "active_customers"], [i("returning_customers"), "÷", i("active_customers"), "× 100"], "higher"),
  cac: D("cac", ["marketing_cost", "new_customers"], [i("marketing_cost"), "÷", i("new_customers")], "lower"),
  roas: D("roas", ["ad_spend", "attributed_revenue"], [i("attributed_revenue"), "÷", i("ad_spend")], "higher"),
  roi: D("roi", ["marketing_cost", "attributed_revenue"], ["(", i("attributed_revenue"), "−", i("marketing_cost"), ")", "÷", i("marketing_cost"), "× 100"], "higher"),
  payback_months: D("payback_months", ["marketing_cost", "new_customers", "gross_margin", "active_customers", "attributed_revenue"],
    ["(", i("marketing_cost"), "÷", i("new_customers"), ")", "÷", "(", i("attributed_revenue"), "÷", term("months"), "÷", i("active_customers"), "×", i("gross_margin"), "÷ 100", ")"], "lower"),
  win_rate: D("win_rate", ["deals"], [term("won_deals"), "÷", "(", term("won_deals"), "+", term("lost_deals"), ")", "× 100"], "higher"),
  average_deal_value: D("average_deal_value", ["deals"], [term("won_value"), "÷", term("won_deals")], "higher"),
  closed_won_value: D("closed_won_value", ["deals"], [term("won_value")], "higher"),
  sales_cycle_days: D("sales_cycle_days", ["deals"], [term("cycle_days")], "lower"),
  pipeline_value: D("pipeline_value", ["deals"], [term("open_value")], "higher"),
};

/** Plain-text formula for prompts and logs, with labels supplied by the caller (translated on screens). */
export function formulaText(d: KpiDefinition, label: (t: { in: string } | { term: string }) => string = (t) => ("in" in t ? t.in : t.term)): string {
  return d.formula.map((t) => (typeof t === "string" ? t : label(t))).join(" ").replace(/\( /g, "(").replace(/ \)/g, ")");
}
