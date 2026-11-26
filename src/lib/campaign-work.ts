import { defaultTaskType, suggestSpecialist, recordedTaskOutput } from "@/lib/task-execution";
import type { TaskProfileRow, TaskRunRow, SpecialistDecisionRow } from "@/lib/pending-schema";

/** Stable primary keys, not a client-side count check, arbitrate concurrent conversion attempts. */
export async function campaignWorkIdentity(
  noteId: string,
  text: string,
  titles: readonly string[],
) {
  const digest = async (value: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const revision = await digest(text);
  const ids = await Promise.all(
    titles.map(async (_, index) => {
      const hash = await digest(`campaign-work/v1/${noteId}/${revision}/${index}`);
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }),
  );
  return { revision, ids, label: `proposal-version:${revision}` };
}

export function campaignAssignment(title: string) {
  const { specialist } = suggestSpecialist(title);
  return { specialist, type: defaultTaskType(specialist), requiresApproval: true };
}

export type CampaignWorkStage =
  | "created"
  | "assigned"
  | "awaiting_approval"
  | "queued"
  | "paused"
  | "running"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "executed"
  | "result_missing"
  | "reviewed"
  | "corrections"
  | "rework";

/** Manual task completion is not evidence of AI execution or human result approval. */
export function campaignWorkStage(
  profile: Pick<TaskProfileRow, "specialist_key"> | undefined,
  run: Pick<TaskRunRow, "status" | "output"> | undefined,
  decision: Pick<SpecialistDecisionRow, "decision"> | undefined,
): CampaignWorkStage {
  if (!run) return profile ? "assigned" : "created";
  if (run.status === "rejected") return "cancelled";
  if (run.status !== "succeeded") return run.status;
  const result = recordedTaskOutput(run.output);
  if (!result || !result.deliverables.length) return "result_missing";
  if (decision?.decision === "accepted") return "reviewed";
  if (decision?.decision === "accepted_with_corrections") return "corrections";
  if (decision?.decision === "needs_rework" || decision?.decision === "rejected") return "rework";
  return "executed";
}

export function newestRun(runs: readonly TaskRunRow[], taskId: string) {
  return runs
    .filter((r) => r.task_id === taskId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
}
