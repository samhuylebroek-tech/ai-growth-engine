import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlarmClock, Bot, Pause, Play, Settings2, Zap } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, type ExecutionCycleRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import { executeTaskRun } from "@/lib/ai.functions";
import { RUN_ESTIMATE, SPECIALIST_KEYS } from "@/lib/task-execution";
import { gateCode } from "@/lib/scheduler";
import { taskExecutionOptions, type EffectiveSettings } from "@/components/execution/task-runs-data";
import { cycleOptions } from "@/components/execution/cycle-data";
import { CycleHistory } from "@/components/execution/cycle-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Form = { mode: number; max: number; cap: number; daily: string; parallel: number; attempts: number; allowed: string[]; wStart: string; wEnd: string; tz: string; schedule: EffectiveSettings["schedule"]; hour: number };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const TIMEZONES = ["Europe/Brussels", "Europe/Amsterdam", "Europe/Paris", "Europe/London", "Europe/Berlin", "UTC"];

/** Workspace AI execution: mode, limits, use, emergency pause, scheduler cycles and settings (admins). */
export function ExecutionBar() {
  const o = useOrg(); const { t, tag } = useI18n(); const qc = useQueryClient();
  const role = o.workspaceRole === "owner" || o.workspaceRole === "admin" ? "admin" : o.workspaceRole === "member" ? "member" : "viewer";
  const q = useQuery(taskExecutionOptions(o.org?.id, o.workspace?.id, role !== "viewer"));
  const cq = useQuery(cycleOptions(o.org?.id, o.workspace?.id));
  const execute = useServerFn(executeTaskRun);
  const [open, setOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  if (q.isError && isNotInstalled(q.error)) return null;
  if (!q.data) return null;
  const s = q.data.settings;
  const active = q.data.runs.filter((r) => ["queued", "running", "awaiting_approval", "paused", "uncertain"].includes(r.status));
  const reserved = active.reduce((n, r) => n + r.estimated_credits, 0);
  const costMap = new Map<string, { runs: number; credits: number }>();
  for (const r of q.data.runs) { const e = costMap.get(r.specialist_key) ?? { runs: 0, credits: 0 }; e.runs += 1; e.credits += r.credits_charged ?? 0; costMap.set(r.specialist_key, e); }
  const bySpecialist = [...costMap.entries()].sort((a, b) => b[1].credits - a[1].credits);
  const cyclesOn = !cq.isError || !isNotInstalled(cq.error);
  const due = cq.data?.due;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["task-execution"] }), qc.invalidateQueries({ queryKey: ["execution-cycles"] }), qc.invalidateQueries({ queryKey: ["execution"] })]);
  const why = (e: { details?: string | null; message?: string } | null) => { const c = gateCode(e); return c ? t(`orch.reason.${c}` as MessageKey) : t("run.failedAction"); };

  async function cycle(trigger: "manual" | "scheduled") {
    if (busy || !o.org || !o.workspace) return; setBusy(true);
    try {
      const p = await growthDb.rpc("plan_execution_cycle", { _workspace: o.workspace.id, _request: crypto.randomUUID(), _trigger: trigger, _estimate: RUN_ESTIMATE });
      if (p.error) { toast.error(why(p.error)); return; }
      const c = p.data as unknown as ExecutionCycleRow;
      toast.info(t("orch.cyclePlanned", { q: c.queued, a: c.awaiting, s: c.skipped }));
      if (c.queued === 0) { if (c.awaiting === 0) toast.message(t("orch.cycleNothing")); return; }
      const items = await growthDb.from("execution_cycle_items").select("run_id,decision").eq("cycle_id", c.id).eq("decision", "queued");
      const runIds = (items.data ?? []).map((x) => x.run_id).filter((x): x is string => !!x);
      await refresh();
      // Controlled parallelism: never more than the workspace limit at once (the database enforces it too).
      const results: { ok: boolean; status?: string }[] = [];
      for (let i = 0; i < runIds.length; i += s.max_parallel) {
        const chunk = runIds.slice(i, i + s.max_parallel);
        const done = await Promise.allSettled(chunk.map((id) => execute({ data: { orgId: o.org!.id, workspaceId: o.workspace!.id, runId: id } })));
        for (const d of done) results.push(d.status === "fulfilled" && d.value.ok ? { ok: true, status: d.value.data.status } : { ok: false });
        await refresh();
      }
      const f = await growthDb.rpc("finish_execution_cycle", { _cycle: c.id });
      const sm = ((f.data as unknown as ExecutionCycleRow | null)?.summary ?? {}) as Record<string, number>;
      const ok = results.filter((r) => r.status === "succeeded").length;
      toast.success(t("orch.cycleDone", { ok, failed: results.length - ok, credits: sm["credits"] ?? 0 }));
    } catch { toast.error(t("run.failedAction")); }
    finally { setBusy(false); await refresh(); }
  }
  async function setPaused(paused: boolean) {
    if (!o.workspace) return; setBusy(true);
    const r = await growthDb.rpc("set_execution_paused", { _workspace: o.workspace.id, _paused: paused, _reason: paused ? reason : "" });
    setBusy(false);
    if (r.error) { toast.error(t("run.failedAction")); return; }
    toast.success(t(paused ? "orch.pausedToast" : "orch.resumedToast")); setPauseOpen(false); setReason(""); await refresh();
  }
  function edit() {
    setForm({ mode: s.mode, max: s.max_credits_per_run, cap: s.monthly_credit_cap, daily: s.daily_credit_cap == null ? "" : String(s.daily_credit_cap), parallel: s.max_parallel,
      attempts: s.max_attempts, allowed: s.allowed_specialists, wStart: s.window_start == null ? "" : String(s.window_start), wEnd: s.window_end == null ? "" : String(s.window_end),
      tz: s.timezone, schedule: s.schedule, hour: s.schedule_hour });
    setOpen(true);
  }
  async function save() {
    if (!o.workspace || !form) return;
    if ((form.wStart === "") !== (form.wEnd === "")) { toast.error(t("orch.windowBoth")); return; }
    setBusy(true);
    const a = await growthDb.rpc("set_execution_settings", { _workspace: o.workspace.id, _mode: form.mode, _max_per_run: form.max, _monthly_cap: form.cap });
    const g: Json = { daily_credit_cap: form.daily === "" ? null : Number(form.daily), max_parallel: form.parallel, max_attempts: form.attempts, allowed_specialists: form.allowed,
      window_start: form.wStart === "" ? null : Number(form.wStart), window_end: form.wEnd === "" ? null : Number(form.wEnd), timezone: form.tz, schedule: form.schedule, schedule_hour: form.hour };
    const b = a.error ? null : await growthDb.rpc("set_execution_governance", { _workspace: o.workspace.id, _g: g });
    setBusy(false);
    if (a.error || b?.error) { toast.error(t("run.failedAction")); return; }
    toast.success(t("run.settingsSaved")); setOpen(false); await refresh();
  }
  const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" }) : "";
  const num = (v: string, set: (n: string) => void) => <Input type="number" min={0} max={100000} value={v} onChange={(e) => set(e.target.value)} />;
  return <section aria-label={t("run.barTitle")} className="mb-5 rounded-lg border bg-card p-3 text-sm">
    {s.paused && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">
      <Pause className="h-4 w-4" /><span className="font-medium">{t("orch.paused")}</span>
      {(s.workspace_paused ?? s.paused) && <span className="text-muted-foreground">{s.pause_reason ? t("orch.pausedBy", { when: when(s.paused_at), reason: s.pause_reason }) : t("orch.pausedNoReason", { when: when(s.paused_at) })}</span>}
      {s.org_paused && <span className="w-full text-muted-foreground">{t("sec.stop.byOrg")}</span>}
      {s.platform_paused && <span className="w-full text-muted-foreground">{t("sec.stop.byPlatform")}</span>}
      {role === "admin" && (s.workspace_paused ?? s.paused) && <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => setPaused(false)}><Play />{t("orch.resume")}</Button>}
    </div>}
    {cyclesOn && due?.due && !s.paused && role === "admin" && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <AlarmClock className="h-4 w-4" /><span className="font-medium">{t("orch.dueTitle")}</span>
      <span className="text-muted-foreground">{t("orch.dueBody", { when: when(due.slot) })}</span>
      <Button size="sm" className="ml-auto" disabled={busy} onClick={() => cycle("scheduled")}><Zap />{t("orch.startScheduled")}</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-2 font-medium"><Bot className="h-4 w-4" />{t("run.mode", { n: s.mode })} · {t(`run.modeName.${s.mode}` as MessageKey)}</span>
      <span className="text-muted-foreground">{t("run.barUse", { used: q.data.monthUsed, cap: s.monthly_credit_cap })}</span>
      <span className="text-muted-foreground">{t("run.barReserved", { n: reserved })}</span>
      <span className="text-muted-foreground">{t("run.barActive", { n: active.length })}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {cyclesOn && role === "admin" && s.mode >= 3 && <Button size="sm" disabled={busy || s.paused} onClick={() => cycle("manual")} title={t("orch.runCycleHint", { n: s.max_parallel })}><Zap />{t("orch.runCycle")}</Button>}
        {cyclesOn && role === "admin" && !s.paused && <Button size="sm" variant="outline" disabled={busy} onClick={() => setPauseOpen(true)}><Pause />{t("orch.pause")}</Button>}
        {role === "admin" && <Button size="sm" variant="outline" onClick={edit}><Settings2 />{t("run.settings")}</Button>}
      </div>
    </div>
    {bySpecialist.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{t("run.costsBySpecialist")}</summary>
      <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">{bySpecialist.map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{t(`run.sp.${k}` as MessageKey)}</span><span className="tabular-nums text-muted-foreground">{t("run.costLine", { runs: v.runs, n: v.credits })}</span></li>)}</ul></details>}
    {cyclesOn && cq.data && <CycleHistory data={cq.data} />}
    <Dialog open={pauseOpen} onOpenChange={setPauseOpen}><DialogContent>
      <DialogHeader><DialogTitle>{t("orch.pause")}</DialogTitle><DialogDescription>{t("orch.pauseHint")}</DialogDescription></DialogHeader>
      <label className="grid gap-1 text-xs">{t("orch.pauseReason")}<Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button disabled={busy} onClick={() => setPaused(true)}><Pause />{t("orch.pauseConfirm")}</Button>
    </DialogContent></Dialog>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("run.settings")}</DialogTitle><DialogDescription>{t("run.settingsHint")}</DialogDescription></DialogHeader>
      {form && <>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">{t("run.modeLabel")}</legend>
          {[1, 2, 3, 4].map((m) => <label key={m} className="flex items-start gap-2 rounded-md border p-2 text-sm"><input type="radio" name="mode" className="mt-1" checked={form.mode === m} onChange={() => setForm({ ...form, mode: m })} />
            <span><span className="font-medium">{t("run.mode", { n: m })} · {t(`run.modeName.${m}` as MessageKey)}</span><span className="block text-xs text-muted-foreground">{t(`run.modeHint.${m}` as MessageKey)}</span></span></label>)}
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs">{t("run.maxPerRun")}<Input type="number" min={1} max={50} value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} /></label>
          <label className="grid gap-1 text-xs">{t("run.monthlyCap")}<Input type="number" min={0} max={100000} value={form.cap} onChange={(e) => setForm({ ...form, cap: Number(e.target.value) })} /></label>
          <label className="grid gap-1 text-xs">{t("orch.dailyCap")}{num(form.daily, (v) => setForm({ ...form, daily: v }))}</label>
          <label className="grid gap-1 text-xs">{t("orch.maxParallel")}<Input type="number" min={1} max={3} value={form.parallel} onChange={(e) => setForm({ ...form, parallel: Math.min(3, Math.max(1, Number(e.target.value))) })} /></label>
          <label className="grid gap-1 text-xs">{t("orch.maxAttempts")}<Input type="number" min={1} max={3} value={form.attempts} onChange={(e) => setForm({ ...form, attempts: Math.min(3, Math.max(1, Number(e.target.value))) })} /></label>
        </div>
        <fieldset className="grid gap-1"><legend className="mb-1 text-sm font-medium">{t("orch.allowed")}</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{SPECIALIST_KEYS.map((k) => <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.allowed.includes(k)}
            onChange={(e) => setForm({ ...form, allowed: e.target.checked ? [...form.allowed, k] : form.allowed.filter((x) => x !== k) })} />{t(`run.sp.${k}` as MessageKey)}</label>)}</div>
        </fieldset>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">{t("orch.window")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["wStart", "wEnd"] as const).map((f) => <label key={f} className="grid gap-1 text-xs">{t(f === "wStart" ? "orch.windowFrom" : "orch.windowTo")}
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })}>
                <option value="">{t("orch.windowAny")}</option>{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>)}
            <label className="grid gap-1 text-xs">{t("orch.timezone")}<select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })}>
              {[...new Set([form.tz, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
          </div>
        </fieldset>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">{t("orch.schedule")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label={t("orch.schedule")} className="h-9 rounded-md border bg-background px-2 text-sm" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value as Form["schedule"] })}>
              {(["off", "daily", "weekdays"] as const).map((x) => <option key={x} value={x}>{t(`orch.schedule.${x}` as MessageKey)}</option>)}</select>
            <label className="flex items-center gap-2 text-xs">{t("orch.scheduleHour")}<select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
          </div>
          <p className="text-xs text-muted-foreground">{t("orch.scheduleNote")}</p>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t("run.externalAlways")}</p>
        <Button disabled={busy} onClick={save}>{t("run.save")}</Button>
      </>}
    </DialogContent></Dialog>
  </section>;
}
