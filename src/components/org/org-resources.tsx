import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncOfficialRates, syncOfficialRateHistory } from "@/lib/exchange-rates.functions";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { growthDb, type OrgAllocationRow } from "@/lib/pending-schema";
import { TASK_SPECIALISTS } from "@/lib/task-execution";
import { REPORTING_CURRENCIES } from "@/lib/org/consolidation";
import type { AllocationRec } from "@/lib/org/allocation";
import type { OrgOverviewData } from "@/components/org/org-data";
import { Section, sel, useFmt, Badge } from "@/components/bi/parts";
import { Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tk, todayIso, newKey, useNames, Empty, type OrgModel } from "@/components/org/org-model";
import { CreditsSection } from "@/components/org/org-credits";

export function ResourcesTab({
  m,
  orgId,
  finance,
}: {
  m: OrgModel;
  orgId: string;
  finance: boolean;
}) {
  const { t } = useI18n();
  const f = useFmt();
  const name = useNames();
  if (!m.model || !m.q.data) return null;
  const { view, iq } = m.model;
  const proposals = m.intel.data?.proposals ?? [];
  return (
    <>
      <CreditsSection orgId={orgId} />
      {finance && (
        <Section title={t("ogo.res.budget")} intro={t("ogo.res.budgetIntro")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-2 font-medium">{t("org.col.business")}</th>
                  <th className="p-2 font-medium">{t("ogo.res.col.planned")}</th>
                  <th className="p-2 font-medium">{t("ogo.res.col.spent")}</th>
                  <th className="p-2 font-medium">{t("ogo.res.col.use")}</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => {
                  const curs = [
                    ...new Set([...Object.keys(r.planned), ...Object.keys(r.spent)]),
                  ].sort();
                  return (
                    <tr key={r.id} className="border-b border-border align-top">
                      <td className="p-2 font-medium">{r.name}</td>
                      <td className="p-2 tabular-nums">
                        {curs.length
                          ? curs.map((c) => <p key={c}>{f.money(r.planned[c] ?? 0, c)}</p>)
                          : "—"}
                      </td>
                      <td className="p-2 tabular-nums">
                        {curs.length
                          ? curs.map((c) => <p key={c}>{f.money(r.spent[c] ?? 0, c)}</p>)
                          : "—"}
                      </td>
                      <td className="p-2 text-xs">
                        {curs.length
                          ? curs.map((c) => (
                              <p key={c}>
                                {r.utilization[c] == null
                                  ? t("org.unplanned", { cur: c })
                                  : `${r.utilization[c]}%`}
                              </p>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("ogo.res.budgetNote")}</p>
        </Section>
      )}

      <Section title={t("ogo.res.recs")} intro={t("ogo.res.recsIntro")}>
        {iq.recs.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {iq.recs.map((r) => (
              <RecCard key={r.key} r={r} m={m} />
            ))}
          </ul>
        ) : (
          <Empty>{t("ogo.res.noRecs")}</Empty>
        )}
      </Section>

      <Section title={t("ogo.res.proposals")} intro={t("ogo.res.proposalsIntro")}>
        {m.intel.data && !m.intel.data.installed ? (
          <Empty>{t("ogo.off")}</Empty>
        ) : proposals.length ? (
          <ul className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} p={p} m={m} />
            ))}
          </ul>
        ) : (
          <Empty>{t("ogo.res.noProposals")}</Empty>
        )}
      </Section>

      <Section title={t("ogo.res.insights")} intro={t("ogo.res.insightsIntro")}>
        {iq.insights.length ? (
          <ul className="flex flex-wrap gap-2">
            {iq.insights.map((s) => (
              <li
                key={`${s.code}:${s.specialist}`}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                <span className="font-medium">{t(tk(`run.sp.${s.specialist}`))}</span> ·{" "}
                {t(tk(`ogo.ins.${s.code}`), { open: String(s.open) })}
                <span className="block text-muted-foreground">
                  {s.businesses.map(name).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("ogo.res.noInsights")}</Empty>
        )}
      </Section>

      <Specialists data={m.q.data} m={m} orgId={orgId} />
      {finance && <Rates orgId={orgId} data={m.q.data} />}
      <p className="mt-6 text-xs text-muted-foreground">
        {t("ogo.res.today", { date: f.date(todayIso()) })}
      </p>
    </>
  );
}

function useRecText() {
  const { t } = useI18n();
  const f = useFmt();
  const name = useNames();
  return (r: AllocationRec) => {
    const title =
      r.kind === "budget_shift"
        ? t("ogo.rec.budget", {
            amount: f.money(r.amount, r.currency),
            channel: r.channel,
            from: name(r.from),
            to: name(r.to),
          })
        : t(tk(`ogo.rec.spec.${r.key.startsWith("se:") ? "enable" : r.direction}`), {
            specialist: t(tk(`run.sp.${r.specialist}`)),
            business: name(r.business),
            cap: r.cap == null ? t("org.spec.noCap") : String(r.cap),
          });
    return { title, reasons: r.reasons.map((x) => t(tk(`ogo.${x.code}`), x.params)) };
  };
}
function RecCard({ r, m }: { r: AllocationRec; m: OrgModel }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const text = useRecText()(r);
  const [busy, setBusy] = useState(false);
  const exists = (m.intel.data?.proposals ?? []).some(
    (p) =>
      p.status === "pending" &&
      JSON.stringify(p.payload).includes(
        r.kind === "budget_shift" ? r.lineId : `${r.specialist}`,
      ) &&
      p.kind === r.kind &&
      (r.kind === "budget_shift" || p.business_ids.includes(r.business)),
  );
  async function propose() {
    if (busy || !o.org) return;
    setBusy(true);
    try {
      const payload =
        r.kind === "budget_shift"
          ? { from_line: r.lineId, to_workspace: r.to, amount: r.amount }
          : { workspace: r.business, specialist: r.specialist, enabled: r.enabled, cap: r.cap };
      const res = await growthDb.rpc("propose_org_allocation", {
        _org: o.org.id,
        _request: newKey(),
        _kind: r.kind,
        _title: text.title.slice(0, 200),
        _reasoning: text.reasons.join(" ").slice(0, 2000) || text.title,
        _payload: payload,
      });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      toast.success(t("ogo.res.proposed"));
      await qc.invalidateQueries({ queryKey: ["org-intel", o.org.id] });
      await qc.invalidateQueries({ queryKey: ["org-decisions"] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <Panel className="h-full">
        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="planned">{t(tk(`ogo.recKind.${r.kind}`))}</Badge>
          <Badge kind={r.confidence}>{t(tk(`ogo.conf.${r.confidence}`))}</Badge>
        </div>
        <p className="mt-2 text-sm font-medium">{text.title}</p>
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {text.reasons.map((x, i) => (
            <li key={i}>• {x}</li>
          ))}
        </ul>
        {can(o.role, "org.coordinate") &&
          m.intel.data?.installed &&
          (exists ? (
            <p className="mt-3 text-xs text-muted-foreground">{t("ogo.res.alreadyProposed")}</p>
          ) : (
            <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={propose}>
              {t("ogo.res.prepare")}
            </Button>
          ))}
      </Panel>
    </li>
  );
}

function ProposalCard({ p, m }: { p: OrgAllocationRow; m: OrgModel }) {
  const o = useOrg();
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const name = useNames();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pl = (p.payload ?? {}) as Record<string, string | number | boolean | null>;
  const r = m.rights.data ?? {};
  const mayDecide =
    p.kind === "budget_shift"
      ? !!(r[String(pl["from_workspace"])]?.editor && r[String(pl["to_workspace"])]?.editor)
      : !!r[String(pl["workspace"])]?.admin;
  async function decide(d: "apply" | "reject" | "withdraw") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await growthDb.rpc("decide_org_allocation", {
        _id: p.id,
        _decision: d,
        _note: note,
      });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      toast.success(t(tk(`ogo.res.decided.${d}`)));
      setNote("");
      await Promise.all(
        ["org-intel", "org-decisions", "org-overview"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const what =
    p.kind === "budget_shift"
      ? t("ogo.res.shiftWhat", {
          amount: f.money(Number(pl["amount"] ?? 0), String(pl["currency"] ?? "EUR")),
          channel: String(pl["channel"] ?? ""),
          from: name(String(pl["from_workspace"])),
          to: name(String(pl["to_workspace"])),
          month: String(pl["period_month"] ?? "").slice(0, 7),
        })
      : t("ogo.res.capWhat", {
          specialist: t(tk(`run.sp.${String(pl["specialist"])}`)),
          business: name(String(pl["workspace"])),
          cap: pl["cap"] == null ? t("org.spec.noCap") : String(pl["cap"]),
          state: pl["enabled"] ? t("org.spec.on") : t("org.spec.offFor"),
        });
  return (
    <li>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{p.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{what}</p>
          </div>
          <StatusChip status={p.status}>{t(tk(`ogo.propStatus.${p.status}`))}</StatusChip>
        </div>
        <p className="mt-2 text-xs">{p.reasoning}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("ogo.res.proposedOn", { date: f.date(p.created_at) })}
          {p.decided_at && ` · ${t("ogo.res.decidedOn", { date: f.date(p.decided_at) })}`}
          {p.decision_note && ` · ${p.decision_note}`}
        </p>
        {p.status === "pending" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {(mayDecide || p.created_by === o.userId) && (
              <input
                aria-label={t("ogo.note")}
                className={`${sel} w-full sm:w-56`}
                maxLength={1000}
                placeholder={t("ogo.notePh")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            {mayDecide && (
              <>
                <Button size="sm" disabled={busy} onClick={() => decide("apply")}>
                  {t("ogo.res.apply")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide("reject")}
                >
                  {t("ogo.res.reject")}
                </Button>
              </>
            )}
            {p.created_by === o.userId && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("withdraw")}>
                {t("ogo.res.withdraw")}
              </Button>
            )}
            <p className="w-full text-[11px] text-muted-foreground">
              {mayDecide ? t("ogo.res.applyNote") : t(tk(`ogo.res.needs.${p.kind}`))}
            </p>
          </div>
        )}
      </Panel>
    </li>
  );
}

function Specialists({ data, m, orgId }: { data: OrgOverviewData; m: OrgModel; orgId: string }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const name = useNames();
  const view = m.model!.view;
  const manage = can(o.role, "specialists.manage") && !view.allocationsOff;
  const [form, setForm] = useState({
    ws: o.workspaces[0]?.id ?? "",
    spec: "seo",
    enabled: true,
    priority: "3",
    cap: "",
  });
  const [busy, setBusy] = useState(false);
  const current = (data.allocations ?? []).find(
    (a) => a.workspace_id === form.ws && a.specialist_key === form.spec,
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const cap = form.cap.trim() ? Number(form.cap) : null;
      const { error } = await growthDb.rpc("set_specialist_allocation", {
        _workspace: form.ws,
        _specialist: form.spec,
        _enabled: form.enabled,
        _priority: Number(form.priority),
        _cap: cap,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t("org.spec.saved"));
      await qc.invalidateQueries({ queryKey: ["org-overview", orgId] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={t("org.spec.title")} intro={t("org.spec.intro")}>
      {view.allocationsOff ? (
        <Empty>{t("org.spec.off")}</Empty>
      ) : view.load.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-2 font-medium">{t("org.spec.col.specialist")}</th>
                <th className="p-2 font-medium">{t("org.spec.col.business")}</th>
                <th className="p-2 font-medium">{t("org.spec.col.open")}</th>
                <th className="p-2 font-medium">{t("org.spec.col.used")}</th>
                <th className="p-2 font-medium">{t("org.spec.col.setting")}</th>
              </tr>
            </thead>
            <tbody>
              {view.load.flatMap((l) =>
                l.businesses.map((b, i) => (
                  <tr key={`${l.specialist}:${b.id}`} className="border-b border-border">
                    <td className="p-2 font-medium">
                      {i === 0 ? t(tk(`run.sp.${l.specialist}`)) : ""}
                    </td>
                    <td className="p-2">{name(b.id)}</td>
                    <td className="p-2 tabular-nums">{b.open}</td>
                    <td className="p-2 tabular-nums">
                      {b.cap != null
                        ? t("org.spec.usedOfCap", { used: String(b.used), cap: String(b.cap) })
                        : b.used}
                    </td>
                    <td className="p-2 text-xs">
                      {b.enabled ? (
                        t("org.spec.on")
                      ) : (
                        <span className="text-destructive">{t("org.spec.offFor")}</span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{t("org.spec.none")}</Empty>
      )}
      {manage && (
        <form
          onSubmit={save}
          className="mt-4 grid gap-2 rounded-lg border border-dashed p-4 sm:grid-cols-3 lg:grid-cols-6"
          aria-label={t("org.spec.form")}
        >
          <select
            aria-label={t("org.spec.col.business")}
            className={sel}
            value={form.ws}
            onChange={(e) => setForm({ ...form, ws: e.target.value })}
          >
            {o.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("org.spec.col.specialist")}
            className={sel}
            value={form.spec}
            onChange={(e) => setForm({ ...form, spec: e.target.value })}
          >
            {Object.keys(TASK_SPECIALISTS).map((s) => (
              <option key={s} value={s}>
                {t(tk(`run.sp.${s}`))}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            {t("org.spec.enabled")}
          </label>
          <select
            aria-label={t("org.spec.priority")}
            className={sel}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {t(tk(`org.spec.prio.${p}`))}
              </option>
            ))}
          </select>
          <Input
            aria-label={t("org.spec.cap")}
            type="number"
            min={1}
            placeholder={t("org.spec.capPh")}
            value={form.cap}
            onChange={(e) => setForm({ ...form, cap: e.target.value })}
          />
          <Button type="submit" disabled={busy || !form.ws}>
            {t("org.spec.save")}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-3 lg:col-span-6">
            {current
              ? t("org.spec.current", {
                  state: current.enabled ? t("org.spec.on") : t("org.spec.offFor"),
                  prio: String(current.priority),
                  cap:
                    current.monthly_credit_cap == null
                      ? t("org.spec.noCap")
                      : String(current.monthly_credit_cap),
                })
              : t("org.spec.default")}
          </p>
        </form>
      )}
    </Section>
  );
}

function Rates({ orgId, data }: { orgId: string; data: OrgOverviewData }) {
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const sync = useServerFn(syncOfficialRates);
  const official = (data.rates ?? []).filter((r) => r.kind === "official");
  const latest = official[0]?.rate_date ?? null;
  // Official rates are fetched on the first visit of the day (the ECB publishes once per working day); stored once.
  const due = data.rates !== null && (!latest || latest < todayIso());
  const auto = useQuery({
    queryKey: ["official-rates-sync", orgId, todayIso()],
    enabled: due,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const r = await sync({ data: { orgId } });
      if (r.ok && r.added > 0) await qc.invalidateQueries({ queryKey: ["org-overview", orgId] });
      return r;
    },
  });
  const [busy, setBusy] = useState(false);
  const syncHistory = useServerFn(syncOfficialRateHistory);
  async function importHistory() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await syncHistory({ data: { orgId } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const v = {
        n: String(r.added),
        days: String(r.days),
        first: f.date(r.first),
        last: f.date(r.last),
      };
      toast.success(r.added ? t("org.rates.historyDone", v) : t("org.rates.historyNone", v));
      if (r.refused) toast.warning(t("org.rates.historyRefused", { n: String(r.refused) }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["org-overview", orgId] }),
        qc.invalidateQueries({ queryKey: ["org-period-rates", orgId] }),
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sync({ data: { orgId } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.added
          ? t("org.rates.added", { n: String(r.added), date: f.date(r.date) })
          : t("org.rates.current", { date: f.date(r.date) }),
      );
      await qc.invalidateQueries({ queryKey: ["org-overview", orgId] });
    } finally {
      setBusy(false);
    }
  }
  if (data.rates === null)
    return (
      <Section title={t("org.rates.title")}>
        <Empty>{t("org.rates.off")}</Empty>
      </Section>
    );
  const shown = latest ? official.filter((r) => r.rate_date === latest) : [];
  const failed =
    auto.data && !auto.data.ok ? auto.data.error : auto.isError ? t("org.rates.syncFailed") : null;
  return (
    <Section
      title={t("org.rates.title")}
      intro={t("org.rates.intro")}
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy || auto.isFetching}>
            {busy || auto.isFetching ? t("org.rates.fetching") : t("org.rates.refresh")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={importHistory}
            disabled={busy || auto.isFetching}
          >
            {t("org.rates.history")}
          </Button>
        </div>
      }
    >
      {failed && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {failed}
        </p>
      )}
      {latest ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("org.rates.published", { date: f.date(latest) })}
          </p>
          <ul className="grid gap-x-6 gap-y-1 border-y border-border py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {shown
              .filter((r) => (REPORTING_CURRENCIES as readonly string[]).includes(r.quote_currency))
              .map((r) => (
                <li key={r.id} className="tabular-nums">
                  1 EUR = {Number(r.rate).toFixed(4)} {r.quote_currency}
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("org.rates.more", { n: String(shown.length) })}
          </p>
        </>
      ) : (
        <Empty>{auto.isFetching ? t("org.rates.fetching") : t("org.rates.none")}</Empty>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("org.rates.historyHint")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("org.rates.permanent")}{" "}
        <Link to="/app/revenue" className="underline">
          {t("org.rates.revenueLink")}
        </Link>
      </p>
    </Section>
  );
}
