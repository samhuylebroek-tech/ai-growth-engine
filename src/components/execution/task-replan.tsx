// Re-planning tab of a task: why it needs re-planning, the options with their impact on dependent tasks, the open
// proposal with editor decisions, and the full history. Proposing costs no credits; nothing changes without approval.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can, hasRole } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, type ReplanOption } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import { buildReplan, replanStatus, type Dependency, type ReplanTask } from "@/lib/task-replan";
import { localDay, executionOptions } from "@/lib/execution";
import { replanOptions } from "@/components/execution/replan-data";
import { taskExecutionOptions, runsByTask } from "@/components/execution/task-runs-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "");

export function TaskReplan({ taskId }: { taskId: string }) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const exec = useQuery({ ...taskExecutionOptions(o.org?.id, o.workspace?.id, false), enabled: !!o.org && !!o.workspace });
  const rp = useQuery(replanOptions(o.org?.id, o.workspace?.id));
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<string>("a");
  const [adjust, setAdjust] = useState("");
  const [note, setNote] = useState("");
  const request = useRef<string | null>(null);
  const member = can(o.workspaceRole, "profile.edit");
  const editor = hasRole(o.workspaceRole, "editor");
  const today = localDay();
  const fmt = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(tag) : tx("rp.noDate"));
  const lbl = (s: string) => (`work.l.${s}` as MessageKey);

  const tasks: ReplanTask[] = (work.data?.tasks ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, start_date: t.start_date, owner_id: t.owner_id, campaign_id: t.campaign_id }));
  const task = tasks.find((t) => t.id === taskId);
  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? id.slice(0, 8);
  const deps: Dependency[] = (work.data?.notes ?? []).filter((n) => n.kind === "dependency" && n.entity_type === "tasks" && n.related_id).map((n) => ({ task: n.entity_id, on: n.related_id! }));
  const assigned = new Set((work.data?.notes ?? []).filter((n) => n.kind === "member" && n.entity_type === "tasks").map((n) => n.entity_id));
  const runState = new Map([...runsByTask(exec.data?.runs ?? [])].map(([k, v]) => [k, v.latest.status]));
  const campaignEnd = new Map((work.data?.campaigns ?? []).map((c) => [c.id, c.end_date]));
  const plan = useMemo(() => (task ? buildReplan(task, { tasks, deps, runState, assigned, campaignEnd, today }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task, work.data, exec.data, today]);

  const mine = (rp.data?.proposals ?? []).filter((p) => p.task_id === taskId);
  const decisions = rp.data?.decisions ?? [];
  const openOne = mine.find((p) => ["pending", "postponed"].includes(replanStatus(p, decisions)));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["task-replan"] }), qc.invalidateQueries({ queryKey: ["execution"] })]);

  if (rp.error && isNotInstalled(rp.error)) return <p className="text-sm text-muted-foreground">{tx("rp.spend.notInstalled")}</p>;
  if (!task) return null;

  async function propose() {
    if (!o.workspace || !plan || busy) return;
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const r = await growthDb.rpc("propose_task_replan", {
        _workspace: o.workspace.id, _request: request.current, _task: taskId,
        _p: { origin: "rule", reasons: plan.reasons, risk: plan.risk, credit_impact: 0,
          // "moves" is display-only; the database receives task, date and the task it waits on.
          options: plan.options.map((op) => ({ ...op, shifts: (op.shifts ?? []).map(({ task_id, due_date, after }) => ({ task_id, due_date, ...(after ? { after } : {}) })) })),
          impact: { affected: plan.affected, campaign_end: plan.campaignEnd, campaign_end_exceeded: plan.campaignEndExceeded, invalid_order: plan.invalidOrder } } as unknown as Json,
      });
      if (r.error) throw r.error;
      request.current = null;
      await refresh();
      toast.success(tx("rp.proposed"));
    } catch (e) {
      const m = errText(e);
      toast.error(tx(m === "replan_already_open" ? "rp.alreadyOpen" : m === "replan_task_closed" ? "rp.taskClosed" : "rp.failed"));
      if (m === "replan_already_open" || m === "replan_task_closed") { request.current = null; await refresh(); }
    } finally { setBusy(false); }
  }
  async function decide(decision: "approved" | "rejected" | "postponed") {
    if (!openOne || busy) return;
    setBusy(true);
    try {
      const r = await growthDb.rpc("decide_task_replan", { _proposal: openOne.id, _decision: decision, _option: decision === "approved" ? choice : null, _due: decision === "approved" && adjust ? adjust : null, _note: note.trim().slice(0, 500) });
      if (r.error) throw r.error;
      setAdjust(""); setNote("");
      await refresh();
      toast.success(tx(decision === "approved" ? "rp.applied" : decision === "rejected" ? "rp.rejected" : "rp.postponed"));
    } catch (e) {
      const m = errText(e);
      toast.error(tx(m === "replan_stale" ? "rp.stale" : m === "replan_already_decided" ? "rp.decided" : m === "replan_task_closed" ? "rp.taskClosed" : "rp.decideFailed"));
      await refresh();
    } finally { setBusy(false); }
  }
  // Stored proposals predate "moves"; compare with today's deadline instead.
  const moving = (op: ReplanOption) => (op.shifts ?? []).filter((x) => x.moves ?? tasks.find((t) => t.id === x.task_id)?.due_date !== x.due_date);
  const optionLine = (op: ReplanOption) => tx("rp.optLine", { d: fmt(op.due_date), p: op.priority ? tx("rp.optPri", { p: tx(lbl(op.priority)) }) : "" });

  return (
    <section aria-label={tx("rp.title")} className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{tx("rp.intro")}</p>
      <p className="text-xs">{tx("rp.current", { d: fmt(task.due_date), p: tx(lbl(task.priority)), s: tx(lbl(task.status)) })}</p>
      {openOne ? (
        <div className="space-y-2 rounded-md border border-warning/50 bg-card p-3">
          <p className="font-medium">{tx("rp.open")} · {tx(`rp.st.${replanStatus(openOne, decisions)}` as MessageKey)}</p>
          <ul className="list-disc pl-5 text-xs">{openOne.reasons.map((r) => <li key={r}>{tx(`rp.r.${r}` as MessageKey)}</li>)}</ul>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">{tx("rp.choose")}</legend>
            {openOne.options.map((op) => (
              <label key={op.key} className="flex items-start gap-2 text-xs">
                <input type="radio" name={`replan-${openOne.id}`} value={op.key} checked={choice === op.key} disabled={!editor} onChange={() => setChoice(op.key)} className="mt-0.5" />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{tx(`rp.o.${op.kind}` as MessageKey)}</span> — {optionLine(op)}
                  {moving(op).length ? <span className="block text-muted-foreground">{tx("rp.shifts", { list: moving(op).map((s) => `${title(s.task_id)} (${fmt(s.due_date)})`).join(", ") })}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <ImpactLines tx={tx} fmt={fmt} title={title} affected={openOne.impact.affected ?? []} invalid={openOne.impact.invalid_order ?? []} end={openOne.impact.campaign_end_exceeded ? (openOne.impact.campaign_end ?? null) : null} risk={openOne.risk} />
          {editor ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">{tx("rp.adjust")}<Input type="date" min={today} value={adjust} onChange={(e) => setAdjust(e.target.value)} /></label>
              <label className="text-xs">{tx("rp.note")}<Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button size="sm" disabled={busy} onClick={() => decide("approved")}>{tx("rp.approve")}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("postponed")}>{tx("rp.postpone")}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("rejected")}>{tx("rp.reject")}</Button>
              </div>
            </div>
          ) : <p className="text-xs text-muted-foreground">{tx("rp.editorOnly")}</p>}
        </div>
      ) : !["done", "cancelled"].includes(task.status) && plan ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium">{tx("rp.why")}</p>
          <ul className="list-disc pl-5 text-xs">{plan.reasons.map((r) => <li key={r}>{tx(`rp.r.${r}` as MessageKey)}</li>)}</ul>
          <p className="text-xs font-medium">{tx("rp.options")}</p>
          <ul className="space-y-1 text-xs">
            {plan.options.map((op) => (
              <li key={op.key} className="break-words"><span className="font-medium">{tx(`rp.o.${op.kind}` as MessageKey)}</span> — {optionLine(op)}
                {moving(op).length ? <span className="block text-muted-foreground">{tx("rp.shifts", { list: moving(op).map((s) => `${title(s.task_id)} (${fmt(s.due_date)})`).join(", ") })}</span> : null}
              </li>
            ))}
          </ul>
          <ImpactLines tx={tx} fmt={fmt} title={title} affected={plan.affected} invalid={plan.invalidOrder} end={plan.campaignEndExceeded ? plan.campaignEnd : null} risk={plan.risk} />
          {member && <Button size="sm" disabled={busy} onClick={propose}>{busy ? tx("rp.proposing") : tx("rp.propose")}</Button>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{tx(["done", "cancelled"].includes(task.status) ? "rp.closed" : "rp.none")}</p>
      )}
      {mine.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">{tx("rp.history")} ({mine.length})</summary>
          <ul className="mt-2 space-y-2">
            {mine.map((p) => {
              const st = replanStatus(p, decisions);
              const fin = decisions.find((d) => d.proposal_id === p.id && d.decision === "approved");
              return (
                <li key={p.id} className="border-b border-border pb-2">
                  <p><span className={cn("rounded border px-1.5 py-0.5", st === "approved" ? "border-success/40 text-success" : st === "rejected" ? "text-muted-foreground" : "border-warning/50 text-warning")}>{tx(`rp.st.${st}` as MessageKey)}</span>{" "}
                    {new Date(p.created_at).toLocaleString(tag)} · {tx(p.origin === "rule" ? "rp.byRules" : "rp.byTeam")}</p>
                  <p className="mt-1 text-muted-foreground">{p.reasons.map((r) => tx(`rp.r.${r}` as MessageKey)).join(" · ")}</p>
                  {fin?.applied.before && fin.applied.after && (
                    <p className="mt-1">{tx("rp.change", { a: fmt(fin.applied.before.due_date), b: fmt(fin.applied.after.due_date), c: tx(lbl(fin.applied.before.priority)), e: tx(lbl(fin.applied.after.priority)) })}
                      {fin.applied.shifted?.length ? ` · ${tx("rp.moved", { n: fin.applied.shifted.length })}` : ""}</p>
                  )}
                  {decisions.filter((d) => d.proposal_id === p.id && d.note).map((d) => <p key={d.id} className="mt-1 italic text-muted-foreground">“{d.note}”</p>)}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function ImpactLines({ tx, fmt, title, affected, invalid, end, risk }: {
  tx: ReturnType<typeof useI18n>["t"]; fmt: (d: string | null) => string; title: (id: string) => string;
  affected: string[]; invalid: string[]; end: string | null; risk: "low" | "medium" | "high";
}) {
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium">{tx("rp.impact")}</p>
      <p>{affected.length ? tx("rp.affected", { n: affected.length, list: affected.map(title).join(", ") }) : tx("rp.affectedNone")}</p>
      {invalid.length > 0 && <p className="text-warning">{tx("rp.invalidOrder", { list: invalid.map(title).join(", ") })}</p>}
      {end && <p className="text-warning">{tx("rp.campaignEnd", { d: fmt(end) })}</p>}
      <p>{tx("rp.risk", { r: tx(`rp.risk.${risk}` as MessageKey) })} · {tx("rp.cost")}</p>
      <p className="text-muted-foreground">{tx("rp.approval")}</p>
    </div>
  );
}
