// Campaign status and approval (proposal 0083): the current status, the steps this caller's role may take next, a
// reason where the database requires one, completion with an outcome the KPI supports, and the insert-only history.
// The database decides; this panel only offers the steps it would accept and explains refusals.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  growthDb,
  isNotInstalled,
  retryUnlessNotInstalled,
  type CampaignOsColumns,
} from "@/lib/pending-schema";
import { completionProblem, nextSteps, type NextStep } from "@/lib/campaign-lifecycle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Campaign = {
  id: string;
  status: string;
  results: string;
  start_date: string | null;
} & Partial<CampaignOsColumns>;
const errText = (e: unknown) =>
  typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "";
const KNOWN = [
  "campaign_transition_invalid",
  "campaign_transition_forbidden",
  "campaign_reason_required",
  "campaign_start_required",
];
const sel = "w-full min-w-0 rounded-md border border-border bg-background px-2 py-2 text-xs";

export const campaignEventsOptions = (ws: string | undefined, campaignId: string) => ({
  queryKey: ["campaign-status-events", ws, campaignId] as const,
  enabled: !!ws,
  retry: retryUnlessNotInstalled,
  queryFn: async () => {
    const r = await growthDb
      .from("campaign_status_events")
      .select("*")
      .eq("workspace_id", ws ?? "")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (r.error) throw r.error;
    return r.data ?? [];
  },
});

export function CampaignLifecycle({
  campaign,
  name,
  statusLabel,
}: {
  campaign: Campaign;
  name: (id: string | null) => string;
  statusLabel: (s: string) => string;
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const events = useQuery(campaignEventsOptions(o.workspace?.id, campaign.id));
  const [step, setStep] = useState<NextStep | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actual, setActual] = useState("");
  const [unavailable, setUnavailable] = useState("");
  const [busy, setBusy] = useState(false);
  if (!("outcome" in campaign) || (events.error && isNotInstalled(events.error))) {
    return (
      <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
        {tx("cos.life.notInstalled")}
      </p>
    );
  }
  const steps = nextSteps(campaign.status, o.workspaceRole);
  const allowed = steps.filter((s) => s.allowed);
  const day = (iso: string) =>
    new Date(iso).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });

  function pick(s: NextStep | null) {
    setStep(s);
    setReason("");
    setOutcome("");
    setActual("");
    setUnavailable("");
  }
  async function confirm() {
    if (!o.workspace || !step || busy) return;
    if (step.needsReason && !reason.trim()) {
      toast.error(tx("cos.life.reasonRequired"));
      return;
    }
    if (step.to === "completed") {
      const p = completionProblem(campaign, {
        outcome,
        resultsUnavailable: unavailable,
        kpiActual: actual,
      });
      if (p) {
        toast.error(tx(`cos.life.e.${p}` as MessageKey));
        return;
      }
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      if (reason.trim()) payload["reason"] = reason.trim();
      if (step.to === "completed") {
        payload["outcome"] = outcome;
        if (actual.trim()) payload["kpi_actual"] = actual.trim().replace(",", ".");
        if (!campaign.results.trim()) payload["results_unavailable"] = unavailable.trim();
      }
      const r = await growthDb.rpc("transition_campaign", {
        _workspace: o.workspace.id,
        _campaign: campaign.id,
        _to: step.to,
        _p: payload,
      });
      if (r.error) throw r.error;
      pick(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["execution"] }),
        qc.invalidateQueries({ queryKey: ["campaign-status-events"] }),
      ]);
      toast.success(tx("cos.life.saved"));
    } catch (e) {
      const m = errText(e);
      const key = KNOWN.includes(m)
        ? `cos.life.e.${m}`
        : m === "campaign_result_required"
          ? "cos.life.e.result_required"
          : m === "campaign_outcome_required"
            ? "cos.life.e.outcome_required"
            : m === "campaign_outcome_unsupported"
              ? "cos.life.e.outcome_unsupported"
              : "cos.life.failed";
      toast.error(tx(key as MessageKey));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={tx("cos.life.title")}
      className="space-y-3 rounded-md border border-border bg-card p-3 text-xs"
    >
      <div>
        <h3 className="text-sm font-semibold">{tx("cos.life.title")}</h3>
        <p className="text-muted-foreground">{tx("cos.life.intro")}</p>
      </div>
      <p>
        <span className="text-muted-foreground">{tx("cos.life.current")} </span>
        <span className="rounded border border-border px-1.5 py-0.5 font-medium">
          {statusLabel(campaign.status)}
        </span>
      </p>
      {campaign.approved_at && (
        <p className="text-muted-foreground">
          {tx("cos.life.approvedBy", {
            who: name(campaign.approved_by ?? null),
            d: day(campaign.approved_at),
          })}
        </p>
      )}
      {campaign.outcome && campaign.outcome !== "not_evaluated" && (
        <p>
          {tx("cos.life.result", { o: tx(`cos.life.o.${campaign.outcome}` as MessageKey) })}
          {campaign.kpi_actual !== null && campaign.kpi_actual !== undefined && campaign.primary_kpi
            ? ` · ${campaign.primary_kpi}: ${campaign.kpi_actual}${campaign.kpi_unit ? ` ${campaign.kpi_unit}` : ""}`
            : ""}
        </p>
      )}
      {campaign.results_unavailable_reason && (
        <p className="text-muted-foreground">
          {tx("cos.life.resultMissing", { r: campaign.results_unavailable_reason })}
        </p>
      )}

      <div className="space-y-2">
        <p className="font-medium">{tx("cos.life.next")}</p>
        {steps.length === 0 ? (
          <p className="text-muted-foreground">{tx("cos.life.none")}</p>
        ) : allowed.length === 0 ? (
          <p className="text-muted-foreground">
            {campaign.status === "awaiting_approval" && o.workspaceRole !== "viewer"
              ? tx("cos.life.waitEditor")
              : tx("cos.life.noRight")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allowed.map((s) => (
              <Button
                key={s.to}
                size="sm"
                variant={
                  step?.to === s.to ? "secondary" : s.to === "cancelled" ? "ghost" : "outline"
                }
                aria-pressed={step?.to === s.to}
                onClick={() => pick(step?.to === s.to ? null : s)}
              >
                {tx("cos.life.to", { s: statusLabel(s.to) })}
              </Button>
            ))}
          </div>
        )}
      </div>

      {step && (
        <div className="space-y-2 rounded-md border border-border p-3">
          {step.to === "completed" && (
            <>
              <p className="font-medium">{tx("cos.life.completeTitle")}</p>
              <p className="text-muted-foreground">{tx("cos.life.completeIntro")}</p>
              <label className="flex flex-col gap-1">
                {tx("cos.life.outcome")}
                <select
                  className={sel}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <option value="">{tx("cos.life.o.choose")}</option>
                  {["achieved", "partially_achieved", "not_achieved", "unknown"].map((x) => (
                    <option key={x} value={x}>
                      {tx(`cos.life.o.${x}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
              {campaign.primary_kpi && (
                <label className="flex flex-col gap-1">
                  {tx("cos.life.kpiActual", { kpi: campaign.primary_kpi })}
                  <Input
                    inputMode="decimal"
                    value={actual}
                    placeholder={
                      campaign.kpi_actual !== null && campaign.kpi_actual !== undefined
                        ? String(campaign.kpi_actual)
                        : ""
                    }
                    onChange={(e) => setActual(e.target.value)}
                  />
                </label>
              )}
              {!campaign.results.trim() && (
                <label className="flex flex-col gap-1">
                  {tx("cos.life.unavailable")}
                  <span className="text-muted-foreground">{tx("cos.life.unavailableHelp")}</span>
                  <Textarea
                    rows={2}
                    maxLength={500}
                    value={unavailable}
                    onChange={(e) => setUnavailable(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <label className="flex flex-col gap-1">
            {step.needsReason ? tx("cos.life.reason") : tx("cos.life.reasonOptional")}
            {step.needsReason && (
              <span className="text-muted-foreground">{tx("cos.life.reasonRequired")}</span>
            )}
            <Textarea
              rows={2}
              maxLength={500}
              required={step.needsReason}
              aria-required={step.needsReason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={confirm}>
              {tx("cos.life.confirm")} · {statusLabel(step.to)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => pick(null)}>
              {tx("cos.life.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1 font-medium">{tx("cos.life.history")}</p>
        {events.isError ? (
          <p className="text-destructive">{tx("cos.life.historyFailed")}</p>
        ) : (events.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">{tx("cos.life.historyEmpty")}</p>
        ) : (
          <ol className="space-y-1">
            {(events.data ?? []).map((ev) => (
              <li
                key={ev.id}
                className={cn(
                  "break-words",
                  ev.to_status === "cancelled" && "text-muted-foreground",
                )}
              >
                {tx("cos.life.event", {
                  from: statusLabel(ev.from_status),
                  to: statusLabel(ev.to_status),
                  who: name(ev.actor_id),
                  d: day(ev.created_at),
                })}
                {ev.reason && <span className="block text-muted-foreground">“{ev.reason}”</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
