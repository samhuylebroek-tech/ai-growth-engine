// Blocked work (pure). A task is blocked while a task it waits on (an execution note of kind "dependency") is still
// open; it is "late" when that prerequisite is overdue or due on or after the waiting task's own deadline. Same rule
// as the Command Center tile, orchestration and task_open_dependencies in SQL, so every screen and the Growth Officer
// agree. A prerequisite whose state was not read is reported as unknown, never as finished.
export type DepTask = { id: string; title: string; status: string; due_date: string | null };
export type Dep = { task_id: string; depends_on: string };
export type Blocked = {
  task: DepTask;
  waitsOn: { id: string; title: string | null; status: string | null; due_date: string | null }[];
  late: boolean;
};

const isOpen = (s: string) => s !== "done" && s !== "cancelled";

export function blockedTasks(tasks: readonly DepTask[], deps: readonly Dep[], today: string): Blocked[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Blocked[] = [];
  for (const task of tasks) {
    if (!isOpen(task.status)) continue;
    const waitsOn = [...new Set(deps.filter((d) => d.task_id === task.id && d.depends_on !== task.id).map((d) => d.depends_on))]
      .map((id) => byId.get(id))
      .flatMap((p) => (p && isOpen(p.status) ? [{ id: p.id, title: p.title, status: p.status, due_date: p.due_date }] : []));
    if (!waitsOn.length) continue;
    const late = waitsOn.some((p) => (p.due_date !== null && p.due_date < today) || (p.due_date !== null && task.due_date !== null && p.due_date >= task.due_date));
    out.push({ task, waitsOn, late });
  }
  return out.sort((a, b) => Number(b.late) - Number(a.late) || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999"));
}

/** Tasks named by a dependency (either side) whose state was not read, for one bounded follow-up read. */
export function unknownTaskIds(tasks: readonly DepTask[], deps: readonly Dep[]): string[] {
  const known = new Set(tasks.map((t) => t.id));
  return [...new Set(deps.flatMap((d) => [d.task_id, d.depends_on]).filter((id) => !known.has(id)))];
}
