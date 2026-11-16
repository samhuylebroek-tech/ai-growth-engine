export type BudgetLine = { planned: number; actual: number; hard_cap: number | null };
/** Progress from baseline toward target, 0–100, or null when not measurable. */
export function goalProgress(baseline: number | null, target: number | null, current: number | null): number | null {
  if (target == null || current == null) return null;
  const b = baseline ?? 0;
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
