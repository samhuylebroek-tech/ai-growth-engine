import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { growthDb as supabase, GROWTH_PLANS_NOT_INSTALLED, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { goalProgress, budgetTotals, budgetAlert, reallocationProposals } from "@/lib/growth-plan";
import { goalMeasurement, type GoalLike } from "@/lib/goal-measurement";
import { StrategyPanel } from "@/components/growth/strategy-panel";
import { InitiativeOperations } from "@/components/growth/initiative-operations";
import { PlanDetails } from "@/components/growth/plan-details";
import { GrowthChain } from "@/components/growth/growth-chain";
import { strategySchema } from "@/lib/growth-strategy";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const OBJECTIVES = ["revenue", "leads", "customers", "reservations", "online_sales", "retention", "launch", "new_market", "awareness", "cac", "repeat_purchases", "other"] as const;
const objKey = (k: string) => `goals.obj.${(OBJECTIVES as readonly string[]).includes(k) ? k : "other"}` as MessageKey;
const statusKey = (s: string) => `goals.status.${s}` as MessageKey;
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

export function GoalsAndBudget() {
  const { workspace, org, workspaceRole, loading, userId } = useOrg();
  const { t: tr } = useI18n();
  if (loading) return <p className="p-6 text-muted-foreground">{tr("goals.loading")}</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">{tr("goals.chooseWorkspace")}</p>;
  return <Planner key={workspace.id} orgId={org.id} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} canBudget={hasRole(workspaceRole, "editor")} userId={userId} canApprove={hasRole(workspaceRole, "admin")} />;
}

function Planner({ orgId, wsId, canEdit, canBudget, canApprove, userId }: { orgId: string; wsId: string; canEdit: boolean; canBudget: boolean; canApprove: boolean; userId: string }) {
  const qc = useQueryClient();
  const { t: tr, tag } = useI18n();
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
  // Brands and business units of this business (proposal 0066); absent tables simply mean no brand choice.
  const units = useQuery({ queryKey: ["business-units", wsId], retry: retryUnlessNotInstalled, queryFn: async () => {
    const r = await supabase.from("business_units").select("id,name,kind").eq("workspace_id", wsId).eq("archived", false).order("name").limit(200);
    if (r.error) { if (isNotInstalled(r.error)) return []; throw r.error; } return r.data ?? []; } });
  const unitName = (id: string | null | undefined) => (id ? units.data?.find(u => u.id === id)?.name ?? null : null);
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
    if (r.error) toast.error(tr("goals.linkFailed")); await qc.invalidateQueries({ queryKey: ["goal-links", wsId] });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["growth-goals", wsId] }).then(() => qc.invalidateQueries({ queryKey: ["budget-lines", wsId] }));

  const [g, setG] = useState({ title: "", objective: "leads", metric: "", baseline: "", target: "", due: "", unit: "" });
  const addGoal = async () => {
    if (!g.title.trim()) return void toast.error(tr("goals.nameGoal"));
    const r = await supabase.from("growth_goals").insert({ org_id: orgId, workspace_id: wsId, title: g.title.trim(), objective: g.objective, metric: g.metric.trim(), baseline: num(g.baseline), target: num(g.target), due_date: g.due || null, priority: (goals.data?.length ?? 0) === 0 ? "primary" : "secondary", ...(g.unit ? { unit_id: g.unit } : {}) });
    if (r.error) return void toast.error(tr("goals.saveGoalFailed"));
    setG({ title: "", objective: "leads", metric: "", baseline: "", target: "", due: "", unit: "" }); await refresh();
  };
  const updateGoal = async (id: string, patch: { current_value?: number | null; priority?: string; status?: string }) => {
    const r = await supabase.from("growth_goals").update(patch).eq("id", id);
    if (r.error) toast.error(tr("goals.updateGoalFailed")); await refresh();
  };

  const [b, setB] = useState({ channel: "", planned: "", cap: "", goal: "", initiative: "", unit: "" });
  const addLine = async () => {
    const planned = num(b.planned) ?? 0, cap = num(b.cap);
    if (!b.channel.trim()) return void toast.error(tr("goals.nameChannel"));
    if (cap != null && planned > cap) return void toast.error(tr("goals.overCap"));
    const r = await supabase.from("budget_lines").insert({ org_id: orgId, workspace_id: wsId, channel: b.channel.trim(), period_month: month, planned, hard_cap: cap, goal_id: b.goal || null, initiative_id: b.initiative || null, ...(b.unit ? { unit_id: b.unit } : {}) });
    if (r.error) return void toast.error(tr("goals.saveLineFailed"));
    setB({ channel: "", planned: "", cap: "", goal: "", initiative: "", unit: "" }); await refresh();
  };
  const setActual = async (id: string, v: string) => {
    const n = num(v); if (n == null || n < 0) return;
    const r = await supabase.from("budget_lines").update({ actual: n }).eq("id", id);
    if (r.error) toast.error(tr("goals.spendFailed")); await refresh();
  };

  const t = budgetTotals(lines.data ?? []);
  const now = new Date(); const sel0 = new Date(`${month}T00:00:00`);
  const days = new Date(sel0.getFullYear(), sel0.getMonth() + 1, 0).getDate();
  const elapsed = sel0.getFullYear() === now.getFullYear() && sel0.getMonth() === now.getMonth() ? now.getDate() / days : sel0 < now ? 1 : 0;
  const proposals = reallocationProposals(lines.data ?? [], elapsed);
  const applyMove = async (m: (typeof proposals)[number]) => {
    const from = lines.data?.find(l => l.id === m.fromId), to = lines.data?.find(l => l.id === m.toId); if (!from || !to) return;
    // One locked database step: both lines change together, only if they still hold the amounts shown here.
    const r = await supabase.rpc("move_budget", { _from: from.id, _to: to.id, _amount: m.amount, _seen_from: Number(from.planned), _seen_to: Number(to.planned) });
    if (r.error) { await refresh(); return void toast.error(tr(r.error.code === "40001" ? "goals.moveStale" : "goals.moveFailed")); }
    toast.success(tr("goals.moved", { amount: fmt(m.amount, from.currency), from: m.from, to: m.to })); await refresh();
  };
  const fmt = (n: number, currency = "EUR") => new Intl.NumberFormat(tag, { style: "currency", currency }).format(n);
  const moveReason = (m: (typeof proposals)[number]) => {
    const from = lines.data?.find(l => l.id === m.fromId), to = lines.data?.find(l => l.id === m.toId);
    if (!from || !to || !Number(from.planned)) return m.reason;
    return tr("goals.moveReason", { from: m.from, to: m.to, pct: Math.round((Number(from.actual) / Number(from.planned)) * 100), over: fmt(Number(to.actual) - Number(to.planned), to.currency) });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      <header><h1 className="text-2xl font-semibold">{tr("goals.title")}</h1>
        <p className="text-sm text-muted-foreground">{tr("goals.intro")}</p></header>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-medium"><Target className="h-5 w-5" /> {tr("goals.businessGoals")}</h2>
        {goals.isLoading ? <p className="text-sm text-muted-foreground">{tr("goals.loading")}</p> : (goals.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{tr("goals.noGoals")}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {(goals.data ?? []).map(x => { const p = goalProgress(x.baseline, x.target, x.current_value); return (
            <div key={x.id} className="min-w-0 space-y-2 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.title}</span>
                {unitName(x.unit_id) && <Badge variant="outline">{unitName(x.unit_id)}</Badge>}{x.priority === "primary" && <Badge>{tr("goals.primary")}</Badge>}<Badge variant="outline">{tr(objKey(x.objective))}</Badge>{x.status !== "active" && <Badge variant="secondary">{tr(statusKey(x.status))}</Badge>}</div>
              <p className="text-sm text-muted-foreground">{tr("goals.goalLine", { metric: x.metric || tr("goals.noMetric"), baseline: x.baseline ?? "—", target: x.target ?? "—" })}{x.due_date ? tr("goals.by", { date: new Date(`${x.due_date}T00:00:00`).toLocaleDateString(tag) }) : ""}</p>
              {p != null ? <div className="space-y-1"><Progress value={p} /><p className="text-xs text-muted-foreground">{tr("goals.progress", { p })}</p></div> : <p className="text-xs text-muted-foreground">{tr("goals.noProgress")}</p>}
              <GoalMeasurementLine goal={x} />
              <GrowthChain orgId={orgId} wsId={wsId} goalId={x.id} />
              <GrowthPlanPanel goalId={x.id} orgId={orgId} wsId={wsId} userId={userId} canEdit={canEdit} canApprove={canApprove} />
              <GoalPlanSnapshot
                budgetLines={(lines.data ?? []).filter(line => line.goal_id === x.id)}
                linkedWorkCount={[...(links.data?.projects ?? []), ...(links.data?.campaigns ?? [])].filter(work => work.goal_id === x.id).length}
                month={month}
                formatAmount={(amount, currency) => new Intl.NumberFormat(tag, { style: "currency", currency }).format(amount)}
              />
              <LinkedWork goalId={x.id} data={links.data} canEdit={canEdit} onLink={link} />
              {canEdit && x.status === "active" && <StrategyPanel orgId={orgId} wsId={wsId} goalId={x.id} goalTitle={x.title} userId={userId} />}
              {canEdit && <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={tr("goals.currentValue")} className="h-8 w-32" type="number" min={0} placeholder={tr("goals.currentValue")} defaultValue={x.current_value ?? ""} onBlur={e => { const n = num(e.target.value); if (n !== x.current_value) void updateGoal(x.id, { current_value: n }); }} />
                {x.priority !== "primary" && <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { priority: "primary" })}>{tr("goals.makePrimary")}</Button>}
                {x.status === "active" ? <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "achieved" })}>{tr("goals.markAchieved")}</Button> : <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "active" })}>{tr("goals.reactivate")}</Button>}
                <Button size="sm" variant="ghost" onClick={() => updateGoal(x.id, { status: "archived" })}>{tr("goals.archive")}</Button>
              </div>}
            </div>); })}
        </div>
        {canEdit && <div className="grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Input aria-label={tr("goals.goalName")} placeholder={tr("goals.goalNamePh")} value={g.title} onChange={e => setG({ ...g, title: e.target.value })} className="sm:col-span-2" />
          <select aria-label={tr("goals.objective")} className={sel} value={g.objective} onChange={e => setG({ ...g, objective: e.target.value })}>{OBJECTIVES.map(k => <option key={k} value={k}>{tr(objKey(k))}</option>)}</select>
          <Input aria-label={tr("goals.metric")} placeholder={tr("goals.metricPh")} value={g.metric} onChange={e => setG({ ...g, metric: e.target.value })} />
          <Input aria-label={tr("goals.baseline")} type="number" min={0} placeholder={tr("goals.baseline")} value={g.baseline} onChange={e => setG({ ...g, baseline: e.target.value })} />
          <Input aria-label={tr("goals.target")} type="number" min={0} placeholder={tr("goals.target")} value={g.target} onChange={e => setG({ ...g, target: e.target.value })} />
          <Input aria-label={tr("goals.deadline")} type="date" value={g.due} onChange={e => setG({ ...g, due: e.target.value })} />
          {!!units.data?.length && <select aria-label={tr("goals.brand")} className={sel} value={g.unit} onChange={e => setG({ ...g, unit: e.target.value })}><option value="">{tr("goals.brandWhole")}</option>{units.data.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          <Button onClick={addGoal} className="sm:col-span-3 lg:col-span-1"><Plus className="mr-1 h-4 w-4" />{tr("goals.addGoal")}</Button>
        </div>}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-medium"><Wallet className="h-5 w-5" /> {tr("goals.budget")}</h2>
          <Input aria-label={tr("goals.month")} type="month" className="w-44" value={month.slice(0, 7)} onChange={e => e.target.value && setMonth(`${e.target.value}-01`)} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[[tr("goals.planned"), t.planned], [tr("goals.spent"), t.actual], [tr("goals.remaining"), t.remaining], [tr("goals.variance"), t.variance]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold">{fmt(v as number)}</p></div>))}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">{tr("goals.channel")}</th><th className="p-2">{tr("goals.goalInitiative")}</th><th className="p-2">{tr("goals.planned")}</th><th className="p-2">{tr("goals.cap")}</th><th className="p-2">{tr("goals.spent")}</th><th className="p-2">{tr("goals.status")}</th></tr></thead>
            <tbody>{(lines.data ?? []).length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">{tr("goals.noBudget")}</td></tr>}
              {(lines.data ?? []).map(l => { const a = budgetAlert(l); return (
                <tr key={l.id} className="border-t"><td className="p-2">{l.channel}{unitName(l.unit_id) && <span className="block text-xs text-muted-foreground">{unitName(l.unit_id)}</span>}</td><td className="p-2 text-muted-foreground">{goals.data?.find(x => x.id === l.goal_id)?.title ?? "—"}{l.initiative_id && <span className="block text-xs">{budgetInitiatives.data?.find(i => i.id === l.initiative_id)?.title ?? tr("goals.initiativeLinked")}</span>}</td>
                  <td className="p-2">{fmt(Number(l.planned))}</td><td className="p-2">{l.hard_cap != null ? fmt(Number(l.hard_cap)) : "—"}</td>
                  <td className="p-2">{canBudget ? <Input aria-label={tr("goals.spentOn", { channel: l.channel })} className="h-8 w-28" type="number" min={0} defaultValue={Number(l.actual)} onBlur={e => { if (Number(e.target.value) !== Number(l.actual)) void setActual(l.id, e.target.value); }} /> : fmt(Number(l.actual))}</td>
                  <td className="p-2">{a === "over_cap" ? <Badge variant="destructive">{tr("goals.overHardCap")}</Badge> : a === "over_plan" ? <Badge variant="destructive">{tr("goals.overPlan")}</Badge> : a === "near_plan" ? <Badge variant="secondary">{tr("goals.nearPlan")}</Badge> : <Badge variant="outline">{tr("goals.onTrack")}</Badge>}</td></tr>); })}
            </tbody></table>
        </div>
        {proposals.length > 0 && <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">{tr("goals.moves")}</p>
          <p className="text-xs text-muted-foreground">{tr("goals.movesNote")}</p>
          {proposals.map((m, i) => <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"><span>{tr("goals.moveLine", { amount: fmt(m.amount), from: m.from, to: m.to })}<span className="block text-xs text-muted-foreground">{moveReason(m)}</span></span>
            {canBudget && <Button size="sm" variant="outline" onClick={() => applyMove(m)}>{tr("goals.apply")}</Button>}</div>)}
        </div>}
        {canEdit && !canBudget && <p className="text-xs text-muted-foreground">{tr("goals.budgetEditors")}</p>}
        {canBudget && <div className="grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-5">
          {!!units.data?.length && <select aria-label={tr("goals.brand")} className={sel} value={b.unit} onChange={e => setB({ ...b, unit: e.target.value })}><option value="">{tr("goals.brandWhole")}</option>{units.data.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          <Input aria-label={tr("goals.channel")} placeholder={tr("goals.channelPh")} value={b.channel} onChange={e => setB({ ...b, channel: e.target.value })} />
          <Input aria-label={tr("goals.plannedAmount")} type="number" min={0} placeholder={tr("goals.plannedPh")} value={b.planned} onChange={e => setB({ ...b, planned: e.target.value })} />
          <Input aria-label={tr("goals.hardCap")} type="number" min={0} placeholder={tr("goals.hardCapPh")} value={b.cap} onChange={e => setB({ ...b, cap: e.target.value })} />
          <div className="space-y-1"><select aria-label={tr("goals.linkedGoal")} className={`${sel} w-full`} value={b.goal} onChange={e => setB({ ...b, goal: e.target.value, initiative: "" })}><option value="">{tr("goals.noLinkedGoal")}</option>{(goals.data ?? []).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select><select aria-label={tr("goals.linkedInitiative")} className={`${sel} w-full`} value={b.initiative} onChange={e => { const initiative = budgetInitiatives.data?.find(i => i.id === e.target.value); setB({ ...b, initiative: e.target.value, goal: initiative?.goal_id ?? b.goal }); }}><option value="">{tr("goals.noInitiative")}</option>{(budgetInitiatives.data ?? []).filter(i => !b.goal || i.goal_id === b.goal).map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></div>
          <Button onClick={addLine}><Plus className="mr-1 h-4 w-4" />{tr("goals.addLine")}</Button>
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
  const { t: tr, tag } = useI18n();
  const currencies = [...new Set(budgetLines.map(line => line.currency))];
  const planned = budgetLines.reduce((sum, line) => sum + Number(line.planned), 0);
  const spent = budgetLines.reduce((sum, line) => sum + Number(line.actual), 0);
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{tr("goals.snapshot", { month: new Date(`${month}T00:00:00`).toLocaleDateString(tag, { month: "long", year: "numeric" }) })}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>{tr("goals.linkedWorkN", { n: linkedWorkCount })}</span>
        <span>{tr("goals.budgetLinesN", { n: budgetLines.length })}</span>
        {budgetLines.length > 0 && currencies.length === 1 && currencies[0]
          ? <span>{tr("goals.plannedRecorded", { planned: formatAmount(planned, currencies[0]), spent: formatAmount(spent, currencies[0]) })}</span>
          : budgetLines.length > 0
            ? <span>{tr("goals.multiCurrency")}</span>
            : <span>{tr("goals.noBudgetMonth")}</span>}
      </div>
    </div>
  );
}
function GrowthPlanPanel({ goalId, orgId, wsId, userId, canEdit, canApprove }: {
  goalId: string;
  orgId: string;
  wsId: string;
  userId: string;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const qc = useQueryClient();
  const { t: tr, tag } = useI18n();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const plans = useQuery({
    queryKey: ["growth-plan-versions", orgId, wsId, goalId],
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await supabase.from("growth_plan_versions").select("id,strategy_id,version,status,title,summary,approved_at,created_at,plan_snapshot")
        .eq("org_id", orgId).eq("workspace_id", wsId).eq("goal_id", goalId).order("version", { ascending: false }).limit(10);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  // Keep the currently approved version operational while a replacement draft is reviewed.
  const approvedPlan = plans.data?.find(plan => plan.status === "approved");
  const draftPlan = plans.data?.find(plan => plan.status === "draft");
  const current = approvedPlan ?? draftPlan ?? plans.data?.[0];
  const initiatives = useQuery({
    queryKey: ["growth-initiatives", orgId, wsId, current?.id],
    enabled: Boolean(current?.id),
    queryFn: async () => {
      if (!current?.id) return [];
      const r = await supabase.from("growth_initiatives").select("id,title,detail,channel,target_week,effort,status,sort_order,project_id")
        .eq("org_id", orgId).eq("workspace_id", wsId).eq("plan_version_id", current.id).order("sort_order");
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const draftInitiatives = useQuery({
    queryKey: ["growth-plan-draft-initiatives", orgId, wsId, draftPlan?.id],
    enabled: Boolean(draftPlan?.id && draftPlan.id !== current?.id),
    queryFn: async () => {
      if (!draftPlan?.id || draftPlan.id === current?.id) return [];
      const r = await supabase.from("growth_initiatives").select("id,title,detail,channel,target_week,effort")
        .eq("org_id", orgId).eq("workspace_id", wsId).eq("plan_version_id", draftPlan.id).order("sort_order");
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const planIds = (plans.data ?? []).map(plan => plan.id);
  const decisions = useQuery({
    queryKey: ["growth-plan-decisions", orgId, wsId, goalId, planIds.join(",")],
    enabled: planIds.length > 0, retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await supabase.from("growth_plan_decisions").select("id,plan_version_id,decision,note,decided_at").eq("org_id", orgId).eq("workspace_id", wsId).in("plan_version_id", planIds).order("decided_at", { ascending: false }).limit(50);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const decisionsOn = !(decisions.isError && isNotInstalled(decisions.error));
  const [details, setDetails] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ plan: string; decision: "rejected" | "changes_requested" } | null>(null);
  const [reason, setReason] = useState("");
  const createWork = async (initiativeId: string) => {
    if (!canEdit || busyAction) return;
    setBusyAction(initiativeId);
    try {
      const r = await supabase.rpc("create_growth_initiative_work", { _initiative: initiativeId });
      if (r.error) throw r.error;
      toast.success(tr("goals.workAdded"));
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", orgId, wsId] });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", wsId] });
      await qc.invalidateQueries({ queryKey: ["goal-links", wsId] });
      await qc.invalidateQueries({ queryKey: ["execution"] });
      await qc.invalidateQueries({ queryKey: ["execution-growth-initiatives"] });
      await qc.invalidateQueries({ queryKey: ["command-center"] });
      await qc.invalidateQueries({ queryKey: ["command-center-approved-initiatives"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
    } catch {
      toast.error(tr("goals.workFailed"));
    } finally {
      setBusyAction(null);
    }
  };
  const decide = async (id: string, decision: "rejected" | "changes_requested") => {
    if (!canApprove || busyAction) return;
    if (reason.trim().length < 3) return void toast.error(tr("goals.pd.reasonNeeded"));
    setBusyAction(id);
    try {
      const r = await supabase.rpc("decide_growth_plan", { _plan: id, _decision: decision, _note: reason.trim() });
      if (r.error) throw r.error;
      toast.success(decision === "rejected" ? tr("goals.pd.rejected") : tr("goals.pd.changesRequested"));
      setAsking(null); setReason("");
      await qc.invalidateQueries({ queryKey: ["growth-plan-versions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["growth-plan-decisions", orgId, wsId, goalId] });
    } catch (error) {
      toast.error(isNotInstalled(error) ? tr("goals.pd.notSwitchedOn") : tr("goals.pd.decisionFailed"));
    } finally {
      setBusyAction(null);
    }
  };
  const approve = async (id: string) => {
    if (!canApprove || busyAction) return;
    setBusyAction(id);
    try {
      // Record the decision when decision history is switched on; otherwise approve as before.
      let r = await supabase.rpc("decide_growth_plan", { _plan: id, _decision: "approved", _note: "" });
      if (r.error && isNotInstalled(r.error)) r = await supabase.rpc("approve_growth_plan", { _plan: id });
      if (r.error) throw r.error;
      toast.success(tr("goals.planApproved"));
      await qc.invalidateQueries({ queryKey: ["growth-plan-decisions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["growth-plan-versions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["command-center-approved-plans"] });
      await qc.invalidateQueries({ queryKey: ["command-center-approved-initiatives"] });
      await qc.invalidateQueries({ queryKey: ["command-center-initiative-ops"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
    } catch {
      toast.error(tr("goals.approveFailed"));
    } finally {
      setBusyAction(null);
    }
  };
  const snapshot = (plan: { plan_snapshot: unknown }) => { const parsed = strategySchema.safeParse(plan.plan_snapshot); return parsed.success ? parsed.data : null; };
  const detailsToggle = (plan: { id: string; plan_snapshot: unknown }) => {
    const body = snapshot(plan); if (!body) return null;
    return <div><Button size="sm" variant="link" className="h-auto px-0" aria-expanded={details === plan.id} onClick={() => setDetails(details === plan.id ? null : plan.id)}>{details === plan.id ? tr("goals.pd.hideDetails") : tr("goals.pd.details")}</Button>
      {details === plan.id && <div className="mt-2 rounded-md border bg-muted/30 p-3"><PlanDetails strategy={body} /></div>}</div>;
  };
  const decisionControls = (plan: { id: string }) => {
    if (!canApprove || !decisionsOn) return null;
    const open = asking?.plan === plan.id;
    return <>
      {!open && <><Button size="sm" variant="outline" disabled={!!busyAction} onClick={() => { setAsking({ plan: plan.id, decision: "changes_requested" }); setReason(""); }}>{tr("goals.pd.requestChanges")}</Button>
        <Button size="sm" variant="ghost" disabled={!!busyAction} onClick={() => { setAsking({ plan: plan.id, decision: "rejected" }); setReason(""); }}>{tr("goals.pd.reject")}</Button></>}
      {open && <div className="w-full space-y-2 rounded-md border p-2">
        <label className="block text-xs font-medium" htmlFor={`reason-${plan.id}`}>{tr("goals.pd.reasonLabel")}</label>
        <Textarea id={`reason-${plan.id}`} value={reason} maxLength={2000} placeholder={tr("goals.pd.reasonPh")} onChange={e => setReason(e.target.value)} className="min-h-[60px]" />
        <div className="flex flex-wrap gap-2"><Button size="sm" variant={asking.decision === "rejected" ? "destructive" : "default"} disabled={!!busyAction} onClick={() => decide(plan.id, asking.decision)}>{asking.decision === "rejected" ? tr("goals.pd.confirmReject") : tr("goals.pd.confirmChanges")}</Button><Button size="sm" variant="ghost" onClick={() => setAsking(null)}>{tr("goals.pd.cancel")}</Button></div>
      </div>}
    </>;
  };
  const versionOf = new Map((plans.data ?? []).map(plan => [plan.id, plan.version] as const));
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">{tr("goals.plan")}</p><p className="text-xs text-muted-foreground">{tr("goals.planSub")}</p></div>
      </div>
      {plans.isLoading ? <p role="status" className="text-xs text-muted-foreground">{tr("goals.loadingPlan")}</p>
        : plans.isError && isNotInstalled(plans.error) ? <p className="text-xs text-muted-foreground">{GROWTH_PLANS_NOT_INSTALLED}</p>
        : plans.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>{tr("goals.planFailed")}</span><Button size="sm" variant="outline" onClick={() => { void plans.refetch(); }}>{tr("goals.retry")}</Button></div>
        : !current ? <p className="text-xs text-muted-foreground">{tr("goals.noPlan")}</p>
        : <>
          {draftPlan && draftPlan.id !== current.id && <div className="space-y-2 rounded-md border border-dashed p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{tr("goals.draftReview", { v: draftPlan.version })}</span><Badge variant="secondary">{tr("goals.status.draft")}</Badge></div>
            <p className="line-clamp-3 text-sm text-muted-foreground">{draftPlan.summary}</p>
            {draftInitiatives.isLoading ? <p role="status" className="text-xs text-muted-foreground">{tr("goals.loadingProposed")}</p>
              : draftInitiatives.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>{tr("goals.draftFailed")}</span><Button size="sm" variant="outline" onClick={() => { void draftInitiatives.refetch(); }}>{tr("goals.retry")}</Button></div>
              : <ol className="space-y-1">{(draftInitiatives.data ?? []).map((item, index) => <li key={item.id} className="text-xs"><span className="font-medium">{index + 1}. {item.title}</span> · {tr("goals.week", { n: item.target_week })} · {tr(`goals.effort.${item.effort}` as MessageKey)}{item.channel ? ` · ${item.channel}` : ""}{item.detail ? <span className="block text-muted-foreground">{item.detail}</span> : null}</li>)}</ol>}
            {detailsToggle(draftPlan)}
            <p className="text-xs text-muted-foreground">{tr("goals.activeUntil")}</p>
            <div className="flex flex-wrap gap-2">{canApprove && <Button size="sm" disabled={!!busyAction} onClick={() => approve(draftPlan.id)}>{busyAction === draftPlan.id ? tr("goals.approving") : tr("goals.approveReplacement")}</Button>}{decisionControls(draftPlan)}</div>
            {!canApprove && <p className="text-xs text-muted-foreground">{tr("goals.awaiting")}</p>}
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="line-clamp-2 text-sm font-medium">V{current.version} · {current.title.replace(/^Growth plan · /, "")}</span>
            <Badge variant={current.status === "approved" ? "default" : "secondary"}>{tr(statusKey(current.status))}</Badge>
            {current.approved_at && <span className="text-xs text-muted-foreground">{tr("goals.approvedOn", { date: new Date(current.approved_at).toLocaleDateString(tag) })}</span>}
          </div>
          {current.status === "draft" && plans.data?.some(plan => plan.status === "approved") &&
            <p className="text-xs text-muted-foreground">{tr("goals.activeUntil")}</p>}
          <p className="text-sm text-muted-foreground">{current.summary}</p>
          {detailsToggle(current)}
          {initiatives.isLoading ? <p className="text-xs text-muted-foreground">{tr("goals.loadingInitiatives")}</p>
            : initiatives.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>{tr("goals.initiativesFailed")}</span><Button size="sm" variant="outline" onClick={() => { void initiatives.refetch(); }}>{tr("goals.retry")}</Button></div>
            : <ol className="space-y-2">{(initiatives.data ?? []).map((item, index) =>
              <li key={item.id} className="rounded-md bg-muted/40 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{index + 1}. {item.title}</span><Badge variant="outline">{tr("goals.week", { n: item.target_week })}</Badge><Badge variant="outline">{tr(`goals.effort.${item.effort}` as MessageKey)}</Badge></div>
                {item.detail && <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>}
                {item.channel && <p className="text-xs text-muted-foreground">{tr("goals.channelX", { c: item.channel })}</p>}
                {item.project_id ? <p className="text-xs text-muted-foreground">{tr("goals.projectCreated")}</p> : ["completed","cancelled"].includes(item.status) ? <p className="text-xs text-muted-foreground">{tr("goals.noWork", { s: tr(statusKey(item.status)) })}</p> : current.status === "approved" && canEdit ? <Button size="sm" variant="outline" disabled={!!busyAction} onClick={() => createWork(item.id)}>{busyAction === item.id ? tr("goals.creatingWork") : tr("goals.createWork")}</Button> : null}
                {current.status === "approved" && <details className="group mt-1"><summary className="cursor-pointer select-none text-xs font-medium text-primary">{tr("goals.op.title")} · {tr(statusKey(item.status))}</summary><InitiativeOperations initiativeId={item.id} orgId={orgId} workspaceId={wsId} userId={userId} canEdit={canEdit} status={item.status} /></details>}
              </li>)}</ol>}
          {current.status === "draft" && canApprove && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!!busyAction} onClick={() => approve(current.id)}>{busyAction === current.id ? tr("goals.approving") : tr("goals.approvePlan")}</Button>{decisionControls(current)}</div>}
          {(decisions.data ?? []).length > 0 && <div className="border-t pt-2"><p className="text-xs font-medium text-muted-foreground">{tr("goals.pd.history")}</p><ul className="mt-1 space-y-1">{decisions.data!.slice(0, 6).map(d => <li key={d.id} className="text-xs"><span className="font-medium">{tr("goals.pd.decisionLine", { v: versionOf.get(d.plan_version_id) ?? "?", d: tr(`goals.pd.dec.${d.decision}`), when: new Date(d.decided_at).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</span>{d.note && <span className="block text-muted-foreground">{d.note}</span>}</li>)}</ul></div>}
          {current.status === "draft" && !canApprove && <p className="text-xs text-muted-foreground">{tr("goals.awaiting")}</p>}
        </>}
    </div>
  );
}
type LinkRow = { id: string; title: string; goal_id: string | null };
function LinkedWork({ goalId, data, canEdit, onLink }: { goalId: string; data: { projects: LinkRow[]; campaigns: LinkRow[] } | undefined; canEdit: boolean; onLink: (t: "projects" | "campaigns", id: string, g: string | null) => void }) {
  const { t: tr } = useI18n();
  if (!data) return null;
  const mine = [...data.projects.filter(p => p.goal_id === goalId).map(p => ({ ...p, t: "projects" as const })), ...data.campaigns.filter(c => c.goal_id === goalId).map(c => ({ ...c, t: "campaigns" as const }))];
  const free = [...data.projects.filter(p => !p.goal_id).map(p => ({ ...p, t: "projects" as const })), ...data.campaigns.filter(c => !c.goal_id).map(c => ({ ...c, t: "campaigns" as const }))];
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{tr("goals.linkedWork", { n: mine.length })}</p>
      {mine.map(w => <div key={w.id} className="flex items-center justify-between gap-2"><span className="truncate">{w.t === "projects" ? tr("goals.project") : tr("goals.campaign")}: {w.title}</span>{canEdit && <Button size="sm" variant="ghost" className="h-7" onClick={() => onLink(w.t, w.id, null)}>{tr("goals.unlink")}</Button>}</div>)}
      {canEdit && free.length > 0 && <select aria-label={tr("goals.linkSelect")} className={`${sel} w-full max-w-full`} value="" onChange={e => { const w = free.find(f => f.id === e.target.value); if (w) onLink(w.t, w.id, goalId); }}>
        <option value="">{tr("goals.linkSelectPh")}</option>{free.map(w => <option key={w.id} value={w.id}>{w.t === "projects" ? tr("goals.project") : tr("goals.campaign")}: {w.title}</option>)}</select>}
    </div>);
}

/** Whether a goal can be measured, what is missing, the remaining gap, time left and pace (entered values only). */
function GoalMeasurementLine({ goal }: { goal: GoalLike }) {
  const { t: tr } = useI18n();
  const m = goalMeasurement(goal, new Date().toISOString().slice(0, 10));
  if (!m.measurable) {
    const list = m.missing.filter((k) => k !== "current" && k !== "deadline").map((k) => tr(`goals.m.missing.${k}` as MessageKey)).join(", ");
    return <p className="rounded border border-warning/50 px-2 py-1 text-xs text-warning">{tr("goals.m.notMeasurable", { list })}</p>;
  }
  const parts = [
    m.gap !== null && m.gap > 0 ? tr("goals.m.gap", { gap: m.gap }) : null,
    m.daysLeft !== null ? (m.daysLeft >= 0 ? tr("goals.m.daysLeft", { n: m.daysLeft }) : tr("goals.m.daysOver", { n: -m.daysLeft })) : null,
    m.pace ? tr(`goals.m.pace.${m.pace}` as MessageKey) : null,
  ].filter(Boolean);
  return (
    <div className="text-xs">
      <p>{tr("goals.m.measurable")}{parts.length ? ` ${parts.join(" · ")}.` : ""}</p>
      {m.missing.length > 0 && <p className="text-muted-foreground">{tr("goals.m.alsoMissing", { list: m.missing.map((k) => tr(`goals.m.missing.${k}` as MessageKey)).join(", ") })}</p>}
      <p className="text-muted-foreground">{tr("goals.m.source")}</p>
    </div>
  );
}
