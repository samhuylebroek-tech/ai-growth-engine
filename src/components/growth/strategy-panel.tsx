import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { planGrowthStrategy } from "@/lib/ai.functions";
import { strategySchema, type Strategy } from "@/lib/growth-strategy";
import { growthDb as supabase, GROWTH_PLANS_NOT_INSTALLED, isNotInstalled } from "@/lib/pending-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** User-started AI strategy for one goal. Nothing is saved or created until the user chooses to. */
export function StrategyPanel({ orgId, wsId, goalId, userId }: { orgId: string; wsId: string; goalId: string; goalTitle: string; userId: string }) {
  const run = useServerFn(planGrowthStrategy); const qc = useQueryClient(); const { t: tr, tag } = useI18n();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [weeks, setWeeks] = useState(12); const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ strategy: Strategy; key: string; saved: boolean } | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [planDraftCreated, setPlanDraftCreated] = useState(false);
  const saved = useQuery({ enabled: open, queryKey: ["growth-strategies", wsId, goalId], queryFn: async () => {
    const r = await supabase.from("growth_strategies").select("id,summary,body,created_at,request_key").eq("org_id", orgId).eq("workspace_id", wsId).eq("goal_id", goalId).order("created_at", { ascending: false }).limit(10);
    if (r.error) throw r.error; return r.data; } });

  const generate = async () => {
    setBusy(true);
    try {
      const r = await run({ data: { orgId, workspaceId: wsId, goalId, requestKey, horizonWeeks: weeks } });
      if (!r.ok) return void toast.error(r.error);
      setResult({ strategy: r.data.strategy, key: requestKey, saved: false }); setStrategyId(null); setPlanDraftCreated(false);
      setRequestKey(crypto.randomUUID()); toast.success(tr("goals.s.ready", { n: r.data.credits })); qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error(tr("goals.s.unconfirmed")); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!result || busy) return;
    setBusy(true);
    try {
      const inserted = await supabase.from("growth_strategies").insert({
        org_id: orgId, workspace_id: wsId, goal_id: goalId,
        request_key: result.key, summary: result.strategy.summary,
        body: result.strategy as never, created_by: userId,
      }).select("id").single();
      let id = inserted.data?.id ?? null;
      if (inserted.error?.code === "23505") {
        const existing = await supabase.from("growth_strategies").select("id")
          .eq("org_id", orgId).eq("workspace_id", wsId).eq("request_key", result.key).maybeSingle();
        if (existing.error || !existing.data) throw new Error("Saved strategy could not be recovered.");
        id = existing.data.id;
      } else if (inserted.error) {
        throw inserted.error;
      }
      if (!id) throw new Error("Saved strategy ID is missing.");
      setStrategyId(id);
      setResult(current => current ? { ...current, saved: true } : current);
      toast.success(tr("goals.s.saved"));
      await saved.refetch();
    } catch {
      toast.error(tr("goals.s.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const createPlanDraft = async () => {
    if (!result?.saved || !strategyId || creating || busy) return;
    setCreating(true);
    try {
      const response = await supabase.rpc("create_growth_plan_draft", { _strategy: strategyId });
      if (response.error) throw response.error;
      const receipt = response.data as { plan_id?: string; version?: number; status?: string } | null;
      if (!receipt?.plan_id || !receipt.version) throw new Error("The Growth Plan receipt is incomplete.");
      setPlanDraftCreated(true);
      if (receipt.status === "approved") toast.success(tr("goals.s.inApproved", { v: receipt.version }));
      else if (receipt.status === "draft") toast.success(tr("goals.s.draftReady", { v: receipt.version }));
      else toast.success(tr("goals.s.exists", { v: receipt.version, s: receipt.status ? tr(`goals.status.${receipt.status}` as MessageKey) : tr("goals.s.savedBadge") }));
      await qc.invalidateQueries({ queryKey: ["growth-plan-versions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", orgId, wsId] });
    } catch (error) {
      toast.error(isNotInstalled(error) ? GROWTH_PLANS_NOT_INSTALLED : tr("goals.s.draftFailed"));
    } finally {
      setCreating(false);
    }
  };

  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Compass className="mr-1 h-4 w-4" />{tr("goals.s.plan")}</Button>;
  const view = result?.strategy;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Compass className="h-4 w-4" />{tr("goals.s.title")}</h3><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tr("goals.s.close")}</Button></div>
      <p className="text-xs text-muted-foreground">{tr("goals.s.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={tr("goals.s.horizon")} className={sel} value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setRequestKey(crypto.randomUUID()); }}>{[4, 8, 12, 26].map((w) => <option key={w} value={w}>{tr("goals.s.weeks", { n: w })}</option>)}</select>
        <Button size="sm" disabled={busy} onClick={generate}>{busy ? tr("goals.s.planning") : tr("goals.s.generate")}</Button>
      </div>
      {view && <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2"><Badge variant="secondary">{tr("goals.s.aiSuggestion")}</Badge>{result.saved && <Badge variant="outline">{tr("goals.s.savedBadge")}</Badge>}</div>
        <p>{view.summary}</p>
        {view.channels.length > 0 && <div><p className="font-medium">{tr("goals.s.channelFocus")}</p><ul className="space-y-1">{view.channels.map((c) => <li key={c.name}><span className="font-medium">{c.name}</span> · {tr("goals.s.share", { n: c.share })} — <span className="text-muted-foreground">{c.why}</span></li>)}</ul></div>}
        <div><p className="font-medium">{tr("goals.s.initiatives")}</p><ul className="space-y-1">{view.actions.map((a, i) => (
          <li key={i} className="rounded-md bg-background/70 px-2 py-1.5">
            <span className="font-medium">{tr("goals.s.weekTitle", { n: a.week, title: a.title })}</span>{a.channel && <span className="text-muted-foreground"> · {a.channel}</span>} <Badge variant="outline">{tr(`goals.effort.${a.effort}` as MessageKey)}</Badge>{a.detail && <span className="block text-muted-foreground">{a.detail}</span>}
          </li>))}</ul><p className="mt-1 text-xs text-muted-foreground">{tr("goals.s.becomeDraft")}</p></div>
        {view.kpis.length > 0 && <div><p className="font-medium">{tr("goals.s.measure")}</p><ul className="list-disc pl-5">{view.kpis.map((k) => <li key={k.metric}>{k.metric}: {k.target}</li>)}</ul></div>}
        {view.risks.length > 0 && <div><p className="font-medium">{tr("goals.s.risks")}</p><ul className="list-disc pl-5">{view.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>}
        {view.assumptions.length > 0 && <div><p className="font-medium">{tr("goals.s.assumptions")}</p><ul className="list-disc pl-5">{view.assumptions.map((r) => <li key={r}>{r}</li>)}</ul></div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={result.saved || busy || creating} onClick={save}>{result.saved ? tr("goals.s.savedBadge") : busy ? tr("goals.s.saving") : tr("goals.s.save")}</Button>
          <Button size="sm" disabled={!result.saved || !strategyId || busy || creating || planDraftCreated} onClick={createPlanDraft}>{creating ? tr("goals.s.creatingDraft") : planDraftCreated ? tr("goals.s.draftCreated") : tr("goals.s.createDraft")}</Button>
          <Button size="sm" variant="ghost" disabled={busy || creating} onClick={() => { setResult(null); setStrategyId(null); setPlanDraftCreated(false); }}>{tr("goals.s.discard")}</Button>
        </div>
        {result.saved && <p className="text-xs text-muted-foreground">{tr("goals.s.needsApproval")}</p>}
      </div>}
      {(saved.data ?? []).length > 0 && <div className="space-y-1 border-t pt-2"><p className="text-xs font-medium text-muted-foreground">{tr("goals.s.savedList")}</p>
        {saved.data!.map((s) => <button key={s.id} type="button" className="block w-full truncate rounded px-1 text-left text-sm hover:bg-accent" onClick={() => { const p = strategySchema.safeParse(s.body); if (p.success) { setResult({ strategy: p.data, key: s.request_key, saved: true }); setStrategyId(s.id); setPlanDraftCreated(false); } }}>
          {new Date(s.created_at).toLocaleDateString(tag)} — {s.summary}</button>)}</div>}
    </div>
  );
}
