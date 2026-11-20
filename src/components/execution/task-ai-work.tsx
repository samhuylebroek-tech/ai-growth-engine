import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Bot, CircleAlert, Pause, Play, RotateCcw, ShieldCheck, Sparkles, X, Check } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, type TaskRunRow } from "@/lib/pending-schema";
import { supabase } from "@/integrations/supabase/client";
import { executeTaskRun } from "@/lib/ai.functions";
import { SPECIALIST_KEYS, TASK_SPECIALISTS, suggestSpecialist, defaultTaskType, runActions, reviewOutput, taskOutputSchema, RUN_ESTIMATE, type TaskSpecialist, type TaskType, type RunAction } from "@/lib/task-execution";
import { taskExecutionOptions, runsByTask, runTone } from "@/components/execution/task-runs-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const roleOf = (r: string | null): "viewer" | "member" | "admin" => (r === "owner" || r === "admin" ? "admin" : r === "member" ? "member" : "viewer");

/** One task's AI work: specialist assignment, run controls, approval, results, costs and history. */
export function TaskAIWork({ task, blocked }: { task: { id: string; title: string; description: string; status: string }; blocked: boolean }) {
  const o = useOrg(); const { t, tag } = useI18n(); const qc = useQueryClient();
  const role = roleOf(o.workspaceRole);
  const q = useQuery(taskExecutionOptions(o.org?.id, o.workspace?.id, role !== "viewer"));
  const execute = useServerFn(executeTaskRun);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pendingKey = useRef<string | null>(null);
  const profile = q.data?.profiles.find((p) => p.task_id === task.id);
  const suggestion = suggestSpecialist(task.title, task.description);
  const [spec, setSpec] = useState<TaskSpecialist>((profile?.specialist_key as TaskSpecialist | undefined) ?? suggestion.specialist);
  const [type, setType] = useState<TaskType>(profile?.task_type ?? defaultTaskType(suggestion.specialist));
  const [needsApproval, setNeedsApproval] = useState(profile?.requires_approval ?? false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["task-execution"] }), qc.invalidateQueries({ queryKey: ["execution"] })]);
  // Saved assignments replace the suggestion once they load or change.
  useEffect(() => {
    if (!profile) return;
    setSpec(profile.specialist_key as TaskSpecialist); setType(profile.task_type); setNeedsApproval(profile.requires_approval);
  }, [profile?.assigned_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isError && isNotInstalled(q.error)) return <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("run.notInstalled")}</p>;
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{t("run.loadFailed")}</p>;
  if (!q.data) return <p role="status" className="text-sm text-muted-foreground">{t("run.loading")}</p>;
  const s = q.data.settings;
  const mine = runsByTask(q.data.runs).get(task.id);
  const latest = mine?.latest ?? null;
  const actions = runActions({ latest, attempts: mine?.attempts ?? 0, role, taskType: profile?.task_type ?? null, taskStatus: task.status, blocked });
  const types = TASK_SPECIALISTS[spec].types;
  const capLeft = s.monthly_credit_cap - q.data.monthUsed;

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    if (busy) return; setBusy(true);
    try { const r = await fn(); if (r.error) throw new Error(r.error.message); if (ok) toast.success(ok); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : t("run.failedAction")); }
    finally { setBusy(false); }
  };
  async function startRun(runId: string) {
    const r = await execute({ data: { orgId: o.org!.id, workspaceId: o.workspace!.id, runId } });
    if (!r.ok) throw new Error(r.error);
    toast[r.data.status === "succeeded" ? "success" : "error"](t(`run.done.${r.data.status}` as MessageKey, { n: r.data.credits ?? 0 }));
  }
  async function run() {
    if (busy || !o.org || !o.workspace) return; setBusy(true);
    // One key per click attempt survives double clicks and errors; the database returns the same run for it.
    pendingKey.current ??= crypto.randomUUID();
    try {
      const r = await growthDb.rpc("queue_task_run", { _task: task.id, _request: pendingKey.current, _estimate: RUN_ESTIMATE });
      if (r.error) throw new Error(r.error.message);
      pendingKey.current = null;
      const row = r.data as { id: string; status: string };
      await refresh();
      if (row.status === "queued") await startRun(row.id);
      else toast.message(t("run.waitingApproval"));
    } catch (e) { toast.error(e instanceof Error ? e.message : t("run.failedAction")); }
    finally { setBusy(false); await refresh(); }
  }
  const button = (a: RunAction) => {
    const common = { size: "sm" as const, disabled: busy };
    switch (a) {
      case "run": case "retry": return <Button key={a} {...common} onClick={run}>{a === "run" ? <Sparkles /> : <RotateCcw />}{t(`run.a.${a}`, { n: RUN_ESTIMATE })}</Button>;
      case "start": return <Button key={a} {...common} onClick={async () => { if (busy) return; setBusy(true); try { await startRun(latest!.id); } catch (e) { toast.error(e instanceof Error ? e.message : t("run.failedAction")); } finally { setBusy(false); await refresh(); } }}><Play />{t("run.a.start", { n: RUN_ESTIMATE })}</Button>;
      case "approve": return <Button key={a} {...common} variant="outline" onClick={() => act(() => growthDb.rpc("decide_task_run", { _run: latest!.id, _decision: "approved", _note: note }), t("run.approved"))}><ShieldCheck />{t("run.a.approve")}</Button>;
      case "reject": return <Button key={a} {...common} variant="ghost" onClick={() => note.trim().length < 3 ? toast.error(t("run.reasonNeeded")) : act(() => growthDb.rpc("decide_task_run", { _run: latest!.id, _decision: "rejected", _note: note }), t("run.rejected"))}><X />{t("run.a.reject")}</Button>;
      case "pause": return <Button key={a} {...common} variant="outline" onClick={() => act(() => growthDb.rpc("control_task_run", { _run: latest!.id, _action: "pause" }))}><Pause />{t("run.a.pause")}</Button>;
      case "resume": return <Button key={a} {...common} variant="outline" onClick={() => act(() => growthDb.rpc("control_task_run", { _run: latest!.id, _action: "resume" }))}><Play />{t("run.a.resume")}</Button>;
      case "cancel": return <Button key={a} {...common} variant="ghost" onClick={() => act(() => growthDb.rpc("control_task_run", { _run: latest!.id, _action: "cancel" }))}><X />{t("run.a.cancel")}</Button>;
      case "accept": return <Button key={a} {...common} onClick={() => act(async () => supabase.from("tasks").update({ status: "done" }).eq("id", task.id).eq("workspace_id", o.workspace!.id), t("run.accepted"))}><Check />{t("run.a.accept")}</Button>;
    }
  };

  return <div className="space-y-4">
    <section className="space-y-2 rounded-lg border p-3" aria-label={t("run.assignTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4" />{t("run.assignTitle")}</h3>
        <Badge variant="outline" className="font-normal">{t("run.mode", { n: s.mode })} · {t(`run.modeName.${s.mode}` as MessageKey)}</Badge>
      </div>
      {profile ? <p className="text-sm">{t(`run.sp.${profile.specialist_key}` as MessageKey)} · {t(`run.type.${profile.task_type}` as MessageKey)}{profile.requires_approval ? ` · ${t("run.needsApproval")}` : ""}</p>
        : <p className="text-xs text-muted-foreground">{t("run.suggested", { s: t(`run.sp.${suggestion.specialist}` as MessageKey) })}{suggestion.matched.length ? ` (${suggestion.matched.slice(0, 3).join(", ")})` : ""}</p>}
      {role !== "viewer" && (!latest || !["awaiting_approval", "queued", "paused", "running", "uncertain"].includes(latest.status)) && <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">{t("run.specialist")}
          <select className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={spec} onChange={(e) => { const v = e.target.value as TaskSpecialist; setSpec(v); if (!TASK_SPECIALISTS[v].types.includes(type)) setType(defaultTaskType(v)); }}>
            {SPECIALIST_KEYS.map((k) => <option key={k} value={k}>{t(`run.sp.${k}` as MessageKey)}</option>)}
          </select></label>
        <label className="grid gap-1 text-xs">{t("run.typeLabel")}
          <select className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {types.map((k) => <option key={k} value={k}>{t(`run.type.${k}` as MessageKey)}</option>)}
          </select></label>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} />{t("run.requireApproval")}</label>
        <div className="sm:col-span-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => growthDb.rpc("assign_task_specialist", { _task: task.id, _specialist: spec, _type: type, _requires_approval: needsApproval }), t("run.assigned"))}>{profile ? t("run.reassign") : t("run.assign")}</Button></div>
      </div>}
      {profile?.task_type === "external" && <p className="flex items-start gap-1.5 text-xs text-warning"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("run.externalBlocked")}</p>}
      {blocked && <p className="flex items-start gap-1.5 text-xs text-warning"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("run.blocked")}</p>}
    </section>

    {profile && profile.task_type !== "external" && <section className="space-y-2 rounded-lg border p-3" aria-label={t("run.runTitle")}>
      <h3 className="text-sm font-semibold">{t("run.runTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("run.estimate", { n: RUN_ESTIMATE, max: s.max_credits_per_run, used: q.data.monthUsed, cap: s.monthly_credit_cap })}</p>
      {capLeft < RUN_ESTIMATE && <p className="text-xs text-warning">{t("run.capReached")}</p>}
      {latest && <div className="text-sm"><Badge variant="outline" className={cn("mr-2 font-normal", runTone(latest.status))}>{t(`run.st.${latest.status}` as MessageKey)}</Badge>
        {latest.status === "running" && t("run.runningHint")}{latest.status === "uncertain" && t("run.uncertainHint")}{latest.error && latest.status !== "uncertain" ? latest.error : ""}</div>}
      {latest?.status === "awaiting_approval" && role === "admin" && <Textarea aria-label={t("run.decisionNote")} placeholder={t("run.decisionNote")} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16 text-sm" />}
      {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions.map(button)}</div>}
    </section>}

    {latest?.status === "succeeded" && latest.output && <RunResult run={latest} />}

    {mine && mine.all.length > 0 && <section className="space-y-1 rounded-lg border p-3" aria-label={t("run.history")}>
      <h3 className="text-sm font-semibold">{t("run.history")}</h3>
      <p className="text-xs text-muted-foreground">{t("run.costTotal", { n: mine.charged })}</p>
      <ol className="divide-y text-xs">{mine.all.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        <span className="font-medium">#{r.attempt}</span><Badge variant="outline" className={cn("font-normal", runTone(r.status))}>{t(`run.st.${r.status}` as MessageKey)}</Badge>
        <span>{t(`run.sp.${r.specialist_key}` as MessageKey)}</span>
        <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}</span>
        <span className="text-muted-foreground">{r.credits_charged != null ? t("run.credits", { n: r.credits_charged }) : t("run.estimated", { n: r.estimated_credits })}</span>
        {r.decision_note && <span className="w-full text-muted-foreground">{t("run.note")}: {r.decision_note}</span>}
        {r.error && r.status !== "succeeded" && <span className="w-full text-muted-foreground">{r.error}</span>}
      </li>)}</ol>
    </section>}
  </div>;
}

function RunResult({ run }: { run: TaskRunRow }) {
  const { t } = useI18n();
  const parsed = taskOutputSchema.safeParse(run.output);
  const raw = run.output as { markdown?: string } | null;
  // A recovered result (saved but not parsed before a timeout) may still be the specialist's JSON.
  const recovered = !parsed.success && raw?.markdown ? (() => { try { return taskOutputSchema.safeParse(JSON.parse(raw.markdown.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""))); } catch { return null; } })() : null;
  const o = parsed.success ? parsed.data : recovered?.success ? recovered.data : null;
  const review = reviewOutput(o);
  return <section className="space-y-3 rounded-lg border p-3" aria-label={t("run.result")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("run.result")}</h3><Badge variant="secondary" className="font-normal">{t(`run.sp.${run.specialist_key}` as MessageKey)}</Badge></div>
    <div className="rounded-md bg-muted/40 p-2 text-xs"><p className="font-medium">{t("run.reviewTitle")}</p>
      <p>{t(`run.next.${review.next}` as MessageKey)}</p>
      {review.flags.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted-foreground">{review.flags.map((f) => <li key={f}>{t(`run.flag.${f}` as MessageKey)}</li>)}</ul>}</div>
    {o ? <>
      <div><p className="font-medium">{o.title}</p><p className="text-sm text-muted-foreground">{o.summary}</p></div>
      {o.sections.map((x, i) => <div key={i} className="prose prose-sm max-w-none break-words dark:prose-invert"><h4>{x.heading}</h4><ReactMarkdown remarkPlugins={[remarkGfm]}>{x.body}</ReactMarkdown></div>)}
      {o.deliverables.length > 0 && <Block title={t("run.deliverables")} items={o.deliverables} />}
      {o.evidence_gaps.length > 0 && <Block title={t("run.gaps")} items={o.evidence_gaps} />}
      {o.next_steps.length > 0 && <Block title={t("run.nextSteps")} items={o.next_steps.map((n) => `${n.title} (${t(n.owner === "ai" ? "run.ownerAi" : "run.ownerTeam")})`)} />}
      {o.external_actions.length > 0 && <div className="rounded-md border border-warning/40 p-2 text-xs"><p className="font-medium text-warning">{t("run.external")}</p>
        <ul className="list-disc pl-4">{o.external_actions.map((x, i) => <li key={i}>{x.action}{x.system ? ` · ${x.system}` : ""}</li>)}</ul><p className="mt-1 text-muted-foreground">{t("run.externalNote")}</p></div>}
    </> : <div className="prose prose-sm max-w-none break-words dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{raw?.markdown ?? ""}</ReactMarkdown></div>}
  </section>;
}
function Block({ title, items }: { title: string; items: string[] }) {
  return <div className="text-sm"><p className="font-medium">{title}</p><ul className="list-disc pl-5 text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}
