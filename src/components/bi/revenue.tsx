// Revenue & attribution: the permanent revenue ledger, refunds and corrections, touchpoints and attribution models.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb } from "@/lib/pending-schema";
import {
  attribute,
  attributionQuality,
  netSales,
  revenueTotals,
  MODELS,
  type Model,
} from "@/lib/bi/attribution";
import { periodRange, PERIODS, type PeriodKey } from "@/lib/bi/kpis";
import type { BiData } from "@/lib/bi/view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { biKey } from "./bi-data";
import { BiState, useBi } from "./business-overview";
import { Badge, ClassBadge, Section, sel, targetLabel, tk, useFmt } from "./parts";

const CLS: Record<string, string> = {
  imported: "actual",
  manual: "manual",
  estimated: "estimated",
};

export function RevenueAttribution() {
  const q = useBi();
  return <BiState q={q}>{(d) => <Body d={d} />}</BiState>;
}

function Body({ d }: { d: BiData }) {
  const { t } = useI18n();
  const f = useFmt();
  const [model, setModel] = useState<Model>("last_touch");
  const [period, setPeriod] = useState<PeriodKey>("year_to_date");
  const range = periodRange(period);
  const totals = useMemo(
    () => revenueTotals(d.revenue, range.from, range.to),
    [d, range.from, range.to],
  );
  const attr = useMemo(
    () => attribute(d.revenue, d.touches, model, range.from, range.to),
    [d, model, range.from, range.to],
  );
  return (
    <>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("bi.rev.rules")}
      </p>
      <RecordRevenue d={d} />
      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:max-w-xl">
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.f.period")}</span>
          <select
            className={sel}
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(tk(`bi.period.${p}`))}
              </option>
            ))}
          </select>
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.f.model")}</span>
          <select className={sel} value={model} onChange={(e) => setModel(e.target.value as Model)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {t(tk(`bi.model.${m}`))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{t(tk(`bi.modelHelp.${model}`))}</p>
      <Section title={t("bi.rev.totals")} intro={`${f.date(range.from)} – ${f.date(range.to)}`}>
        {!totals.length ? (
          <p className="text-xs text-muted-foreground">{t("bi.rev.noneInPeriod")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-2xs text-muted-foreground">
                <tr>
                  {["currency", "gross", "refunds", "net", "imported", "manual", "estimated"].map(
                    (h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">
                        {t(tk(`bi.tot.${h}`))}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {totals.map((x) => (
                  <tr key={x.currency}>
                    <td className="px-2 py-1.5 font-medium">{x.currency}</td>
                    <td className="px-2 py-1.5">{f.money(x.gross, x.currency)}</td>
                    <td className="px-2 py-1.5">{f.money(x.refunds, x.currency)}</td>
                    <td className="px-2 py-1.5 font-semibold">{f.money(x.net, x.currency)}</td>
                    <td className="px-2 py-1.5">{f.money(x.imported, x.currency)}</td>
                    <td className="px-2 py-1.5">{f.money(x.manual, x.currency)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {f.money(x.estimated, x.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title={t("bi.rev.attribution")} intro={t("bi.rev.attributionIntro")}>
        {!attr.length ? (
          <p className="text-xs text-muted-foreground">{t("bi.rev.noneInPeriod")}</p>
        ) : (
          <div className="space-y-3">
            {attr.map((a) => {
              const q = attributionQuality(a);
              return (
                <div key={a.currency} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-semibold">{a.currency}</span>
                    <span>
                      {t("bi.rev.total")}: {f.money(a.total, a.currency)}
                    </span>
                    <span>
                      {t("bi.rev.attributedAmt")}: {f.money(a.attributed, a.currency)}
                    </span>
                    <span>
                      {t("bi.rev.unattributedAmt", { n: a.unattributedSales })}:{" "}
                      {f.money(a.unattributed, a.currency)}
                    </span>
                    <Badge kind={q}>{t(tk(`bi.quality.${q}`))}</Badge>
                  </div>
                  {a.credits.length > 0 && (
                    <ul className="mt-2 divide-y divide-border">
                      {a.credits.map((c) => (
                        <li
                          key={c.key}
                          className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
                        >
                          <span className="min-w-0">
                            <span className="text-muted-foreground">
                              {t(tk(`bi.target.${c.key.split(":")[0]}`))}:{" "}
                            </span>
                            {targetLabel(c.key, d)}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{f.money(c.amount, a.currency)}</span>
                            <span className="text-2xs text-muted-foreground">
                              {t("bi.rev.sales", { n: c.sales })}
                            </span>
                            <Badge kind={c.confidence}>{t(tk(`bi.quality.${c.confidence}`))}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <Ledger d={d} />
    </>
  );
}

function RecordRevenue({ d }: { d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const [kind, setKind] = useState("sale");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cls, setCls] = useState("manual");
  const [ref, setRef] = useState("");
  const [customer, setCustomer] = useState("");
  const [relates, setRelates] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!member) return null;
  const sales = netSales(d.revenue)
    .filter((n) => n.net > 0 && (n.sale.data_class === "estimated") === (cls === "estimated"))
    .slice(0, 200);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace) return;
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      toast.error(t("bi.rev.badAmount"));
      return;
    }
    if (customer.includes("@")) {
      toast.error(t("bi.rev.noEmail"));
      return;
    }
    if (kind !== "sale" && !relates) {
      toast.error(t("bi.rev.chooseSale"));
      return;
    }
    const signed = kind === "refund" || kind === "cancellation" ? -Number(amount) : Number(amount);
    setBusy(true);
    const r = await growthDb.rpc("record_revenue_event", {
      _workspace: o.workspace.id,
      _request: key,
      _kind: kind,
      _amount: signed,
      _currency: currency,
      _occurred: `${date}T12:00:00Z`,
      _class: cls,
      _source_ref: ref.trim(),
      _customer_ref: customer.trim(),
      _deal: null,
      _relates: kind === "sale" ? null : relates,
      _unit: unit || null,
      _note: note.trim(),
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.rev.saved"));
    setAmount("");
    setRef("");
    setCustomer("");
    setNote("");
    setRelates("");
    setKey(crypto.randomUUID());
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-lg border border-border bg-card p-4"
      aria-label={t("bi.rev.record")}
    >
      <h2 className="text-sm font-semibold">{t("bi.rev.record")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("bi.rev.recordIntro")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.kind")}</span>
          <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
            {["sale", "refund", "cancellation", "correction"].map((k) => (
              <option key={k} value={k}>
                {t(tk(`bi.kind.${k}`))}
              </option>
            ))}
          </select>
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">
            {kind === "correction" ? t("bi.rev.amountCorrection") : t("bi.rev.amount")}
          </span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.currency")}</span>
          <select className={sel} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["EUR", "USD", "GBP", "CHF"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.date")}</span>
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.class")}</span>
          <select
            className={sel}
            value={cls}
            onChange={(e) => {
              setCls(e.target.value);
              setRelates("");
            }}
          >
            <option value="manual">{t("bi.class.manual")}</option>
            <option value="estimated">{t("bi.class.estimated")}</option>
          </select>
        </label>
        {kind !== "sale" && (
          <label className="text-2xs lg:col-span-2">
            <span className="mb-1 block font-medium">{t("bi.rev.relates")}</span>
            <select
              className={sel}
              value={relates}
              onChange={(e) => setRelates(e.target.value)}
              required
            >
              <option value="">{t("bi.choose")}</option>
              {sales
                .filter((n) => n.sale.currency === currency)
                .map((n) => (
                  <option key={n.sale.id} value={n.sale.id}>
                    {n.sale.occurred_at.slice(0, 10)} · {n.sale.currency} {n.net}
                    {n.sale.source_ref ? ` · ${n.sale.source_ref}` : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.ref")}</span>
          <Input
            value={ref}
            maxLength={200}
            onChange={(e) => setRef(e.target.value)}
            placeholder={t("bi.rev.refHint")}
          />
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("bi.rev.customer")}</span>
          <Input
            value={customer}
            maxLength={120}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder={t("bi.rev.customerHint")}
          />
        </label>
        {kind === "sale" && d.units.length > 0 && (
          <label className="text-2xs">
            <span className="mb-1 block font-medium">{t("bi.f.unit")}</span>
            <select className={sel} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{t("bi.f.wholeBusiness")}</option>
              {d.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-2xs sm:col-span-2">
          <span className="mb-1 block font-medium">{t("bi.rev.note")}</span>
          <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <Button type="submit" size="sm" className="mt-3" disabled={busy}>
        {t("bi.rev.save")}
      </Button>
    </form>
  );
}

function Ledger({ d }: { d: BiData }) {
  const { t } = useI18n();
  const f = useFmt();
  const [open, setOpen] = useState<string | null>(null);
  const sales = netSales(d.revenue).slice(0, 60);
  return (
    <Section title={t("bi.rev.ledger")} intro={t("bi.rev.ledgerIntro")}>
      {!sales.length ? (
        <p className="text-xs text-muted-foreground">{t("bi.rev.none")}</p>
      ) : (
        <ul className="space-y-2">
          {sales.map((n) => {
            const tps = d.touches.filter(
              (x) => x.revenue_event_id === n.sale.id && !x.retracted_at,
            );
            return (
              <li key={n.sale.id} className="rounded-lg border border-border bg-card p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{f.money(n.net, n.sale.currency)}</span>
                    {n.net !== Number(n.sale.amount) && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({t("bi.rev.of", { v: f.money(Number(n.sale.amount), n.sale.currency) })})
                      </span>
                    )}{" "}
                    · {f.date(n.sale.occurred_at)}
                    {n.sale.source_ref ? ` · ${n.sale.source_ref}` : ""}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <ClassBadge cls={CLS[n.sale.data_class] ?? "manual"} />
                    <span className="text-2xs text-muted-foreground">
                      {n.sale.source === "manual" ? t("bi.src.team") : n.sale.source}
                    </span>
                    <button
                      type="button"
                      className="text-2xs text-primary hover:underline"
                      onClick={() => setOpen(open === n.sale.id ? null : n.sale.id)}
                      aria-expanded={open === n.sale.id}
                    >
                      {t("bi.rev.touchpoints", { n: tps.length })}
                    </button>
                  </span>
                </div>
                {open === n.sale.id && <Touchpoints d={d} saleId={n.sale.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Touchpoints({ d, saleId }: { d: BiData; saleId: string }) {
  const o = useOrg();
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const admin = can(o.workspaceRole, "approvals.decide");
  const sale = d.revenue.find((e) => e.id === saleId)!;
  const list = d.touches.filter((x) => x.revenue_event_id === saleId);
  const [campaign, setCampaign] = useState("");
  const [initiative, setInitiative] = useState("");
  const [channel, setChannel] = useState("");
  const [date, setDate] = useState(sale.occurred_at.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const refresh = () => void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!campaign && !initiative && !channel.trim()) {
      toast.error(t("bi.tp.needTarget"));
      return;
    }
    setBusy(true);
    const at = date === sale.occurred_at.slice(0, 10) ? sale.occurred_at : `${date}T12:00:00Z`;
    const r = await growthDb.rpc("record_touchpoint", {
      _sale: saleId,
      _request: key,
      _campaign: campaign || null,
      _initiative: initiative || null,
      _channel: channel.trim(),
      _touched: at,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.tp.saved"));
    setCampaign("");
    setInitiative("");
    setChannel("");
    setKey(crypto.randomUUID());
    refresh();
  }
  async function retract(id: string) {
    const r = await growthDb.rpc("retract_touchpoint", { _touchpoint: id });
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.tp.retracted"));
    refresh();
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      {list.length ? (
        <ul className="space-y-1">
          {list.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className={x.retracted_at ? "text-muted-foreground line-through" : ""}>
                {f.date(x.touched_at)} ·{" "}
                {targetLabel(
                  x.campaign_id
                    ? `campaign:${x.campaign_id}`
                    : x.initiative_id
                      ? `initiative:${x.initiative_id}`
                      : `channel:${x.channel}`,
                  d,
                )}
                {x.channel && (x.campaign_id || x.initiative_id) ? ` · ${x.channel}` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Badge
                  kind={
                    x.evidence === "verified_link"
                      ? "high"
                      : x.evidence === "tracked"
                        ? "medium"
                        : "low"
                  }
                >
                  {t(tk(`bi.evidence.${x.evidence}`))}
                </Badge>
                {!x.retracted_at && member && (x.evidence === "manual" || admin) && (
                  <button
                    type="button"
                    className="text-2xs text-muted-foreground hover:text-destructive"
                    onClick={() => retract(x.id)}
                  >
                    {t("bi.tp.retract")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t("bi.tp.none")}</p>
      )}
      {member && (
        <form
          onSubmit={add}
          className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          aria-label={t("bi.tp.add")}
        >
          <label className="text-2xs">
            <span className="mb-1 block font-medium">{t("bi.f.campaign")}</span>
            <select className={sel} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">—</option>
              {d.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-2xs">
            <span className="mb-1 block font-medium">{t("bi.tp.initiative")}</span>
            <select
              className={sel}
              value={initiative}
              onChange={(e) => setInitiative(e.target.value)}
            >
              <option value="">—</option>
              {d.initiatives.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-2xs">
            <span className="mb-1 block font-medium">{t("bi.f.channel")}</span>
            <Input
              value={channel}
              maxLength={40}
              onChange={(e) => setChannel(e.target.value)}
              placeholder={t("bi.tp.channelHint")}
              className="h-8"
            />
          </label>
          <label className="text-2xs">
            <span className="mb-1 block font-medium">{t("bi.tp.date")}</span>
            <Input
              type="date"
              value={date}
              max={sale.occurred_at.slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              className="h-8"
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={busy}>
              {t("bi.tp.add")}
            </Button>
          </div>
        </form>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">{t("bi.tp.manualNote")}</p>
    </div>
  );
}
