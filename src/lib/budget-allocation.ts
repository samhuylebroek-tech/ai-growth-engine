// Unified budget economics (pure) over the budget lines, campaign allocations and the campaign spend ledger
// (proposal 0084). Every amount keeps one classification and one currency:
//   total = planned on budget lines; allocated = active campaign allocations; unallocated = total - allocated;
//   spent = actual spend + corrections paid from a line; reserved = actual open reservations on a line;
//   simulated amounts are reported apart and never enter actual totals; remaining = total - spent - reserved;
//   "recorded on the line" (the older manual field) is shown separately and never added to ledger spending.
// A forecast is a straight-line estimate from actual spending only. Nothing is converted between currencies.
import type {
  CampaignBudgetAllocationRow,
  CampaignSpendRow,
  BudgetAllocationRejection,
} from "@/lib/pending-schema";

export type LineLike = {
  id: string;
  channel: string;
  period_month: string;
  planned: number | string;
  actual: number | string;
  currency: string;
  goal_id?: string | null;
  initiative_id?: string | null;
  unit_id?: string | null;
};
export type CampaignLike = {
  id: string;
  title: string;
  status: string;
  goal_id?: string | null;
  initiative_id?: string | null;
  strategy_id?: string | null;
  unit_id?: string | null;
};
type Alloc = Pick<
  CampaignBudgetAllocationRow,
  "budget_line_id" | "campaign_id" | "amount" | "status"
>;
type Spend = Pick<CampaignSpendRow, "campaign_id" | "kind" | "amount" | "data_class"> & {
  budget_line_id?: string | null;
};

const c2 = (n: number) => Math.round(n * 100) / 100;
const isSpent = (k: Spend["kind"]) => k === "spend" || k === "correction";

export type CampaignShare = {
  campaignId: string;
  amount: number;
  spent: number;
  reserved: number;
  simulatedSpent: number;
  simulatedReserved: number;
  available: number;
};
export type LineEconomics = {
  id: string;
  channel: string;
  currency: string;
  month: string;
  planned: number;
  allocated: number;
  unallocated: number;
  overcommitted: number;
  spent: number;
  reserved: number;
  simulatedSpent: number;
  simulatedReserved: number;
  recordedOnLine: number;
  overlap: boolean;
  campaigns: CampaignShare[];
};

export function lineEconomics(
  line: LineLike,
  allocations: readonly Alloc[],
  spend: readonly Spend[],
): LineEconomics {
  const mine = allocations.filter((a) => a.budget_line_id === line.id && a.status === "active");
  const paid = spend.filter((s) => s.budget_line_id === line.id);
  const share = (campaignId: string, amount: number): CampaignShare => {
    const rows = paid.filter((s) => s.campaign_id === campaignId);
    const sum = (cls: "manual" | "simulated", spent: boolean) =>
      c2(
        rows
          .filter((r) => r.data_class === cls && isSpent(r.kind) === spent)
          .reduce((t, r) => t + Number(r.amount), 0),
      );
    const spent = sum("manual", true),
      reserved = sum("manual", false);
    return {
      campaignId,
      amount,
      spent,
      reserved,
      simulatedSpent: sum("simulated", true),
      simulatedReserved: sum("simulated", false),
      available: c2(amount - spent - reserved),
    };
  };
  const ids = [...new Set([...mine.map((a) => a.campaign_id), ...paid.map((s) => s.campaign_id)])];
  const campaigns = ids.map((id) =>
    share(id, Number(mine.find((a) => a.campaign_id === id)?.amount ?? 0)),
  );
  const planned = Number(line.planned);
  const allocated = c2(campaigns.reduce((t, c) => t + c.amount, 0));
  const total = (k: keyof CampaignShare) => c2(campaigns.reduce((t, c) => t + Number(c[k]), 0));
  const recordedOnLine = Number(line.actual) || 0;
  const spent = total("spent");
  return {
    id: line.id,
    channel: line.channel,
    currency: line.currency,
    month: line.period_month,
    planned,
    allocated,
    unallocated: c2(Math.max(0, planned - allocated)),
    overcommitted: c2(Math.max(0, allocated - planned)),
    spent,
    reserved: total("reserved"),
    simulatedSpent: total("simulatedSpent"),
    simulatedReserved: total("simulatedReserved"),
    recordedOnLine,
    overlap: recordedOnLine > 0 && paid.some((s) => s.data_class === "manual"),
    campaigns,
  };
}

export type CurrencyEconomics = {
  currency: string;
  total: number;
  allocated: number;
  unallocated: number;
  overcommitted: number;
  spent: number;
  reserved: number;
  simulatedSpent: number;
  simulatedReserved: number;
  remaining: number;
  recordedOnLines: number;
  lines: number;
};

export function budgetEconomics(
  lines: readonly LineLike[],
  allocations: readonly Alloc[],
  spend: readonly Spend[],
) {
  const perLine = lines.map((l) => lineEconomics(l, allocations, spend));
  const byCurrency: Record<string, CurrencyEconomics> = {};
  for (const l of perLine) {
    const t = (byCurrency[l.currency] ??= {
      currency: l.currency,
      total: 0,
      allocated: 0,
      unallocated: 0,
      overcommitted: 0,
      spent: 0,
      reserved: 0,
      simulatedSpent: 0,
      simulatedReserved: 0,
      remaining: 0,
      recordedOnLines: 0,
      lines: 0,
    });
    t.total = c2(t.total + l.planned);
    t.allocated = c2(t.allocated + l.allocated);
    t.unallocated = c2(t.unallocated + l.unallocated);
    t.overcommitted = c2(t.overcommitted + l.overcommitted);
    t.spent = c2(t.spent + l.spent);
    t.reserved = c2(t.reserved + l.reserved);
    t.simulatedSpent = c2(t.simulatedSpent + l.simulatedSpent);
    t.simulatedReserved = c2(t.simulatedReserved + l.simulatedReserved);
    t.recordedOnLines = c2(t.recordedOnLines + l.recordedOnLine);
    t.lines += 1;
    t.remaining = c2(t.total - t.spent - t.reserved);
  }
  return { lines: perLine, byCurrency };
}

/** Straight-line estimate of the month's actual spending; null without actual spending or outside the month. */
export function monthForecast(spent: number, elapsedShare: number): number | null {
  if (spent <= 0 || elapsedShare <= 0 || elapsedShare >= 1) return null;
  return c2(spent / elapsedShare);
}

export type GroupKey = "goal_id" | "initiative_id" | "strategy_id";
/** Allocations and spending grouped by a campaign link (drill-down business → goal/strategy/initiative → campaign). */
export function groupAllocations(
  lines: readonly LineEconomics[],
  campaigns: readonly CampaignLike[],
  key: GroupKey,
) {
  const out = new Map<
    string | null,
    Record<string, { allocated: number; spent: number; reserved: number; campaigns: Set<string> }>
  >();
  for (const l of lines)
    for (const s of l.campaigns) {
      const c = campaigns.find((x) => x.id === s.campaignId);
      const g = (c?.[key] as string | null | undefined) ?? null;
      const m = out.get(g) ?? {};
      out.set(g, m);
      const t = (m[l.currency] ??= { allocated: 0, spent: 0, reserved: 0, campaigns: new Set() });
      t.allocated = c2(t.allocated + s.amount);
      t.spent = c2(t.spent + s.spent);
      t.reserved = c2(t.reserved + s.reserved);
      t.campaigns.add(s.campaignId);
    }
  return out;
}

const CLOSED = ["completed", "cancelled", "archived"];
/**
 * Preview of the database decision for setting one campaign's allocation on a line, in the same rule order as
 * apply_budget_allocation. The database stays the authority; this only explains before submitting.
 */
export function previewAllocation(
  line: LineLike & {
    goal_id?: string | null;
    initiative_id?: string | null;
    unit_id?: string | null;
  },
  econ: LineEconomics,
  campaign: CampaignLike,
  amount: number,
): BudgetAllocationRejection | null {
  const share = econ.campaigns.find((c) => c.campaignId === campaign.id);
  const cur = share?.amount ?? 0;
  const committed = share ? c2(share.spent + share.reserved) : 0;
  const diff = c2(amount - cur);
  if (diff === 0) return "no_change";
  if (amount < committed) return "below_committed";
  if (diff > 0 && CLOSED.includes(campaign.status)) return "campaign_closed";
  if (
    diff > 0 &&
    ((line.goal_id && campaign.goal_id !== line.goal_id) ||
      (line.initiative_id && campaign.initiative_id !== line.initiative_id) ||
      (line.unit_id && campaign.unit_id !== line.unit_id))
  )
    return "earmark_mismatch";
  const unallocated = c2(econ.planned - econ.allocated);
  if (diff > 0 && diff > unallocated) return "exceeds_unallocated";
  return null;
}
