// Growth Officer orchestration: deterministic next-best-actions, duplicates and bottlenecks over the caller's
// own task records. No AI, no credits; every suggestion carries the evidence that produced it.
import { taskScore } from "@/lib/scheduler";

export type OrchTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  project_id: string | null;
  campaign_id: string | null;
};
export type OrchInput = {
  today: string;
  tasks: readonly OrchTask[];
  dependencies: readonly { task_id: string; depends_on: string }[];
  profiles: ReadonlyMap<string, { task_type: string }>;
  latestRun: ReadonlyMap<string, { status: string; failed: number }>;
  goalOfProject: ReadonlyMap<string, string>;
  goalOfCampaign: ReadonlyMap<string, string>;
  goals: ReadonlyMap<string, { priority: "primary" | "secondary"; status: string }>;
  initiativeProjects: ReadonlySet<string>;
};
export type ActionKind = "resolve" | "approve" | "review" | "unblock" | "assign" | "run";
export type Why =
  "urgent" | "high" | "overdue" | "due_soon" | "primary_goal" | "goal" | "plan" | "blocks_others";
export type NextAction = {
  task: OrchTask;
  kind: ActionKind;
  score: number;
  why: Why[];
  blocker?: OrchTask;
};

const open = (t: OrchTask) => t.status !== "done" && t.status !== "cancelled";
const KIND_ORDER: Record<ActionKind, number> = {
  resolve: 0,
  approve: 1,
  review: 2,
  unblock: 3,
  run: 4,
  assign: 5,
};

export function nextBestActions(i: OrchInput, limit = 5): NextAction[] {
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  const openIds = new Set(i.tasks.filter(open).map((t) => t.id));
  const blocksCount = new Map<string, number>();
  for (const d of i.dependencies)
    if (openIds.has(d.task_id) && openIds.has(d.depends_on))
      blocksCount.set(d.depends_on, (blocksCount.get(d.depends_on) ?? 0) + 1);
  const soon = new Date(`${i.today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  const soonS = soon.toISOString().slice(0, 10);
  const out: NextAction[] = [];
  for (const t of i.tasks) {
    if (!open(t)) continue;
    const goalId =
      (t.project_id && i.goalOfProject.get(t.project_id)) ||
      (t.campaign_id && i.goalOfCampaign.get(t.campaign_id)) ||
      null;
    const g = goalId ? i.goals.get(goalId) : undefined;
    const goalPriority = g && g.status === "active" ? g.priority : null;
    const inInitiative = !!t.project_id && i.initiativeProjects.has(t.project_id);
    const run = i.latestRun.get(t.id);
    const why: Why[] = [];
    if (t.priority === "urgent") why.push("urgent");
    else if (t.priority === "high") why.push("high");
    if (t.due_date && t.due_date < i.today) why.push("overdue");
    else if (t.due_date && t.due_date <= soonS) why.push("due_soon");
    if (goalPriority === "primary") why.push("primary_goal");
    else if (goalPriority) why.push("goal");
    if (inInitiative) why.push("plan");
    const blocks = blocksCount.get(t.id) ?? 0;
    if (blocks > 0) why.push("blocks_others");
    const score =
      taskScore(
        {
          priority: t.priority,
          due_date: t.due_date,
          goalPriority,
          inInitiative,
          failedRuns: run?.failed ?? 0,
        },
        i.today,
      ) +
      5 * blocks;
    const blockerId = i.dependencies.find(
      (d) => d.task_id === t.id && openIds.has(d.depends_on),
    )?.depends_on;
    let kind: ActionKind;
    if (run?.status === "uncertain") kind = "resolve";
    else if (run?.status === "awaiting_approval") kind = "approve";
    else if (t.status === "review" && run?.status === "succeeded") kind = "review";
    else if (blockerId) kind = "unblock";
    else if (!i.profiles.has(t.id)) kind = "assign";
    else if (
      i.profiles.get(t.id)!.task_type === "external" ||
      (run && ["queued", "running", "paused"].includes(run.status))
    )
      continue;
    else kind = "run";
    out.push({
      task: t,
      kind,
      score,
      why,
      ...(blockerId ? { blocker: byId.get(blockerId)! } : {}),
    });
  }
  return out
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        b.score - a.score ||
        a.task.title.localeCompare(b.task.title),
    )
    .slice(0, limit);
}

const STOP = new Set([
  "de",
  "het",
  "een",
  "en",
  "van",
  "voor",
  "op",
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "to",
  "le",
  "la",
  "les",
  "un",
  "une",
  "et",
  "du",
  "des",
  "pour",
]);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  ); // crude stem: schrijf/schrijven, post/posts

/** Open tasks whose titles share at least 75% of their meaningful words (Jaccard), as possible duplicates. */
export function possibleDuplicates(tasks: readonly OrchTask[], threshold = 0.75) {
  const list = tasks
    .filter(open)
    .slice(0, 400)
    .map((t) => ({ t, w: words(t.title) }))
    .filter((x) => x.w.size >= 2);
  const pairs: { a: OrchTask; b: OrchTask; similarity: number }[] = [];
  for (let x = 0; x < list.length; x++)
    for (let y = x + 1; y < list.length; y++) {
      const A = list[x]!,
        B = list[y]!;
      let inter = 0;
      for (const w of A.w) if (B.w.has(w)) inter++;
      const sim = inter / (A.w.size + B.w.size - inter);
      if (sim >= threshold) pairs.push({ a: A.t, b: B.t, similarity: Math.round(sim * 100) / 100 });
    }
  return pairs.sort((p, q) => q.similarity - p.similarity).slice(0, 10);
}

/** Open tasks that hold up two or more other open tasks. */
export function bottlenecks(
  tasks: readonly OrchTask[],
  deps: readonly { task_id: string; depends_on: string }[],
) {
  const openIds = new Set(tasks.filter(open).map((t) => t.id));
  const n = new Map<string, number>();
  for (const d of deps)
    if (openIds.has(d.task_id) && openIds.has(d.depends_on))
      n.set(d.depends_on, (n.get(d.depends_on) ?? 0) + 1);
  return tasks
    .filter((t) => (n.get(t.id) ?? 0) >= 2)
    .map((t) => ({ task: t, blocks: n.get(t.id)! }))
    .sort((a, b) => b.blocks - a.blocks);
}
