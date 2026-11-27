// The visible chain for one goal: opportunity → goal → strategy → approved plan → initiatives → campaigns/projects → tasks → results.
// Pure, so every stage's state is decided by testable rules over records the caller already read under RLS.

export type ChainStage =
  "opportunity" | "goal" | "strategy" | "plan" | "initiatives" | "work" | "tasks" | "results";
export type StageState = "done" | "in_progress" | "waiting" | "missing" | "off";
export type ChainStep = {
  stage: ChainStage;
  state: StageState;
  count: number;
  total?: number;
  label?: string;
};
export type ChainInput = {
  opportunity: { title: string; status: string } | null | "off";
  strategies: number;
  plans: { version: number; status: string }[] | "off";
  initiatives: { status: string; project_id: string | null }[];
  work: { kind: "projects" | "campaigns"; title: string; status: string }[];
  tasks: { status: string }[];
  results: { withActual: number; total: number } | "off";
};
export type Chain = { steps: ChainStep[]; next: ChainStage | null; duplicates: string[] };

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Titles shared by more than one linked campaign/project of the same goal, which usually means duplicated work. */
export function duplicateTitles(work: readonly { title: string; status: string }[]): string[] {
  const seen = new Map<string, { title: string; n: number }>();
  for (const w of work) {
    if (["archived", "cancelled"].includes(w.status)) continue;
    const k = norm(w.title);
    if (!k) continue;
    const e = seen.get(k);
    if (e) e.n += 1;
    else seen.set(k, { title: w.title, n: 1 });
  }
  return [...seen.values()].filter((e) => e.n > 1).map((e) => e.title);
}

export function buildGrowthChain(i: ChainInput): Chain {
  const approved = i.plans === "off" ? undefined : i.plans.find((p) => p.status === "approved");
  const draft = i.plans === "off" ? undefined : i.plans.find((p) => p.status === "draft");
  const liveInit = i.initiatives.filter((x) => x.status !== "cancelled");
  const doneInit = liveInit.filter((x) => x.status === "completed").length;
  const liveWork = i.work.filter((w) => !["archived", "cancelled"].includes(w.status));
  const openTasks = i.tasks.filter((t) => t.status !== "cancelled");
  const doneTasks = openTasks.filter((t) => t.status === "done").length;
  const steps: ChainStep[] = [
    i.opportunity === "off"
      ? { stage: "opportunity", state: "off", count: 0 }
      : i.opportunity
        ? { stage: "opportunity", state: "done", count: 1, label: i.opportunity.title }
        : { stage: "opportunity", state: "missing", count: 0 },
    { stage: "goal", state: "done", count: 1 },
    { stage: "strategy", state: i.strategies > 0 ? "done" : "missing", count: i.strategies },
    i.plans === "off"
      ? { stage: "plan", state: "off", count: 0 }
      : approved
        ? { stage: "plan", state: "done", count: 1, label: `V${approved.version}` }
        : draft
          ? { stage: "plan", state: "waiting", count: 1, label: `V${draft.version}` }
          : { stage: "plan", state: "missing", count: 0 },
    {
      stage: "initiatives",
      state: !approved
        ? "missing"
        : !liveInit.length
          ? "missing"
          : doneInit === liveInit.length
            ? "done"
            : "in_progress",
      count: doneInit,
      total: liveInit.length,
    },
    { stage: "work", state: liveWork.length ? "done" : "missing", count: liveWork.length },
    {
      stage: "tasks",
      state: !openTasks.length
        ? "missing"
        : doneTasks === openTasks.length
          ? "done"
          : "in_progress",
      count: doneTasks,
      total: openTasks.length,
    },
    i.results === "off"
      ? { stage: "results", state: "off", count: 0 }
      : {
          stage: "results",
          state: !i.results.total
            ? "missing"
            : i.results.withActual === i.results.total
              ? "done"
              : "in_progress",
          count: i.results.withActual,
          total: i.results.total,
        },
  ];
  // The opportunity is optional (goals can be set directly); the first missing required stage is the next step.
  const next =
    steps.find((s) => s.stage !== "opportunity" && (s.state === "missing" || s.state === "waiting"))
      ?.stage ?? null;
  return { steps, next, duplicates: duplicateTitles(i.work) };
}
