import { describe, expect, it } from "vitest";
import { classifyInitiativeAttention, sortInitiativeAttention } from "@/lib/initiative-pulse";

describe("classifyInitiativeAttention", () => {
  const base = {
    status: "in_progress",
    dueDate: null as string | null,
    ownerId: "member-1",
    blockerNote: "",
    successMetric: "qualified leads",
    baselineValue: 10,
    targetValue: 30,
    currentValue: 18,
  };
  it("prioritizes a blocker over deadline and ownership signals", () => {
    expect(
      classifyInitiativeAttention(
        { ...base, dueDate: "2026-11-01", blockerNote: "Waiting for approval" },
        "2026-11-17",
      ),
    ).toEqual({ kind: "blocked", reason: "Waiting for approval", rank: 0 });
  });
  it("marks past deadlines as overdue", () => {
    expect(
      classifyInitiativeAttention({ ...base, dueDate: "2026-11-16" }, "2026-11-17")?.kind,
    ).toBe("overdue");
  });
  it("marks deadlines within seven days as due soon", () => {
    expect(
      classifyInitiativeAttention({ ...base, dueDate: "2026-11-24" }, "2026-11-17")?.kind,
    ).toBe("due_soon");
  });
  it("flags active work without an owner", () => {
    expect(classifyInitiativeAttention({ ...base, ownerId: null }, "2026-11-17")?.kind).toBe(
      "unassigned",
    );
  });
  it("flags active work without a complete outcome measure", () => {
    expect(classifyInitiativeAttention({ ...base, baselineValue: null }, "2026-11-17")?.kind).toBe(
      "measurement",
    );
  });
  it("does not flag completed or cancelled work", () => {
    expect(classifyInitiativeAttention({ ...base, status: "completed" }, "2026-11-17")).toBeNull();
    expect(classifyInitiativeAttention({ ...base, status: "cancelled" }, "2026-11-17")).toBeNull();
  });
});

describe("sortInitiativeAttention", () => {
  it("orders blockers before overdue, and earlier deadlines before later ones at equal priority", () => {
    const result = sortInitiativeAttention([
      { id: "late", rank: 2, dueDate: "2026-11-24" },
      { id: "blocked", rank: 0, dueDate: null },
      { id: "early", rank: 2, dueDate: "2026-11-20" },
      { id: "overdue", rank: 1, dueDate: "2026-11-16" },
    ]);
    expect(result.map((item) => item.id)).toEqual(["blocked", "overdue", "early", "late"]);
  });
});
