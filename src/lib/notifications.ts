import { readableRunSummary } from "@/lib/command-center";
import type { Task } from "@/lib/execution";
export type Notice = { id: string; title: string; detail: string; severity: "urgent" | "attention" | "info"; time: string; to: "/app/tasks" | "/app/approvals" | "/app/activity" | "/app/documents" | "/app/integrations" };
type Run = { id: string; agent_key: string; status: string; created_at: string; finished_at: string | null; summary: string | null; error: string | null };
type Decision = { id: string; title: string; status: string; created_at: string };
type Document = { id: string; name: string; status: string; created_at: string };
type Connection = { id: string; connector_key: string; status: string };
export function notificationPreferenceKey(userId: string, orgId: string, workspaceId: string) {
  return `age.notifications.v1:${userId}:${orgId}:${workspaceId}`;
}
export function buildNotifications(data: { tasks: Task[]; approvals: Decision[]; runs: Run[]; documents: Document[]; connections: Connection[] }, today: string): Notice[] {
  const notices: Notice[] = [];
  for (const task of data.tasks) {
    if (["done", "cancelled"].includes(task.status) || !task.due_date) continue;
    if (task.due_date <= today) notices.push({ id: `task:${task.id}:${task.due_date}:${task.status}`, title: task.title, detail: task.due_date < today ? `Overdue · ${task.due_date}` : "Due today", severity: task.due_date < today ? "urgent" : "attention", time: task.updated_at, to: "/app/tasks" });
  }
  for (const approval of data.approvals) if (approval.status === "pending") notices.push({ id: `approval:${approval.id}`, title: approval.title, detail: "Decision awaiting review", severity: "attention", time: approval.created_at, to: "/app/approvals" });
  for (const run of data.runs) if (["failed", "succeeded"].includes(run.status)) notices.push({ id: `run:${run.id}:${run.status}`, title: `${run.agent_key.replace(/_/g, " ")} · ${run.status === "failed" ? "failed" : "completed"}`, detail: run.error ?? readableRunSummary(run.summary) ?? "AI assignment", severity: run.status === "failed" ? "urgent" : "info", time: run.finished_at ?? run.created_at, to: "/app/activity" });
  for (const doc of data.documents) if (doc.status === "failed") notices.push({ id: `document:${doc.id}:${doc.status}`, title: doc.name, detail: "Document processing failed", severity: "urgent", time: doc.created_at, to: "/app/documents" });
  for (const connection of data.connections) if (["error", "failed", "expired"].includes(connection.status)) notices.push({ id: `connection:${connection.id}:${connection.status}`, title: connection.connector_key.replace(/_/g, " "), detail: `Connection ${connection.status}`, severity: "urgent", time: "", to: "/app/integrations" });
  const rank = { urgent: 0, attention: 1, info: 2 };
  return [...new Map(notices.map(n => [n.id, n])).values()].sort((a,b) => rank[a.severity] - rank[b.severity] || b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
}