import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { goalProgress, budgetTotals, budgetAlert } from "@/lib/growth-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const OBJECTIVES: Record<string, string> = { revenue: "Increase revenue", leads: "Qualified leads", customers: "New customers", reservations: "Reservations", online_sales: "Online sales", retention: "Customer retention", launch: "Launch a product", new_market: "Enter a new market", awareness: "Brand awareness", cac: "Lower acquisition cost", repeat_purchases: "Repeat purchases", other: "Other" };
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

export function GoalsAndBudget() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to plan goals and budget.</p>;
  return <Planner key={workspace.id} orgId={org.id} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} />;
}

function Planner({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthStart());
  const goals = useQuery({ queryKey: ["growth-goals", wsId], queryFn: async () => {
    const r = await supabase.from("growth_goals").select("*").eq("workspace_id", wsId).neq("status", "archived").order("priority").order("created_at").limit(100);
    if (r.error) throw r.error; return r.data; } });
  const lines = useQuery({ queryKey: ["budget-lines", wsId, month], queryFn: async () => {
    const r = await supabase.from("budget_lines").select("*").eq("workspace_id", wsId).eq("period_month", month).order("created_at").limit(200);
    if (r.error) throw r.error; return r.data; } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["growth-goals", wsId] }).then(() => qc.invalidateQueries({ queryKey: ["budget-lines", wsId] }));

  const [g, setG] = useState({ title: "", objective: "leads", metric: "", baseline: "", target: "", due: "" });
  const addGoal = async () => {
    if (!g.title.trim()) return void toast.error("Give the goal a name.");
    const r = await supabase.from("growth_goals").insert({ org_id: orgId, workspace_id: wsId, title: g.title.trim(), objective: g.objective, metric: g.metric.trim(), baseline: num(g.baseline), target: num(g.target), due_date: g.due || null, priority: (goals.data?.length ?? 0) === 0 ? "primary" : "secondary" });
    if (r.error) return void toast.error("Could not save the goal.");
    setG({ title: "", objective: "leads", metric: "", baseline: "", target: "", due: "" }); await refresh();
  };
  const updateGoal = async (id: string, patch: { current_value?: number | null; priority?: string; status?: string }) => {
    const r = await supabase.from("growth_goals").update(patch).eq("id", id);
    if (r.error) toast.error("Could not update the goal."); await refresh();
  };

  const [b, setB] = useState({ channel: "", planned: "", cap: "", goal: "" });
  const addLine = async () => {
    const planned = num(b.planned) ?? 0, cap = num(b.cap);
    if (!b.channel.trim()) return void toast.error("Name the channel or activity.");
    if (cap != null && planned > cap) return void toast.error("Planned amount can't exceed the hard cap.");
    const r = await supabase.from("budget_lines").insert({ org_id: orgId, workspace_id: wsId, channel: b.channel.trim(), period_month: month, planned, hard_cap: cap, goal_id: b.goal || null });
    if (r.error) return void toast.error("Could not save the budget line.");
    setB({ channel: "", planned: "", cap: "", goal: "" }); await refresh();
  };
  const setActual = async (id: string, v: string) => {
    const n = num(v); if (n == null || n < 0) return;
    const r = await supabase.from("budget_lines").update({ actual: n }).eq("id", id);
    if (r.error) toast.error("Could not record spend."); await refresh();
  };

  const t = budgetTotals(lines.data ?? []);
  const fmt = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      <header><h1 className="text-2xl font-semibold">Goals & budget</h1>
        <p className="text-sm text-muted-foreground">Set what you want to achieve and what you plan to spend. Spend here is entered by you; no ad accounts are connected, and nothing is charged.</p></header>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-medium"><Target className="h-5 w-5" /> Business goals</h2>
        {goals.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (goals.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No goals yet. Start with your most important objective.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {(goals.data ?? []).map(x => { const p = goalProgress(x.baseline, x.target, x.current_value); return (
            <div key={x.id} className="space-y-2 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.title}</span>
                {x.priority === "primary" && <Badge>Primary</Badge>}<Badge variant="outline">{OBJECTIVES[x.objective]}</Badge>{x.status !== "active" && <Badge variant="secondary">{x.status}</Badge>}</div>
              <p className="text-sm text-muted-foreground">{x.metric || "No metric"} · baseline {x.baseline ?? "—"} → target {x.target ?? "—"}{x.due_date ? ` by ${x.due_date}` : ""}</p>
              {p != null ? <div className="space-y-1"><Progress value={p} /><p className="text-xs text-muted-foreground">{p}% of the way, based on the current value you entered</p></div> : <p className="text-xs text-muted-foreground">Enter a target and current value to track progress.</p>}
              {canEdit && <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Current value" className="h-8 w-32" type="number" min={0} placeholder="Current value" defaultValue={x.current_value ?? ""} onBlur={e => { const n = num(e.target.value); if (n !== x.current_value) void updateGoal(x.id, { current_value: n }); }} />
                {x.priority !== "primary" && <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { priority: "primary" })}>Make primary</Button>}
                {x.status === "active" ? <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "achieved" })}>Mark achieved</Button> : <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "active" })}>Reactivate</Button>}
                <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "archived" })}>Archive</Button>
              </div>}
            </div>); })}
        </div>
        {canEdit && <div className="grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Input aria-label="Goal name" placeholder="e.g. 100 qualified leads" value={g.title} onChange={e => setG({ ...g, title: e.target.value })} className="sm:col-span-2" />
          <select aria-label="Objective" className={sel} value={g.objective} onChange={e => setG({ ...g, objective: e.target.value })}>{Object.entries(OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <Input aria-label="Metric" placeholder="Metric (e.g. leads/month)" value={g.metric} onChange={e => setG({ ...g, metric: e.target.value })} />
          <Input aria-label="Baseline" type="number" min={0} placeholder="Baseline" value={g.baseline} onChange={e => setG({ ...g, baseline: e.target.value })} />
          <Input aria-label="Target" type="number" min={0} placeholder="Target" value={g.target} onChange={e => setG({ ...g, target: e.target.value })} />
          <Input aria-label="Deadline" type="date" value={g.due} onChange={e => setG({ ...g, due: e.target.value })} />
          <Button onClick={addGoal} className="sm:col-span-3 lg:col-span-1"><Plus className="mr-1 h-4 w-4" />Add goal</Button>
        </div>}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-medium"><Wallet className="h-5 w-5" /> Marketing budget</h2>
          <Input aria-label="Month" type="month" className="w-44" value={month.slice(0, 7)} onChange={e => e.target.value && setMonth(`${e.target.value}-01`)} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Planned", t.planned], ["Spent", t.actual], ["Remaining", t.remaining], ["Variance", t.variance]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold">{fmt(v as number)}</p></div>))}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Channel</th><th className="p-2">Goal</th><th className="p-2">Planned</th><th className="p-2">Cap</th><th className="p-2">Spent</th><th className="p-2">Status</th></tr></thead>
            <tbody>{(lines.data ?? []).length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">No budget planned for this month.</td></tr>}
              {(lines.data ?? []).map(l => { const a = budgetAlert(l); return (
                <tr key={l.id} className="border-t"><td className="p-2">{l.channel}</td><td className="p-2 text-muted-foreground">{goals.data?.find(x => x.id === l.goal_id)?.title ?? "—"}</td>
                  <td className="p-2">{fmt(Number(l.planned))}</td><td className="p-2">{l.hard_cap != null ? fmt(Number(l.hard_cap)) : "—"}</td>
                  <td className="p-2">{canEdit ? <Input aria-label={`Spent on ${l.channel}`} className="h-8 w-28" type="number" min={0} defaultValue={Number(l.actual)} onBlur={e => { if (Number(e.target.value) !== Number(l.actual)) void setActual(l.id, e.target.value); }} /> : fmt(Number(l.actual))}</td>
                  <td className="p-2">{a === "over_cap" ? <Badge variant="destructive">Over hard cap</Badge> : a === "over_plan" ? <Badge variant="destructive">Over plan</Badge> : a === "near_plan" ? <Badge variant="secondary">80%+ used</Badge> : <Badge variant="outline">On track</Badge>}</td></tr>); })}
            </tbody></table>
        </div>
        {canEdit && <div className="grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-5">
          <Input aria-label="Channel" placeholder="e.g. Google Ads" value={b.channel} onChange={e => setB({ ...b, channel: e.target.value })} />
          <Input aria-label="Planned amount" type="number" min={0} placeholder="Planned €" value={b.planned} onChange={e => setB({ ...b, planned: e.target.value })} />
          <Input aria-label="Hard cap" type="number" min={0} placeholder="Hard cap € (optional)" value={b.cap} onChange={e => setB({ ...b, cap: e.target.value })} />
          <select aria-label="Linked goal" className={sel} value={b.goal} onChange={e => setB({ ...b, goal: e.target.value })}><option value="">No linked goal</option>{(goals.data ?? []).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          <Button onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add budget line</Button>
        </div>}
      </section>
    </div>
  );
}
