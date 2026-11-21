// Goal measurability and KPI progress (pure). A goal is measurable only with a metric, a measured baseline and a
// target; nothing is assumed (a missing baseline is never treated as zero). Progress, the remaining gap, time left and
// pace are computed from the values the team entered and are labelled as entered, not verified.
import { goalProgress } from "@/lib/growth-plan";

export type GoalLike = { metric: string; baseline: number | null; target: number | null; current_value: number | null; due_date: string | null; created_at?: string | null };
export type GoalMissing = "metric" | "baseline" | "target" | "current" | "deadline";
export type GoalMeasurement = {
  measurable: boolean;
  missing: GoalMissing[];
  progress: number | null;
  gap: number | null;
  daysLeft: number | null;
  pace: "ahead" | "on_pace" | "behind" | "overdue" | null;
};
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY);

export function goalMeasurement(g: GoalLike, today: string): GoalMeasurement {
  const missing: GoalMissing[] = [];
  if (!g.metric.trim()) missing.push("metric");
  if (g.baseline === null) missing.push("baseline");
  if (g.target === null) missing.push("target");
  if (g.current_value === null) missing.push("current");
  if (!g.due_date) missing.push("deadline");
  const measurable = !missing.includes("metric") && !missing.includes("baseline") && !missing.includes("target");
  const progress = measurable ? goalProgress(g.baseline, g.target, g.current_value) : null;
  const gap = g.target !== null && g.current_value !== null ? Math.round((g.target - g.current_value) * 100) / 100 : null;
  const daysLeft = g.due_date ? days(today, g.due_date) : null;
  let pace: GoalMeasurement["pace"] = null;
  if (progress !== null && daysLeft !== null) {
    if (daysLeft < 0 && progress < 100) pace = "overdue";
    else if (g.created_at && g.due_date && days(g.created_at, g.due_date) > 0) {
      const expected = Math.min(1, Math.max(0, days(g.created_at, today) / days(g.created_at, g.due_date)));
      const actual = progress / 100;
      pace = actual >= 1 || actual - expected > 0.1 ? "ahead" : expected - actual > 0.1 ? "behind" : "on_pace";
    }
  }
  return { measurable, missing, progress, gap, daysLeft, pace };
}
