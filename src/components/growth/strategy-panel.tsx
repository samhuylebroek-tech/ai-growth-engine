import { useState } from "react";
import { serverErrorText } from "@/lib/server-error";
import { evidenceQuality, fromClassified } from "@/lib/evidence";
import { QualityBadge } from "@/components/bi/evidence";
import { useI18n } from "@/lib/i18n";
import { SingleAIRecovery } from "@/components/app/single-ai-recovery";
import type { MessageKey } from "@/lib/i18n/messages";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { planGrowthStrategy } from "@/lib/ai.functions";
import { strategySchema, type Strategy } from "@/lib/growth-strategy";
import {
  growthDb as supabase,
  GROWTH_PLANS_NOT_INSTALLED,
  isNotInstalled,
} from "@/lib/pending-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlanDetails } from "@/components/growth/plan-details";
import { normalizeSteps } from "@/lib/growth-strategy";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** User-started AI strategy for one goal. Nothing is saved or created until the user chooses to. */
export function StrategyPanel({
  orgId,
  wsId,
  goalId,
  userId,
}: {
  orgId: string;
  wsId: string;
  goalId: string;
  goalTitle: string;
  userId: string;
}) {
  const run = useServerFn(planGrowthStrategy);
  const qc = useQueryClient();
  const { t: tr, tag, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weeks, setWeeks] = useState(12);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{
    strategy: Strategy;
    key: string;
    saved: boolean;
    edited?: boolean;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [planDraftCreated, setPlanDraftCreated] = useState(false);
  const saved = useQuery({
    enabled: open,
    queryKey: ["growth-strategies", wsId, goalId],
    queryFn: async () => {
      const r = await supabase
        .from("growth_strategies")
        .select("id,summary,body,created_at,request_key")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .eq("goal_id", goalId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (r.error) throw r.error;
      return r.data;
    },
  });

  const generate = async () => {
    setBusy(true);
    try {
      const r = await run({
        data: { orgId, workspaceId: wsId, goalId, requestKey, horizonWeeks: weeks, locale },
      });
      if (!r.ok) return void toast.error(serverErrorText(r.error));
      setResult({ strategy: r.data.strategy, key: requestKey, saved: false });
      setStrategyId(null);
      setPlanDraftCreated(false);
      setRequestKey(crypto.randomUUID());
      toast.success(tr("goals.s.ready", { n: r.data.credits }));
      qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(tr("goals.s.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };
  const edit = (change: (s: Strategy) => Strategy) =>
    setResult((current) =>
      current ? { ...current, strategy: change(current.strategy), edited: true } : current,
    );
  const save = async () => {
    if (!result || busy) return;
    if (
      !result.strategy.summary.trim() ||
      !result.strategy.actions.length ||
      result.strategy.actions.some((a) => !a.title.trim())
    )
      return void toast.error(tr("goals.pd.oneStep"));
    // An edited saved strategy becomes a new strategy (and later a new plan version); saved ones are never changed.
    const key = result.saved ? crypto.randomUUID() : result.key;
    const body = normalizeSteps(result.strategy);
    setBusy(true);
    try {
      const inserted = await supabase
        .from("growth_strategies")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          goal_id: goalId,
          request_key: key,
          summary: body.summary.slice(0, 4000),
          body: body as never,
          created_by: userId,
        })
        .select("id")
        .single();
      let id = inserted.data?.id ?? null;
      if (inserted.error?.code === "23505") {
        const existing = await supabase
          .from("growth_strategies")
          .select("id")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("request_key", key)
          .maybeSingle();
        if (existing.error || !existing.data)
          throw new Error("Saved strategy could not be recovered.");
        id = existing.data.id;
      } else if (inserted.error) {
        throw inserted.error;
      }
      if (!id) throw new Error("Saved strategy ID is missing.");
      setStrategyId(id);
      setResult((current) =>
        current ? { strategy: body, key, saved: true, edited: false } : current,
      );
      setEditing(false);
      setPlanDraftCreated(false);
      toast.success(tr("goals.s.saved"));
      await saved.refetch();
    } catch {
      toast.error(tr("goals.s.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const createPlanDraft = async () => {
    if (!result?.saved || !strategyId || creating || busy) return;
    setCreating(true);
    try {
      const response = await supabase.rpc("create_growth_plan_draft", { _strategy: strategyId });
      if (response.error) throw response.error;
      const receipt = response.data as {
        plan_id?: string;
        version?: number;
        status?: string;
      } | null;
      if (!receipt?.plan_id || !receipt.version)
        throw new Error("The Growth Plan receipt is incomplete.");
      setPlanDraftCreated(true);
      if (receipt.status === "approved")
        toast.success(tr("goals.s.inApproved", { v: receipt.version }));
      else if (receipt.status === "draft")
        toast.success(tr("goals.s.draftReady", { v: receipt.version }));
      else
        toast.success(
          tr("goals.s.exists", {
            v: receipt.version,
            s: receipt.status
              ? tr(`goals.status.${receipt.status}` as MessageKey)
              : tr("goals.s.savedBadge"),
          }),
        );
      await qc.invalidateQueries({ queryKey: ["growth-plan-versions", orgId, wsId, goalId] });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", orgId, wsId] });
    } catch (error) {
      toast.error(isNotInstalled(error) ? GROWTH_PLANS_NOT_INSTALLED : tr("goals.s.draftFailed"));
    } finally {
      setCreating(false);
    }
  };

  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Compass className="mr-1 h-4 w-4" />
        {tr("goals.s.plan")}
      </Button>
    );
  const view = result?.strategy;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          <Compass className="h-4 w-4" />
          {tr("goals.s.title")}
        </h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {tr("goals.s.close")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{tr("goals.s.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={tr("goals.s.horizon")}
          className={sel}
          value={weeks}
          onChange={(e) => {
            setWeeks(Number(e.target.value));
            setRequestKey(crypto.randomUUID());
          }}
        >
          {[4, 8, 12, 26].map((w) => (
            <option key={w} value={w}>
              {tr("goals.s.weeks", { n: w })}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy} onClick={generate}>
          {busy ? tr("goals.s.planning") : tr("goals.s.generate")}
        </Button>
      </div>
      {view && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{tr("goals.s.aiSuggestion")}</Badge>
            <QualityBadge q={strategyQuality(view)} />
            {result.saved && <Badge variant="outline">{tr("goals.s.savedBadge")}</Badge>}
          </div>
          {editing ? (
            <div className="space-y-2 rounded-md border bg-background p-2">
              <p className="text-xs text-muted-foreground">{tr("goals.pd.editNote")}</p>
              <label className="block text-xs font-medium">
                {tr("goals.pd.summaryLabel")}
                <Textarea
                  value={view.summary}
                  maxLength={1500}
                  onChange={(e) => edit((st) => ({ ...st, summary: e.target.value }))}
                  className="mt-1 min-h-[60px]"
                />
              </label>
              <ol className="space-y-2">
                {view.actions.map((a, i) => (
                  <li key={i} className="space-y-1 rounded border p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{i + 1}.</span>
                      <Input
                        aria-label={tr("goals.pd.stepTitle", { n: i + 1 })}
                        value={a.title}
                        maxLength={200}
                        onChange={(e) =>
                          edit((st) => ({
                            ...st,
                            actions: st.actions.map((x, j) =>
                              j === i ? { ...x, title: e.target.value } : x,
                            ),
                          }))
                        }
                        className="h-8"
                      />
                      <Input
                        aria-label={tr("goals.pd.stepWeek", { n: i + 1 })}
                        type="number"
                        min={1}
                        max={26}
                        value={a.week}
                        onChange={(e) =>
                          edit((st) => ({
                            ...st,
                            actions: st.actions.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    week: Math.max(
                                      1,
                                      Math.min(26, Math.round(Number(e.target.value) || 1)),
                                    ),
                                  }
                                : x,
                            ),
                          }))
                        }
                        className="h-8 w-16"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={tr("goals.pd.removeStep", { n: i + 1 })}
                        disabled={view.actions.length <= 1}
                        onClick={() =>
                          edit((st) => ({
                            ...st,
                            actions: st.actions
                              .filter((_, j) => j !== i)
                              .map((x) => ({
                                ...x,
                                dependsOn: x.dependsOn
                                  .filter((d) => d !== i + 1)
                                  .map((d) => (d > i + 1 ? d - 1 : d)),
                              })),
                          }))
                        }
                      >
                        ×
                      </Button>
                    </div>
                    <Textarea
                      aria-label={tr("goals.pd.stepDetail", { n: i + 1 })}
                      value={a.detail}
                      maxLength={800}
                      onChange={(e) =>
                        edit((st) => ({
                          ...st,
                          actions: st.actions.map((x, j) =>
                            j === i ? { ...x, detail: e.target.value } : x,
                          ),
                        }))
                      }
                      className="min-h-[48px] text-xs"
                    />
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <p>{view.summary}</p>
              <PlanDetails strategy={view} />
            </>
          )}
          <p className="text-xs text-muted-foreground">{tr("goals.s.becomeDraft")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || creating}
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? tr("goals.pd.doneEditing") : tr("goals.pd.edit")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(result.saved && !result.edited) || busy || creating}
              onClick={save}
            >
              {result.saved && result.edited
                ? tr("goals.pd.saveAsNew")
                : result.saved
                  ? tr("goals.s.savedBadge")
                  : busy
                    ? tr("goals.s.saving")
                    : tr("goals.s.save")}
            </Button>
            <Button
              size="sm"
              disabled={
                !result.saved ||
                !!result.edited ||
                !strategyId ||
                busy ||
                creating ||
                planDraftCreated
              }
              onClick={createPlanDraft}
            >
              {creating
                ? tr("goals.s.creatingDraft")
                : planDraftCreated
                  ? tr("goals.s.draftCreated")
                  : tr("goals.s.createDraft")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || creating}
              onClick={() => {
                setResult(null);
                setStrategyId(null);
                setPlanDraftCreated(false);
                setEditing(false);
              }}
            >
              {tr("goals.s.discard")}
            </Button>
          </div>
          {result.saved && (
            <p className="text-xs text-muted-foreground">{tr("goals.s.needsApproval")}</p>
          )}
        </div>
      )}
      {(saved.data ?? []).length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground">{tr("goals.s.savedList")}</p>
          {saved.data!.map((s) => (
            <button
              key={s.id}
              type="button"
              className="block w-full truncate rounded px-1 text-left text-sm hover:bg-accent"
              onClick={() => {
                const p = strategySchema.safeParse(s.body);
                if (p.success) {
                  setResult({ strategy: p.data, key: s.request_key, saved: true });
                  setStrategyId(s.id);
                  setPlanDraftCreated(false);
                  setEditing(false);
                }
              }}
            >
              {new Date(s.created_at).toLocaleDateString(tag)} — {s.summary}
            </button>
          ))}
        </div>
      )}
      {/* An interrupted or refused request can block the next one; it is closed or recovered here, never replayed. */}
      <SingleAIRecovery pendingOnly />
    </div>
  );
}

/** An AI strategy cites facts, estimates, hypotheses and assumptions; as AI output none of it is independent evidence. */
function strategyQuality(v: {
  evidence: { facts: string[]; estimates: string[]; hypotheses: string[] };
  assumptions: string[];
}) {
  return evidenceQuality([
    ...v.evidence.facts.map(() => fromClassified("fact", "ai")),
    ...v.evidence.estimates.map(() => fromClassified("estimate", "ai")),
    ...v.evidence.hypotheses.map(() => fromClassified("hypothesis", "ai")),
    ...v.assumptions.map(() => fromClassified("assumption", "ai")),
  ]);
}
