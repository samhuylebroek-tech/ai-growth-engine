import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncOfficialRates } from "@/lib/exchange-rates.functions";
import { ArrowRight, Network } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { growthDb } from "@/lib/pending-schema";
import { TASK_SPECIALISTS } from "@/lib/task-execution";
import { businessRow, byAttention, convertMoney, orgTotals, REPORTING_CURRENCIES, revenueByUnit, specialistLoad, type BusinessRow, type Money } from "@/lib/org/consolidation";
import { coordinate, nextOrgActions, type CoordBusiness, type Finding } from "@/lib/org/coordination";
import { monthStartIso, orgOverviewOptions, type OrgOverviewData } from "@/components/org/org-data";
import { Section, sel, useFmt } from "@/components/bi/parts";
import { PageHeader, Panel, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Period = "month" | "90d" | "year";
const tk = (k: string) => k as MessageKey;
const today = () => new Date().toISOString().slice(0, 10);
function periodFrom(p: Period): string {
  const d = new Date();
  if (p === "month") return monthStartIso(d);
  if (p === "year") return `${d.getUTCFullYear()}-01-01`;
  return new Date(d.getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
}
const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

export function Organization() {
  const o = useOrg(); const { t } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{t("org.loading")}</p>;
  if (!o.org) return <p className="p-6 text-muted-foreground">{t("org.noOrg")}</p>;
  if (!o.workspaces.length) return <EmptyState icon={<Network />} title={t("org.noBusinessesTitle")} text={t("org.noBusinesses")} />;
  return <Overview key={o.org.id} orgId={o.org.id} />;
}

function Overview({ orgId }: { orgId: string }) {
  const o = useOrg(); const { t } = useI18n(); const f = useFmt(); const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("month");
  const businesses = o.workspaces;
  const ids = businesses.map((w) => w.id);
  const q = useQuery(orgOverviewOptions(orgId, ids, periodFrom(period)));
  const finance = can(o.role, "finance.consolidated");
  const [target, setTarget] = useState<string | null>(null);

  const view = useMemo(() => (q.data ? build(q.data, businesses, period) : null), [q.data, businesses, period]);
  const open = (id: string) => { o.setWorkspaceId(id); void navigate({ to: "/app" }); };
  const name = (id: string) => businesses.find((b) => b.id === id)?.name ?? t("org.unknownBusiness");

  if (q.isLoading) return <p role="status" className="py-12 text-sm text-muted-foreground">{t("org.loading")}</p>;
  if (q.isError || !view || !q.data) return <div role="alert" className="py-6 text-sm text-destructive">{String((q.error as Error | null)?.message ?? "").startsWith("too_many") ? t("org.tooMany") : t("org.loadFailed")}</div>;

  const cur = target ?? view.defaultCurrency;
  const rates = q.data.rates ?? [];
  const conv = (m: Money) => convertMoney(m, cur, rates, today());
  const money = (m: Money) => Object.keys(m).length ? Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => f.money(v, c)).join(" · ") : "—";

  return <>
    <PageHeader title={t("org.title")} description={t("org.scope", { org: o.org?.name ?? "", n: String(businesses.length) })}
      actions={<div className="flex flex-wrap gap-2">
        <select aria-label={t("org.period")} className={`${sel} w-auto`} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {(["month", "90d", "year"] as const).map((p) => <option key={p} value={p}>{t(tk(`org.period.${p}`))}</option>)}
        </select>
        {finance && <select aria-label={t("org.reportIn")} className={`${sel} w-auto`} value={cur} onChange={(e) => setTarget(e.target.value)}>
          {REPORTING_CURRENCIES.map((c) => <option key={c} value={c}>{t("org.reportInCur", { cur: c })}</option>)}
        </select>}
      </div>} />

    <p className="mb-6 max-w-3xl text-xs text-muted-foreground">{t("org.isolation")}</p>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {finance ? <Tile label={t("org.tile.revenue")} value={money(view.totals.revenue)} note={view.revenueOff ? t("org.revenueOff") : <Converted c={conv(view.totals.revenue)} cur={cur} />} /> : <Tile label={t("org.tile.revenue")} value="—" note={t("org.financeAdminsOnly")} />}
      {finance ? <Tile label={t("org.tile.budget")} value={money(view.totals.spent)} note={t("org.tile.budgetOf", { planned: money(view.totals.planned) })} /> : <Tile label={t("org.tile.budget")} value="—" note={t("org.financeAdminsOnly")} />}
      <Tile label={t("org.tile.credits")} value={String(view.totals.creditsUsed)} note={t("org.tile.creditsReserved", { n: String(view.totals.creditsReserved) })} />
      <Tile label={t("org.tile.goals")} value={t("org.tile.goalsValue", { on: String(view.totals.goals.onTrack), active: String(view.totals.goals.active) })}
        note={t("org.tile.goalsNote", { behind: String(view.totals.goals.behind), achieved: String(view.totals.goals.achieved), unmeasured: String(view.totals.goals.unmeasured) })} />
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Tile label={t("org.tile.approvals")} value={String(view.rows.reduce((s, r) => s + r.pendingApprovals, 0))} note={t("org.tile.approvalsNote")} />
      <Tile label={t("org.tile.initiatives")} value={String(view.initiatives)} note={t("org.tile.initiativesNote")} />
      <Tile label={t("org.tile.attention")} value={String(view.rows.filter((r) => r.attention > 0).length)} note={t("org.tile.attentionNote", { n: String(view.rows.length) })} />
    </div>

    <Section title={t("org.next.title")} intro={t("org.next.intro")}>
      {view.actions.length ? <ol className="divide-y divide-border border-y border-border">{view.actions.map((a) => <li key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div className="min-w-0"><span className="mr-2 text-xs tabular-nums text-muted-foreground">{a.rank}.</span>
          <span className="font-medium">{t(tk(`org.act.${a.code}`), { subject: subjectLabel(t, a.code, a.subject), businesses: a.businesses.map(name).join(" · ") })}</span></div>
        <Button size="sm" variant="outline" onClick={() => open(a.businesses[0]!)}>{t("org.openBusiness", { name: name(a.businesses[0]!) })}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
      </li>)}</ol> : <p className="text-sm text-muted-foreground">{t("org.next.none")}</p>}
    </Section>

    <Section title={t("org.compare.title")} intro={t("org.compare.intro")}>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="p-2 font-medium">{t("org.col.business")}</th>{finance && <th className="p-2 font-medium">{t("org.col.revenue")}</th>}
          {finance && <th className="p-2 font-medium">{t("org.col.budget")}</th>}<th className="p-2 font-medium">{t("org.col.credits")}</th>
          <th className="p-2 font-medium">{t("org.col.goals")}</th><th className="p-2 font-medium">{t("org.col.work")}</th><th className="p-2 font-medium">{t("org.col.attention")}</th><th className="p-2" />
        </tr></thead>
        <tbody>{view.sorted.map((r) => <tr key={r.id} className="border-b border-border align-top">
          <td className="p-2"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{t("org.reporting", { cur: r.reportingCurrency })}</p></td>
          {finance && <td className="p-2 tabular-nums">{money(r.revenue)}{Object.keys(r.estimated).length > 0 && <p className="text-xs text-muted-foreground">{t("org.estimatedApart", { v: money(r.estimated) })}</p>}</td>}
          {finance && <td className="p-2 tabular-nums">{Object.keys(r.utilization).length ? Object.entries(r.utilization).map(([c, u]) => <p key={c}>{u == null ? t("org.unplanned", { cur: c }) : t("org.used", { pct: String(u), cur: c })}</p>) : "—"}{r.overCap > 0 && <p className="text-xs text-destructive">{t("org.overCap", { n: String(r.overCap) })}</p>}</td>}
          <td className="p-2 tabular-nums">{r.creditsUsed}{r.creditsReserved > 0 && <p className="text-xs text-muted-foreground">{t("org.reserved", { n: String(r.creditsReserved) })}</p>}</td>
          <td className="p-2 text-xs">{t("org.goalsCell", { on: String(r.goals.onTrack), active: String(r.goals.active), behind: String(r.goals.behind) })}</td>
          <td className="p-2 text-xs">{t("org.workCell", { open: String(r.openTasks), overdue: String(r.overdueTasks) })}</td>
          <td className="p-2 text-xs">{r.reasons.length ? r.reasons.map((x) => <p key={x}>{t(tk(`org.reason.${x}`))}</p>) : <span className="text-muted-foreground">{t("org.calm")}</span>}</td>
          <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => open(r.id)} aria-label={t("org.openBusiness", { name: r.name })}><ArrowRight className="h-4 w-4" /></Button></td>
        </tr>)}</tbody>
      </table></div>
    </Section>

    {finance && <Section title={t("org.brands.title")} intro={t("org.brands.intro")}>
      {view.revenueOff ? <p className="text-sm text-muted-foreground">{t("org.revenueOff")}</p> : view.brandRows.length ? <div className="grid gap-3 md:grid-cols-2">{view.brandRows.map((b) => <Panel key={b.id}>
        <p className="font-medium">{b.name}</p>
        <ul className="mt-2 space-y-1 text-sm">{b.units.map((u) => <li key={u.unitId ?? "none"} className="flex justify-between gap-3"><span className={u.unitId ? "" : "text-muted-foreground"}>{u.unitId ? (u.label || t("org.unknownBrand")) : t("org.noBrand")}</span><span className="tabular-nums">{money(u.revenue)}</span></li>)}</ul>
      </Panel>)}</div> : <p className="text-sm text-muted-foreground">{t("org.brands.none")}</p>}
    </Section>}

    <Section title={t("org.coord.title")} intro={t("org.coord.intro")}>
      {view.findings.length ? <ul className="grid gap-3 md:grid-cols-2">{view.findings.map((x) => <FindingCard key={x.key} f={x} name={name} />)}</ul> : <p className="text-sm text-muted-foreground">{t("org.coord.none", { n: String(businesses.length) })}</p>}
    </Section>

    <Specialists data={q.data} view={view} name={name} orgId={orgId} />
    {finance && <Rates orgId={orgId} data={q.data} />}
  </>;
}

function subjectLabel(t: ReturnType<typeof useI18n>["t"], code: string, subject: string) {
  const known = (k: string) => (k in MESSAGES.en ? t(tk(k)) : subject);
  if (code === "attend_business") return subject ? known(`org.reason.${subject}`) : "";
  if (code === "specialist_contention") return known(`run.sp.${subject}`);
  if (code === "shared_bottleneck") return known(`org.bottleneck.${subject}`);
  if (code === "strategy_reuse") return known(`goals.obj.${subject}`);
  return subject;
}

function FindingCard({ f, name }: { f: Finding; name: (id: string) => string }) {
  const { t } = useI18n();
  return <li><Panel className="h-full">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(tk(`org.find.${f.code}`))}</p>
    <p className="mt-1 text-sm font-medium">{f.businesses.map(name).join(" · ")} — {subjectLabel(t, f.code, f.subject)}</p>
    <p className="mt-1 text-xs text-muted-foreground">{t(tk(`org.findHow.${f.code}`))}</p>
    {f.code !== "specialist_contention" && f.evidence.length > 0 && <ul className="mt-2 space-y-0.5 text-xs">{f.evidence.map((e) => <li key={e}>• {e}</li>)}</ul>}
  </Panel></li>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return <Panel><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>{note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}</Panel>;
}

function Converted({ c, cur }: { c: ReturnType<typeof convertMoney>; cur: string }) {
  const { t } = useI18n(); const f = useFmt();
  if (c.total == null) return <span>{t("org.convWithheld", { cur, pairs: c.missing.join(", ") })}</span>;
  if (!c.used.length) return <span>{t("org.convSingle", { cur })}</span>;
  return <span>{t("org.convTotal", { v: f.money(c.total, cur) })} · {c.used.map((u) => t("org.convRate", { pair: `${u.from}→${u.to}`, rate: u.rate.toFixed(4), date: f.date(u.rateDate), source: u.source })).join("; ")}{c.stale.length > 0 && <span className="text-warning"> · {t("org.convStale", { pairs: c.stale.join(", ") })}</span>}</span>;
}

type Built = ReturnType<typeof build>;
function build(d: OrgOverviewData, businesses: readonly { id: string; name: string }[], period: Period) {
  const from = periodFrom(period), now = today(), month = monthStartIso();
  const prof = new Map(d.profiles.map((p) => [p.workspace_id, p]));
  const by = <T extends { workspace_id: string | null }>(rows: readonly T[], id: string) => rows.filter((r) => r.workspace_id === id);
  const rows: BusinessRow[] = businesses.map((b) => businessRow({
    id: b.id, name: b.name, reportingCurrency: (prof.get(b.id) as { reporting_currency?: string } | undefined)?.reporting_currency ?? "EUR",
    revenue: by(d.revenue ?? [], b.id), goals: by(d.goals, b.id), tasks: by(d.tasks, b.id), budget: by(d.budget, b.id),
    runs: by(d.runs, b.id), pendingApprovals: by(d.approvals, b.id).length, truncated: false,
  }, month, now, from, now));
  const coord: CoordBusiness[] = businesses.map((b) => ({
    id: b.id, name: b.name, audiences: list(prof.get(b.id)?.audiences),
    campaigns: by(d.campaigns, b.id).map((c) => ({ id: c.id, title: c.title, status: c.status, audience: c.audience, channels: c.channels ?? [], start_date: c.start_date, end_date: c.end_date })),
    openWork: by(d.tasks, b.id).map((x) => ({ id: x.id, title: x.title })),
    budgetChannels: by(d.budget, b.id).map((l) => ({ channel: l.channel, month: l.period_month, planned: Number(l.planned), currency: l.currency })),
    goals: by(d.goals, b.id).map((g) => ({ id: g.id, title: g.title, objective: g.objective, status: g.status, achieved: g.status === "achieved" || (g.target != null && g.current_value != null && Number(g.current_value) >= Number(g.target)) })),
  }));
  const load = specialistLoad(businesses.map((b) => ({ id: b.id, runs: by(d.runs, b.id) })), d.allocations ?? [], `${month}T00:00:00Z`);
  const findings = coordinate(coord, rows, load);
  const units = d.units ?? [];
  const brandRows = d.revenue ? businesses.map((b) => ({
    id: b.id, name: b.name, hasUnits: units.some((u) => u.workspace_id === b.id),
    units: revenueByUnit(by(d.revenue ?? [], b.id), from, now).map((u) => ({ ...u, label: units.find((x) => x.id === u.unitId)?.name ?? "" })),
  })).filter((b) => b.hasUnits && b.units.length) : [];
  const counts = new Map<string, number>(); for (const r of rows) counts.set(r.reportingCurrency, (counts.get(r.reportingCurrency) ?? 0) + 1);
  const defaultCurrency = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "EUR";
  return { rows, sorted: byAttention(rows), totals: orgTotals(rows), findings, actions: nextOrgActions(rows, findings), load, brandRows,
    defaultCurrency, revenueOff: d.revenue === null, initiatives: d.initiatives.length, allocationsOff: d.allocations === null };
}

function Specialists({ data, view, name, orgId }: { data: OrgOverviewData; view: Built; name: (id: string) => string; orgId: string }) {
  const o = useOrg(); const { t } = useI18n(); const qc = useQueryClient();
  const manage = can(o.role, "specialists.manage") && !view.allocationsOff;
  const [form, setForm] = useState({ ws: o.workspaces[0]?.id ?? "", spec: "seo", enabled: true, priority: "3", cap: "" });
  const [busy, setBusy] = useState(false);
  const current = (data.allocations ?? []).find((a) => a.workspace_id === form.ws && a.specialist_key === form.spec);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      const cap = form.cap.trim() ? Number(form.cap) : null;
      const { error } = await growthDb.rpc("set_specialist_allocation", { _workspace: form.ws, _specialist: form.spec, _enabled: form.enabled, _priority: Number(form.priority), _cap: cap });
      if (error) { toast.error(error.message); return; }
      toast.success(t("org.spec.saved")); await qc.invalidateQueries({ queryKey: ["org-overview", orgId] });
    } finally { setBusy(false); }
  }
  return <Section title={t("org.spec.title")} intro={t("org.spec.intro")}>
    {view.allocationsOff ? <p className="text-sm text-muted-foreground">{t("org.spec.off")}</p> : view.load.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
      <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="p-2 font-medium">{t("org.spec.col.specialist")}</th><th className="p-2 font-medium">{t("org.spec.col.business")}</th><th className="p-2 font-medium">{t("org.spec.col.open")}</th><th className="p-2 font-medium">{t("org.spec.col.used")}</th><th className="p-2 font-medium">{t("org.spec.col.setting")}</th></tr></thead>
      <tbody>{view.load.flatMap((l) => l.businesses.map((b, i) => <tr key={`${l.specialist}:${b.id}`} className="border-b border-border">
        <td className="p-2 font-medium">{i === 0 ? t(tk(`run.sp.${l.specialist}`)) : ""}</td><td className="p-2">{name(b.id)}</td>
        <td className="p-2 tabular-nums">{b.open}</td><td className="p-2 tabular-nums">{b.cap != null ? t("org.spec.usedOfCap", { used: String(b.used), cap: String(b.cap) }) : b.used}</td>
        <td className="p-2 text-xs">{b.enabled ? t("org.spec.on") : <span className="text-destructive">{t("org.spec.offFor")}</span>}</td>
      </tr>))}</tbody></table></div> : <p className="text-sm text-muted-foreground">{t("org.spec.none")}</p>}
    {manage && <form onSubmit={save} className="mt-4 grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("org.spec.form")}>
      <select aria-label={t("org.spec.col.business")} className={sel} value={form.ws} onChange={(e) => setForm({ ...form, ws: e.target.value })}>{o.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <select aria-label={t("org.spec.col.specialist")} className={sel} value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })}>{Object.keys(TASK_SPECIALISTS).map((s) => <option key={s} value={s}>{t(tk(`run.sp.${s}`))}</option>)}</select>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{t("org.spec.enabled")}</label>
      <select aria-label={t("org.spec.priority")} className={sel} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{t(tk(`org.spec.prio.${p}`))}</option>)}</select>
      <Input aria-label={t("org.spec.cap")} type="number" min={1} placeholder={t("org.spec.capPh")} value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
      <Button type="submit" disabled={busy || !form.ws}>{t("org.spec.save")}</Button>
      <p className="text-xs text-muted-foreground sm:col-span-3 lg:col-span-6">{current ? t("org.spec.current", { state: current.enabled ? t("org.spec.on") : t("org.spec.offFor"), prio: String(current.priority), cap: current.monthly_credit_cap == null ? t("org.spec.noCap") : String(current.monthly_credit_cap) }) : t("org.spec.default")}</p>
    </form>}
  </Section>;
}

function Rates({ orgId, data }: { orgId: string; data: OrgOverviewData }) {
  const { t } = useI18n(); const f = useFmt(); const qc = useQueryClient();
  const sync = useServerFn(syncOfficialRates);
  const official = (data.rates ?? []).filter((r) => r.kind === "official");
  const latest = official[0]?.rate_date ?? null;
  // Official rates are fetched on the first visit of the day (the ECB publishes once per working day); stored once.
  const due = data.rates !== null && (!latest || latest < today());
  const auto = useQuery({
    queryKey: ["official-rates-sync", orgId, today()], enabled: due, staleTime: Infinity, retry: false,
    queryFn: async () => { const r = await sync({ data: { orgId } }); if (r.ok && r.added > 0) await qc.invalidateQueries({ queryKey: ["org-overview", orgId] }); return r; },
  });
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (busy) return; setBusy(true);
    try {
      const r = await sync({ data: { orgId } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.added ? t("org.rates.added", { n: String(r.added), date: f.date(r.date) }) : t("org.rates.current", { date: f.date(r.date) }));
      await qc.invalidateQueries({ queryKey: ["org-overview", orgId] });
    } finally { setBusy(false); }
  }
  if (data.rates === null) return <Section title={t("org.rates.title")}><p className="text-sm text-muted-foreground">{t("org.rates.off")}</p></Section>;
  const shown = latest ? official.filter((r) => r.rate_date === latest) : [];
  const failed = auto.data && !auto.data.ok ? auto.data.error : auto.isError ? t("org.rates.syncFailed") : null;
  return <Section title={t("org.rates.title")} intro={t("org.rates.intro")}
    action={<Button size="sm" variant="outline" onClick={refresh} disabled={busy || auto.isFetching}>{busy || auto.isFetching ? t("org.rates.fetching") : t("org.rates.refresh")}</Button>}>
    {failed && <p role="alert" className="mb-2 text-xs text-destructive">{failed}</p>}
    {latest ? <>
      <p className="mb-2 text-xs text-muted-foreground">{t("org.rates.published", { date: f.date(latest) })}</p>
      <ul className="grid gap-x-6 gap-y-1 border-y border-border py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{shown.filter((r) => (REPORTING_CURRENCIES as readonly string[]).includes(r.quote_currency)).map((r) => <li key={r.id} className="tabular-nums">1 EUR = {Number(r.rate).toFixed(4)} {r.quote_currency}</li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground">{t("org.rates.more", { n: String(shown.length) })}</p>
    </> : <p className="text-sm text-muted-foreground">{auto.isFetching ? t("org.rates.fetching") : t("org.rates.none")}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{t("org.rates.permanent")} <Link to="/app/revenue" className="underline">{t("org.rates.revenueLink")}</Link></p>
  </Section>;
}
