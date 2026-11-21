import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCreditPriceAdmin, setCreditPrice } from "@/lib/credit-price.functions";
import { draftProblems, impactPreview, priceHistory, versionAt, type PriceDraft } from "@/lib/econ/price-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";

/** Local "datetime-local" value a few minutes ahead, so a new price is never back-dated. */
const soon = () => {
  const d = new Date(Date.now() + 10 * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function CreditPrices() {
  const { t, tag } = useI18n();
  const load = useServerFn(getCreditPriceAdmin);
  const save = useServerFn(setCreditPrice);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["owner", "credit-prices"], queryFn: () => load() });
  const [scope, setScope] = useState<"platform" | "plan">("platform");
  const [plan, setPlan] = useState<string>("");
  const [currency, setCurrency] = useState("EUR");
  const [price, setPrice] = useState("");
  const [when, setWhen] = useState(soon);
  const [method, setMethod] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = q.data?.ok ? q.data : null;
  const history = useMemo(() => (data ? priceHistory(data.history, now) : []), [data, now]);
  const effectiveIso = when ? new Date(when).toISOString() : "";
  const draft: PriceDraft = { scope, plan: scope === "plan" ? plan || null : null, currency: currency.trim().toUpperCase(), price: Number(price), effectiveFrom: effectiveIso, methodology: method };
  const problems = draftProblems(draft, new Date());
  const current = data ? versionAt(data.history, draft.scope, draft.plan, draft.currency, new Date()) : null;
  const credits = data ? (scope === "plan" ? data.creditsByPlan[plan] ?? 0 : data.credits30d) : 0;
  const preview = problems.includes("price") ? null : impactPreview(credits, current ? Number(current.price_per_credit) : null, draft.price);
  const money = (n: number, c: string) => new Intl.NumberFormat(tag, { style: "currency", currency: c, maximumFractionDigits: 4 }).format(n);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">{t("own.loading")}</p>;
  if (!data) return <p role="alert" className="text-sm text-muted-foreground">{t(`own.cp.err.${q.data && !q.data.ok ? q.data.error : "load_failed"}` as MessageKey)}</p>;

  async function submit() {
    if (problems.length || !confirm) return;
    setBusy(true);
    const r = await save({ data: { scope: draft.scope, plan: draft.plan, currency: draft.currency, price: draft.price, effectiveFrom: draft.effectiveFrom, methodology: draft.methodology } }).catch(() => ({ ok: false as const, error: "failed" as const }));
    setBusy(false);
    if (!r.ok) { toast.error(t(`own.cp.err.${r.error}` as MessageKey)); return; }
    toast.success(t("own.cp.saved"));
    setPrice(""); setMethod(""); setConfirm(false); setWhen(soon());
    await qc.invalidateQueries({ queryKey: ["owner", "credit-prices"] });
  }

  return (
    <section aria-labelledby="cp-title" className="mt-10 space-y-4">
      <div>
        <h2 id="cp-title" className="font-semibold">{t("own.cp.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("own.cp.desc")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium">{t("own.cp.new")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cp-scope">{t("own.cp.scope")}</Label>
              <select id="cp-scope" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value as "platform" | "plan")}>
                <option value="platform">{t("own.cp.scope.platform")}</option>
                <option value="plan">{t("own.cp.scope.plan")}</option>
              </select>
            </div>
            {scope === "plan" && (
              <div className="space-y-1">
                <Label htmlFor="cp-plan">{t("own.cp.plan")}</Label>
                <select id="cp-plan" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={plan} onChange={(e) => setPlan(e.target.value)}>
                  <option value="">{t("own.cp.choosePlan")}</option>
                  {data.plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="cp-currency">{t("own.cp.currency")}</Label>
              <Input id="cp-currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cp-price">{t("own.cp.price")}</Label>
              <Input id="cp-price" type="number" inputMode="decimal" min="0" step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cp-when">{t("own.cp.when")}</Label>
              <Input id="cp-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cp-method">{t("own.cp.method")}</Label>
              <Textarea id="cp-method" rows={2} maxLength={500} value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t("own.cp.methodHint")} />
            </div>
          </div>
          {price !== "" && problems.length > 0 && (
            <ul role="alert" className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>{t(`own.cp.problem.${p}` as MessageKey)}</li>)}</ul>
          )}
          {preview && price !== "" && (
            <div className="rounded-md bg-muted/50 p-3 text-xs">
              <p className="font-medium">{t("own.cp.impact")}</p>
              <p>{t("own.cp.impactCredits", { n: preview.credits30d })}</p>
              <p>{preview.currentMonthly === null ? t("own.cp.impactNoCurrent", { next: money(preview.nextMonthly, draft.currency) }) : t("own.cp.impactChange", { now: money(preview.currentMonthly, draft.currency), next: money(preview.nextMonthly, draft.currency), d: money(preview.change ?? 0, draft.currency) })}</p>
              <p className="text-muted-foreground">{t("own.cp.impactNote")}</p>
              {data.usageTruncated && <p className="text-warning">{t("own.cp.impactTruncated")}</p>}
            </div>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>{t("own.cp.confirm")}</span>
          </label>
          <Button onClick={submit} disabled={busy || !confirm || problems.length > 0}>{busy ? t("own.cp.saving") : t("own.cp.save")}</Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">{t("own.cp.history")}</h3>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("own.cp.none")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="whitespace-nowrap text-left text-muted-foreground">
                  <tr><th className="py-1 pr-2">{t("own.cp.col.scope")}</th><th className="py-1 pr-2">{t("own.cp.col.price")}</th><th className="py-1 pr-2">{t("own.cp.col.from")}</th><th className="py-1 pr-2">{t("own.cp.col.to")}</th><th className="py-1 pr-2">{t("own.cp.col.status")}</th><th className="py-1">{t("own.cp.col.method")}</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="py-1.5 pr-2">{h.scope === "plan" ? data.plans.find((p) => p.key === h.plan_key)?.name ?? h.plan_key : t("own.cp.scope.platform")}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{money(Number(h.price_per_credit), h.currency)}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(h.effective_from).toLocaleString(tag)}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{h.effective_to ? new Date(h.effective_to).toLocaleString(tag) : "—"}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{t(`own.cp.status.${h.status}` as MessageKey)}</td>
                      <td className="py-1.5 text-muted-foreground">{h.methodology}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("own.cp.historyNote")}</p>
        </div>
      </div>
    </section>
  );
}
