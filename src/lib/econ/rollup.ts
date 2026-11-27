// Canonical growth economics rollup (pure). ONE RULE: every amount enters at exactly one atom —
//   * campaign ledger rows (campaign_spend_entries) at their campaign;
//   * business cost rows (business_cost_entries) at their initiative when they name one, otherwise at the business;
//   * AI credits at the campaign of the task that used them, otherwise "not linked to a campaign";
//   * budget lines and allocations are budget (money planned), never spending.
// A parent level (initiative, strategy, goal, business) is the sum of its own direct atoms plus each linked campaign
// exactly once. A campaign has at most one initiative, strategy and goal, so it can never be added twice to a level,
// and an initiative's total never adds its campaigns' spending a second time. Currencies are never added together;
// actual, simulated and reserved amounts stay apart; estimated business costs are kept apart from recorded ones.
export type EconCampaign = {
  id: string;
  title: string;
  status: string;
  goal_id?: string | null;
  initiative_id?: string | null;
  strategy_id?: string | null;
};
export type EconAlloc = {
  campaign_id: string;
  amount: number | string;
  status: string;
  currency: string;
};
export type EconSpend = {
  campaign_id: string;
  kind: string;
  amount: number | string;
  currency: string;
  data_class: string;
  category?: string | null;
};
export type EconCost = {
  kind: string;
  category: string;
  amount: number | string;
  currency: string;
  data_class: string;
  initiative_id: string | null;
  period_start: string;
  period_end: string;
};
export type EconCredit = {
  campaign_id: string | null;
  credits: number;
  state: "charged" | "pending" | "uncertain";
};

export type Money = Record<string, number>;
export type Totals = {
  allocated: Money;
  spent: Money;
  reserved: Money;
  simulatedSpent: Money;
  simulatedReserved: Money;
  spentByCategory: Record<string, Money>;
  directCosts: Money;
  estimatedCosts: Money;
  simulatedCosts: Money;
  costsByCategory: Record<string, Money>;
  credits: number;
  pendingCredits: number;
  uncertainRuns: number;
  campaigns: number;
};
const c2 = (n: number) => Math.round(n * 100) / 100;
const add = (m: Money, cur: string, v: number) => {
  m[cur] = c2((m[cur] ?? 0) + v);
};
const empty = (): Totals => ({
  allocated: {},
  spent: {},
  reserved: {},
  simulatedSpent: {},
  simulatedReserved: {},
  spentByCategory: {},
  directCosts: {},
  estimatedCosts: {},
  simulatedCosts: {},
  costsByCategory: {},
  credits: 0,
  pendingCredits: 0,
  uncertainRuns: 0,
  campaigns: 0,
});
const isSpent = (k: string) => k === "spend" || k === "correction";

function addCampaign(
  t: Totals,
  id: string,
  allocs: readonly EconAlloc[],
  spend: readonly EconSpend[],
  credits: readonly EconCredit[],
) {
  t.campaigns += 1;
  for (const a of allocs)
    if (a.campaign_id === id && a.status === "active")
      add(t.allocated, a.currency, Number(a.amount));
  for (const s of spend) {
    if (s.campaign_id !== id) continue;
    const v = Number(s.amount),
      sim = s.data_class === "simulated";
    if (isSpent(s.kind)) {
      add(sim ? t.simulatedSpent : t.spent, s.currency, v);
      if (!sim) add((t.spentByCategory[s.category ?? "marketing"] ??= {}), s.currency, v);
    } else add(sim ? t.simulatedReserved : t.reserved, s.currency, v);
  }
  for (const c of credits) if (c.campaign_id === id) addCredit(t, c);
}
function addCredit(t: Totals, c: EconCredit) {
  if (c.state === "charged") t.credits += c.credits;
  else if (c.state === "pending") t.pendingCredits += c.credits;
  else t.uncertainRuns += 1;
}
function addCost(t: Totals, c: EconCost) {
  const v = Number(c.amount);
  const bucket =
    c.data_class === "simulated"
      ? t.simulatedCosts
      : c.data_class === "estimated"
        ? t.estimatedCosts
        : t.directCosts;
  add(bucket, c.currency, v);
  if (c.data_class !== "simulated" && c.data_class !== "estimated")
    add((t.costsByCategory[c.category] ??= {}), c.currency, v);
}

export type Level = "campaign" | "initiative" | "strategy" | "goal" | "business";
export type RollupInput = {
  campaigns: readonly EconCampaign[];
  allocations: readonly EconAlloc[];
  spend: readonly EconSpend[];
  costs: readonly EconCost[];
  credits: readonly EconCredit[];
};

/** Totals for one record at one level, by the canonical rule. */
export function rollup(level: Level, id: string | null, i: RollupInput): Totals {
  const t = empty();
  const linked =
    level === "business"
      ? i.campaigns
      : level === "campaign"
        ? i.campaigns.filter((c) => c.id === id)
        : i.campaigns.filter(
            (c) =>
              (level === "initiative"
                ? c.initiative_id
                : level === "strategy"
                  ? c.strategy_id
                  : c.goal_id) === id,
          );
  const seen = new Set<string>();
  for (const c of linked) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    addCampaign(t, c.id, i.allocations, i.spend, i.credits);
  }
  if (level === "business") {
    for (const c of i.costs) addCost(t, c);
    for (const c of i.credits) if (!c.campaign_id || !seen.has(c.campaign_id)) addCredit(t, c);
  } else if (level === "initiative") {
    for (const c of i.costs) if (c.initiative_id === id) addCost(t, c);
  }
  return t;
}

/** Business AI credits that no campaign carries (shown separately, never spread over campaigns). */
export const unlinkedCredits = (
  credits: readonly EconCredit[],
  campaigns: readonly EconCampaign[],
) => {
  const ids = new Set(campaigns.map((c) => c.id));
  return credits
    .filter((c) => c.state === "charged" && (!c.campaign_id || !ids.has(c.campaign_id)))
    .reduce((n, c) => n + c.credits, 0);
};

export type InputState = "recorded" | "missing" | "estimated" | "simulated_only";
/** Which financial inputs a campaign or initiative has, without guessing the missing ones. */
export function completeness(t: Totals, extra: { attributedRevenue: boolean; priced: boolean }) {
  const has = (m: Money) => Object.values(m).some((v) => v !== 0);
  const spend: InputState = has(t.spent)
    ? "recorded"
    : has(t.simulatedSpent)
      ? "simulated_only"
      : "missing";
  const costs: InputState = has(t.directCosts)
    ? "recorded"
    : has(t.estimatedCosts)
      ? "estimated"
      : has(t.simulatedCosts)
        ? "simulated_only"
        : "missing";
  return {
    budget: (has(t.allocated) ? "recorded" : "missing") as InputState,
    spend,
    costs,
    revenue: (extra.attributedRevenue ? "recorded" : "missing") as InputState,
    ai: (t.credits === 0 ? "missing" : extra.priced ? "recorded" : "estimated") as InputState,
  };
}

/** The AI credit atoms one level counts, by the same rule as rollup(): a campaign its own; an initiative, strategy
 *  or goal those of its linked campaigns, each campaign once; the business all of them. Used to value AI work. */
export function creditAtoms<T extends EconCredit>(
  level: Level,
  id: string | null,
  campaigns: readonly EconCampaign[],
  credits: readonly T[],
): T[] {
  if (level === "business") return [...credits];
  const key =
    level === "initiative"
      ? "initiative_id"
      : level === "strategy"
        ? "strategy_id"
        : level === "goal"
          ? "goal_id"
          : "id";
  const ids = new Set(campaigns.filter((c) => c[key] === id).map((c) => c.id));
  return credits.filter((c) => c.campaign_id !== null && ids.has(c.campaign_id));
}
