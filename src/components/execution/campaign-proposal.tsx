import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileText, ListChecks, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiMarkdown } from "@/components/ai/ai-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import {
  decide,
  isProposalNote,
  parseProposal,
  proposalTaskLabel,
  proposalTasks,
  PROPOSAL_MAX,
  PROPOSAL_TITLE,
  saveDraft,
  serialize,
} from "@/lib/campaign-proposal";
import type { Note } from "@/lib/execution";

/** Review a campaign's proposal inside the campaign: save as draft, modify, approve or reject.
 * Approving the plan never authorises ad spend, publishing, sending or other external actions. */
export function CampaignProposal({
  campaignId,
  notes,
}: {
  campaignId: string;
  notes: readonly Note[];
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t } = useI18n();
  const note = notes.find((n) => n.entity_id === campaignId && isProposalNote(n));
  const proposal = note ? parseProposal(note.body) : null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = can(o.workspaceRole, "profile.edit");
  const canDecide = can(o.workspaceRole, "approvals.decide");
  const approved = proposal?.status === "approved" && note ? note : null;
  const items = approved && proposal ? proposalTasks(proposal.text) : [];
  const label = approved ? proposalTaskLabel(approved.id) : "";
  const made = useQuery({
    queryKey: ["execution", "proposal-tasks", o.workspace?.id, label],
    enabled: !!label && !!o.workspace,
    queryFn: async () => {
      const r = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", o.workspace!.id)
        .contains("labels", [label]);
      if (r.error) throw r.error;
      return r.count ?? 0;
    },
  });

  async function createTasks() {
    if (!approved || !o.org || !o.workspace || !o.userId || made.data !== 0) return;
    setBusy(true);
    const r = await supabase.from("tasks").insert(
      items.map((title) => ({
        org_id: o.org!.id,
        workspace_id: o.workspace!.id,
        campaign_id: campaignId,
        title,
        description: "",
        labels: ["campaign-proposal", label],
        created_by: o.userId!,
      })),
    );
    setBusy(false);
    if (r.error) return void toast.error(t("ch.cp.failed"));
    toast.success(t("ch.cp.tasksDone"));
    await qc.invalidateQueries({ queryKey: ["execution"] });
  }

  async function persist(body: string) {
    if (!o.org || !o.workspace || !o.userId) return;
    setBusy(true);
    try {
      const r = note
        ? await supabase
            .from("execution_notes")
            .update({ body })
            .eq("id", note.id)
            .eq("org_id", o.org.id)
            .eq("workspace_id", o.workspace.id)
        : await supabase.from("execution_notes").insert({
            org_id: o.org.id,
            workspace_id: o.workspace.id,
            entity_type: "campaigns",
            entity_id: campaignId,
            kind: "proposal",
            content_type: "draft",
            title: PROPOSAL_TITLE,
            body,
            created_by: o.userId,
          });
      if (r.error) throw r.error;
      await qc.invalidateQueries({ queryKey: ["execution"] });
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
      toast.error(t(m.includes("proposal_decision_denied") ? "ch.cp.needsAdmin" : "ch.cp.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    let p;
    try {
      p = saveDraft(text);
    } catch {
      toast.error(t("ch.cp.empty"));
      return;
    }
    if (await persist(serialize(p))) {
      setEditing(false);
      toast.success(t("ch.cp.saved"));
    }
  }
  async function decideNow(approve: boolean) {
    if (!proposal || !o.userId) return;
    if (await persist(serialize(decide(proposal, approve, o.userId, new Date()))))
      toast.success(t(approve ? "ch.cp.approvedToast" : "ch.cp.rejectedToast"));
  }

  return (
    <section
      aria-labelledby={`cp-${campaignId}`}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`cp-${campaignId}`} className="flex items-center gap-2 font-semibold">
          <FileText className="size-4" />
          {t("ch.cp.title")}
        </h4>
        {proposal && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
            {t(`ch.cp.status.${proposal.status}`)}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("ch.cp.separation")}</p>
      {editing ? (
        <>
          <Textarea
            aria-label={t("ch.cp.title")}
            value={text}
            maxLength={PROPOSAL_MAX}
            rows={12}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("ch.cp.placeholder")}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !text.trim()} onClick={save}>
              {t("ch.cp.saveDraft")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t("ch.cp.cancel")}
            </Button>
          </div>
          {proposal && proposal.status !== "draft" && (
            <p className="text-xs text-muted-foreground">{t("ch.cp.reopens")}</p>
          )}
        </>
      ) : proposal ? (
        <>
          <AiMarkdown content={proposal.text} summary />
          {proposal.decidedAt && (
            <p className="text-xs text-muted-foreground">
              {t("ch.cp.decidedAt", { d: new Date(proposal.decidedAt).toLocaleString() })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {proposal.status === "draft" && canDecide && (
              <>
                <Button disabled={busy} onClick={() => decideNow(true)}>
                  <Check />
                  {t("ch.cp.approve")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => decideNow(false)}>
                  <X />
                  {t("ch.cp.reject")}
                </Button>
              </>
            )}
            {canEdit && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setText(proposal.text);
                  setEditing(true);
                }}
              >
                <Pencil />
                {t("ch.cp.modify")}
              </Button>
            )}
          </div>
          {approved && canEdit && made.data === 0 && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ListChecks className="size-4" />
                {t("ch.cp.tasksTitle")}
              </p>
              {items.length ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("ch.cp.tasksHint", { n: items.length })}
                  </p>
                  <ul className="list-disc pl-5 text-sm">
                    {items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                  <Button disabled={busy} onClick={createTasks}>
                    {t("ch.cp.tasksCreate", { n: items.length })}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("ch.cp.tasksNone")}</p>
              )}
            </div>
          )}
          {approved && !!made.data && (
            <p className="text-xs text-muted-foreground">{t("ch.cp.tasksDone")}</p>
          )}
          {proposal.status === "draft" && !canDecide && (
            <p className="text-xs text-muted-foreground">{t("ch.cp.needsAdmin")}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">{t("ch.cp.none")}</p>
          {canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              {t("ch.cp.add")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
