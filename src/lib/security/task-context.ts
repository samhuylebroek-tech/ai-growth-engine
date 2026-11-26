import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PendingDatabase } from "@/lib/pending-schema";
import { campaignWorkStage } from "@/lib/campaign-work";
import { recordedTaskOutput } from "@/lib/task-execution";
import type { WorkspaceScope } from "./context";

/** Called only for explicit task references (or bounded children of an explicitly selected campaign). */
export async function selectedTaskProgress(
  sb: SupabaseClient<Database>,
  scope: WorkspaceScope,
  taskId: string,
) {
  const pending = sb as unknown as SupabaseClient<PendingDatabase>;
  const [profile, run] = await Promise.all([
    pending
      .from("task_execution_profiles")
      .select("*")
      .eq("org_id", scope.orgId)
      .eq("workspace_id", scope.workspaceId)
      .eq("task_id", taskId)
      .maybeSingle(),
    pending
      .from("task_runs")
      .select("*")
      .eq("org_id", scope.orgId)
      .eq("workspace_id", scope.workspaceId)
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const missing = (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    ["42P01", "42703", "PGRST205", "PGRST204"].includes(String(error.code));
  if (missing(profile.error) || missing(run.error))
    return { sources: [] as string[], data: { stage: "unavailable" } };
  if (profile.error || run.error) throw new Error("Selected task progress is unavailable");
  const decision = run.data
    ? await pending
        .from("specialist_result_decisions")
        .select("*")
        .eq("org_id", scope.orgId)
        .eq("workspace_id", scope.workspaceId)
        .eq("task_run_id", run.data.id)
        .maybeSingle()
    : { data: null, error: null };
  if (decision.error && !missing(decision.error))
    throw new Error("Selected result decision is unavailable");
  const output = recordedTaskOutput(run.data?.output);
  return {
    sources: [
      ...(run.data ? [`task_runs:${run.data.id}`] : []),
      ...(decision.data ? [`specialist_result_decisions:${decision.data.id}`] : []),
    ],
    data: {
      stage: campaignWorkStage(
        profile.data ?? undefined,
        run.data ?? undefined,
        decision.data ?? undefined,
      ),
      specialist: profile.data?.specialist_key ?? run.data?.specialist_key ?? null,
      credits: run.data?.credits_charged ?? null,
      decision: decision.data?.decision ?? (decision.error ? "unavailable" : null),
      corrections: decision.data?.corrections ?? "",
      result: output
        ? {
            title: output.title,
            summary: output.summary,
            deliverables: output.deliverables.slice(0, 3),
            evidence_gaps: output.evidence_gaps.slice(0, 3),
            next_steps: output.next_steps.slice(0, 3),
          }
        : null,
      caution:
        "Internal workflow only. A created/done task is not proof of specialist execution; an AI result is not verified business evidence. External actions require separate authorization.",
    },
  };
}
