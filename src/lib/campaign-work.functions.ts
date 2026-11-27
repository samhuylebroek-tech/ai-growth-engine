import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PendingDatabase } from "@/lib/pending-schema";
import { campaignAssignment, campaignWorkIdentity } from "@/lib/campaign-work";
import { collectPages } from "@/lib/pagination";
import {
  isProposalNote,
  parseProposal,
  proposalTasks,
  proposalTaskLabel,
  PROPOSAL_MAX,
} from "@/lib/campaign-proposal";

/** No inference or external action. One atomic batch insert; interrupted assignments can resume independently. */
export const prepareCampaignWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orgId: z.guid(),
        workspaceId: z.guid(),
        campaignId: z.guid(),
        noteId: z.guid(),
        expectedBody: z.string().max(PROPOSAL_MAX + 3000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const pending = sb as unknown as SupabaseClient<PendingDatabase>;
    const allowed = await sb.rpc("has_workspace_role", {
      _workspace: data.workspaceId,
      _min: "member",
    });
    if (allowed.error || !allowed.data) throw new Error("campaign_work_denied");
    const [n, c] = await Promise.all([
      sb
        .from("execution_notes")
        .select("*")
        .eq("id", data.noteId)
        .eq("org_id", data.orgId)
        .eq("workspace_id", data.workspaceId)
        .eq("entity_type", "campaigns")
        .eq("entity_id", data.campaignId)
        .maybeSingle(),
      sb
        .from("campaigns")
        .select("title,objective,audience,channels")
        .eq("id", data.campaignId)
        .eq("org_id", data.orgId)
        .eq("workspace_id", data.workspaceId)
        .maybeSingle(),
    ]);
    if (n.error || c.error || !n.data || !c.data) throw new Error("campaign_work_unavailable");
    const proposal = parseProposal(n.data.body);
    if (
      !isProposalNote(n.data) ||
      !proposal ||
      proposal.status !== "approved" ||
      n.data.body !== data.expectedBody
    )
      throw new Error("campaign_work_changed");
    const titles = proposalTasks(proposal.text);
    if (!titles.length) throw new Error("campaign_work_no_activities");
    const identity = await campaignWorkIdentity(data.noteId, proposal.text, titles);
    const origin = proposalTaskLabel(data.noteId);
    const watermark = new Date().toISOString();
    const readTasks = async () =>
      collectPages(async (cursor, size) => {
        let query = sb
          .from("tasks")
          .select("id,title,labels")
          .eq("org_id", data.orgId)
          .eq("workspace_id", data.workspaceId)
          .eq("campaign_id", data.campaignId)
          .contains("labels", [origin])
          .order("id")
          .limit(size);
        if (cursor) query = query.gt("id", cursor);
        // Existing versions are read completely; the exact deterministic IDs also include this attempt's insert.
        query = query.or(`created_at.lte.${watermark},id.in.(${identity.ids.join(",")})`);
        return await query;
      });
    let tasks = await readTasks();
    // Old conversions have no immutable version marker: never guess their version or create duplicates.
    if (tasks.some((t) => !t.labels.some((l) => l.startsWith("proposal-version:"))))
      throw new Error("campaign_work_legacy");
    const present = tasks.filter((t) => t.labels.includes(identity.label));
    if (!present.length) {
      const campaign = c.data;
      const description = [
        `Campaign: ${campaign.title}`,
        `Objective: ${campaign.objective}`,
        `Audience: ${campaign.audience}`,
        `Channels: ${campaign.channels.join(", ")}`,
        `Approved proposal: ${data.noteId}`,
        `Approved by: ${proposal.decidedBy ?? ""} at ${proposal.decidedAt ?? ""}`,
        `Proposal revision: ${identity.revision}`,
        "Approval authorizes internal preparation only, not publishing, sending or spending.",
        proposal.text.slice(0, 9000),
      ]
        .join("\n")
        .slice(0, 12000);
      const rows = titles.map((title, index) => {
        const id = identity.ids[index];
        if (!id) throw new Error("campaign_work_unavailable");
        return {
          id,
          org_id: data.orgId,
          workspace_id: data.workspaceId,
          campaign_id: data.campaignId,
          title,
          description,
          labels: ["campaign-proposal", origin, identity.label],
          created_by: context.userId,
        };
      });
      const inserted = await sb.from("tasks").insert(rows);
      // A competing insert or lost acknowledgement is safe only when the exact complete batch reads back.
      tasks = await readTasks();
      if (
        inserted.error &&
        !identity.ids.every((id) =>
          tasks.some((t) => t.id === id && t.labels.includes(identity.label)),
        )
      )
        throw new Error("campaign_work_unavailable");
    }
    const current = tasks.filter((t) => t.labels.includes(identity.label));
    if (
      current.length !== titles.length ||
      !identity.ids.every((id) => current.some((t) => t.id === id))
    )
      throw new Error("campaign_work_incomplete");
    const profiles = await pending
      .from("task_execution_profiles")
      .select("task_id")
      .eq("org_id", data.orgId)
      .eq("workspace_id", data.workspaceId)
      .in("task_id", identity.ids);
    if (profiles.error) return { created: current.length, assigned: 0, assignmentPending: true };
    let assigned = profiles.data?.length ?? 0;
    for (const task of current) {
      if (profiles.data?.some((p) => p.task_id === task.id)) continue;
      const suggested = campaignAssignment(task.title);
      const result = await pending.rpc("assign_task_specialist", {
        _task: task.id,
        _specialist: suggested.specialist,
        _type: suggested.type,
        _requires_approval: suggested.requiresApproval,
      });
      if (!result.error) assigned++;
    }
    return { created: current.length, assigned, assignmentPending: assigned !== current.length };
  });
