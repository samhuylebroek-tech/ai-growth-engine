import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { attribution, creditOverviewSchema, specialistTotals, type CreditOverview } from "@/lib/org/credits";
import { Section } from "@/components/bi/parts";
import { Panel } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { tk, todayIso, useNames, useKnown, Empty } from "@/components/org/org-model";

const monthStart = () => `${todayIso().slice(0, 7)}-01`;

export function orgCreditsOptions(orgId: string | undefined) {
  return {
    queryKey: ["org-credits", orgId, monthStart()], enabled: !!orgId, staleTime: 30_000, retry: false,
    queryFn: async (): Promise<CreditOverview | null> => {
      const r = await growthDb.rpc("org_credit_overview", { _org: orgId!, _month: monthStart() });
      if (r.error) { if (isNotInstalled(r.error)) return null; throw r.error; }
      return creditOverviewSchema.parse(r.data);
    },
  };
}

export function CreditsSection({ orgId }: { orgId: string }) {
  const { t } = useI18n(); const name = useNames(); const known = useKnown();
  const q = useQuery(orgCreditsOptions(orgId));
  const [open, setOpen] = useState<string | null>(null);
  const num = (v: number) => v.toLocaleString();
  const spec = (k: string) => k === "growth_officer" ? t("ogo.cr.businessOfficer") : known(`run.sp.${k}`, k);
  if (q.isLoading) return <Section title={t("ogo.cr.title")}><p role="status" className="text-sm text-muted-foreground">{t("ogo.cr.loading")}</p></Section>;
  if (q.isError) return <Section title={t("ogo.cr.title")}><p role="alert" className="text-sm text-destructive">{t("ogo.cr.failed")}</p></Section>;
  if (!q.data) return <Section title={t("ogo.cr.title")}><Empty>{t("ogo.cr.off")}</Empty></Section>;
  const o = q.data; const a = attribution(o); const specs = specialistTotals(o);
  const tiles: [string, number, string][] = [
    ["ogo.cr.available", o.balance, "ogo.cr.availableNote"], ["ogo.cr.pending", o.reserved_pending, "ogo.cr.pendingNote"],
    ["ogo.cr.month", o.consumed_month, "ogo.cr.monthNote"], ["ogo.cr.consumed", o.consumed, "ogo.cr.consumedNote"],
    ["ogo.cr.released", o.released, "ogo.cr.releasedNote"], ["ogo.cr.officer", o.org_officer.consumed, "ogo.cr.officerNote"],
  ];
  return <Section title={t("ogo.cr.title")} intro={t("ogo.cr.intro")}>
    <p className="mb-3 max-w-3xl rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{t("ogo.cr.pool")}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tiles.map(([k, v, note]) => <Panel key={k}><p className="text-xs text-muted-foreground">{t(tk(k))}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{num(v)}</p><p className="mt-1 text-[11px] text-muted-foreground">{t(tk(note))}</p></Panel>)}</div>
    <p className={`mt-2 text-xs ${o.reconciles ? "text-muted-foreground" : "text-destructive"}`}>{o.reconciles ? t("ogo.cr.reconciles", { granted: num(o.granted) }) : t("ogo.cr.noReconcile")}</p>

    <h3 className="mt-5 text-sm font-medium">{t("ogo.cr.byBusiness")}</h3>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
      <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="p-2 font-medium">{t("org.col.business")}</th><th className="p-2 text-right font-medium">{t("ogo.cr.col.month")}</th><th className="p-2 text-right font-medium">{t("ogo.cr.col.total")}</th><th className="p-2 text-right font-medium">{t("ogo.cr.col.pending")}</th><th className="p-2 text-right font-medium">{t("ogo.cr.col.runs")}</th></tr></thead>
      <tbody>
        {o.businesses.map((b) => { const rows = o.specialists.filter((s) => s.workspace_id === b.workspace_id); const isOpen = open === b.workspace_id;
          return <Fragment key={b.workspace_id}>
            <tr className="border-b border-border"><td className="p-2"><Button variant="ghost" size="sm" className="h-auto gap-1 px-1 py-0.5 font-medium" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.workspace_id)}>{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{name(b.workspace_id)}</Button></td>
              <td className="p-2 text-right tabular-nums">{num(b.consumed_month)}</td><td className="p-2 text-right tabular-nums">{num(b.consumed)}</td><td className="p-2 text-right tabular-nums">{num(b.reserved_pending)}</td><td className="p-2 text-right tabular-nums">{num(b.runs)}</td></tr>
            {isOpen && rows.map((s) => <tr key={s.agent_key} className="border-b border-border bg-muted/30 text-xs"><td className="p-2 pl-9">{spec(s.agent_key)}</td><td className="p-2 text-right tabular-nums">{num(s.consumed_month)}</td><td className="p-2 text-right tabular-nums">{num(s.consumed)}</td><td className="p-2 text-right tabular-nums">{num(s.reserved_pending)}</td><td className="p-2 text-right tabular-nums">{num(s.runs)}</td></tr>)}
          </Fragment>; })}
        <tr className="border-b border-border"><td className="p-2 font-medium">{t("ogo.cr.officerRow")}</td><td className="p-2 text-right tabular-nums">{num(o.org_officer.consumed_month)}</td><td className="p-2 text-right tabular-nums">{num(o.org_officer.consumed)}</td><td className="p-2 text-right tabular-nums">{num(o.org_officer.reserved_pending)}</td><td className="p-2 text-right tabular-nums">{num(o.org_officer.runs)}</td></tr>
        {(o.not_visible.consumed > 0 || o.not_visible.reserved_pending > 0) && <tr className="border-b border-border text-muted-foreground"><td className="p-2">{t("ogo.cr.hiddenRow")}</td><td className="p-2 text-right tabular-nums">{num(o.not_visible.consumed_month)}</td><td className="p-2 text-right tabular-nums">{num(o.not_visible.consumed)}</td><td className="p-2 text-right tabular-nums">{num(o.not_visible.reserved_pending)}</td><td className="p-2 text-right">—</td></tr>}
        {o.direct_used > 0 && <tr className="border-b border-border text-muted-foreground"><td className="p-2">{t("ogo.cr.directRow")}</td><td className="p-2 text-right">—</td><td className="p-2 text-right tabular-nums">{num(o.direct_used)}</td><td className="p-2 text-right">—</td><td className="p-2 text-right">—</td></tr>}
        <tr className="font-medium"><td className="p-2">{t("ogo.cr.totalRow")}</td><td className="p-2 text-right tabular-nums">{num(o.consumed_month)}</td><td className="p-2 text-right tabular-nums">{num(o.consumed)}</td><td className="p-2 text-right tabular-nums">{num(o.reserved_pending)}</td><td className="p-2 text-right tabular-nums">{num(o.runs)}</td></tr>
      </tbody>
    </table></div>
    {!a.matches && <p role="alert" className="mt-1 text-xs text-destructive">{t("ogo.cr.mismatch")}</p>}
    <p className="mt-1 text-[11px] text-muted-foreground">{t("ogo.cr.drill")}</p>

    <h3 className="mt-5 text-sm font-medium">{t("ogo.cr.bySpecialist")}</h3>
    {specs.length ? <ul className="mt-2 divide-y divide-border border-y border-border text-sm">{specs.map((s) => <li key={s.agent_key} className="flex flex-wrap justify-between gap-2 py-2"><span>{spec(s.agent_key)} <span className="text-xs text-muted-foreground">· {t("ogo.cr.inBusinesses", { n: String(s.businesses) })}</span></span><span className="tabular-nums text-xs">{t("ogo.cr.specLine", { month: num(s.consumed_month), total: num(s.consumed), runs: num(s.runs) })}</span></li>)}</ul> : <Empty>{t("ogo.cr.noSpecialists")}</Empty>}
    <p className="mt-2 text-[11px] text-muted-foreground">{t("ogo.cr.notMoney")}</p>
  </Section>;
}
