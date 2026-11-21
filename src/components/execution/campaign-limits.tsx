// Hard spending limits of one campaign (proposal 0083): usage per limit from actual entries, simulated usage shown
// apart, deduplicated alerts, a labelled straight-line forecast, an editor form with a required reason, the emergency
// stop (members raise it, editors lift it) and the insert-only limit history. The database enforces the limits.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type CampaignSpendLimitsRow, type CampaignSpendRow } from "@/lib/pending-schema";
import { budgetAlerts, hasLimits, limitMaxima, limitUsage, spendForecast, type BudgetAlert, type Block } from "@/lib/campaign-budget";
import { localDay } from "@/lib/execution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "");
const KEYS = ["daily", "weekly", "monthly", "lifetime"] as const;

export function campaignLimitsOptions(ws: string | undefined) {
  return {
    queryKey: ["campaign-limits", ws] as const,
    enabled: !!ws,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<CampaignSpendLimitsRow[]> => {
      const r = await growthDb.from("campaign_spend_limits").select("*").eq("workspace_id", ws ?? "").limit(1000);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  };
}

/** Plain-language explanation of a refused entry (from the database result or the local pre-check). */
export function blockText(tx: (k: MessageKey, v?: Record<string, string | number>) => string, b: Block, currency: string, money: (n: number, c?: string) => string) {
  if (b.limit === "emergency_stop") return tx("cos.block.emergency_stop");
  if (b.limit === "currency") return tx("cos.block.currency", { c: currency });
  if (b.limit === "allocation") return tx("ba.block.allocation", { used: money(b.used ?? 0, currency), max: money(b.max ?? 0, currency) });
  return tx("cos.block.limit", { k: tx(`cos.lim.${b.limit}`), used: money(b.used ?? 0, currency), max: money(b.max ?? 0, currency) });
}

export function alertText(tx: (k: MessageKey, v?: Record<string, string | number>) => string, a: BudgetAlert, money: (n: number) => string) {
  switch (a.kind) {
    case "emergency_stop": return tx("cos.alert.emergency_stop");
    case "threshold": return tx("cos.alert.threshold", { k: tx(`cos.lim.${a.limit}`), t: a.threshold, used: money(a.used), max: money(a.max) });
    case "forecast_overspend": return tx("cos.alert.forecast_overspend", { p: money(a.projected), b: money(a.budget) });
    case "reservations_exceed": return tx("cos.alert.reservations_exceed", { r: money(a.reserved), room: money(a.room) });
    case "faster_than_time": return tx("cos.alert.faster_than_time", { s: Math.round(a.spentShare * 100), t: Math.round(a.timeShare * 100) });
  }
}

export function CampaignLimits({ campaign, rows }: { campaign: { id: string; start_date: string | null; end_date: string | null; budget_eur: number }; rows: readonly CampaignSpendRow[] }) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const q = useQuery(campaignLimitsOptions(o.workspace?.id));
  const history = useQuery({
    queryKey: ["campaign-limit-events", o.workspace?.id, campaign.id],
    enabled: !!o.workspace,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb.from("campaign_spend_limit_events").select("*").eq("workspace_id", o.workspace?.id ?? "").eq("campaign_id", campaign.id).order("created_at", { ascending: false }).limit(20);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const editor = can(o.workspaceRole, "budgets.manage");
  const member = can(o.workspaceRole, "profile.edit");
  const lim = (q.data ?? []).find((l) => l.campaign_id === campaign.id) ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [stopReason, setStopReason] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  const currency = lim && hasLimits(lim) ? lim.currency : "EUR";
  const money = (n: number, c = currency) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);

  if (q.error) return <p className="text-xs text-muted-foreground">{tx(isNotInstalled(q.error) ? "cos.lim.notInstalled" : "cos.lim.failed")}</p>;
  if (q.isLoading) return null;
  const today = localDay();
  const usage = lim ? limitUsage(lim, rows, today) : [];
  const simUsage = lim ? limitUsage(lim, rows, today, "simulated").filter((u) => u.used > 0) : [];
  const alerts = budgetAlerts({ limits: lim, rows, today, campaign });
  const lifetime = lim ? limitMaxima(lim).lifetime : undefined;
  const budget = lifetime ?? (currency === "EUR" && campaign.budget_eur > 0 ? campaign.budget_eur : null);
  const forecast = spendForecast(campaign, rows, currency, budget, today);

  function startEdit() {
    const v = (x: number | string | null | undefined) => (x === null || x === undefined ? "" : String(x));
    setForm({
      currency: lim?.currency ?? "EUR", daily_max: v(lim?.daily_max), weekly_max: v(lim?.weekly_max), monthly_max: v(lim?.monthly_max),
      lifetime_max: v(lim?.lifetime_max), reserve_amount: v(lim?.reserve_amount), thresholds: (lim?.alert_thresholds ?? [50, 80, 90, 100]).join(", "), reason: "",
    });
    request.current = null;
    setEditing(true);
  }
  async function call(p: Record<string, unknown>, done: () => void) {
    if (!o.workspace || busy) return;
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const r = await growthDb.rpc("set_campaign_spend_limits", { _workspace: o.workspace.id, _request: request.current, _campaign: campaign.id, _p: p as never });
      if (r.error) throw r.error;
      request.current = null;
      done();
      await Promise.all([qc.invalidateQueries({ queryKey: ["campaign-limits"] }), qc.invalidateQueries({ queryKey: ["campaign-limit-events"] })]);
      toast.success(tx("cos.lim.saved"));
    } catch (e) {
      const m = errText(e);
      request.current = null;
      toast.error(tx(["limit_reason_required", "limit_forbidden", "limit_currency_mismatch"].includes(m) ? (`cos.lim.e.${m}` as MessageKey) : m.startsWith("invalid") ? "cos.lim.e.invalid" : "cos.lim.failed"));
    } finally { setBusy(false); }
  }
  function saveLimits() {
    const p: Record<string, unknown> = { currency: (form["currency"] ?? "EUR").trim().toUpperCase(), reason: (form["reason"] ?? "").trim() };
    for (const k of ["daily_max", "weekly_max", "monthly_max", "lifetime_max", "reserve_amount"]) {
      const v = (form[k] ?? "").trim().replace(",", ".");
      if (v) p[k] = v;
    }
    const th = (form["thresholds"] ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
    if (th.some((x) => !Number.isInteger(x))) { toast.error(tx("cos.lim.e.invalid")); return; }
    p["alert_thresholds"] = th;
    void call(p, () => setEditing(false));
  }

  return (
    <section aria-label={tx("cos.lim.title")} className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{tx("cos.lim.title")}</h3>
        <p className="text-muted-foreground">{tx("cos.lim.intro")}</p>
        <p className="mt-1 text-muted-foreground">{tx("cos.lim.honest")}</p>
      </div>
      {lim?.emergency_stop && <p role="status" className="rounded border border-destructive/40 px-2 py-1 font-medium text-destructive">{tx("cos.lim.stopped", { r: lim.stop_reason })}</p>}
      {usage.length === 0 ? <p className="text-muted-foreground">{tx("cos.lim.none")}</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {usage.map((u) => (
            <li key={u.key} className="min-w-0 rounded border border-border p-2">
              <p className="flex justify-between gap-2"><span>{tx(`cos.lim.${u.key}`)}</span><span className="tabular-nums">{tx("cos.lim.usage", { used: money(u.used), max: money(u.max), p: Math.round(u.share * 100) })}</span></p>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted" aria-hidden><div className={cn("h-full", u.share >= 1 ? "bg-destructive" : u.crossed !== null && u.crossed >= 80 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.round(u.share * 100))}%` }} /></div>
              {u.key === "lifetime" && lim?.reserve_amount ? <p className="mt-1 text-muted-foreground">{tx("cos.lim.reserve")}: {money(Number(lim.reserve_amount))}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {simUsage.map((u) => <p key={u.key} className="rounded border border-warning/50 px-2 py-1 text-warning">{tx("cos.lim.simUsage", { used: money(u.used), k: tx(`cos.lim.${u.key}`) })}</p>)}
      {alerts.filter((a) => a.kind !== "emergency_stop").length > 0 && (
        <div>
          <p className="font-medium">{tx("cos.alert.title")}</p>
          <ul className="mt-1 space-y-1">{alerts.filter((a) => a.kind !== "emergency_stop").map((a, i) => <li key={i} className={cn("rounded border px-2 py-1", a.kind === "threshold" && a.threshold >= 100 ? "border-destructive/40 text-destructive" : "border-warning/50 text-warning")}>{alertText(tx, a, (n) => money(n))}</li>)}</ul>
        </div>
      )}
      <div className="rounded border border-border p-2">
        <p className="font-medium">{tx("cos.fc.title")}</p>
        {forecast ? (
          <>
            <p>{tx("cos.fc.body", { d: money(forecast.perDay), n: forecast.basisDays, p: money(forecast.projected) })}</p>
            {forecast.projectedRemaining !== null && <p>{tx("cos.fc.remaining", { r: money(forecast.projectedRemaining) })}</p>}
            <p className="text-muted-foreground">{tx(`cos.fc.conf.${forecast.confidence}`)}</p>
          </>
        ) : <p className="text-muted-foreground">{tx("cos.fc.none")}</p>}
      </div>

      {editor && !editing && <Button size="sm" variant="outline" onClick={startEdit}>{tx("cos.lim.edit")}</Button>}
      {editor && editing && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">{tx("cos.lim.currency")}<Input maxLength={3} value={form["currency"] ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
            {KEYS.map((k) => (
              <label key={k} className="flex flex-col gap-1">{tx(`cos.lim.${k}`)}<Input inputMode="decimal" value={form[`${k}_max`] ?? ""} onChange={(e) => setForm({ ...form, [`${k}_max`]: e.target.value })} /></label>
            ))}
            <label className="flex flex-col gap-1">{tx("cos.lim.reserve")}<Input inputMode="decimal" value={form["reserve_amount"] ?? ""} onChange={(e) => setForm({ ...form, reserve_amount: e.target.value })} /></label>
            <label className="flex flex-col gap-1 sm:col-span-3">{tx("cos.lim.thresholds")}<Input value={form["thresholds"] ?? ""} onChange={(e) => setForm({ ...form, thresholds: e.target.value })} /></label>
            <label className="flex flex-col gap-1 sm:col-span-3">{tx("cos.lim.reason")}<Input required aria-required maxLength={300} value={form["reason"] ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !(form["reason"] ?? "").trim()} onClick={saveLimits}>{tx("cos.lim.save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{tx("cos.life.cancel")}</Button>
          </div>
        </div>
      )}
      {member && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">{tx("cos.lim.stop")}</p>
          {(!lim?.emergency_stop || editor) && (
            <label className="flex flex-col gap-1">{lim?.emergency_stop ? tx("cos.lim.reason") : tx("cos.lim.stopReason")}<Input maxLength={300} value={stopReason} onChange={(e) => setStopReason(e.target.value)} /></label>
          )}
          {!lim?.emergency_stop ? (
            <Button size="sm" variant="destructive" disabled={busy || !stopReason.trim()} onClick={() => call({ emergency_stop: true, reason: stopReason.trim() }, () => setStopReason(""))}>{tx("cos.lim.stopOn")}</Button>
          ) : editor ? (
            <Button size="sm" variant="outline" disabled={busy || !stopReason.trim()} onClick={() => call({ emergency_stop: false, reason: stopReason.trim() }, () => setStopReason(""))}>{tx("cos.lim.stopOff")}</Button>
          ) : <p className="text-muted-foreground">{tx("cos.lim.e.limit_forbidden")}</p>}
        </div>
      )}
      {(history.data ?? []).length > 0 && (
        <div>
          <p className="font-medium">{tx("cos.lim.history")}</p>
          <ol className="mt-1 space-y-1">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="break-words">{tx(`cos.lim.h.${h.kind}`)} · {new Date(h.created_at).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" })}{h.reason && <span className="block text-muted-foreground">“{h.reason}”</span>}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
