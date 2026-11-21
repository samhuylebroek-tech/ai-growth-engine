// Campaign spending: budget, spent, reserved and remaining (EUR), warnings, the insert-only entry list and a form to
// record spending, reservations, releases and corrections. Simulated entries are labelled as test data.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, type CampaignSpendRow } from "@/lib/pending-schema";
import { localDay } from "@/lib/execution";
import { openAmount, spendSummary } from "@/lib/campaign-spend";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "");
const sel = "min-w-0 rounded-md border border-border bg-background px-2 py-2 text-xs";

export function CampaignSpend({ campaignId, budgetEur }: { campaignId: string; budgetEur: number }) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const q = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const member = can(o.workspaceRole, "profile.edit");
  const [kind, setKind] = useState<CampaignSpendRow["kind"]>("spend");
  const [relates, setRelates] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [day, setDay] = useState(localDay());
  const [cls, setCls] = useState<"manual" | "simulated">("manual");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  const money = (n: number, c = "EUR") => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);

  if (q.error) return <p className="text-xs text-muted-foreground">{tx(isNotInstalled(q.error) ? "rp.spend.notInstalled" : "rp.spend.loadFailed")}</p>;
  const rows = (q.data ?? []).filter((r) => r.campaign_id === campaignId).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
  const s = spendSummary(budgetEur, rows);
  const others = Object.entries(s.byCurrency).filter(([c]) => c !== "EUR");
  const target = rows.find((r) => r.id === relates);

  function pick(k: CampaignSpendRow["kind"], entry?: CampaignSpendRow) {
    setKind(k); setRelates(entry?.id ?? ""); request.current = null;
    if (entry) { setCurrency(entry.currency); setCls(entry.data_class); }
  }
  async function save() {
    if (!o.workspace || busy) return;
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n === 0) { toast.error(tx("rp.spend.invalid")); return; }
    // Releases always reduce a reservation; spending and reservations are positive; corrections keep their sign.
    const signed = kind === "release" ? -Math.abs(n) : kind === "correction" ? n : Math.abs(n);
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const r = await growthDb.rpc("record_campaign_spend", {
        _workspace: o.workspace.id, _request: request.current, _campaign: campaignId,
        _p: { kind, amount: signed, currency: currency.trim().toUpperCase(), occurred_on: day, data_class: cls, source_ref: ref.trim(), note: note.trim(), ...(relates ? { relates_to: relates } : {}) },
      });
      if (r.error) throw r.error;
      request.current = null;
      setAmount(""); setRef(""); setNote(""); pick("spend");
      await qc.invalidateQueries({ queryKey: ["campaign-spend"] });
      toast.success(tx("rp.spend.saved"));
    } catch (e) {
      const m = errText(e);
      toast.error(tx(m === "spend_duplicate_reference" ? "rp.spend.duplicate" : m === "spend_below_zero" ? "rp.spend.belowZero" : m.startsWith("invalid") ? "rp.spend.invalid" : "rp.spend.failed"));
      if (m === "spend_duplicate_reference" || m === "spend_below_zero" || m.startsWith("invalid")) request.current = null;
    } finally { setBusy(false); }
  }

  return (
    <section aria-label={tx("rp.spend.title")} className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{tx("rp.spend.title")}</h3>
        <p className="text-muted-foreground">{tx("rp.spend.intro")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["rp.spend.budget", s.budget > 0 ? money(s.budget) : "—"], ["rp.spend.spent", money(s.eur.spent)], ["rp.spend.committed", money(s.eur.committed)], ["rp.spend.remaining", s.remaining === null ? "—" : money(s.remaining)]].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded border border-border p-2"><dt className="text-muted-foreground">{tx(k as MessageKey)}</dt><dd className={cn("font-semibold tabular-nums", k === "rp.spend.remaining" && s.remaining !== null && s.remaining < 0 && "text-destructive")}>{v}</dd></div>
        ))}
      </dl>
      {s.usedPct !== null && (
        <div>
          <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden><div className={cn("h-full", s.warnings.includes("budget_over") ? "bg-destructive" : s.warnings.length ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.round(s.usedPct * 100))}%` }} /></div>
          <p className="mt-1">{tx("rp.spend.used", { p: Math.round(s.usedPct * 100) })}</p>
        </div>
      )}
      {s.budget === 0 && <p className="text-muted-foreground">{tx("rp.spend.noBudget")}</p>}
      {s.warnings.filter((w) => w !== "other_currency").map((w) => (
        <p key={w} className={cn("rounded border px-2 py-1", w === "budget_over" || w === "committed_over" ? "border-destructive/40 text-destructive" : "border-warning/50 text-warning")}>{tx(`rp.spend.w.${w}` as MessageKey)}</p>
      ))}
      {others.length > 0 && <p className="text-muted-foreground">{tx("rp.spend.other", { list: others.map(([c, t]) => money(t.spent, c)).join(", ") })}</p>}
      {s.simulatedEntries > 0 && (
        <p className="rounded border border-warning/50 px-2 py-1 text-warning">
          {tx("rp.spend.simulatedNote", { n: s.simulatedEntries })} {tx("rp.spend.simTotals", { s: money(s.simulatedEur.spent), r: money(s.simulatedEur.committed) })}
          {s.simulatedWarnings.filter((w) => w !== "other_currency").map((w) => ` ${tx(`ci.simWarn.${w}` as MessageKey)}`).join("")}
        </p>
      )}

      {rows.length === 0 ? <p className="text-muted-foreground">{tx("rp.spend.none")}</p> : (
        <ul className="divide-y divide-border">
          {rows.slice(0, 50).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-words">
                {new Date(`${r.occurred_on}T12:00:00`).toLocaleDateString(tag)} · {tx(`rp.spend.k.${r.kind}` as MessageKey)} · <span className="tabular-nums">{money(Number(r.amount), r.currency)}</span>
                {r.data_class === "simulated" && <span className="ml-1 rounded border px-1 text-muted-foreground">{tx("rp.spend.c.simulated")}</span>}
                {r.source_ref && <span className="text-muted-foreground"> · {r.source_ref}</span>}
                {r.note && <span className="block text-muted-foreground">{r.note}</span>}
                {(r.kind === "spend" || r.kind === "commitment") && <span className="block text-muted-foreground">{tx("rp.spend.openAmount", { a: money(openAmount(r, rows), r.currency) })}</span>}
              </span>
              {member && r.kind === "spend" && <Button size="sm" variant="ghost" onClick={() => pick("correction", r)}>{tx("rp.spend.correct")}</Button>}
              {member && r.kind === "commitment" && openAmount(r, rows) > 0 && <Button size="sm" variant="ghost" onClick={() => pick("release", r)}>{tx("rp.spend.release")}</Button>}
            </li>
          ))}
        </ul>
      )}

      {member ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">{tx("rp.spend.add")}{target ? ` · ${tx(`rp.spend.k.${kind}` as MessageKey)}: ${money(Number(target.amount), target.currency)}` : ""}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">{tx("rp.spend.kind")}
              <select className={sel} value={kind} disabled={!!target} onChange={(e) => pick(e.target.value as CampaignSpendRow["kind"])}>
                {(target ? [kind] : ["spend", "commitment"]).map((k) => <option key={k} value={k}>{tx(`rp.spend.k.${k}` as MessageKey)}</option>)}
              </select></label>
            <label className="flex flex-col gap-1">{tx("rp.spend.amount")}<Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="flex flex-col gap-1">{tx("rp.spend.currency")}<Input value={currency} maxLength={3} disabled={!!target} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
            <label className="flex flex-col gap-1">{tx("rp.spend.date")}<Input type="date" value={day} max={kind === "commitment" ? undefined : localDay()} onChange={(e) => setDay(e.target.value)} /></label>
            <label className="flex flex-col gap-1">{tx("rp.spend.class")}
              <select className={sel} value={cls} disabled={!!target} onChange={(e) => setCls(e.target.value as "manual" | "simulated")}>
                <option value="manual">{tx("rp.spend.c.manual")}</option><option value="simulated">{tx("rp.spend.c.simulated")}</option>
              </select></label>
            <label className="flex flex-col gap-1">{tx("rp.spend.ref")}<Input value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></label>
            <label className="flex flex-col gap-1 sm:col-span-3">{tx("rp.spend.noteLabel")}<Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !amount.trim()} onClick={save}>{tx("rp.spend.save")}</Button>
            {target && <Button size="sm" variant="ghost" onClick={() => pick("spend")}>✕</Button>}
          </div>
        </div>
      ) : <p className="text-muted-foreground">{tx("rp.spend.viewerOnly")}</p>}
    </section>
  );
}
