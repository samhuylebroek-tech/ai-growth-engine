import { describe, expect, it } from "vitest";
import { EXPLAINED, sx } from "@/lib/i18n/areas/sx";
import { detectSignals } from "@/lib/signals";

describe("warning explanations", () => {
  it("every warning type has why / what to do / if nothing is done, in every language", () => {
    for (const code of Object.keys(EXPLAINED))
      for (const l of [sx.en, sx.nl, sx.fr] as Record<string, string>[])
        for (const f of ["why", "do", "if"]) expect(l[`sx.${code}.${f}`], `${code}.${f}`).toBeTruthy();
  });
});

describe("blocked-task warning", () => {
  const ok = <T,>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
  const base = { workspace: { id: "w", name: "Main" }, objectives: null, facts: [], goals: [], recommendations: [], plans: ok([]), initiatives: [], operations: [], projects: [], tasks: [],
    budget: ok([]), deals: ok([]), competitors: ok([]), observations: [], seo: ok([]), content: ok([]), versions: [], decisions: [], campaigns: ok([]), connections: ok([]), metrics: ok([]), measurements: [] };
  it("is raised when an open task waits on an unfinished earlier task, and names both", () => {
    const d = {
      ...base,
      tasks: [
        { id: "a", title: "Send offer", status: "todo", due_date: "2026-07-01" },
        { id: "p", title: "Price analysis", status: "in_progress", due_date: "2026-06-01" },
      ],
      dependencies: { status: "ok", rows: [{ task_id: "a", depends_on: "p" }] },
    };
    const s = detectSignals(d as never, new Date("2026-06-10T00:00:00Z")).find((x) => x.code === "tasks_blocked");
    expect(s?.vars).toMatchObject({ n: 1, task: "Send offer", pre: "Price analysis" });
    expect(s?.urgency).toBe("high");
  });
  it("is not raised when the dependencies could not be read", () => {
    const d = { ...base, tasks: [{ id: "a", title: "x", status: "todo", due_date: null }], dependencies: { status: "error", rows: [] } };
    expect(detectSignals(d as never, new Date("2026-06-10T00:00:00Z")).some((x) => x.code === "tasks_blocked")).toBe(false);
  });
});
