// Campaign spending: budget, spent, reserved and remaining (EUR), warnings, the insert-only entry list and a form to
// record spending, reservations, releases and corrections. Simulated entries are labelled as test data.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  growthDb,
  isNotInstalled,
  retryUnlessNotInstalled,
  type CampaignBudgetAllocationRow,
  type CampaignSpendRow,
} from "@/lib/pending-schema";
import { localDay } from "@/lib/execution";
import { openAmount, spendSummary } from "@/lib/campaign-spend";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import {
  blockText,
  campaignLimitsOptions,
  CampaignLimits,
} from "@/components/execution/campaign-limits";
import { wouldExceed, type Block } from "@/lib/campaign-budget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const errText = (e: unknown) =>
  typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "";
const sel = "min-w-0 rounded-md border border-border bg-background px-2 py-2 text-xs";

export function CampaignSpend({
  campaignId,
  budgetEur,
  dates,
}: {
  campaignId: string;
  budgetEur: number;
  dates?: { start_date: string | null; end_date: string | null };
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const q = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const limitsQ = useQuery(campaignLimitsOptions(o.workspace?.id));
  const [blocked, setBlocked] = useState<string | null>(null);
  // Proposal 0084: allocations of budget lines to this campaign; entries can name the line they are paid from.
  const fundingQ = useQuery({
    queryKey: ["budget-allocations", o.workspace?.id, "campaign", campaignId],
    enabled: !!o.workspace,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const a = await growthDb
        .from("campaign_budget_allocations")
        .select("*")
        .eq("workspace_id", o.workspace!.id)
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .limit(100);
      if (a.error) {
        if (isNotInstalled(a.error))
          return { allocations: [] as CampaignBudgetAllocationRow[], lines: [] };
        throw a.error;
      }
      const ids = (a.data ?? []).map((x) => x.budget_line_id);
      if (!ids.length)
        return { allocations: (a.data ?? []) as CampaignBudgetAllocationRow[], lines: [] };
      const l = await growthDb
        .from("budget_lines")
        .select("id,channel,period_month,currency")
        .in("id", ids);
      if (l.error) throw l.error;
      return { allocations: (a.data ?? []) as CampaignBudgetAllocationRow[], lines: l.data ?? [] };
    },
  });
  const [lineId, setLineId] = useState("");
  const member = can(o.workspaceRole, "profile.edit");
  const [kind, setKind] = useState<CampaignSpendRow["kind"]>("spend");
  const [relates, setRelates] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [day, setDay] = useState(localDay());
  const [cls, setCls] = useState<"manual" | "simulated">("manual");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("marketing");
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  const money = (n: number, c = "EUR") =>
    new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);

  if (q.error)
    return (
      <p className="text-xs text-muted-foreground">
        {tx(isNotInstalled(q.error) ? "rp.spend.notInstalled" : "rp.spend.loadFailed")}
      </p>
    );
  const rows = (q.data ?? [])
    .filter((r) => r.campaign_id === campaignId)
    .sort(
      (a, b) =>
        b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at),
    );
  const s = spendSummary(budgetEur, rows);
  const others = Object.entries(s.byCurrency).filter(([c]) => c !== "EUR");
  const target = rows.find((r) => r.id === relates);
  const lim = (limitsQ.data ?? []).find((l) => l.campaign_id === campaignId) ?? null;
  const typed = Number(amount.replace(",", "."));
  const signedTyped =
    kind === "release" ? -Math.abs(typed) : kind === "correction" ? typed : Math.abs(typed);
  const funding = (fundingQ.data?.allocations ?? [])
    .map((a) => ({ a, line: fundingQ.data?.lines.find((l) => l.id === a.budget_line_id) }))
    .filter((x) => !!x.line);
  const lineChoices = funding.filter(
    (x) =>
      x.line!.period_month.slice(0, 7) === day.slice(0, 7) &&
      x.line!.currency === currency.trim().toUpperCase(),
  );
  const chosen = funding.find((x) => x.a.budget_line_id === lineId);
  const lineExposure = (id: string, c: "manual" | "simulated") =>
    rows
      .filter((r) => r.budget_line_id === id && r.data_class === c)
      .reduce((t, r) => t + Number(r.amount), 0);
  const allocationBlock: Block | null =
    chosen &&
    !target &&
    signedTyped > 0 &&
    lineExposure(chosen.a.budget_line_id, cls) + signedTyped > Number(chosen.a.amount)
      ? {
          limit: "allocation",
          max: Number(chosen.a.amount),
          used: lineExposure(chosen.a.budget_line_id, cls),
        }
      : null;
  const preview =
    amount.trim() && Number.isFinite(typed) && typed !== 0
      ? (wouldExceed(lim, rows, {
          kind,
          amount: signedTyped,
          currency: currency.trim().toUpperCase(),
          occurred_on: day,
          data_class: cls,
          relates_to: relates || null,
        }) ?? allocationBlock)
      : null;

  function pick(k: CampaignSpendRow["kind"], entry?: CampaignSpendRow) {
    setKind(k);
    setRelates(entry?.id ?? "");
    request.current = null;
    if (entry) {
      setCurrency(entry.currency);
      setCls(entry.data_class);
    }
  }
  async function save() {
    if (!o.workspace || busy) return;
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n === 0) {
      toast.error(tx("rp.spend.invalid"));
      return;
    }
    // Releases always reduce a reservation; spending and reservations are positive; corrections keep their sign.
    const signed = kind === "release" ? -Math.abs(n) : kind === "correction" ? n : Math.abs(n);
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const r = await growthDb.rpc("record_campaign_spend", {
        _workspace: o.workspace.id,
        _request: request.current,
        _campaign: campaignId,
        _p: {
          kind,
          amount: signed,
          currency: currency.trim().toUpperCase(),
          occurred_on: day,
          data_class: cls,
          source_ref: ref.trim(),
          note: note.trim(),
          ...(relates ? { relates_to: relates } : category !== "marketing" ? { category } : {}),
          ...(!relates && lineId && lineChoices.some((x) => x.a.budget_line_id === lineId)
            ? { budget_line_id: lineId }
            : {}),
        },
      });
      if (r.error) throw r.error;
      request.current = null;
      const res = (r.data ?? {}) as {
        status?: string;
        limit?: Block["limit"];
        limit_amount?: number | string | null;
        used?: number | string | null;
        currency?: string;
      };
      if (res.status === "blocked" && res.limit) {
        const msg = blockText(
          tx,
          {
            limit: res.limit,
            max:
              res.limit_amount === null || res.limit_amount === undefined
                ? null
                : Number(res.limit_amount),
            used: res.used === null || res.used === undefined ? null : Number(res.used),
          },
          res.currency ?? currency,
          money,
        );
        setBlocked(msg);
        toast.error(msg);
        return;
      }
      setBlocked(null);
      setAmount("");
      setRef("");
      setNote("");
      pick("spend");
      await qc.invalidateQueries({ queryKey: ["campaign-spend"] });
      toast.success(tx("rp.spend.saved"));
    } catch (e) {
      const m = errText(e);
      toast.error(
        tx(
          m === "spend_duplicate_reference"
            ? "rp.spend.duplicate"
            : m === "spend_below_zero"
              ? "rp.spend.belowZero"
              : m === "spend_line_mismatch"
                ? "ba.spendLineMismatch"
                : m.startsWith("invalid")
                  ? "rp.spend.invalid"
                  : "rp.spend.failed",
        ),
      );
      if (
        m === "spend_duplicate_reference" ||
        m === "spend_below_zero" ||
        m === "spend_line_mismatch" ||
        m.startsWith("invalid")
      )
        request.current = null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={tx("rp.spend.title")}
      className="space-y-3 rounded-md border border-border bg-card p-3 text-xs"
    >
      <div>
        <h3 className="text-sm font-semibold">{tx("rp.spend.title")}</h3>
        <p className="text-muted-foreground">{tx("rp.spend.intro")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["rp.spend.budget", s.budget > 0 ? money(s.budget) : "—"],
          ["rp.spend.spent", money(s.eur.spent)],
          ["rp.spend.committed", money(s.eur.committed)],
          ["rp.spend.remaining", s.remaining === null ? "—" : money(s.remaining)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded border border-border p-2">
            <dt className="text-muted-foreground">{tx(k as MessageKey)}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                k === "rp.spend.remaining" &&
                  s.remaining !== null &&
                  s.remaining < 0 &&
                  "text-destructive",
              )}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {s.usedPct !== null && (
        <div>
          <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden>
            <div
              className={cn(
                "h-full",
                s.warnings.includes("budget_over")
                  ? "bg-destructive"
                  : s.warnings.length
                    ? "bg-warning"
                    : "bg-primary",
              )}
              style={{ width: `${Math.min(100, Math.round(s.usedPct * 100))}%` }}
            />
          </div>
          <p className="mt-1">{tx("rp.spend.used", { p: Math.round(s.usedPct * 100) })}</p>
        </div>
      )}
      {s.budget === 0 && <p className="text-muted-foreground">{tx("rp.spend.noBudget")}</p>}
      {fundingQ.data &&
        (funding.length === 0 ? (
          <p className="text-muted-foreground">{tx("ba.noFunding")}</p>
        ) : (
          <p>
            {tx("ba.funding", {
              list: funding
                .map(
                  (x) =>
                    `${x.line!.channel} ${new Date(`${x.line!.period_month}T00:00:00`).toLocaleDateString(tag, { month: "short", year: "numeric" })}: ${money(Number(x.a.amount), x.a.currency)} (${money(Math.max(0, lineExposure(x.a.budget_line_id, "manual")), x.a.currency)} ${tx("ba.spent").toLowerCase()} / ${tx("ba.reserved").toLowerCase()})`,
                )
                .join(" · "),
            })}
          </p>
        ))}
      {s.warnings
        .filter((w) => w !== "other_currency")
        .map((w) => (
          <p
            key={w}
            className={cn(
              "rounded border px-2 py-1",
              w === "budget_over" || w === "committed_over"
                ? "border-destructive/40 text-destructive"
                : "border-warning/50 text-warning",
            )}
          >
            {tx(`rp.spend.w.${w}` as MessageKey)}
          </p>
        ))}
      {others.length > 0 && (
        <p className="text-muted-foreground">
          {tx("rp.spend.other", { list: others.map(([c, t]) => money(t.spent, c)).join(", ") })}
        </p>
      )}
      {s.simulatedEntries > 0 && (
        <p className="rounded border border-warning/50 px-2 py-1 text-warning">
          {tx("rp.spend.simulatedNote", { n: s.simulatedEntries })}{" "}
          {tx("rp.spend.simTotals", {
            s: money(s.simulatedEur.spent),
            r: money(s.simulatedEur.committed),
          })}
          {s.simulatedWarnings
            .filter((w) => w !== "other_currency")
            .map((w) => ` ${tx(`ci.simWarn.${w}` as MessageKey)}`)
            .join("")}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{tx("rp.spend.none")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.slice(0, 50).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-words">
                {new Date(`${r.occurred_on}T12:00:00`).toLocaleDateString(tag)} ·{" "}
                {tx(`rp.spend.k.${r.kind}` as MessageKey)} ·{" "}
                <span className="tabular-nums">{money(Number(r.amount), r.currency)}</span>
                {r.data_class === "simulated" && (
                  <span className="ml-1 rounded border px-1 text-muted-foreground">
                    {tx("rp.spend.c.simulated")}
                  </span>
                )}
                {r.source_ref && <span className="text-muted-foreground"> · {r.source_ref}</span>}
                {r.budget_line_id && (
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {fundingQ.data?.lines.find((l) => l.id === r.budget_line_id)?.channel ??
                      tx("ba.spendLine")}
                  </span>
                )}
                {r.note && <span className="block text-muted-foreground">{r.note}</span>}
                {(r.kind === "spend" || r.kind === "commitment") && (
                  <span className="block text-muted-foreground">
                    {tx("rp.spend.openAmount", { a: money(openAmount(r, rows), r.currency) })}
                  </span>
                )}
              </span>
              {member && r.kind === "spend" && (
                <Button size="sm" variant="ghost" onClick={() => pick("correction", r)}>
                  {tx("rp.spend.correct")}
                </Button>
              )}
              {member && r.kind === "commitment" && openAmount(r, rows) > 0 && (
                <Button size="sm" variant="ghost" onClick={() => pick("release", r)}>
                  {tx("rp.spend.release")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {member ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">
            {tx("rp.spend.add")}
            {target
              ? ` · ${tx(`rp.spend.k.${kind}` as MessageKey)}: ${money(Number(target.amount), target.currency)}`
              : ""}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              {tx("rp.spend.kind")}
              <select
                className={sel}
                value={kind}
                disabled={!!target}
                onChange={(e) => pick(e.target.value as CampaignSpendRow["kind"])}
              >
                {(target ? [kind] : ["spend", "commitment"]).map((k) => (
                  <option key={k} value={k}>
                    {tx(`rp.spend.k.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {tx("rp.spend.amount")}
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              {tx("rp.spend.currency")}
              <Input
                value={currency}
                maxLength={3}
                disabled={!!target}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label className="flex flex-col gap-1">
              {tx("rp.spend.date")}
              <Input
                type="date"
                value={day}
                max={kind === "commitment" ? undefined : localDay()}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              {tx("rp.spend.class")}
              <select
                className={sel}
                value={cls}
                disabled={!!target}
                onChange={(e) => setCls(e.target.value as "manual" | "simulated")}
              >
                <option value="manual">{tx("rp.spend.c.manual")}</option>
                <option value="simulated">{tx("rp.spend.c.simulated")}</option>
              </select>
            </label>
            {!target && (
              <label className="flex flex-col gap-1">
                {tx("ge.category")}
                <select
                  aria-label={tx("ge.category")}
                  className={sel}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    request.current = null;
                  }}
                >
                  {["marketing", "production", "agency", "software", "other"].map((k) => (
                    <option key={k} value={k}>
                      {tx(`ge.scat.${k}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              {tx("rp.spend.ref")}
              <Input value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} />
            </label>
            {!target && lineChoices.length > 0 && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                {tx("ba.spendLine")}
                <select
                  aria-label={tx("ba.spendLine")}
                  className={sel}
                  value={lineId}
                  onChange={(e) => {
                    setLineId(e.target.value);
                    request.current = null;
                  }}
                >
                  <option value="">{tx("ba.spendLineNone")}</option>
                  {lineChoices.map((x) => (
                    <option
                      key={x.a.budget_line_id}
                      value={x.a.budget_line_id}
                    >{`${x.line!.channel} · ${money(Number(x.a.amount), x.a.currency)}`}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 sm:col-span-3">
              {tx("rp.spend.noteLabel")}
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          {preview && (
            <p
              role="status"
              className="rounded border border-destructive/40 px-2 py-1 text-destructive"
            >
              {blockText(tx, preview, lim?.currency ?? currency, money)}
            </p>
          )}
          {blocked && !preview && (
            <p
              role="alert"
              className="rounded border border-destructive/40 px-2 py-1 text-destructive"
            >
              {blocked}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !amount.trim()} onClick={save}>
              {tx("rp.spend.save")}
            </Button>
            {target && (
              <Button size="sm" variant="ghost" onClick={() => pick("spend")}>
                ✕
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">{tx("rp.spend.viewerOnly")}</p>
      )}
      <CampaignLimits
        campaign={{
          id: campaignId,
          start_date: dates?.start_date ?? null,
          end_date: dates?.end_date ?? null,
          budget_eur: budgetEur,
        }}
        rows={rows}
      />
    </section>
  );
}
