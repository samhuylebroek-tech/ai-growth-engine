// Experiment design form (proposal 0079): creates a draft, a follow-up, or revises a draft/in-review design.
// The sample size shown here is computed with the same formula the database stores.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { growthDb, type ExperimentRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import type { BiData } from "@/lib/bi/view";
import { daysToSample, sampleSizePerGroup } from "@/lib/experiment-stats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { biKey } from "./bi-data";
import { experimentDetailKey } from "./experiment-data";
import { sel, tk } from "./parts";

export const METHODS = ["ab_test", "comparison_group", "before_after", "observational"] as const;
type Method = (typeof METHODS)[number];

const TEXT = [
  "title",
  "hypothesis",
  "intervention",
  "control_description",
  "objective",
  "audience",
  "primary_kpi",
  "success_criteria",
  "stop_criteria",
  "expected_result",
  "risks",
] as const;
type TextKey = (typeof TEXT)[number];
type Values = Record<TextKey, string> & {
  secondary: string;
  baseline: string;
  effect: string;
  guardrail: string;
  duration: string;
  budget: string;
  traffic: string;
};

function initial(x?: ExperimentRow | null, followUp?: ExperimentRow | null): Values {
  const s = x ?? null;
  return {
    title: s?.title ?? (followUp ? `${followUp.title} (2)` : ""),
    hypothesis: s?.hypothesis ?? "",
    intervention: s?.intervention ?? "",
    control_description: s?.control_description ?? followUp?.control_description ?? "",
    objective: s?.objective ?? followUp?.objective ?? "",
    audience: s?.audience ?? followUp?.audience ?? "",
    primary_kpi: s?.primary_kpi || s?.success_metric || followUp?.primary_kpi || "",
    success_criteria: s?.success_criteria ?? "",
    stop_criteria: s?.stop_criteria ?? "",
    expected_result: s?.expected_result ?? "",
    risks: s?.risks ?? "",
    secondary: (s?.secondary_kpis ?? followUp?.secondary_kpis ?? []).join("\n"),
    baseline: s?.baseline_rate != null ? String(s.baseline_rate) : "",
    effect: s?.min_effect != null ? String(s.min_effect) : "",
    guardrail: s?.guardrail_min_rate != null ? String(s.guardrail_min_rate) : "",
    duration: String(s?.duration_days ?? 14),
    budget: s?.budget != null ? String(s.budget) : "",
    traffic: "",
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function ExperimentDesigner({
  d,
  edit,
  followUp,
  onDone,
}: {
  d: BiData;
  edit?: ExperimentRow | null;
  followUp?: ExperimentRow | null;
  onDone: () => void;
}) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<Values>(() => initial(edit, followUp));
  const [method, setMethod] = useState<Method>(
    (edit?.method ?? followUp?.method ?? "ab_test") as Method,
  );
  const [currency, setCurrency] = useState(edit?.currency ?? "EUR");
  const [goal, setGoal] = useState(edit?.goal_id ?? followUp?.goal_id ?? "");
  const [metric, setMetric] = useState(edit?.metric_id ?? followUp?.metric_id ?? "");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const baseline = num(v.baseline);
  const effect = num(v.effect);
  const n = sampleSizePerGroup(baseline, effect);
  const days = daysToSample(n, num(v.traffic));
  const duration = Number(v.duration);
  const controlled = method === "ab_test" || method === "comparison_group";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace || !o.org) return;
    if (v.budget && !/^\d+([.,]\d{1,2})?$/.test(v.budget))
      return void toast.error(t("bi.rev.badAmount"));
    if (!Number.isInteger(duration) || duration < 1 || duration > 365)
      return void toast.error(t("bi.exp.badDuration"));
    for (const x of [baseline, effect, num(v.guardrail)])
      if (x !== null && (Number.isNaN(x) || x < 0 || x > 100))
        return void toast.error(t("exp.sampleNone"));
    const p: Record<string, unknown> = {
      ...Object.fromEntries(TEXT.map((k) => [k, v[k]])),
      method,
      secondary_kpis: v.secondary
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5),
      duration_days: duration,
      ...(baseline !== null && effect !== null && controlled
        ? { baseline_rate: baseline, min_effect: effect }
        : {}),
      ...(num(v.guardrail) !== null ? { guardrail_min_rate: num(v.guardrail) } : {}),
      ...(v.budget ? { budget: v.budget.replace(",", "."), currency } : {}),
      ...(goal ? { goal_id: goal } : {}),
      ...(metric ? { metric_id: metric } : {}),
    };
    if (!edit && followUp) p["follow_up_of"] = followUp.id;
    setBusy(true);
    const r = edit
      ? await growthDb.rpc("revise_experiment_design", {
          _experiment: edit.id,
          _version: edit.design_version ?? 1,
          _p: p as Json,
        })
      : await growthDb.rpc("design_experiment", {
          _workspace: o.workspace.id,
          _request: key,
          _p: p as Json,
        });
    setBusy(false);
    if (r.error) return void toast.error(t("bi.failed", { e: r.error.message }));
    toast.success(edit ? t("exp.revised") : t("exp.saved"));
    void qc.invalidateQueries({ queryKey: biKey(o.org.id, o.workspace.id) });
    void qc.invalidateQueries({ queryKey: experimentDetailKey(o.org.id, o.workspace.id) });
    onDone();
  }

  const field = (
    k: TextKey,
    label: string,
    opts: { area?: boolean; req?: boolean; help?: string } = {},
  ) => (
    <label className={cn("text-[11px]", opts.area && "sm:col-span-2")}>
      <span className="mb-1 block font-medium">
        {label}
        {opts.req ? " *" : ""}
      </span>
      {opts.area ? (
        <Textarea
          rows={2}
          value={v[k]}
          onChange={set(k)}
          maxLength={k === "control_description" ? 500 : k.endsWith("criteria") ? 600 : 1000}
          required={opts.req}
        />
      ) : (
        <Input
          value={v[k]}
          onChange={set(k)}
          maxLength={k === "title" ? 160 : k === "primary_kpi" ? 200 : 500}
          required={opts.req}
        />
      )}
      {opts.help && <span className="mt-1 block text-muted-foreground">{opts.help}</span>}
    </label>
  );
  const numField = (
    k: "baseline" | "effect" | "guardrail" | "duration" | "traffic",
    label: string,
    req = false,
  ) => (
    <label className="text-[11px]">
      <span className="mb-1 block font-medium">
        {label}
        {req ? " *" : ""}
      </span>
      <Input inputMode="decimal" value={v[k]} onChange={set(k)} required={req} />
    </label>
  );
  const title = edit ? t("exp.editTitle") : t("bi.exp.new");
  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-border bg-card p-4"
      aria-label={title}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {followUp && !edit && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("exp.followUpOf", { t: followUp.title })}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("title", t("bi.exp.title"), { req: true })}
        <label className="text-[11px]">
          <span className="mb-1 block font-medium">{t("bi.exp.method")}</span>
          <select
            className={sel}
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(tk(`bi.method.${m}`))}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-muted-foreground">
            {t(tk(`bi.methodHelp.${method}`))}
          </span>
        </label>
        {field("hypothesis", t("bi.exp.hypothesis"), { area: true, req: true })}
        {field("intervention", t("bi.exp.intervention"), { area: true, req: true })}
        {controlled &&
          field("control_description", t("exp.f.control"), {
            area: true,
            help: t("exp.f.controlHelp"),
          })}
        {field("objective", t("bi.exp.objective"))}
        {field("audience", t("bi.exp.audience"))}
        {field("primary_kpi", t("exp.f.primaryKpi"), { req: true })}
        <label className="text-[11px]">
          <span className="mb-1 block font-medium">{t("exp.f.secondary")}</span>
          <Textarea rows={2} value={v.secondary} onChange={set("secondary")} maxLength={1000} />
        </label>
        {controlled && (
          <>
            {numField("baseline", t("exp.f.baseline"))}
            {numField("effect", t("exp.f.effect"))}
            {numField("traffic", t("exp.f.traffic"))}
            <div
              className="rounded-md border border-border bg-muted/40 p-2 text-[11px]"
              aria-live="polite"
            >
              {n ? (
                <>
                  <p className="font-medium">{t("exp.sample", { n })}</p>
                  {days && <p className="mt-1">{t("exp.sampleDays", { t: v.traffic, d: days })}</p>}
                  {days && Number.isInteger(duration) && days > duration && (
                    <p className="mt-1 text-warning">
                      {t("exp.sampleShort", { p: duration, d: days })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">{t("exp.sampleNone")}</p>
              )}
            </div>
          </>
        )}
        {numField("duration", t("bi.exp.duration"), true)}
        {numField("guardrail", t("exp.f.guardrail"))}
        {field("success_criteria", t("exp.f.successCriteria"), { area: true })}
        {field("stop_criteria", t("exp.f.stopCriteria"), { area: true })}
        {field("expected_result", t("bi.exp.expected"))}
        <div className="flex items-end gap-2 text-[11px]">
          <label className="flex-1">
            <span className="mb-1 block font-medium">{t("bi.exp.budget")}</span>
            <Input inputMode="decimal" value={v.budget} onChange={set("budget")} />
          </label>
          <label>
            <span className="mb-1 block font-medium">{t("bi.rev.currency")}</span>
            <select
              className="rounded-md border border-border bg-card px-2 py-2 text-xs"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["EUR", "USD", "GBP"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-[11px]">
          <span className="mb-1 block font-medium">{t("bi.exp.goal")}</span>
          <select className={sel} value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="">—</option>
            {d.goals
              .filter((g) => g.status === "active")
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
        </label>
        <label className="text-[11px]">
          <span className="mb-1 block font-medium">{t("bi.exp.metric")}</span>
          <select className={sel} value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="">—</option>
            {d.metrics
              .filter((m) => !m.archived)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </select>
        </label>
        {field("risks", t("bi.exp.risks"), { area: true })}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {edit ? t("exp.saveRevision") : t("exp.saveDraft")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("bi.cancel")}
        </Button>
      </div>
    </form>
  );
}
