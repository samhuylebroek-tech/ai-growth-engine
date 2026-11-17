export type InitiativeAttentionInput = {
  status: string;
  dueDate: string | null;
  ownerId: string | null;
  blockerNote: string;
  successMetric: string;
  baselineValue: number | string | null;
  targetValue: number | string | null;
  currentValue: number | string | null;
};
export type InitiativeAttention = {
  kind: "blocked" | "overdue" | "due_soon" | "unassigned" | "measurement";
  reason: string;
  rank: number;
};

export function localISODate(date = new Date()): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return localISODate(date);
}
export function classifyInitiativeAttention(input: InitiativeAttentionInput, today: string): InitiativeAttention | null {
  if (input.status === "completed" || input.status === "cancelled") return null;
  if (input.blockerNote.trim()) return { kind: "blocked", reason: input.blockerNote.trim(), rank: 0 };
  if (input.dueDate && input.dueDate < today) return { kind: "overdue", reason: `Deadline was ${input.dueDate}`, rank: 1 };
  if (input.dueDate && input.dueDate <= addCalendarDays(today, 7)) return { kind: "due_soon", reason: `Deadline ${input.dueDate}`, rank: 2 };
  if (input.status === "in_progress" && !input.ownerId) return { kind: "unassigned", reason: "This initiative is underway but has no owner", rank: 3 };
  if (input.status === "in_progress" && (!input.successMetric || input.baselineValue == null || input.targetValue == null || input.currentValue == null)) {
    return { kind: "measurement", reason: "Add a success metric, baseline, target and current result", rank: 4 };
  }
  return null;
}
export function sortInitiativeAttention<T extends { rank: number; dueDate: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.rank - b.rank || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
}
