// Growth experiments: hypothesis → administrator approval → run → result and conclusion. Evidence strength is set
// by the database from the method; only a controlled test with enough data can be read as cause and effect.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, type ExperimentRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import type { BiData } from "@/lib/bi/view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { biKey } from "./bi-data";
import { BiState, useBi } from "./business-overview";
import { Badge, Section, sel, tk, useFmt } from "./parts";
import { QualityBadge } from "./evidence";
import { experimentQuality } from "@/lib/evidence";

const METHODS = ["ab_test", "comparison_group", "before_after", "observational"] as const;

export function Experiments() {
  const q = useBi();
  return <BiState q={q}>{(d) => <Body d={d} />}</BiState>;
}

function Body({ d }: { d: BiData }) {
  const { t } = useI18n();
  const list = d.experiments as unknown as ExperimentRow[];
  const learnings = list.filter((x) => x.status === "completed");
  return (
    <>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("bi.exp.rules")}
      </p>
      <Propose d={d} />
      <Section title={t("bi.exp.list")}>
        {!list.filter((x) => x.status !== "completed").length ? (
          <p className="text-xs text-muted-foreground">{t("bi.exp.none")}</p>
        ) : (
          <ul className="space-y-3">
            {list
              .filter((x) => x.status !== "completed")
              .map((x) => (
                <Card key={x.id} x={x} />
              ))}
          </ul>
        )}
      </Section>
      <Section title={t("bi.exp.learnings")} intro={t("bi.exp.learningsIntro")}>
        {!learnings.length ? (
          <p className="text-xs text-muted-foreground">{t("bi.exp.noLearnings")}</p>
        ) : (
          <ul className="space-y-3">
            {learnings.map((x) => (
              <Card key={x.id} x={x} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Propose({ d }: { d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const empty = {
    title: "",
    hypothesis: "",
    objective: "",
    audience: "",
    intervention: "",
    expected_result: "",
    success_metric: "",
    risks: "",
    budget: "",
    duration: "14",
  };
  const [v, setV] = useState(empty);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("ab_test");
  const [currency, setCurrency] = useState("EUR");
  const [goal, setGoal] = useState("");
  const [metric, setMetric] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!member) return null;
  const set =
    (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace) return;
    if (v.budget && !/^\d+(\.\d{1,2})?$/.test(v.budget)) {
      toast.error(t("bi.rev.badAmount"));
      return;
    }
    const days = Number(v.duration);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      toast.error(t("bi.exp.badDuration"));
      return;
    }
    setBusy(true);
    const r = await growthDb.rpc("propose_experiment", {
      _workspace: o.workspace.id,
      _request: key,
      _p: {
        title: v.title,
        hypothesis: v.hypothesis,
        objective: v.objective,
        audience: v.audience,
        intervention: v.intervention,
        expected_result: v.expected_result,
        success_metric: v.success_metric,
        risks: v.risks,
        duration_days: days,
        method,
        ...(v.budget ? { budget: v.budget, currency } : {}),
        ...(goal ? { goal_id: goal } : {}),
        ...(metric ? { metric_id: metric } : {}),
      } as Json,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.exp.proposed"));
    setV(empty);
    setKey(crypto.randomUUID());
    setOpen(false);
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  const f = (
    k: keyof typeof empty,
    label: string,
    opts: { area?: boolean; req?: boolean } = {},
  ) => (
    <label className={cn("text-[11px]", opts.area && "sm:col-span-2")}>
      <span className="mb-1 block font-medium">
        {label}
        {opts.req ? " *" : ""}
      </span>
      {opts.area ? (
        <Textarea rows={2} value={v[k]} onChange={set(k)} maxLength={1000} required={opts.req} />
      ) : (
        <Input
          value={v[k]}
          onChange={set(k)}
          maxLength={k === "title" ? 160 : 500}
          required={opts.req}
        />
      )}
    </label>
  );
  return (
    <div className="mt-4">
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          {t("bi.exp.new")}
        </Button>
      ) : (
        <form
          onSubmit={submit}
          className="rounded-lg border border-border bg-card p-4"
          aria-label={t("bi.exp.new")}
        >
          <h2 className="text-sm font-semibold">{t("bi.exp.new")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {f("title", t("bi.exp.title"), { req: true })}
            <label className="text-[11px]">
              <span className="mb-1 block font-medium">{t("bi.exp.method")}</span>
              <select
                className={sel}
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
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
            {f("hypothesis", t("bi.exp.hypothesis"), { area: true, req: true })}
            {f("intervention", t("bi.exp.intervention"), { area: true, req: true })}
            {f("objective", t("bi.exp.objective"))}
            {f("audience", t("bi.exp.audience"))}
            {f("success_metric", t("bi.exp.successMetric"), { req: true })}
            {f("expected_result", t("bi.exp.expected"))}
            <label className="text-[11px]">
              <span className="mb-1 block font-medium">{t("bi.exp.duration")} *</span>
              <Input inputMode="numeric" value={v.duration} onChange={set("duration")} required />
            </label>
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
            {f("risks", t("bi.exp.risks"), { area: true })}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("bi.exp.submit")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("bi.cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Card({ x }: { x: ExperimentRow }) {
  const o = useOrg();
  const { t } = useI18n();
  const fm = useFmt();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const admin = can(o.workspaceRole, "approvals.decide");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [r, setR] = useState({
    variant_value: "",
    control_value: "",
    variant_n: "",
    control_n: "",
    actual_result: "",
    conclusion: "",
  });
  async function act(
    action: "approve" | "reject" | "start" | "complete" | "cancel",
    data: Record<string, string> = {},
  ) {
    setBusy(true);
    const res = await growthDb.rpc("advance_experiment", {
      _experiment: x.id,
      _action: action,
      _data: data as Json,
    });
    setBusy(false);
    if (res.error) {
      toast.error(t("bi.failed", { e: res.error.message }));
      return;
    }
    toast.success(t(tk(`bi.exp.done.${action}`)));
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  const sig =
    x.status === "completed" && x.z_score !== null && x.z_score !== undefined
      ? { z: Number(x.z_score), significant: Math.abs(Number(x.z_score)) >= 1.96 }
      : null;
  const controlled = x.method === "ab_test" || x.method === "comparison_group";
  const setF =
    (k: keyof typeof r) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setR((v) => ({ ...v, [k]: e.target.value }));
  return (
    <li className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{x.title}</span>
        <span className="flex flex-wrap gap-1">
          <Badge kind="medium">{t(tk(`bi.method.${x.method}`))}</Badge>
          <Badge
            kind={
              x.status === "completed"
                ? "high"
                : x.status === "rejected" || x.status === "cancelled"
                  ? "none"
                  : "low"
            }
          >
            {t(tk(`bi.estatus.${x.status}`))}
          </Badge>
        </span>
      </div>
      <div className="mt-1.5">
        <QualityBadge q={experimentQuality(x.status, x.evidence_strength)} />
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {(
          [
            ["hypothesis", x.hypothesis],
            ["intervention", x.intervention],
            ["objective", x.objective],
            ["audience", x.audience],
            ["successMetric", x.success_metric],
            ["expected", x.expected_result],
            ["risks", x.risks],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{t(tk(`bi.exp.${k}`))}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("bi.exp.duration")}</dt>
          <dd>
            {t("bi.exp.days", { n: x.duration_days })}
            {x.started_at ? ` · ${t("bi.exp.started", { d: fm.date(x.started_at) })}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("bi.exp.budget")}</dt>
          <dd>{x.budget !== null && x.currency ? fm.money(Number(x.budget), x.currency) : "—"}</dd>
        </div>
      </dl>
      {x.status === "completed" && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
          <p>
            <span className="font-medium">{t("bi.exp.result")}:</span> {x.actual_result}
          </p>
          <p className="mt-1">
            <span className="font-medium">{t("bi.exp.conclusion")}:</span> {x.conclusion}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <Badge
              kind={
                x.evidence_strength === "controlled"
                  ? "high"
                  : x.evidence_strength === "correlational"
                    ? "medium"
                    : "low"
              }
            >
              {t(tk(`bi.strength.${x.evidence_strength ?? "inconclusive"}`))}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {t(tk(`bi.strengthHelp.${x.evidence_strength ?? "inconclusive"}`))}
            </span>
          </p>
          {sig && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {sig.significant
                ? t("bi.exp.significant", { z: sig.z })
                : t("bi.exp.notSignificant", { z: sig.z })}
            </p>
          )}
        </div>
      )}
      {member && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {x.status === "proposed" && admin && (
            <>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder={t("bi.imp.notePh")}
                className="h-8 w-56"
                aria-label={t("bi.imp.decisionNote")}
              />
              <Button size="sm" disabled={busy} onClick={() => act("approve", { note })}>
                {t("bi.imp.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("reject", { note })}
              >
                {t("bi.imp.reject")}
              </Button>
            </>
          )}
          {x.status === "proposed" && !admin && (
            <p className="text-[11px] text-muted-foreground">{t("bi.imp.awaitAdmin")}</p>
          )}
          {x.status === "approved" && (
            <Button size="sm" disabled={busy} onClick={() => act("start")}>
              {t("bi.exp.start")}
            </Button>
          )}
          {x.status === "running" && (
            <form
              className="grid w-full gap-2 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                void act("complete", r);
              }}
              aria-label={t("bi.exp.complete")}
            >
              <label className="text-[11px]">
                <span className="mb-1 block font-medium">
                  {controlled ? t("bi.exp.variantRate") : t("bi.exp.variantValue")}
                </span>
                <Input
                  inputMode="decimal"
                  value={r.variant_value}
                  onChange={setF("variant_value")}
                />
              </label>
              <label className="text-[11px]">
                <span className="mb-1 block font-medium">
                  {controlled ? t("bi.exp.controlRate") : t("bi.exp.beforeValue")}
                </span>
                <Input
                  inputMode="decimal"
                  value={r.control_value}
                  onChange={setF("control_value")}
                />
              </label>
              {controlled && (
                <>
                  <label className="text-[11px]">
                    <span className="mb-1 block font-medium">{t("bi.exp.variantN")}</span>
                    <Input inputMode="numeric" value={r.variant_n} onChange={setF("variant_n")} />
                  </label>
                  <label className="text-[11px]">
                    <span className="mb-1 block font-medium">{t("bi.exp.controlN")}</span>
                    <Input inputMode="numeric" value={r.control_n} onChange={setF("control_n")} />
                  </label>
                </>
              )}
              <label className="text-[11px] sm:col-span-2">
                <span className="mb-1 block font-medium">{t("bi.exp.result")} *</span>
                <Textarea
                  rows={2}
                  value={r.actual_result}
                  onChange={setF("actual_result")}
                  required
                  maxLength={1000}
                />
              </label>
              <label className="text-[11px] sm:col-span-2">
                <span className="mb-1 block font-medium">{t("bi.exp.conclusion")} *</span>
                <Textarea
                  rows={2}
                  value={r.conclusion}
                  onChange={setF("conclusion")}
                  required
                  maxLength={1000}
                />
              </label>
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit" size="sm" disabled={busy}>
                  {t("bi.exp.complete")}
                </Button>
              </div>
            </form>
          )}
          {["proposed", "approved", "running"].includes(x.status) && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel")}>
              {t("bi.exp.cancel")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
