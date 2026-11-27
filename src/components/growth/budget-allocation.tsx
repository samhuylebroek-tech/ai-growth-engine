// Unified budget allocation (proposal 0084) on Goals & budget: business totals per currency, each budget line split
// over campaigns, the change form (editors apply, members request), pending requests and the insert-only history.
// Every rule is enforced in the database; this screen previews refusals and explains the database's answer.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  growthDb,
  isNotInstalled,
  retryUnlessNotInstalled,
  type BudgetAllocationRejection,
  type CampaignBudgetAllocationRow,
  type BudgetAllocationEventRow,
  type BudgetChangeRequestRow,
} from "@/lib/pending-schema";
import {
  budgetEconomics,
  groupAllocations,
  monthForecast,
  previewAllocation,
  type CampaignLike,
  type LineLike,
} from "@/lib/budget-allocation";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import { duplicateGroups, lineLabel } from "@/lib/econ/budget-duplicates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const sel = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
type Mode = "set" | "move" | "cancel" | "release_unused";
type Result = {
  status?: string;
  code?: BudgetAllocationRejection;
  unallocated?: number | string;
  committed?: number | string;
  currency?: string;
};
const errMsg = (e: unknown) =>
  typeof e === "object" && e !== null
    ? String((e as { message?: unknown; code?: unknown }).message ?? "")
    : "";
const errCode = (e: unknown) =>
  typeof e === "object" && e !== null ? String((e as { code?: unknown }).code ?? "") : "";

export function BudgetAllocations({
  orgId,
  wsId,
  month,
  lines,
  goals,
  canRequest,
  canBudget,
  elapsed,
}: {
  orgId: string;
  wsId: string;
  month: string;
  lines: readonly (LineLike & {
    goal_id: string | null;
    initiative_id: string | null;
    note?: string | null;
    created_at?: string | null;
  })[];
  goals: readonly { id: string; title: string }[];
  canRequest: boolean;
  canBudget: boolean;
  elapsed: number;
}) {
  const qc = useQueryClient();
  const { t: tr, tag } = useI18n();
  const lineIds = lines.map((l) => l.id);
  const money = (n: number, c = "EUR") =>
    new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  const allocQ = useQuery({
    queryKey: ["budget-allocations", wsId, month, lineIds.join()],
    enabled: lineIds.length > 0,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("campaign_budget_allocations")
        .select("*")
        .eq("workspace_id", wsId)
        .in("budget_line_id", lineIds)
        .limit(1000);
      if (r.error) throw r.error;
      return (r.data ?? []) as CampaignBudgetAllocationRow[];
    },
  });
  const eventsQ = useQuery({
    queryKey: ["budget-allocation-events", wsId, month, lineIds.join()],
    enabled: lineIds.length > 0,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("budget_allocation_events")
        .select("*")
        .eq("workspace_id", wsId)
        .in("budget_line_id", lineIds)
        .order("created_at", { ascending: false })
        .limit(30);
      if (r.error) throw r.error;
      return (r.data ?? []) as BudgetAllocationEventRow[];
    },
  });
  const requestsQ = useQuery({
    queryKey: ["budget-change-requests", wsId],
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("budget_change_requests")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("status", "pending")
        .order("created_at")
        .limit(50);
      if (r.error) throw r.error;
      return (r.data ?? []) as BudgetChangeRequestRow[];
    },
  });
  const campaignsQ = useQuery({
    queryKey: ["allocation-campaigns", wsId],
    queryFn: async () => {
      const r = await growthDb
        .from("campaigns")
        .select("*")
        .eq("workspace_id", wsId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(300);
      if (r.error) throw r.error;
      return (r.data ?? []) as unknown as CampaignLike[];
    },
  });
  const spendQ = useQuery(campaignSpendOptions(orgId, wsId));

  const econ = useMemo(
    () => budgetEconomics(lines, allocQ.data ?? [], spendQ.data ?? []),
    [lines, allocQ.data, spendQ.data],
  );
  const campaigns = campaignsQ.data ?? [];
  const title = (id: string | null | undefined) => campaigns.find((c) => c.id === id)?.title ?? "—";
  const dups = useMemo(() => duplicateGroups(lines), [lines]);
  const dupIds = new Set(dups.flat().map((l) => l.id));
  // Lines that look alike carry a distinguishing label everywhere they are named.
  const tagOf = (id: string) => {
    const l = lines.find((x) => x.id === id);
    return l && dupIds.has(id) ? ` (${lineLabel(l, tag)})` : "";
  };
  const lineName = (id: string) => `${lines.find((l) => l.id === id)?.channel ?? "—"}${tagOf(id)}`;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["budget-allocations", wsId] }),
      qc.invalidateQueries({ queryKey: ["budget-allocation-events", wsId] }),
      qc.invalidateQueries({ queryKey: ["budget-change-requests", wsId] }),
      qc.invalidateQueries({ queryKey: ["budget-lines", wsId] }),
    ]);
  const rejectText = (r: Result) =>
    tr(`ba.rej.${r.code ?? "stale"}` as MessageKey, {
      u: money(Number(r.unallocated ?? 0), r.currency),
      c: money(Number(r.committed ?? 0), r.currency),
    });

  // change form
  const [mode, setMode] = useState<Mode>("set");
  const [lineId, setLineId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const line = lines.find((l) => l.id === lineId);
  const lineE = econ.lines.find((l) => l.id === lineId);
  const share = lineE?.campaigns.find((c) => c.campaignId === campaignId);
  const current = share?.amount ?? 0;
  const camp = campaigns.find((c) => c.id === campaignId);
  const n = Number(amount.replace(",", "."));
  const preview =
    mode === "set" && line && lineE && camp && amount.trim() && Number.isFinite(n) && n >= 0
      ? previewAllocation(line, lineE, camp, n)
      : null;
  const reset = () => {
    setAmount("");
    setReason("");
    setToId("");
    key.current = null;
  };

  if (lines.length === 0) return null;
  const notInstalled = [allocQ.error, eventsQ.error, requestsQ.error].some(
    (e) => e && isNotInstalled(e),
  );
  if (notInstalled)
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">{tr("ba.notInstalled")}</p>
    );
  if (allocQ.error || spendQ.error)
    return <p className="rounded-lg border p-3 text-sm text-destructive">{tr("ba.loadFailed")}</p>;

  async function submit() {
    if (busy || !line || !campaignId) return void toast.error(tr("ba.form.invalid"));
    if (reason.trim().length < 3) return void toast.error(tr("ba.form.needReason"));
    if ((mode === "set" || mode === "move") && (!amount.trim() || !Number.isFinite(n) || n < 0))
      return void toast.error(tr("ba.form.invalid"));
    if (mode === "move" && (!toId || toId === campaignId || n <= 0))
      return void toast.error(tr("ba.form.invalid"));
    setBusy(true);
    key.current ??= crypto.randomUUID();
    const p = {
      kind: mode,
      budget_line_id: line.id,
      campaign_id: campaignId,
      seen_amount: current,
      reason: reason.trim(),
      ...(mode === "set" || mode === "move" ? { amount: Math.round(n * 100) / 100 } : {}),
      ...(mode === "move" ? { to_campaign_id: toId } : {}),
    };
    try {
      const r = canBudget
        ? await growthDb.rpc("change_campaign_allocation", {
            _workspace: wsId,
            _request: key.current,
            _p: p,
          })
        : await growthDb.rpc("request_budget_change", {
            _workspace: wsId,
            _request: key.current,
            _p: p,
          });
      if (r.error) throw r.error;
      const res = (r.data ?? {}) as Result;
      key.current = null;
      if (res.status === "rejected") {
        const m = rejectText(res);
        setRefusal(m);
        toast.error(m);
        await refresh();
        return;
      }
      setRefusal(null);
      reset();
      toast.success(tr(canBudget ? "ba.applied" : "ba.requested"));
      await refresh();
    } catch (e) {
      if (errCode(e) === "40001") {
        key.current = null;
        await refresh();
        toast.error(tr("ba.stale"));
      } else {
        if (errMsg(e).startsWith("invalid")) key.current = null;
        toast.error(tr("ba.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean, note: string) {
    const r = await growthDb.rpc("decide_budget_change", {
      _id: id,
      _approve: approve,
      _note: note,
    });
    if (r.error) return void toast.error(tr("ba.decideFailed"));
    const res = (r.data ?? {}) as Result;
    if (res.status === "rejected" && approve) toast.error(rejectText(res));
    else toast.success(tr("ba.decided"));
    await refresh();
  }

  const byGoal = groupAllocations(econ.lines, campaigns, "goal_id");
  return (
    <section aria-label={tr("ba.title")} className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold">{tr("ba.title")}</h3>
        <p className="text-sm text-muted-foreground">{tr("ba.intro")}</p>
      </div>

      {Object.values(econ.byCurrency).map((t) => {
        const forecast = monthForecast(t.spent, elapsed);
        return (
          <div key={t.currency} className="space-y-2">
            <p className="text-sm font-medium">{tr("ba.overview", { c: t.currency })}</p>
            <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {(
                [
                  ["ba.total", t.total],
                  ["ba.allocated", t.allocated],
                  ["ba.unallocated", t.unallocated],
                  ["ba.reserved", t.reserved],
                  ["ba.spent", t.spent],
                  ["ba.remaining", t.remaining],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0 rounded border p-2">
                  <dt className="text-xs text-muted-foreground">{tr(k)}</dt>
                  <dd className="font-semibold tabular-nums">{money(v, t.currency)}</dd>
                </div>
              ))}
              <div className="min-w-0 rounded border p-2">
                <dt className="text-xs text-muted-foreground">{tr("ba.forecast")}</dt>
                <dd className="text-sm">
                  {forecast === null ? tr("ba.noForecast") : money(forecast, t.currency)}
                </dd>
              </div>
              {(t.simulatedSpent > 0 || t.simulatedReserved > 0) && (
                <div className="min-w-0 rounded border border-warning/50 p-2">
                  <dt className="text-xs text-warning">{tr("ba.simulated")}</dt>
                  <dd className="tabular-nums">
                    {money(t.simulatedSpent + t.simulatedReserved, t.currency)}
                  </dd>
                </div>
              )}
            </dl>
            {t.overcommitted > 0 && (
              <p className="rounded border border-destructive/40 px-2 py-1 text-sm text-destructive">
                {tr("ba.overcommitted", { a: money(t.overcommitted, t.currency) })}
              </p>
            )}
            {t.recordedOnLines > 0 && (
              <p className="text-xs text-muted-foreground">
                {tr("ba.recordedOnLines", { a: money(t.recordedOnLines, t.currency) })}
              </p>
            )}
          </div>
        );
      })}

      {dups.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded border border-warning/40 p-3 text-sm text-warning"
        >
          <p className="font-medium">{tr("ba.dup.title")}</p>
          {dups.map((g) => (
            <p key={g[0]!.id}>
              {tr("ba.dup.group", {
                ch: g[0]!.channel,
                m: g[0]!.period_month.slice(0, 7),
                c: g[0]!.currency,
                n: g.length,
                a: money(
                  g.reduce((t, l) => t + Number(l.planned), 0),
                  g[0]!.currency,
                ),
                labels: g.map((l) => lineLabel(l, tag)).join(", "),
              })}
            </p>
          ))}
          <p className="text-xs">{tr("ba.dup.note")}</p>
        </div>
      )}
      <ul className="space-y-3">
        {econ.lines.map((l) => {
          const src = lines.find((x) => x.id === l.id);
          const earmark = src?.goal_id ? goals.find((g) => g.id === src.goal_id)?.title : null;
          const pct =
            l.planned > 0 ? Math.min(100, Math.round((l.allocated / l.planned) * 100)) : 0;
          return (
            <li key={l.id} className="space-y-2 rounded border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {tr("ba.line", { ch: l.channel, a: money(l.planned, l.currency) })}
                  {tagOf(l.id)}
                </span>
                <span className={cn("text-xs", l.unallocated === 0 ? "text-muted-foreground" : "")}>
                  {tr("ba.lineUnallocated", { a: money(l.unallocated, l.currency) })}
                </span>
              </div>
              {earmark && (
                <p className="text-xs text-muted-foreground">
                  {tr("ba.lineEarmark", { t: earmark })}
                </p>
              )}
              <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden>
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              {l.overlap && <p className="text-xs text-warning">{tr("ba.overlap")}</p>}
              {l.campaigns.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tr("ba.noAllocations")}</p>
              ) : (
                <ul className="divide-y">
                  {l.campaigns.map((c) => (
                    <li key={c.campaignId} className="py-1.5">
                      <span className="font-medium">{title(c.campaignId)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tr("ba.campaignRow", {
                          a: money(c.amount, l.currency),
                          s: money(c.spent, l.currency),
                          r: money(c.reserved, l.currency),
                          f: money(c.available, l.currency),
                        })}
                      </span>
                      {(c.simulatedSpent > 0 || c.simulatedReserved > 0) && (
                        <span className="block text-xs text-warning">
                          {tr("ba.simRow", {
                            s: money(c.simulatedSpent, l.currency),
                            r: money(c.simulatedReserved, l.currency),
                          })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {byGoal.size > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{tr("ba.byGoal")}</p>
          {[...byGoal.entries()].map(([g, cur]) =>
            Object.entries(cur).map(([c, v]) => (
              <p key={`${g}-${c}`} className="text-xs text-muted-foreground">
                {tr("ba.goalRow", {
                  g: g ? (goals.find((x) => x.id === g)?.title ?? "—") : tr("ba.noGoal"),
                  a: money(v.allocated, c),
                  s: money(v.spent, c),
                  n: v.campaigns.size,
                })}
              </p>
            )),
          )}
        </div>
      )}

      {(canBudget || canRequest) && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">
            {tr(canBudget ? "ba.form.title" : "ba.form.requestTitle")}
          </p>
          {!canBudget && (
            <p className="text-xs text-muted-foreground">{tr("ba.form.requestNote")}</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              {tr("ba.form.mode")}
              <select
                aria-label={tr("ba.form.mode")}
                className={sel}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as Mode);
                  key.current = null;
                  setRefusal(null);
                }}
              >
                {(["set", "move", "cancel", "release_unused"] as const).map((m) => (
                  <option key={m} value={m}>
                    {tr(
                      m === "set"
                        ? "ba.form.set"
                        : m === "move"
                          ? "ba.form.move"
                          : m === "cancel"
                            ? "ba.form.cancel"
                            : "ba.form.release",
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {tr("ba.form.line")}
              <select
                aria-label={tr("ba.form.line")}
                className={sel}
                value={lineId}
                onChange={(e) => {
                  setLineId(e.target.value);
                  key.current = null;
                  setRefusal(null);
                }}
              >
                <option value="">{tr("ba.form.choose")}</option>
                {econ.lines.map((l) => (
                  <option
                    key={l.id}
                    value={l.id}
                  >{`${l.channel}${tagOf(l.id)} · ${money(l.unallocated, l.currency)}`}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {tr("ba.form.campaign")}
              <select
                aria-label={tr("ba.form.campaign")}
                className={sel}
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  key.current = null;
                  setRefusal(null);
                }}
              >
                <option value="">{tr("ba.form.choose")}</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {mode === "move" && (
              <label className="flex flex-col gap-1 text-xs">
                {tr("ba.form.to")}
                <select
                  aria-label={tr("ba.form.to")}
                  className={sel}
                  value={toId}
                  onChange={(e) => {
                    setToId(e.target.value);
                    key.current = null;
                  }}
                >
                  <option value="">{tr("ba.form.choose")}</option>
                  {campaigns
                    .filter((c) => c.id !== campaignId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(mode === "set" || mode === "move") && (
              <label className="flex flex-col gap-1 text-xs">
                {tr(mode === "set" ? "ba.form.newAmount" : "ba.form.amount")}
                <Input
                  aria-label={tr(mode === "set" ? "ba.form.newAmount" : "ba.form.amount")}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    key.current = null;
                    setRefusal(null);
                  }}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-3">
              {tr("ba.form.reason")}
              <Input
                aria-label={tr("ba.form.reason")}
                value={reason}
                maxLength={500}
                placeholder={tr("ba.form.reasonPh")}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          {line && campaignId && (
            <p className="text-xs text-muted-foreground">
              {tr("ba.form.current", { a: money(current, line.currency) })}
            </p>
          )}
          {preview && (
            <p
              role="status"
              className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive"
            >
              {rejectText({
                code: preview,
                unallocated: lineE ? lineE.planned - lineE.allocated : 0,
                committed: share ? share.spent + share.reserved : 0,
                currency: line?.currency ?? "EUR",
              })}
            </p>
          )}
          {refusal && !preview && (
            <p
              role="alert"
              className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive"
            >
              {refusal}
            </p>
          )}
          <Button size="sm" disabled={busy || !lineId || !campaignId} onClick={submit}>
            {tr(canBudget ? "ba.form.apply" : "ba.form.request")}
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">{tr("ba.requests")}</p>
        {(requestsQ.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr("ba.noRequests")}</p>
        ) : (
          <ul className="space-y-2">
            {(requestsQ.data ?? []).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                canDecide={canBudget}
                title={title}
                lineName={lineName}
                currency={lines.find((l) => l.id === r.budget_line_id)?.currency ?? "EUR"}
                money={money}
                onDecide={decide}
              />
            ))}
          </ul>
        )}
      </div>

      <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer font-medium">{tr("ba.history")}</summary>
        {(eventsQ.data ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{tr("ba.noHistory")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {(eventsQ.data ?? []).map((e) => (
              <li key={e.id} className="text-xs">
                <span className="text-muted-foreground">
                  {new Date(e.created_at).toLocaleString(tag)} · {e.reason}
                </span>
                <span className={cn("block", e.outcome === "rejected" && "text-destructive")}>
                  {e.outcome === "applied"
                    ? tr("ba.ev.applied", {
                        k: tr(`ba.k.${e.kind}` as MessageKey),
                        c: e.to_campaign_id
                          ? `${title(e.campaign_id)} → ${title(e.to_campaign_id)}`
                          : title(e.campaign_id),
                        p: money(Number(e.previous_amount), e.currency),
                        n: money(Number(e.new_amount), e.currency),
                      })
                    : `${tr("ba.ev.rejected", { k: tr(`ba.k.${e.kind}` as MessageKey), c: title(e.campaign_id) })} — ${rejectText({ code: e.rejection ?? "stale", unallocated: e.unallocated_before, committed: 0, currency: e.currency })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function RequestRow({
  r,
  canDecide,
  title,
  lineName,
  currency,
  money,
  onDecide,
}: {
  r: BudgetChangeRequestRow;
  canDecide: boolean;
  title: (id: string | null) => string;
  lineName: (id: string) => string;
  currency: string;
  money: (n: number, c?: string) => string;
  onDecide: (id: string, approve: boolean, note: string) => Promise<void>;
}) {
  const { t: tr, tag } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (approve: boolean) => {
    setBusy(true);
    try {
      await onDecide(r.id, approve, note.trim());
    } finally {
      setBusy(false);
    }
  };
  const amount = r.amount === null ? "—" : money(Number(r.amount), currency);
  return (
    <li className="space-y-1 rounded border p-2 text-xs">
      <p className="font-medium">
        {r.kind === "move"
          ? tr("ba.reqMove", {
              a: amount,
              c: title(r.campaign_id),
              t: title(r.to_campaign_id),
              ch: lineName(r.budget_line_id),
            })
          : tr("ba.reqLine", {
              k: tr(
                r.kind === "set"
                  ? "ba.k.set"
                  : r.kind === "cancel"
                    ? "ba.k.cancel"
                    : "ba.k.release_unused",
              ),
              c: title(r.campaign_id),
              ch: lineName(r.budget_line_id),
              a: amount,
            })}
      </p>
      <p className="text-muted-foreground">
        {new Date(r.created_at).toLocaleString(tag)} · {r.reason}
      </p>
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(true)}>
            {tr("ba.approve")}
          </Button>
          <Input
            aria-label={tr("ba.rejectNote")}
            className="h-8 w-48"
            placeholder={tr("ba.rejectNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || note.trim().length < 3}
            onClick={() => run(false)}
          >
            {tr("ba.reject")}
          </Button>
        </div>
      )}
    </li>
  );
}
