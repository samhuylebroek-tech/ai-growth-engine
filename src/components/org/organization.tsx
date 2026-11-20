import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Network, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { convertMoney, REPORTING_CURRENCIES, type Money } from "@/lib/org/consolidation";
import type { RankedAction } from "@/lib/org/priorities";
import { Section, sel, useFmt } from "@/components/bi/parts";
import { PageHeader, Panel, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tk, todayIso, useOrgModel, useRefNamer, Tile, Empty, type Period, type OrgModel } from "@/components/org/org-model";
import { StrategyTab } from "@/components/org/org-strategy";
import { OpportunitiesTab } from "@/components/org/org-opportunities";
import { InitiativesTab } from "@/components/org/org-initiatives";
import { ResourcesTab } from "@/components/org/org-resources";
import { RisksTab } from "@/components/org/org-risks";
import { subjectLabel } from "@/components/org/org-parts";

export const ORG_TABS = ["overview", "strategy", "opportunities", "initiatives", "resources", "risks"] as const;
export type OrgTab = (typeof ORG_TABS)[number];

export function Organization({ tab, onTab }: { tab: OrgTab; onTab: (t: OrgTab) => void }) {
  const o = useOrg(); const { t } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{t("org.loading")}</p>;
  if (!o.org) return <p className="p-6 text-muted-foreground">{t("org.noOrg")}</p>;
  if (!o.workspaces.length) return <EmptyState icon={<Network />} title={t("org.noBusinessesTitle")} text={t("org.noBusinesses")} />;
  return <Overview key={o.org.id} orgId={o.org.id} tab={tab} onTab={onTab} />;
}

function Overview({ orgId, tab, onTab }: { orgId: string; tab: OrgTab; onTab: (t: OrgTab) => void }) {
  const o = useOrg(); const { t } = useI18n(); const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("month");
  const m = useOrgModel(orgId, period);
  const finance = can(o.role, "finance.consolidated");
  const [target, setTarget] = useState<string | null>(null);
  const single = m.businesses.length < 2;
  const open = (id: string, to: "/app" | "/app/goals" | "/app/campaigns" | "/app/tasks" | "/app/costs" | "/app/approvals" = "/app") => { o.setWorkspaceId(id); void navigate({ to }); };

  if (m.q.isLoading) return <p role="status" className="py-12 text-sm text-muted-foreground">{t("org.loading")}</p>;
  if (m.q.isError || !m.model || !m.q.data) return <div role="alert" className="py-6 text-sm text-destructive">{String((m.q.error as Error | null)?.message ?? "").startsWith("too_many") ? t("org.tooMany") : t("org.loadFailed")}</div>;
  const cur = target ?? m.model.view.defaultCurrency;
  const tabs: OrgTab[] = single ? ["overview", "resources"] : [...ORG_TABS];
  const active = tabs.includes(tab) ? tab : "overview";

  return <>
    <PageHeader title={t("org.title")} description={t("org.scope", { org: o.org?.name ?? "", n: String(m.businesses.length) })}
      actions={<div className="flex flex-wrap gap-2">
        <select aria-label={t("org.period")} className={`${sel} w-auto`} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {(["month", "90d", "year"] as const).map((p) => <option key={p} value={p}>{t(tk(`org.period.${p}`))}</option>)}
        </select>
        {finance && <select aria-label={t("org.reportIn")} className={`${sel} w-auto`} value={cur} onChange={(e) => setTarget(e.target.value)}>
          {REPORTING_CURRENCIES.map((c) => <option key={c} value={c}>{t("org.reportInCur", { cur: c })}</option>)}
        </select>}
      </div>} />
    {m.businesses.length > 1 && <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" role="note">
      <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">{t("ogo.context.org")}</span>
      <span className="text-muted-foreground">{t("ogo.context.orgHint", { n: String(m.businesses.length) })}</span>
    </div>}
    <nav aria-label={t("ogo.tabs")} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((x) => <button key={x} type="button" onClick={() => onTab(x)} aria-current={active === x ? "page" : undefined}
        className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", active === x ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
        {t(tk(`ogo.tab.${x}`))}{x === "risks" && pendingCount(m) > 0 ? ` · ${pendingCount(m)}` : ""}
      </button>)}
    </nav>
    {single && <SingleBusiness name={m.businesses[0]?.name ?? ""} />}
    {active === "overview" && <OverviewTab m={m} finance={finance} cur={cur} open={open} select={o.setWorkspaceId} onTab={onTab} single={single} />}
    {active === "strategy" && <StrategyTab m={m} />}
    {active === "opportunities" && <OpportunitiesTab m={m} />}
    {active === "initiatives" && <InitiativesTab m={m} />}
    {active === "resources" && <ResourcesTab m={m} orgId={orgId} finance={finance} />}
    {active === "risks" && <RisksTab m={m} open={open} />}
  </>;
}

const pendingCount = (m: OrgModel) => !m.model ? 0 : m.model.iq.pending.strategyDrafts + m.model.iq.pending.commitmentsToDecide.length + m.model.iq.pending.proposals.length;

function SingleBusiness({ name }: { name: string }) {
  const { t } = useI18n();
  return <Panel className="mb-6"><div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex min-w-0 items-start gap-3"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div><p className="text-sm font-medium">{t("ogo.single.title", { name })}</p><p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{t("ogo.single.text")}</p></div></div>
    <Button asChild size="sm" variant="outline"><Link to="/app/growth-officer">{t("ogo.single.cta")}</Link></Button>
  </div></Panel>;
}

function OverviewTab({ m, finance, cur, open, select, onTab, single }: { m: OrgModel; select: (id: string) => void; finance: boolean; cur: string; open: (id: string, to?: "/app" | "/app/goals" | "/app/campaigns" | "/app/tasks" | "/app/costs" | "/app/approvals") => void; onTab: (t: OrgTab) => void; single: boolean }) {
  const { t } = useI18n(); const f = useFmt(); const refNamer = useRefNamer();
  const { view, iq } = m.model!;
  const rates = m.q.data?.rates ?? [];
  const conv = (x: Money) => convertMoney(x, cur, rates, todayIso());
  const money = (x: Money) => Object.keys(x).length ? Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => f.money(v, c)).join(" · ") : "—";
  const name = (id: string) => m.name(id) ?? t("ogo.otherBusiness");
  return <>
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

    {!single && <Section title={t("ogo.officer.title")} intro={t("ogo.officer.intro")} action={<Button size="sm" variant="outline" onClick={() => onTab("strategy")}>{t("ogo.officer.open")}</Button>}>
      {m.intel.data && !m.intel.data.installed ? <Empty>{t("ogo.off")}</Empty> : iq.approved ? <Panel>
        <p className="text-xs text-muted-foreground">{t("ogo.officer.approved", { v: String(iq.approved.version), date: f.date(iq.approved.decided_at ?? iq.approved.created_at) })}</p>
        <p className="mt-1 font-medium">{refNamer(iq.approved.body, iq.approved.business_ids).named(iq.approved.title)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{refNamer(iq.approved.body, iq.approved.business_ids).named(iq.approved.summary)}</p>
        {iq.approvedBody && iq.approvedBody.objectives.length > 0 && <ul className="mt-3 space-y-1 text-sm">{iq.approvedBody.objectives.slice(0, 4).map((x, i) => <li key={i}>• {x.objective}{x.target ? ` — ${x.target}` : ""}</li>)}</ul>}
      </Panel> : <Empty>{iq.pending.strategyDrafts ? t("ogo.officer.draftWaiting") : t("ogo.officer.none")}</Empty>}
    </Section>}

    <Section title={t("ogo.next.title")} intro={t("ogo.next.intro")}>
      {iq.actions.length ? <ol className="divide-y divide-border border-y border-border">{iq.actions.map((a) => <ActionRow key={a.key} a={a} name={name} open={open} onTab={onTab} />)}</ol> : <Empty>{t("org.next.none")}</Empty>}
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
      <p className="mt-2 max-w-3xl text-xs text-muted-foreground">{t("org.isolation")}</p>
    </Section>

    {finance && <Section title={t("org.brands.title")} intro={t("org.brands.intro")}>
      {view.revenueOff ? <Empty>{t("org.revenueOff")}</Empty> : view.brandRows.length ? <div className="grid gap-3 md:grid-cols-2">{view.brandRows.map((b) => <Panel key={b.id}>
        <p className="font-medium">{b.name}</p>
        <ul className="mt-2 space-y-1 text-sm">{b.units.map((u) => <li key={u.unitId ?? "none"} className="flex justify-between gap-3">{u.unitId ? <Link to="/app/business" search={{ unit: u.unitId }} onClick={() => select(b.id)} className="underline-offset-2 hover:underline">{u.label || t("org.unknownBrand")}</Link> : <span className="text-muted-foreground">{t("org.noBrand")}</span>}<span className="tabular-nums">{money(u.revenue)}</span></li>)}</ul>
      </Panel>)}</div> : <Empty>{t("org.brands.none")}</Empty>}
    </Section>}
  </>;
}

function ActionRow({ a, name, open, onTab }: { a: RankedAction; name: (id: string) => string; open: (id: string, to?: "/app" | "/app/goals" | "/app/campaigns" | "/app/tasks" | "/app/costs" | "/app/approvals") => void; onTab: (t: OrgTab) => void }) {
  const { t } = useI18n();
  const params: Record<string, string> = { ...a.params, businesses: a.businesses.map(name).join(" · "), subject: subjectLabel(t, a.code, a.params["subject"] ?? a.params["reason"] ?? ""), reason: a.params["reason"] ? subjectLabel(t, "attend_business", a.params["reason"]) : "" };
  if (a.params["specialist"]) params["specialist"] = subjectLabel(t, "specialist_contention", a.params["specialist"]);
  return <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
    <div className="min-w-0 flex-1">
      <p><span className="mr-2 text-xs tabular-nums text-muted-foreground">{a.rank}.</span><span className="font-medium">{t(tk(`ogo.act.${a.code}`), params)}</span></p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("ogo.next.why", { score: String(a.score), factors: a.why.length ? a.why.map((w) => t(tk(`ogo.factor.${w}`))).join(", ") : t("ogo.factor.balanced") })}{a.businesses.length > 0 && ` · ${a.businesses.map(name).join(" · ")}`}</p>
    </div>
    {a.target.kind === "business" ? <Button size="sm" variant="outline" onClick={() => a.target.kind === "business" && open(a.target.business, a.target.to)}>{t("org.openBusiness", { name: name(a.target.business) })}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
      : <Button size="sm" variant="outline" onClick={() => a.target.kind === "tab" && onTab(a.target.tab)}>{t(tk(`ogo.go.${a.target.tab}`))}<ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>}
  </li>;
}

function Converted({ c, cur }: { c: ReturnType<typeof convertMoney>; cur: string }) {
  const { t } = useI18n(); const f = useFmt();
  if (c.total == null) return <span>{t("org.convWithheld", { cur, pairs: c.missing.join(", ") })}</span>;
  if (!c.used.length) return <span>{t("org.convSingle", { cur })}</span>;
  return <span>{t("org.convTotal", { v: f.money(c.total, cur) })} · {c.used.map((u) => t("org.convRate", { pair: `${u.from}→${u.to}`, rate: u.rate.toFixed(4), date: f.date(u.rateDate), source: u.source })).join("; ")}{c.stale.length > 0 && <span className="text-warning"> · {t("org.convStale", { pairs: c.stale.join(", ") })}</span>}</span>;
}
