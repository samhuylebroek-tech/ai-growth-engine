export type BudgetLine = { planned: number; actual: number; hard_cap: number | null };
/** Progress from the measured baseline toward the target, 0–100, or null when not measurable. */
export function goalProgress(
  baseline: number | null,
  target: number | null,
  current: number | null,
): number | null {
  // A missing baseline is unknown, never zero: without it progress cannot be measured.
  if (target == null || current == null || baseline == null) return null;
  const b = baseline;
  if (target === b) return current >= target ? 100 : 0;
  const p = ((current - b) / (target - b)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}
export function budgetTotals(lines: BudgetLine[]) {
  const planned = lines.reduce((s, l) => s + Number(l.planned), 0);
  const actual = lines.reduce((s, l) => s + Number(l.actual), 0);
  return { planned, actual, remaining: planned - actual, variance: actual - planned };
}
/** Alert level for one line: over cap is critical, over plan is warning, ≥80% of plan is notice. */
export function budgetAlert(l: BudgetLine): "over_cap" | "over_plan" | "near_plan" | null {
  if (l.hard_cap != null && l.actual > l.hard_cap) return "over_cap";
  if (l.planned > 0 && l.actual > l.planned) return "over_plan";
  if (l.planned > 0 && l.actual >= l.planned * 0.8) return "near_plan";
  return null;
}

export type Reallocation = {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  amount: number;
  reason: string;
};
type PlanLine = {
  id: string;
  channel: string;
  planned: number | string;
  actual: number | string;
  hard_cap: number | string | null;
  currency?: string;
};
/**
 * Rule-based proposals (no AI): when at least half the month has passed, move unused planned budget
 * from lines that used under 50% of plan to lines already over plan. Never exceeds the receiving
 * line's hard cap and never moves money already spent. Total planned budget stays the same.
 */
export function reallocationProposals(lines: PlanLine[], monthElapsed: number): Reallocation[] {
  if (monthElapsed < 0.5) return [];
  const n = (v: number | string | null) => (v == null ? null : Number(v));
  const donors = lines
    .map((l) => ({ l, spare: Number(l.planned) - Number(l.actual) }))
    .filter(
      ({ l, spare }) =>
        Number(l.planned) > 0 && Number(l.actual) / Number(l.planned) < 0.5 && spare > 0,
    )
    .map((d) => ({ ...d, spare: Math.floor(d.spare * 0.5) }))
    .filter((d) => d.spare > 0);
  const takers = lines
    .map((l) => ({
      l,
      need: Number(l.actual) - Number(l.planned),
      room: n(l.hard_cap) == null ? Infinity : n(l.hard_cap)! - Number(l.planned),
    }))
    .filter((t) => t.need > 0 && t.room > 0)
    .sort((a, b) => b.need - a.need);
  const out: Reallocation[] = [];
  for (const t of takers) {
    let need = Math.min(t.need, t.room);
    for (const d of donors) {
      if (need <= 0) break;
      if ((d.l.currency ?? "EUR") !== (t.l.currency ?? "EUR")) continue; // money never moves between currencies
      const amount = Math.min(need, d.spare);
      if (amount <= 0) continue;
      d.spare -= amount;
      need -= amount;
      out.push({
        fromId: d.l.id,
        toId: t.l.id,
        from: d.l.channel,
        to: t.l.channel,
        amount,
        reason: `${d.l.channel} has used ${Math.round((Number(d.l.actual) / Number(d.l.planned)) * 100)}% of plan; ${t.l.channel} is over plan by ${Number(t.l.actual) - Number(t.l.planned)}.`,
      });
    }
  }
  return out;
}

/** Budget totals per currency for one month; currencies are never added together. */
export function budgetByCurrency(lines: readonly (BudgetLine & { currency: string })[]) {
  const by = new Map<string, (BudgetLine & { currency: string })[]>();
  for (const l of lines) by.set(l.currency, [...(by.get(l.currency) ?? []), l]);
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, ls]) => ({
      currency,
      ...budgetTotals(ls),
      lines: ls.length,
      overCap: ls.filter((l) => budgetAlert(l) === "over_cap").length,
      overPlan: ls.filter((l) => budgetAlert(l) === "over_plan").length,
    }));
}
