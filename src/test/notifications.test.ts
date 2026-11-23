import { expect, it } from "vitest";
import { buildNotifications, notificationPreferenceKey } from "@/lib/notifications";
import type { Task } from "@/lib/execution";
const task = (id: string, due_date: string | null, status = "todo") =>
  ({ id, due_date, status, title: id, updated_at: "2026-11-15T12:00:00Z" }) as Task;
it("surfaces due-today and overdue tasks, excluding completed, future and undated tasks", () => {
  const result = buildNotifications(
    {
      tasks: [
        task("overdue", "2026-11-14"),
        task("today", "2026-11-15"),
        task("future", "2026-11-16"),
        task("done", "2026-11-14", "done"),
        task("cancelled", "2026-11-14", "cancelled"),
        task("undated", null),
      ],
      approvals: [],
      runs: [],
      documents: [],
      connections: [],
    },
    "2026-11-15",
  );
  expect(result.map((r) => [r.title, r.severity])).toEqual([
    ["overdue", "urgent"],
    ["today", "attention"],
  ]);
});
it("shows pending approvals and terminal AI outcomes without inventing events", () => {
  const result = buildNotifications(
    {
      tasks: [],
      approvals: [
        { id: "a", title: "Review", status: "pending", created_at: "2026-11-15" },
        { id: "b", title: "Closed", status: "approved", created_at: "2026-11-15" },
      ],
      runs: [
        {
          id: "r",
          agent_key: "content",
          status: "succeeded",
          created_at: "2026-11-15",
          finished_at: null,
          summary: "Draft",
          error: null,
        },
      ],
      documents: [],
      connections: [],
    },
    "2026-11-15",
  );
  expect(result.map((r) => r.id)).toEqual(["approval:a", "run:r:succeeded"]);
});
it("does not turn unconfigured integrations into invented failure events", () => {
  expect(
    buildNotifications(
      {
        tasks: [],
        approvals: [],
        runs: [],
        documents: [],
        connections: [{ id: "a", connector_key: "analytics", status: "not_configured" }],
      },
      "2026-11-15",
    ),
  ).toEqual([]);
});
it("isolates read preferences by user, organization and workspace", () => {
  const keys = [
    notificationPreferenceKey("a", "org", "ws"),
    notificationPreferenceKey("b", "org", "ws"),
    notificationPreferenceKey("a", "other", "ws"),
    notificationPreferenceKey("a", "org", "other"),
  ];
  expect(new Set(keys).size).toBe(4);
});
