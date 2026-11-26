import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { prepareCampaignWork } from "@/lib/campaign-work.functions";
import { campaignAssignment, campaignWorkIdentity } from "@/lib/campaign-work";
import { CampaignWork } from "@/components/execution/campaign-work";
import type { MessageKey } from "@/lib/i18n/messages";
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
import type { Note, Task } from "@/lib/execution";

/** Review a campaign's proposal inside the campaign: save as draft, modify, approve or reject.
 * Approving the plan never authorises ad spend, publishing, sending or other external actions. */
export function CampaignProposal({
  campaignId,
  notes,
  tasks,
  blocked,
}: {
  campaignId: string;
  notes: readonly Note[];
  tasks: readonly Task[];
  blocked: ReadonlySet<string>;
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const prepare = useServerFn(prepareCampaignWork);
  const inFlight = useRef(false);
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
  const label = note ? proposalTaskLabel(note.id) : "";
  const version = useQuery({
    queryKey: ["campaign-proposal-version", approved?.id, proposal?.text],
    enabled: !!approved && !!proposal,
    queryFn: async () => {
      if (!approved || !proposal) throw new Error("No approved proposal");
      return campaignWorkIdentity(approved.id, proposal.text, items);
    },
  });
  const proposalWork = tasks.filter((task) => task.labels.includes(label));
  const legacy = proposalWork.some(
    (task) => !task.labels.some((l) => l.startsWith("proposal-version:")),
  );
  const currentWork = proposalWork.filter((task) =>
    task.labels.includes(version.data?.label ?? ""),
  );

  async function createTasks() {
    if (!approved || !o.org || !o.workspace || !canEdit || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await prepare({
        data: {
          orgId: o.org.id,
          workspaceId: o.workspace.id,
          campaignId,
          noteId: approved.id,
          expectedBody: approved.body,
        },
      });
      toast[r.assignmentPending ? "warning" : "success"](
        t(r.assignmentPending ? "ch.work.assignmentPending" : "ch.cp.tasksDone"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        t(
          message.includes("campaign_work_changed")
            ? "ch.work.changed"
            : message.includes("campaign_work_legacy")
              ? "ch.work.legacy"
              : "ch.work.failed",
        ),
      );
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["execution"] }),
        qc.invalidateQueries({ queryKey: ["campaign-work"] }),
        qc.invalidateQueries({ queryKey: ["task-execution"] }),
      ]);
      setBusy(false);
      inFlight.current = false;
    }
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
            .eq("body", note.body)
            .select("id")
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
      if (note && (!r.data || r.data.length !== 1)) throw new Error("campaign_work_changed");
      await qc.invalidateQueries({ queryKey: ["execution"] });
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
      toast.error(
        t(
          m.includes("campaign_work_changed")
            ? "ch.work.changed"
            : m.includes("proposal_decision_denied")
              ? "ch.cp.needsAdmin"
              : "ch.cp.failed",
        ),
      );
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
          {approved && canEdit && !legacy && currentWork.length === 0 && (
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
                      <li key={i}>
                        {i}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {t(`run.sp.${campaignAssignment(i).specialist}` as MessageKey)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button disabled={busy || !version.data} onClick={createTasks}>
                    {t("ch.cp.tasksCreate", { n: items.length })}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("ch.cp.tasksNone")}</p>
              )}
            </div>
          )}
          {legacy && (
            <p role="alert" className="text-xs text-warning">
              {t("ch.work.legacy")}
            </p>
          )}
          {approved && canEdit && currentWork.length > 0 && !legacy && (
            <Button variant="outline" disabled={busy} onClick={createTasks}>
              {t("ch.work.resumeAssignment")}
            </Button>
          )}
          {version.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t("ch.work.unavailable")}
            </p>
          )}
          <CampaignWork tasks={proposalWork} blocked={blocked} />
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
