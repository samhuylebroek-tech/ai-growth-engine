import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { planGrowthStrategy } from "@/lib/ai.functions";
import { strategySchema, type Strategy } from "@/lib/growth-strategy";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** User-started AI strategy for one goal. Nothing is saved or created until the user chooses to. */
export function StrategyPanel({ orgId, wsId, goalId, userId }: { orgId: string; wsId: string; goalId: string; goalTitle: string; userId: string }) {
  const run = useServerFn(planGrowthStrategy); const qc = useQueryClient();
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
      setRequestKey(crypto.randomUUID()); toast.success(`Strategy ready · ${r.data.credits} AI credits`); qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error("The request could not be confirmed. Check saved requests before trying again."); }
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
      toast.success("Strategy saved");
      await saved.refetch();
    } catch {
      toast.error("Could not confirm the saved strategy. Check saved strategies before retrying.");
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
      const receipt = response.data as { plan_id?: string; version?: number } | null;
      if (!receipt?.plan_id || !receipt.version) throw new Error("The Growth Plan receipt is incomplete.");
      setPlanDraftCreated(true);
      toast.success(`Growth Plan draft V${receipt.version} created · awaiting approval`);
      await qc.invalidateQueries({ queryKey: ["growth-plan-versions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", orgId, wsId] });
    } catch {
      toast.error("The Growth Plan draft could not be confirmed. Check the plan panel before retrying.");
    } finally {
      setCreating(false);
    }
  };

  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Compass className="mr-1 h-4 w-4" />Plan strategy</Button>;
  const view = result?.strategy;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Compass className="h-4 w-4" />Growth strategy</h3><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      <p className="text-xs text-muted-foreground">Uses this goal, this month's budget and your confirmed business facts. One strategy uses AI credits. It is a suggestion: you decide what to save and turn into work.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Planning horizon" className={sel} value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setRequestKey(crypto.randomUUID()); }}>{[4, 8, 12, 26].map((w) => <option key={w} value={w}>{w} weeks</option>)}</select>
        <Button size="sm" disabled={busy} onClick={generate}>{busy ? "Planning…" : "Generate strategy"}</Button>
      </div>
      {view && <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2"><Badge variant="secondary">AI suggestion</Badge>{result.saved && <Badge variant="outline">Saved</Badge>}</div>
        <p>{view.summary}</p>
        {view.channels.length > 0 && <div><p className="font-medium">Channel focus</p><ul className="space-y-1">{view.channels.map((c) => <li key={c.name}><span className="font-medium">{c.name}</span> · {c.share}% of effort — <span className="text-muted-foreground">{c.why}</span></li>)}</ul></div>}
        <div><p className="font-medium">Proposed initiatives</p><ul className="space-y-1">{view.actions.map((a, i) => (
          <li key={i} className="rounded-md bg-background/70 px-2 py-1.5">
            <span className="font-medium">Week {a.week}: {a.title}</span>{a.channel && <span className="text-muted-foreground"> · {a.channel}</span>} <Badge variant="outline">{a.effort} effort</Badge>{a.detail && <span className="block text-muted-foreground">{a.detail}</span>}
          </li>))}</ul><p className="mt-1 text-xs text-muted-foreground">These actions become initiatives in a draft Growth Plan. A workspace admin or owner must approve the plan before work is created.</p></div>
        {view.kpis.length > 0 && <div><p className="font-medium">Measure</p><ul className="list-disc pl-5">{view.kpis.map((k) => <li key={k.metric}>{k.metric}: {k.target}</li>)}</ul></div>}
        {view.risks.length > 0 && <div><p className="font-medium">Risks</p><ul className="list-disc pl-5">{view.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>}
        {view.assumptions.length > 0 && <div><p className="font-medium">Assumptions to check</p><ul className="list-disc pl-5">{view.assumptions.map((r) => <li key={r}>{r}</li>)}</ul></div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={result.saved || busy || creating} onClick={save}>{result.saved ? "Saved" : busy ? "Saving…" : "Save strategy"}</Button>
          <Button size="sm" disabled={!result.saved || !strategyId || busy || creating || planDraftCreated} onClick={createPlanDraft}>{creating ? "Creating draft…" : planDraftCreated ? "Draft created" : "Create Growth Plan draft"}</Button>
          <Button size="sm" variant="ghost" disabled={busy || creating} onClick={() => { setResult(null); setStrategyId(null); setPlanDraftCreated(false); }}>Discard</Button>
        </div>
        {result.saved && <p className="text-xs text-muted-foreground">The draft requires approval by a workspace admin or owner before it can create Work.</p>}
      </div>}
      {(saved.data ?? []).length > 0 && <div className="space-y-1 border-t pt-2"><p className="text-xs font-medium text-muted-foreground">Saved strategies</p>
        {saved.data!.map((s) => <button key={s.id} type="button" className="block w-full truncate rounded px-1 text-left text-sm hover:bg-accent" onClick={() => { const p = strategySchema.safeParse(s.body); if (p.success) { setResult({ strategy: p.data, key: s.request_key, saved: true }); setStrategyId(s.id); setPlanDraftCreated(false); } }}>
          {new Date(s.created_at).toLocaleDateString()} — {s.summary}</button>)}</div>}
    </div>
  );
}
