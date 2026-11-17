import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { goalProgress, budgetTotals, budgetAlert, reallocationProposals } from "@/lib/growth-plan";
import { StrategyPanel } from "@/components/growth/strategy-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const OBJECTIVES: Record<string, string> = { revenue: "Increase revenue", leads: "Qualified leads", customers: "New customers", reservations: "Reservations", online_sales: "Online sales", retention: "Customer retention", launch: "Launch a product", new_market: "Enter a new market", awareness: "Brand awareness", cac: "Lower acquisition cost", repeat_purchases: "Repeat purchases", other: "Other" };
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

export function GoalsAndBudget() {
  const { workspace, org, workspaceRole, loading, userId } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to plan goals and budget.</p>;
  return <Planner key={workspace.id} orgId={org.id} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} userId={userId} canApprove={hasRole(workspaceRole, "admin")} />;
}

function Planner({ orgId, wsId, canEdit, canApprove, userId }: { orgId: string; wsId: string; canEdit: boolean; canApprove: boolean; userId: string }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthStart());
  const goals = useQuery({ queryKey: ["growth-goals", wsId], queryFn: async () => {
    const r = await supabase.from("growth_goals").select("*").eq("workspace_id", wsId).neq("status", "archived").order("priority").order("created_at").limit(100);
    if (r.error) throw r.error; return r.data; } });
  const budgetInitiatives = useQuery({
    queryKey: ["approved-budget-initiatives", wsId],
    enabled: canEdit,
    queryFn: async () => {
      const plans = await supabase.from("growth_plan_versions").select("id").eq("workspace_id", wsId).eq("status", "approved");
      if (plans.error) throw plans.error;
      const ids = (plans.data ?? []).map(plan => plan.id);
      if (!ids.length) return [];
      const r = await supabase.from("growth_initiatives").select("id,title,goal_id,plan_version_id")
        .eq("workspace_id", wsId).in("plan_version_id", ids).neq("status", "cancelled").order("sort_order");
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const lines = useQuery({ queryKey: ["budget-lines", wsId, month], queryFn: async () => {
    const r = await supabase.from("budget_lines").select("*").eq("workspace_id", wsId).eq("period_month", month).order("created_at").limit(200);
    if (r.error) throw r.error; return r.data; } });
  const links = useQuery({ queryKey: ["goal-links", wsId], queryFn: async () => {
    const [p, c] = await Promise.all([
      supabase.from("projects").select("id,title,goal_id,status").eq("workspace_id", wsId).neq("status", "archived").order("created_at", { ascending: false }).limit(200),
      supabase.from("campaigns").select("id,title,goal_id,status").eq("workspace_id", wsId).neq("status", "archived").order("created_at", { ascending: false }).limit(200),
    ]);
    if (p.error || c.error) throw p.error ?? c.error; return { projects: p.data, campaigns: c.data }; } });
  const link = async (table: "projects" | "campaigns", id: string, goalId: string | null) => {
    const r = await supabase.from(table).update({ goal_id: goalId }).eq("id", id).eq("workspace_id", wsId);
    if (r.error) toast.error("Could not link this work."); await qc.invalidateQueries({ queryKey: ["goal-links", wsId] });
  };
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

  const [b, setB] = useState({ channel: "", planned: "", cap: "", goal: "", initiative: "" });
  const addLine = async () => {
    const planned = num(b.planned) ?? 0, cap = num(b.cap);
    if (!b.channel.trim()) return void toast.error("Name the channel or activity.");
    if (cap != null && planned > cap) return void toast.error("Planned amount can't exceed the hard cap.");
    const r = await supabase.from("budget_lines").insert({ org_id: orgId, workspace_id: wsId, channel: b.channel.trim(), period_month: month, planned, hard_cap: cap, goal_id: b.goal || null, initiative_id: b.initiative || null });
    if (r.error) return void toast.error("Could not save the budget line.");
    setB({ channel: "", planned: "", cap: "", goal: "", initiative: "" }); await refresh();
  };
  const setActual = async (id: string, v: string) => {
    const n = num(v); if (n == null || n < 0) return;
    const r = await supabase.from("budget_lines").update({ actual: n }).eq("id", id);
    if (r.error) toast.error("Could not record spend."); await refresh();
  };

  const t = budgetTotals(lines.data ?? []);
  const now = new Date(); const sel0 = new Date(`${month}T00:00:00`);
  const days = new Date(sel0.getFullYear(), sel0.getMonth() + 1, 0).getDate();
  const elapsed = sel0.getFullYear() === now.getFullYear() && sel0.getMonth() === now.getMonth() ? now.getDate() / days : sel0 < now ? 1 : 0;
  const proposals = reallocationProposals(lines.data ?? [], elapsed);
  const applyMove = async (m: (typeof proposals)[number]) => {
    const from = lines.data?.find(l => l.id === m.fromId), to = lines.data?.find(l => l.id === m.toId); if (!from || !to) return;
    const a = await supabase.from("budget_lines").update({ planned: Number(from.planned) - m.amount }).eq("id", from.id);
    if (a.error) return void toast.error("Could not move the budget.");
    const b = await supabase.from("budget_lines").update({ planned: Number(to.planned) + m.amount }).eq("id", to.id);
    if (b.error) { await supabase.from("budget_lines").update({ planned: Number(from.planned) }).eq("id", from.id); return void toast.error("Could not move the budget; nothing was changed."); }
    toast.success(`Moved ${fmt(m.amount)} from ${m.from} to ${m.to}`); await refresh();
  };
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
            <div key={x.id} className="min-w-0 space-y-2 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.title}</span>
                {x.priority === "primary" && <Badge>Primary</Badge>}<Badge variant="outline">{OBJECTIVES[x.objective]}</Badge>{x.status !== "active" && <Badge variant="secondary">{x.status}</Badge>}</div>
              <p className="text-sm text-muted-foreground">{x.metric || "No metric"} · baseline {x.baseline ?? "—"} → target {x.target ?? "—"}{x.due_date ? ` by ${x.due_date}` : ""}</p>
              {p != null ? <div className="space-y-1"><Progress value={p} /><p className="text-xs text-muted-foreground">{p}% of the way, based on the current value you entered</p></div> : <p className="text-xs text-muted-foreground">Enter a target and current value to track progress.</p>}
              <GrowthPlanPanel goalId={x.id} wsId={wsId} canEdit={canEdit} canApprove={canApprove} />
              <GoalPlanSnapshot
                budgetLines={(lines.data ?? []).filter(line => line.goal_id === x.id)}
                linkedWorkCount={[...(links.data?.projects ?? []), ...(links.data?.campaigns ?? [])].filter(work => work.goal_id === x.id).length}
                month={month}
                formatAmount={(amount, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)}
              />
              <LinkedWork goalId={x.id} data={links.data} canEdit={canEdit} onLink={link} />
              {canEdit && x.status === "active" && <StrategyPanel orgId={orgId} wsId={wsId} goalId={x.id} goalTitle={x.title} userId={userId} />}
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
          <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Channel</th><th className="p-2">Goal / initiative</th><th className="p-2">Planned</th><th className="p-2">Cap</th><th className="p-2">Spent</th><th className="p-2">Status</th></tr></thead>
            <tbody>{(lines.data ?? []).length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">No budget planned for this month.</td></tr>}
              {(lines.data ?? []).map(l => { const a = budgetAlert(l); return (
                <tr key={l.id} className="border-t"><td className="p-2">{l.channel}</td><td className="p-2 text-muted-foreground">{goals.data?.find(x => x.id === l.goal_id)?.title ?? "—"}{l.initiative_id && <span className="block text-xs">{budgetInitiatives.data?.find(i => i.id === l.initiative_id)?.title ?? "Initiative linked"}</span>}</td>
                  <td className="p-2">{fmt(Number(l.planned))}</td><td className="p-2">{l.hard_cap != null ? fmt(Number(l.hard_cap)) : "—"}</td>
                  <td className="p-2">{canEdit ? <Input aria-label={`Spent on ${l.channel}`} className="h-8 w-28" type="number" min={0} defaultValue={Number(l.actual)} onBlur={e => { if (Number(e.target.value) !== Number(l.actual)) void setActual(l.id, e.target.value); }} /> : fmt(Number(l.actual))}</td>
                  <td className="p-2">{a === "over_cap" ? <Badge variant="destructive">Over hard cap</Badge> : a === "over_plan" ? <Badge variant="destructive">Over plan</Badge> : a === "near_plan" ? <Badge variant="secondary">80%+ used</Badge> : <Badge variant="outline">On track</Badge>}</td></tr>); })}
            </tbody></table>
        </div>
        {proposals.length > 0 && <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Suggested budget moves</p>
          <p className="text-xs text-muted-foreground">Simple rules, not AI: past mid-month, half of the unused budget on slow channels can move to channels already over plan, within their hard cap. Your total stays the same.</p>
          {proposals.map((m, i) => <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span>Move <span className="font-medium">{fmt(m.amount)}</span> from {m.from} to {m.to}<span className="block text-xs text-muted-foreground">{m.reason}</span></span>
            {canEdit && <Button size="sm" variant="outline" onClick={() => applyMove(m)}>Apply</Button>}</div>)}
        </div>}
        {canEdit && <div className="grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-5">
          <Input aria-label="Channel" placeholder="e.g. Google Ads" value={b.channel} onChange={e => setB({ ...b, channel: e.target.value })} />
          <Input aria-label="Planned amount" type="number" min={0} placeholder="Planned €" value={b.planned} onChange={e => setB({ ...b, planned: e.target.value })} />
          <Input aria-label="Hard cap" type="number" min={0} placeholder="Hard cap € (optional)" value={b.cap} onChange={e => setB({ ...b, cap: e.target.value })} />
          <div className="space-y-1"><select aria-label="Linked goal" className={`${sel} w-full`} value={b.goal} onChange={e => setB({ ...b, goal: e.target.value, initiative: "" })}><option value="">No linked goal</option>{(goals.data ?? []).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select><select aria-label="Linked approved initiative" className={`${sel} w-full`} value={b.initiative} onChange={e => { const initiative = budgetInitiatives.data?.find(i => i.id === e.target.value); setB({ ...b, initiative: e.target.value, goal: initiative?.goal_id ?? b.goal }); }}><option value="">No initiative link</option>{(budgetInitiatives.data ?? []).filter(i => !b.goal || i.goal_id === b.goal).map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></div>
          <Button onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add budget line</Button>
        </div>}
      </section>
    </div>
  );
}

function GoalPlanSnapshot({ budgetLines, linkedWorkCount, month, formatAmount }: {
  budgetLines: Array<{ id: string; planned: number | string; actual: number | string; currency: string }>;
  linkedWorkCount: number;
  month: string;
  formatAmount: (n: number, currency: string) => string;
}) {
  const currencies = [...new Set(budgetLines.map(line => line.currency))];
  const planned = budgetLines.reduce((sum, line) => sum + Number(line.planned), 0);
  const spent = budgetLines.reduce((sum, line) => sum + Number(line.actual), 0);
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">Plan snapshot · {new Date(`${month}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>{linkedWorkCount} linked {linkedWorkCount === 1 ? "work item" : "work items"}</span>
        <span>{budgetLines.length} budget {budgetLines.length === 1 ? "line" : "lines"}</span>
        {budgetLines.length > 0 && currencies.length === 1
          ? <span>{formatAmount(planned, currencies[0])} planned · {formatAmount(spent, currencies[0])} recorded</span>
          : budgetLines.length > 0
            ? <span>Multiple currencies — totals kept separate in the budget table</span>
            : <span>No budget assigned this month</span>}
      </div>
    </div>
  );
}
function GrowthPlanPanel({ goalId, wsId, canEdit, canApprove }: {
  goalId: string;
  wsId: string;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const qc = useQueryClient();
  const plans = useQuery({
    queryKey: ["growth-plan-versions", wsId, goalId],
    queryFn: async () => {
      const r = await supabase.from("growth_plan_versions").select("id,strategy_id,version,status,title,summary,approved_at,created_at")
        .eq("workspace_id", wsId).eq("goal_id", goalId).order("version", { ascending: false }).limit(10);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const latestStrategy = useQuery({
    queryKey: ["latest-saved-growth-strategy", wsId, goalId],
    enabled: canEdit,
    queryFn: async () => {
      const r = await supabase.from("growth_strategies").select("id")
        .eq("workspace_id", wsId).eq("goal_id", goalId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const initiatives = useQuery({
    queryKey: ["growth-initiatives", wsId, plans.data?.[0]?.id],
    enabled: Boolean(plans.data?.[0]?.id),
    queryFn: async () => {
      const r = await supabase.from("growth_initiatives").select("id,title,detail,channel,target_week,effort,status,sort_order,project_id")
        .eq("workspace_id", wsId).eq("plan_version_id", plans.data![0].id).order("sort_order");
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const createDraft = async () => {
    const strategyId = latestStrategy.data?.id;
    if (!strategyId) return;
    const r = await supabase.rpc("create_growth_plan_draft", { _strategy: strategyId });
    if (r.error) return void toast.error("Could not create the Growth Plan draft.");
    toast.success("Growth Plan draft created");
    await qc.invalidateQueries({ queryKey: ["growth-plan-versions", wsId, goalId] });
    await qc.invalidateQueries({ queryKey: ["growth-initiatives", wsId] });
  };
  const createWork = async (initiativeId: string) => {
    const r = await supabase.rpc("create_growth_initiative_work", { _initiative: initiativeId });
    if (r.error) return void toast.error("Could not create work from this initiative.");
    toast.success("Initiative added to Work");
    await qc.invalidateQueries({ queryKey: ["growth-initiatives", wsId] });
    await qc.invalidateQueries({ queryKey: ["goal-links", wsId] });
  };
  const approve = async (id: string) => {
    const r = await supabase.rpc("approve_growth_plan", { _plan: id });
    if (r.error) return void toast.error("Approval failed. Check your workspace permissions.");
    toast.success("Growth Plan approved");
    await qc.invalidateQueries({ queryKey: ["growth-plan-versions", wsId, goalId] });
  };
  const current = plans.data?.[0];
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">Growth Plan</p><p className="text-xs text-muted-foreground">Versioned strategy and prioritized initiatives</p></div>
        {canEdit && latestStrategy.data?.id && !plans.data?.some(p => p.strategy_id === latestStrategy.data?.id) &&
          <Button size="sm" variant="outline" onClick={createDraft}>Create plan draft</Button>}
      </div>
      {plans.isLoading ? <p className="text-xs text-muted-foreground">Loading plan…</p>
        : !current ? <p className="text-xs text-muted-foreground">No plan version yet. Generate and save a strategy, then create a draft here.</p>
        : <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">V{current.version} · {current.title}</span>
            <Badge variant={current.status === "approved" ? "default" : "secondary"}>{current.status}</Badge>
            {current.approved_at && <span className="text-xs text-muted-foreground">Approved {new Date(current.approved_at).toLocaleDateString()}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{current.summary}</p>
          {initiatives.isLoading ? <p className="text-xs text-muted-foreground">Loading initiatives…</p>
            : <ol className="space-y-2">{(initiatives.data ?? []).map((item, index) =>
              <li key={item.id} className="rounded-md bg-muted/40 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{index + 1}. {item.title}</span><Badge variant="outline">Week {item.target_week}</Badge><Badge variant="outline">{item.effort} effort</Badge></div>
                {item.detail && <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>}
                {item.channel && <p className="text-xs text-muted-foreground">Channel: {item.channel}</p>}
                {item.project_id ? <p className="text-xs text-muted-foreground">Work project created</p> : current.status === "approved" && canEdit ? <Button size="sm" variant="outline" onClick={() => createWork(item.id)}>Create work from initiative</Button> : null}
              </li>)}</ol>}
          {current.status === "draft" && canApprove && <Button size="sm" onClick={() => approve(current.id)}>Approve this plan</Button>}
          {current.status === "draft" && !canApprove && <p className="text-xs text-muted-foreground">Awaiting approval from a workspace admin or owner.</p>}
        </>}
    </div>
  );
}
type LinkRow = { id: string; title: string; goal_id: string | null };
function LinkedWork({ goalId, data, canEdit, onLink }: { goalId: string; data: { projects: LinkRow[]; campaigns: LinkRow[] } | undefined; canEdit: boolean; onLink: (t: "projects" | "campaigns", id: string, g: string | null) => void }) {
  if (!data) return null;
  const mine = [...data.projects.filter(p => p.goal_id === goalId).map(p => ({ ...p, t: "projects" as const })), ...data.campaigns.filter(c => c.goal_id === goalId).map(c => ({ ...c, t: "campaigns" as const }))];
  const free = [...data.projects.filter(p => !p.goal_id).map(p => ({ ...p, t: "projects" as const })), ...data.campaigns.filter(c => !c.goal_id).map(c => ({ ...c, t: "campaigns" as const }))];
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs font-medium text-muted-foreground">Linked work ({mine.length})</p>
      {mine.map(w => <div key={w.id} className="flex items-center justify-between gap-2"><span className="truncate">{w.t === "projects" ? "Project" : "Campaign"}: {w.title}</span>{canEdit && <Button size="sm" variant="ghost" className="h-7" onClick={() => onLink(w.t, w.id, null)}>Unlink</Button>}</div>)}
      {canEdit && free.length > 0 && <select aria-label="Link a project or campaign" className={`${sel} w-full max-w-full`} value="" onChange={e => { const w = free.find(f => f.id === e.target.value); if (w) onLink(w.t, w.id, goalId); }}>
        <option value="">Link a project or campaign…</option>{free.map(w => <option key={w.id} value={w.id}>{w.t === "projects" ? "Project" : "Campaign"}: {w.title}</option>)}</select>}
    </div>);
}
