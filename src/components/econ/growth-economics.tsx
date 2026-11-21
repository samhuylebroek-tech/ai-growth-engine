// Growth economics: one page for the money of a business — budget, campaign spending, business costs, AI credits,
// revenue, attribution, gross profit, CAC, ROAS and observed customer value — built from the canonical ledgers by the
// pure rules in src/lib/econ/. Actual, estimated and simulated amounts are never mixed; a figure without its inputs
// shows what is missing instead of a number. Recording costs and choosing a cost model are role-checked in SQL.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { hasRole } from "@/lib/permissions";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { MODELS, type Model } from "@/lib/bi/attribution";
import { PERIODS, periodRange, type PeriodKey } from "@/lib/bi/kpis";
import { rollup, type Money } from "@/lib/econ/rollup";
import { economicsSummary, PRICE_CURRENCY, type EconSummary } from "@/lib/econ/summary";
import { econKey, econOptions, type EconData } from "@/components/econ/econ-data";
import { SectionHeading } from "@/components/app/section-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sel = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const AGENT_KEYS = ["growth_officer", "organization_growth_officer", "business_intelligence", "market_research", "competitor_intel", "marketing_strategy", "seo", "content", "social", "advertising", "crm", "email"];
const COST_CATS = ["cogs", "software", "agency", "marketing", "other_operating"] as const;

export function GrowthEconomics() {
  const o = useOrg(); const { t } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{t("ge.loading")}</p>;
  if (!o.org || !o.workspace) return <p className="p-6 text-muted-foreground">{t("ge.chooseWs")}</p>;
  return <Economics key={`${o.org.id}:${o.workspace.id}`} orgId={o.org.id} wsId={o.workspace.id} canRecord={hasRole(o.workspaceRole, "member")} canModel={hasRole(o.workspaceRole, "editor")} />;
}

function Economics({ orgId, wsId, canRecord, canModel }: { orgId: string; wsId: string; canRecord: boolean; canModel: boolean }) {
  const { t, tag } = useI18n();
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [model, setModel] = useState<Model>("last_touch");
  const q = useQuery(econOptions(orgId, wsId));
  const { from, to } = periodRange(period);
  const money = (n: number, c: string) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  const many = (m: Money) => { const e = Object.entries(m).filter(([, v]) => v !== 0); return e.length ? e.map(([c, v]) => money(v, c)).join(" · ") : "—"; };
  const d = q.data;
  const today = new Date().toISOString().slice(0, 10);
  const view = useMemo(() => d ? economicsSummary(d, from, to, model, today) : null, [d, from, to, model, today]);
  if (q.isLoading) return <p className="p-6 text-muted-foreground">{t("ge.loading")}</p>;
  if (q.error) return <p className="p-6 text-destructive">{t(isNotInstalled(q.error) ? "ge.notInstalled" : "ge.loadFailed")}</p>;
  if (!d || !view) return null;
  const st = (s: string) => t(`ge.status.${s}` as MessageKey);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <SectionHeading title={t("ge.title")} />
      <p className="-mt-4 text-sm text-muted-foreground">{t("ge.intro")}</p>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs">{t("ge.period")}<select className={sel} value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {PERIODS.map((p) => <option key={p} value={p}>{t(`bi.period.${p}` as MessageKey)}</option>)}</select></label>
        <label className="grid gap-1 text-xs">{t("ge.model")}<select className={sel} value={model} onChange={(e) => setModel(e.target.value as Model)}>
          {MODELS.map((m) => <option key={m} value={m}>{t(`bi.model.${m}` as MessageKey)}</option>)}</select></label>
        <p className="self-end text-xs text-muted-foreground">{from} – {to}</p>
      </div>
      {d.incomplete.length > 0 && <p role="alert" className="rounded-md border border-warning/40 p-3 text-sm text-warning">{t("ge.incomplete", { list: d.incomplete.join(", ") })}</p>}
      {!d.costsInstalled && <p className="rounded-md border border-warning/40 p-3 text-sm text-warning">{t("ge.costsNotInstalled")}</p>}

      <section aria-label={t("ge.business")} className="space-y-3">
        <h2 className="text-base font-semibold">{t("ge.business")}</h2>
        {view.currencies.length === 0 && <p className="text-sm text-muted-foreground">{t("ge.nothing")}</p>}
        {view.currencies.map((c) => (
          <div key={c.currency} className="rounded-lg border bg-card p-4 text-sm">
            <h3 className="mb-2 font-medium">{c.currency}</h3>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Fig label={t("ge.netRevenue")} value={c.rev ? money(c.rev.net, c.currency) : "—"} note={c.rev ? t("ge.revenueNote", { g: money(c.rev.gross, c.currency), r: money(Math.abs(c.rev.refunds), c.currency), n: c.rev.sales }) : t("ge.noRevenue")} />
              <Fig label={t("ge.attributed", { m: t(`bi.model.${model}` as MessageKey) })} value={c.att ? money(c.att.attributed, c.currency) : "—"} note={c.att ? t("ge.unattributed", { a: money(c.att.unattributed, c.currency), n: c.att.unattributedSales }) : ""} />
              <Fig label={t("ge.campaignSpend")} value={money(c.spent, c.currency)} note={[c.byCat.length ? c.byCat.map(([k, v]) => `${t(`ge.scat.${k}` as MessageKey)} ${money(v, c.currency)}`).join(" · ") : t("ge.noSpend"), c.reserved ? t("ge.reserved", { a: money(c.reserved, c.currency) }) : "", c.simulated ? t("ge.simulated", { a: money(c.simulated, c.currency) }) : ""].filter(Boolean).join(" · ")} />
              <Fig label={t("ge.businessCosts")} value={money(c.costs, c.currency)} note={[c.costCat.length ? c.costCat.map(([k, v]) => `${t(`ge.cat.${k}` as MessageKey)} ${money(v, c.currency)}`).join(" · ") : t("ge.noCosts"), c.estCosts ? t("ge.estimatedCosts", { a: money(c.estCosts, c.currency) }) : ""].filter(Boolean).join(" · ")} />
              <Fig label={t("ge.grossProfit")} value={c.gp && c.gp.grossProfit !== null ? `${money(c.gp.grossProfit, c.currency)}${c.gp.grossMargin !== null ? ` (${c.gp.grossMargin}%)` : ""}` : "—"}
                note={c.gp ? `${st(c.gp.status)}${c.gp.missing.length ? ` — ${c.gp.missing.map((m) => t(`ge.missing.${m}` as MessageKey)).join(", ")}` : ""}${c.gp.monthsWithoutCost.length ? ` (${c.gp.monthsWithoutCost.join(", ")})` : ""}${c.gp.salesWithoutCost ? ` (${t("ge.salesWithoutCost", { n: c.gp.salesWithoutCost })})` : ""}` : st("unavailable")} />
              <Fig label={t("ge.cac")} value={c.cac && c.cac.value !== null ? money(c.cac.value, c.currency) : "—"}
                note={c.cac ? `${st(c.cac.status)} · ${t("ge.cacNote", { s: money(c.cac.spend, c.currency), n: c.cac.newCustomers })}${c.cac.salesWithoutCustomer ? ` · ${t("ge.salesWithoutCustomer", { n: c.cac.salesWithoutCustomer })}` : ""}` : st("unavailable")} />
              <Fig label={t("ge.customerValue")} value={c.clv && c.clv.avgRevenue !== null ? money(c.clv.avgRevenue, c.currency) : "—"}
                note={c.clv ? `${st(c.clv.status)} · ${t("ge.clvNote", { n: c.clv.customers, r: c.clv.repeatRate ?? "—" })}` : st("unavailable")} />
            </dl>
          </div>
        ))}
        {view.currencies.map((c) => <Missing key={`m:${c.currency}`} c={c} />)}
        <div className="rounded-lg border bg-card p-4 text-sm">
          <h3 className="mb-1 font-medium">{t("ge.ai")}</h3>
          <p>{t("ge.aiTotal", { n: view.ai.total, c: view.ai.onCampaigns, o: view.ai.otherWork })}</p>
          {(view.ai.pending > 0 || view.ai.uncertain > 0) && <p className="text-muted-foreground">{t("ge.aiOpen", { p: view.ai.pending, u: view.ai.uncertain })}</p>}
          {view.ai.byAgent.length > 0 && <p className="text-xs text-muted-foreground">{view.ai.byAgent.map(([k, n]) => `${t(`ge.agent.${AGENT_KEYS.includes(k) ? k : "other"}` as MessageKey)} ${n}`).join(" · ")}</p>}
          <p className="text-muted-foreground">{view.ai.cost.priced > 0 ? t("ge.aiCost", { a: money(view.ai.cost.amount, PRICE_CURRENCY), p: view.ai.cost.priced }) : t("ge.aiNoPrice")}{view.ai.cost.unpriced > 0 && view.ai.cost.priced > 0 ? ` · ${t("ge.aiUnpriced", { n: view.ai.cost.unpriced })}` : ""}</p>
          {!view.ai.reconciled && <p role="alert" className="text-xs text-warning">{t("ge.aiNotReconciled")}</p>}
          <p className="text-xs text-muted-foreground">{t("ge.aiSeparate")}</p>
        </div>
        <Budget v={view} money={money} />
        <Channels v={view} money={money} />
      </section>

      <section aria-label={t("ge.campaigns")} className="space-y-2">
        <h2 className="text-base font-semibold">{t("ge.campaigns")}</h2>
        <p className="text-xs text-muted-foreground">{t("ge.campaignsNote")}</p>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">{["ge.col.campaign", "ge.col.allocated", "ge.col.spent", "ge.col.reserved", "ge.col.simulated", "ge.col.credits", "ge.col.revenue", "ge.col.roas", "ge.col.inputs"].map((k) => <th key={k} className="whitespace-nowrap p-2 font-normal">{t(k as MessageKey)}</th>)}</tr></thead>
            <tbody>{view.campaigns.map((c) => (
              <tr key={c.id} className="border-b last:border-0 align-top">
                <td className="p-2 font-medium">{c.title}</td><td className="p-2">{many(c.t.allocated)}</td><td className="p-2">{many(c.t.spent)}</td><td className="p-2">{many(c.t.reserved)}</td>
                <td className="p-2 text-muted-foreground">{many(c.t.simulatedSpent)}</td><td className="p-2">{c.t.credits}{c.t.uncertainRuns ? ` (+${c.t.uncertainRuns} ?)` : ""}</td>
                <td className="p-2">{c.roas.map((r) => r.revenue ? money(r.revenue, r.currency) : "—").join(" · ") || "—"}</td>
                <td className="p-2">{c.roas.map((r) => r.value !== null ? `${r.value}×` : st(r.status)).join(" · ") || st("unavailable")}</td>
                <td className="p-2 text-xs text-muted-foreground">{Object.entries(c.inputs).filter(([k]) => k !== "costs").map(([k, v]) => `${t(`ge.input.${k}` as MessageKey)}: ${t(`ge.state.${v}` as MessageKey)}`).join(" · ")}</td>
              </tr>))}
              {view.campaigns.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={9}>{t("ge.noCampaigns")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <Rollups d={d} many={many} />
      <Formulas />
      {d.costsInstalled && <CostLedger orgId={orgId} wsId={wsId} d={d} canRecord={canRecord} canModel={canModel} money={money} />}
    </div>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded border border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-semibold tabular-nums">{value}</dd>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>;
}

type Cur = EconSummary["currencies"][number];
/** Each missing input of a figure, with why it is needed and where it is added. */
function Missing({ c }: { c: Cur }) {
  const { t } = useI18n();
  const keys = new Set<string>();
  for (const m of c.gp?.missing ?? []) keys.add(m);
  if (c.cac?.salesWithoutCustomer) keys.add("customer_ref");
  if (c.cac && c.cac.spend <= 0 && (c.rev?.sales ?? 0) > 0) keys.add("acquisition_spend");
  if (c.att && c.att.unattributedSales > 0) keys.add("attribution");
  if (!keys.size) return null;
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm">
      <h3 className="mb-2 font-medium">{t("ge.missingTitle", { c: c.currency })}</h3>
      <ul className="space-y-1.5 text-xs">{[...keys].map((k) => <li key={k}><span className="font-medium">{t(`ge.missing.${k}` as MessageKey)}</span> — {t(`ge.fix.${k}` as MessageKey)}</li>)}</ul>
    </div>
  );
}

function Budget({ v, money }: { v: EconSummary; money: (n: number, c: string) => string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h3 className="mb-1 font-medium">{t("ge.budget")}</h3>
      {v.budget.length === 0 ? <p className="text-muted-foreground">{t("ge.noBudget")}</p> : v.budget.map((b) => (
        <p key={b.currency}>{t("ge.budgetLine", { p: money(b.total, b.currency), a: money(b.allocated, b.currency), u: money(b.unallocated, b.currency), s: money(b.spent, b.currency), r: money(b.reserved, b.currency), n: b.lines })}</p>))}
      {v.duplicates.length > 0 && <p className="text-xs text-warning">{t("ge.budgetDups", { n: v.duplicates.length })}</p>}
      <p className="text-xs text-muted-foreground">{t("ge.budgetNote")}</p>
    </div>
  );
}

function Channels({ v, money }: { v: EconSummary; money: (n: number, c: string) => string }) {
  const { t } = useI18n();
  const rows = Object.entries(v.channels);
  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h3 className="mb-1 font-medium">{t("ge.channels")}</h3>
      {rows.length === 0 ? <p className="text-muted-foreground">{t("ge.noChannels")}</p> : (
        <ul className="space-y-0.5">{rows.map(([ch, m]) => <li key={ch}>{ch === "unspecified" ? t("ge.channelNone") : ch}: {Object.entries(m).map(([cur, a]) => money(a, cur)).join(" · ")}</li>)}</ul>)}
      <p className="text-xs text-muted-foreground">{t("ge.channelsNote")}</p>
    </div>
  );
}

function Formulas() {
  const { t } = useI18n();
  return (
    <details className="rounded-lg border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-medium">{t("ge.formulas")}</summary>
      <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        {["net", "gp", "margin", "cac", "roas", "rpc", "ai"].map((k) => <li key={k}>{t(`ge.f.${k}` as MessageKey)}</li>)}
      </ul>
    </details>
  );
}

function Rollups({ d, many }: { d: EconData; many: (m: Money) => string }) {
  const { t } = useI18n();
  const [level, setLevel] = useState<"initiative" | "strategy" | "goal">("initiative");
  const input = { campaigns: d.campaigns, allocations: d.allocations, spend: d.spend, costs: d.costs, credits: d.credits };
  const items = level === "initiative" ? d.initiatives.map((x) => ({ id: x.id, name: x.title })) : level === "strategy" ? d.strategies.map((x) => ({ id: x.id, name: x.summary.slice(0, 80) })) : d.goals.map((x) => ({ id: x.id, name: x.title }));
  const key = level === "initiative" ? "initiative_id" : level === "strategy" ? "strategy_id" : "goal_id";
  const used = items.filter((x) => d.campaigns.some((c) => c[key] === x.id) || (level === "initiative" && d.costs.some((c) => c.initiative_id === x.id)));
  return (
    <section aria-label={t("ge.rollups")} className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-base font-semibold">{t("ge.rollups")}</h2><p className="text-xs text-muted-foreground">{t("ge.rollupRule")}</p></div>
        <select aria-label={t("ge.level")} className={`${sel} w-auto`} value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          {(["initiative", "strategy", "goal"] as const).map((l) => <option key={l} value={l}>{t(`ge.level.${l}` as MessageKey)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">{["ge.col.name", "ge.col.campaignsN", "ge.col.allocated", "ge.col.spent", "ge.col.direct", "ge.col.simulated", "ge.col.credits"].map((k) => <th key={k} className="whitespace-nowrap p-2 font-normal">{t(k as MessageKey)}</th>)}</tr></thead>
          <tbody>{used.map((x) => { const r = rollup(level, x.id, input); return (
            <tr key={x.id} className="border-b last:border-0"><td className="p-2 font-medium">{x.name}</td><td className="p-2">{r.campaigns}</td><td className="p-2">{many(r.allocated)}</td><td className="p-2">{many(r.spent)}</td>
              <td className="p-2">{level === "initiative" ? many(r.directCosts) : "—"}</td><td className="p-2 text-muted-foreground">{many(r.simulatedSpent)}</td><td className="p-2">{r.credits}</td></tr>); })}
            {used.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={7}>{t("ge.noRollup")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostLedger({ orgId, wsId, d, canRecord, canModel, money }: { orgId: string; wsId: string; d: EconData; canRecord: boolean; canModel: boolean; money: (n: number, c: string) => string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const month = new Date().toISOString().slice(0, 7);
  const [f, setF] = useState({ category: "cogs", amount: "", currency: "EUR", start: `${month}-01`, end: "", data_class: "manual", note: "", initiative_id: "" });
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState({ model: "per_period", rate: "", from: `${month}-01`, note: "" });
  const current = [...d.models].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const refresh = () => qc.invalidateQueries({ queryKey: econKey(orgId, wsId) });
  const err = (e: { message?: string } | null) => {
    const msg = e?.message ?? "";
    toast.error(t(msg.includes("cost_below_zero") ? "ge.err.belowZero" : msg.includes("duplicate_reference") ? "ge.err.duplicate" : msg.includes("42501") || msg.includes("only editors") || msg.includes("business not found") ? "ge.err.role" : "ge.err.invalid"));
  };
  const record = async (p: Record<string, unknown>) => {
    setBusy(true);
    const r = await growthDb.rpc("record_business_cost", { _workspace: wsId, _request: crypto.randomUUID(), _p: p as never });
    setBusy(false);
    if (r.error) return err(r.error);
    toast.success(t("ge.costSaved")); await refresh();
  };
  const saveModel = async () => {
    setBusy(true);
    const r = await growthDb.rpc("set_cost_model", { _workspace: wsId, _request: crypto.randomUUID(), _model: m.model, _margin_rate: m.model === "margin_estimate" ? Number(m.rate) / 100 : null, _effective_from: m.from, _note: m.note });
    setBusy(false);
    if (r.error) return err(r.error);
    toast.success(t("ge.modelSaved")); await refresh();
  };
  const corrected = (id: string) => d.costs.filter((c) => c.relates_to === id).reduce((s, c) => s + Number(c.amount), 0);
  const end = f.end || `${f.start.slice(0, 7)}-${String(new Date(Date.UTC(+f.start.slice(0, 4), +f.start.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
  return (
    <section aria-label={t("ge.costs")} className="space-y-3">
      <h2 className="text-base font-semibold">{t("ge.costs")}</h2>
      <p className="text-xs text-muted-foreground">{t("ge.costsIntro")}</p>
      <div className="rounded-lg border bg-card p-4 text-sm">
        <h3 className="font-medium">{t("ge.costModel")}</h3>
        <p className="text-muted-foreground">{current ? t("ge.modelCurrent", { m: t(`ge.model.${current.model}` as MessageKey), d: current.effective_from, r: current.margin_rate !== null ? `${Number(current.margin_rate) * 100}%` : "" }) : t("ge.modelNone")}</p>
        {canModel ? <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label className="grid gap-1 text-xs">{t("ge.model.label")}<select className={sel} value={m.model} onChange={(e) => setM({ ...m, model: e.target.value })}>{(["per_sale", "per_period", "margin_estimate", "none"] as const).map((x) => <option key={x} value={x}>{t(`ge.model.${x}` as MessageKey)}</option>)}</select></label>
          {m.model === "margin_estimate" && <label className="grid gap-1 text-xs">{t("ge.marginRate")}<Input type="number" min={0} max={100} value={m.rate} onChange={(e) => setM({ ...m, rate: e.target.value })} /></label>}
          <label className="grid gap-1 text-xs">{t("ge.effectiveFrom")}<Input type="date" value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} /></label>
          <div className="self-end"><Button size="sm" variant="outline" disabled={busy || (m.model === "margin_estimate" && m.rate === "")} onClick={saveModel}>{t("ge.saveModel")}</Button></div>
        </div> : <p className="text-xs text-muted-foreground">{t("ge.modelEditors")}</p>}
      </div>
      {canRecord && <div className="grid gap-2 rounded-lg border border-dashed p-4 text-sm sm:grid-cols-4">
        <label className="grid gap-1 text-xs">{t("ge.category")}<select className={sel} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{COST_CATS.map((c) => <option key={c} value={c}>{t(`ge.cat.${c}` as MessageKey)}</option>)}</select></label>
        <label className="grid gap-1 text-xs">{t("ge.amount")}<Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="grid gap-1 text-xs">{t("ge.currency")}<Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></label>
        <label className="grid gap-1 text-xs">{t("ge.dataClass")}<select className={sel} value={f.data_class} onChange={(e) => setF({ ...f, data_class: e.target.value })}>{(["manual", "estimated", "simulated"] as const).map((c) => <option key={c} value={c}>{t(`ge.class.${c}` as MessageKey)}</option>)}</select></label>
        <label className="grid gap-1 text-xs">{t("ge.from")}<Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label className="grid gap-1 text-xs">{t("ge.to")}<Input type="date" value={end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
        <label className="grid gap-1 text-xs">{t("ge.initiative")}<select className={sel} value={f.initiative_id} onChange={(e) => setF({ ...f, initiative_id: e.target.value })}><option value="">{t("ge.noInitiative")}</option>{d.initiatives.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
        <label className="grid gap-1 text-xs">{t("ge.note")}<Input maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="sm:col-span-4"><Button size="sm" disabled={busy || !(Number(f.amount) > 0)} onClick={() => record({ category: f.category, amount: Number(f.amount), currency: f.currency, period_start: f.start, period_end: end, data_class: f.data_class, note: f.note, initiative_id: f.initiative_id })}>{t("ge.recordCost")}</Button>
          <span className="ml-2 text-xs text-muted-foreground">{t("ge.campaignCostsElsewhere")}</span></div>
      </div>}
      <ul className="divide-y rounded-lg border bg-card text-sm">
        {d.costs.filter((c) => c.kind === "cost").slice(0, 50).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
            <span>{t(`ge.cat.${c.category}` as MessageKey)} · {c.period_start} – {c.period_end} · {money(Number(c.amount) + corrected(c.id), c.currency)}{corrected(c.id) ? ` (${t("ge.correctedFrom", { a: money(Number(c.amount), c.currency) })})` : ""}
              {c.data_class !== "manual" ? ` · ${t(`ge.class.${c.data_class}` as MessageKey)}` : ""}{c.note ? ` · ${c.note}` : ""}</span>
            {canRecord && <CorrectButton onCorrect={(amount) => record({ kind: "correction", amount, currency: c.currency, relates_to: c.id, period_start: c.period_start, period_end: c.period_end })} />}
          </li>))}
        {d.costs.length === 0 && <li className="p-3 text-muted-foreground">{t("ge.noCostRows")}</li>}
      </ul>
    </section>
  );
}

function CorrectButton({ onCorrect }: { onCorrect: (amount: number) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState("");
  return <span className="flex items-center gap-1"><Input aria-label={t("ge.correction")} className="h-8 w-28" type="number" step="0.01" placeholder="-10" value={v} onChange={(e) => setV(e.target.value)} />
    <Button size="sm" variant="ghost" disabled={!Number(v)} onClick={() => { onCorrect(Number(v)); setV(""); }}>{t("ge.correct")}</Button></span>;
}
