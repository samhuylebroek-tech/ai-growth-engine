import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Settings2, Zap } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { executeTaskRun } from "@/lib/ai.functions";
import { readyForBatch, RUN_ESTIMATE, BATCH_LIMIT, type TaskType } from "@/lib/task-execution";
import { taskExecutionOptions, runsByTask } from "@/components/execution/task-runs-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TaskLite = { id: string; priority: string; due_date: string | null; status: string };

/** Workspace AI execution summary: mode, limits, this month's use, settings (admins) and the bounded mode-4 batch. */
export function ExecutionBar({ tasks, blockedIds }: { tasks: readonly TaskLite[]; blockedIds: ReadonlySet<string> }) {
  const o = useOrg(); const { t } = useI18n(); const qc = useQueryClient();
  const role = o.workspaceRole === "owner" || o.workspaceRole === "admin" ? "admin" : o.workspaceRole === "member" ? "member" : "viewer";
  const q = useQuery(taskExecutionOptions(o.org?.id, o.workspace?.id, role !== "viewer"));
  const execute = useServerFn(executeTaskRun);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ mode: 2, max: 20, cap: 200 });
  if (q.isError && isNotInstalled(q.error)) return null;
  if (!q.data) return null;
  const s = q.data.settings;
  const runs = runsByTask(q.data.runs);
  const active = q.data.runs.filter((r) => ["queued", "running", "awaiting_approval", "paused", "uncertain"].includes(r.status));
  const reserved = active.reduce((n, r) => n + r.estimated_credits, 0);
  const costMap = new Map<string, { runs: number; credits: number }>();
  for (const r of q.data.runs) { const e = costMap.get(r.specialist_key) ?? { runs: 0, credits: 0 }; e.runs += 1; e.credits += r.credits_charged ?? 0; costMap.set(r.specialist_key, e); }
  const bySpecialist = [...costMap.entries()].sort((a, b) => b[1].credits - a[1].credits);
  const profiles = new Map(q.data.profiles.map((p) => [p.task_id, p.task_type as TaskType]));
  const ready = readyForBatch(tasks.map((x) => {
    const r = runs.get(x.id);
    return { ...x, type: profiles.get(x.id) ?? null, blocked: blockedIds.has(x.id), active: !!r && ["awaiting_approval", "queued", "paused", "running", "uncertain"].includes(r.latest.status), attempts: r?.attempts ?? 0, succeeded: !!r?.all.some((y) => y.status === "succeeded") };
  }));
  async function batch() {
    if (busy || !o.org || !o.workspace) return; setBusy(true);
    let done = 0;
    try {
      // Explicit stopping conditions: at most BATCH_LIMIT runs, stop at the first run that does not succeed.
      for (const x of ready) {
        const r = await growthDb.rpc("queue_task_run", { _task: x.id, _request: crypto.randomUUID(), _estimate: RUN_ESTIMATE });
        if (r.error) throw new Error(r.error.message);
        const row = r.data as { id: string; status: string };
        if (row.status !== "queued") continue;
        const e = await execute({ data: { orgId: o.org.id, workspaceId: o.workspace.id, runId: row.id } });
        await qc.invalidateQueries({ queryKey: ["task-execution"] });
        if (!e.ok || e.data.status !== "succeeded") throw new Error(e.ok ? t(`run.done.${e.data.status}` as MessageKey, { n: e.data.credits ?? 0 }) : e.error);
        done += 1;
      }
      toast.success(t("run.batchDone", { n: done }));
    } catch (e) { toast.error(`${t("run.batchStopped", { n: done })} ${e instanceof Error ? e.message : ""}`); }
    finally { setBusy(false); await Promise.all([qc.invalidateQueries({ queryKey: ["task-execution"] }), qc.invalidateQueries({ queryKey: ["execution"] })]); }
  }
  async function save() {
    if (!o.workspace) return; setBusy(true);
    const r = await growthDb.rpc("set_execution_settings", { _workspace: o.workspace.id, _mode: form.mode, _max_per_run: form.max, _monthly_cap: form.cap });
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success(t("run.settingsSaved")); setOpen(false); await qc.invalidateQueries({ queryKey: ["task-execution"] });
  }
  return <section aria-label={t("run.barTitle")} className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card p-3 text-sm">
    <span className="flex items-center gap-2 font-medium"><Bot className="h-4 w-4" />{t("run.mode", { n: s.mode })} · {t(`run.modeName.${s.mode}` as MessageKey)}</span>
    <span className="text-muted-foreground">{t("run.barUse", { used: q.data.monthUsed, cap: s.monthly_credit_cap })}</span>
    <span className="text-muted-foreground">{t("run.barReserved", { n: reserved })}</span>
    <span className="text-muted-foreground">{t("run.barActive", { n: active.length })}</span>
    {bySpecialist.length > 0 && <details className="w-full text-xs sm:order-last"><summary className="cursor-pointer text-muted-foreground">{t("run.costsBySpecialist")}</summary>
      <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">{bySpecialist.map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{t(`run.sp.${k}` as MessageKey)}</span><span className="tabular-nums text-muted-foreground">{t("run.costLine", { runs: v.runs, n: v.credits })}</span></li>)}</ul></details>}
    <div className="ml-auto flex flex-wrap gap-2">
      {s.mode === 4 && role !== "viewer" && <Button size="sm" disabled={busy || !ready.length} onClick={batch} title={t("run.batchHint", { n: BATCH_LIMIT })}><Zap />{t("run.batch", { n: ready.length })}</Button>}
      {role === "admin" && <Button size="sm" variant="outline" onClick={() => { setForm({ mode: s.mode, max: s.max_credits_per_run, cap: s.monthly_credit_cap }); setOpen(true); }}><Settings2 />{t("run.settings")}</Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>{t("run.settings")}</DialogTitle><DialogDescription>{t("run.settingsHint")}</DialogDescription></DialogHeader>
      <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">{t("run.modeLabel")}</legend>
        {[1, 2, 3, 4].map((m) => <label key={m} className="flex items-start gap-2 rounded-md border p-2 text-sm"><input type="radio" name="mode" className="mt-1" checked={form.mode === m} onChange={() => setForm({ ...form, mode: m })} />
          <span><span className="font-medium">{t("run.mode", { n: m })} · {t(`run.modeName.${m}` as MessageKey)}</span><span className="block text-xs text-muted-foreground">{t(`run.modeHint.${m}` as MessageKey)}</span></span></label>)}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">{t("run.maxPerRun")}<Input type="number" min={1} max={50} value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} /></label>
        <label className="grid gap-1 text-xs">{t("run.monthlyCap")}<Input type="number" min={0} max={100000} value={form.cap} onChange={(e) => setForm({ ...form, cap: Number(e.target.value) })} /></label>
      </div>
      <p className="text-xs text-muted-foreground">{t("run.externalAlways")}</p>
      <Button disabled={busy} onClick={save}>{t("run.save")}</Button>
    </DialogContent></Dialog>
  </section>;
}
