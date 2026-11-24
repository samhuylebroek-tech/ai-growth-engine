// Growth experiments (proposal 0079): design → review → administrator approval → schedule/run → data collection →
// evaluation → outcome. The database decides which outcomes the recorded data supports; the screen shows the same
// rules up front (src/lib/experiment-stats.ts) so nobody can call an early or correlational result a success.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, type ExperimentObservationRow, type ExperimentRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import type { BiData } from "@/lib/bi/view";
import {
  designGaps,
  evaluateExperiment,
  experimentActions,
  STAGES,
  type ExperimentAction,
  type Outcome,
} from "@/lib/experiment-stats";
import { experimentQuality } from "@/lib/evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { biKey } from "./bi-data";
import { BiState, useBi } from "./business-overview";
import { QualityBadge } from "./evidence";
import { Badge, Section, sel, tk, useFmt } from "./parts";
import { ExperimentDesigner } from "./experiment-design";
import { ExperimentAI } from "./experiment-ai";
import {
  experimentDetailKey,
  experimentDetailOptions,
  type ExperimentDetail,
} from "./experiment-data";

const DESIGN = ["draft", "in_review", "proposed"];
const ACTIVE = ["approved", "scheduled", "running", "collecting", "evaluating", "paused"];
const CLOSED = ["rejected", "cancelled"];

export function Experiments() {
  const q = useBi();
  return <BiState q={q}>{(d) => <Body d={d} />}</BiState>;
}

function Body({ d }: { d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const detail = useQuery(experimentDetailOptions(o.org?.id, o.workspace?.id));
  const [form, setForm] = useState<{ edit?: ExperimentRow; followUp?: ExperimentRow } | null>(null);
  const member = can(o.workspaceRole, "ai.use");
  const list = d.experiments as unknown as ExperimentRow[];
  const det: ExperimentDetail = detail.data ?? {
    observations: {},
    events: {},
    installed: true,
    truncated: false,
  };
  const group = (statuses: string[]) => list.filter((x) => statuses.includes(x.status));
  const cards = (rows: ExperimentRow[]) =>
    !rows.length ? (
      <p className="text-xs text-muted-foreground">{t("exp.none")}</p>
    ) : (
      <ul className="space-y-3">
        {rows.map((x) => (
          <Card
            key={x.id}
            x={x}
            all={list}
            det={det}
            onEdit={() => setForm({ edit: x })}
            onFollowUp={() => setForm({ followUp: x })}
          />
        ))}
      </ul>
    );
  return (
    <>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("exp.rules")}
      </p>
      {detail.isError && (
        <p className="mt-3 text-xs text-destructive">
          {t("bi.failed", { e: String((detail.error as Error).message) })}
        </p>
      )}
      {member && <ExperimentAI />}
      {member && (
        <div className="mt-4">
          {form ? (
            <ExperimentDesigner
              key={form.edit?.id ?? form.followUp?.id ?? "new"}
              d={d}
              edit={form.edit ?? null}
              followUp={form.followUp ?? null}
              onDone={() => setForm(null)}
            />
          ) : (
            <Button size="sm" onClick={() => setForm({})}>
              {t("bi.exp.new")}
            </Button>
          )}
        </div>
      )}
      <Section title={t("exp.sec.design")}>{cards(group(DESIGN))}</Section>
      <Section title={t("exp.sec.active")}>{cards(group(ACTIVE))}</Section>
      <Section title={t("bi.exp.learnings")} intro={t("bi.exp.learningsIntro")}>
        {cards(group(["completed"]))}
      </Section>
      {group(CLOSED).length > 0 && (
        <Section title={t("exp.sec.closed")}>{cards(group(CLOSED))}</Section>
      )}
    </>
  );
}

function Stepper({ status }: { status: string }) {
  const { t } = useI18n();
  const at = STAGES.indexOf(status as (typeof STAGES)[number]);
  if (at < 0) return null;
  return (
    <ol className="mt-2 flex flex-wrap gap-1" aria-label={t(tk(`bi.estatus.${status}`))}>
      {STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-2xs",
            i < at && "border-primary/30 bg-primary/10 text-primary",
            i === at && "border-primary bg-primary text-primary-foreground",
            i > at && "border-border text-muted-foreground",
          )}
        >
          {t(tk(`bi.estatus.${s}`))}
        </li>
      ))}
    </ol>
  );
}

function Card({
  x,
  all,
  det,
  onEdit,
  onFollowUp,
}: {
  x: ExperimentRow;
  all: ExperimentRow[];
  det: ExperimentDetail;
  onEdit: () => void;
  onFollowUp: () => void;
}) {
  const o = useOrg();
  const { t } = useI18n();
  const fm = useFmt();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const admin = can(o.workspaceRole, "approvals.decide");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [start, setStart] = useState("");
  const obs = det.observations[x.id] ?? [];
  const latest = obs[0] ?? null;
  const events = det.events[x.id] ?? [];
  const ev = evaluateExperiment(
    {
      method: x.method,
      sample_per_group: x.sample_per_group ?? null,
      guardrail_min_rate: x.guardrail_min_rate ?? null,
    },
    latest,
  );
  const actions = experimentActions(x.status, { member, admin }, obs.length > 0);
  const gaps =
    x.status === "in_review" || x.status === "draft"
      ? designGaps({ ...x, sample_per_group: x.sample_per_group ?? null })
      : [];
  const parent = x.follow_up_of ? all.find((y) => y.id === x.follow_up_of) : null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
    void qc.invalidateQueries({ queryKey: experimentDetailKey(o.org?.id, o.workspace?.id) });
  };
  async function act(action: ExperimentAction, data: Record<string, string> = {}) {
    if ((action === "pause" || action === "cancel") && !note.trim())
      return void toast.error(t("exp.noteNeeded"));
    setBusy(true);
    const res = await growthDb.rpc("move_experiment", {
      _experiment: x.id,
      _action: action,
      _data: { note, ...data } as Json,
    });
    setBusy(false);
    if (res.error) return void toast.error(t("bi.failed", { e: res.error.message }));
    toast.success(t("exp.done", { a: t(tk(`exp.a.${action}`)) }));
    setNote("");
    refresh();
  }
  const inline = actions.filter((a) => a !== "complete" && a !== "schedule");
  return (
    <li className="rounded-lg border border-border bg-card p-3 text-xs" aria-label={x.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium">{x.title}</span>
        <span className="flex flex-wrap gap-1">
          {x.origin === "growth_officer" && (
            <Badge kind="medium">{t("exp.origin.growth_officer")}</Badge>
          )}
          <Badge kind="medium">{t(tk(`bi.method.${x.method}`))}</Badge>
          <Badge
            kind={x.status === "completed" ? "high" : CLOSED.includes(x.status) ? "none" : "low"}
          >
            {t(tk(`bi.estatus.${x.status}`))}
          </Badge>
        </span>
      </div>
      <Stepper status={x.status === "paused" ? (x.paused_from ?? "running") : x.status} />
      {parent && (
        <p className="mt-1 text-2xs text-muted-foreground">
          {t("exp.followUpOf", { t: parent.title })}
        </p>
      )}
      <div className="mt-1.5">
        <QualityBadge q={experimentQuality(x.status, x.evidence_strength)} />
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {(
          [
            ["bi.exp.hypothesis", x.hypothesis],
            ["bi.exp.intervention", x.intervention],
            ["exp.f.control", x.control_description ?? ""],
            ["bi.exp.objective", x.objective],
            ["bi.exp.audience", x.audience],
            [
              "exp.kpis",
              [x.primary_kpi || x.success_metric, ...(x.secondary_kpis ?? [])]
                .filter(Boolean)
                .join(" · "),
            ],
            ["exp.f.successCriteria", x.success_criteria ?? ""],
            ["exp.f.stopCriteria", x.stop_criteria ?? ""],
            ["bi.exp.expected", x.expected_result],
            ["bi.exp.risks", x.risks],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-2xs text-muted-foreground">{t(tk(k))}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        <div>
          <dt className="text-2xs text-muted-foreground">{t("bi.exp.duration")}</dt>
          <dd>
            {t("bi.exp.days", { n: x.duration_days })}
            {x.scheduled_start && x.status === "scheduled"
              ? ` · ${t("exp.scheduledFor", { d: fm.date(x.scheduled_start) })}`
              : ""}
            {x.started_at ? ` · ${t("bi.exp.started", { d: fm.date(x.started_at) })}` : ""}
          </dd>
        </div>
        {x.sample_per_group != null && (
          <div>
            <dt className="text-2xs text-muted-foreground">
              {t("exp.samplePlanned", { n: x.sample_per_group })}
            </dt>
            <dd>
              {x.baseline_rate}% → {Number(x.baseline_rate) + Number(x.min_effect)}%
              {x.sample_per_group < 30 ? ` · ${t("exp.sampleMin")}` : ""}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-2xs text-muted-foreground">{t("bi.exp.budget")}</dt>
          <dd>{x.budget !== null && x.currency ? fm.money(Number(x.budget), x.currency) : "—"}</dd>
        </div>
      </dl>
      {gaps.length > 0 && (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-2xs">
          {t("exp.gaps", { list: gaps.map((g) => t(tk(`exp.gap.${g}`))).join(", ") })}
        </p>
      )}
      {x.reviewed_by && x.reviewed_by === x.created_by && !CLOSED.includes(x.status) && (
        <p className="mt-2 text-2xs text-muted-foreground">{t("exp.reviewedBySelf")}</p>
      )}
      {(obs.length > 0 || ["running", "collecting", "evaluating", "paused"].includes(x.status)) && (
        <Results x={x} obs={obs} ev={ev} />
      )}
      {x.status === "completed" && <OutcomeView x={x} />}
      {member && ["running", "collecting", "evaluating", "paused"].includes(x.status) && (
        <RecordResults x={x} latest={latest} onSaved={refresh} />
      )}
      {x.status === "evaluating" && member && (
        <Complete
          x={x}
          allowed={ev.allowed}
          busy={busy}
          onSubmit={(data) => act("complete", data)}
        />
      )}
      {member && (actions.length > 0 || x.status === "completed") && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {!["completed"].includes(x.status) &&
            actions.some((a) =>
              ["pause", "cancel", "approve", "reject", "return_to_draft"].includes(a),
            ) && (
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={600}
                placeholder={t("exp.note")}
                aria-label={t("exp.note")}
                className="h-8 w-full sm:w-64"
              />
            )}
          {(x.status === "draft" || x.status === "in_review") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
              {t("exp.edit")}
            </Button>
          )}
          {inline.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={
                a === "cancel" || a === "reject" || a === "return_to_draft"
                  ? "ghost"
                  : a === "pause"
                    ? "outline"
                    : "default"
              }
              disabled={busy || (a === "request_approval" && gaps.length > 0)}
              onClick={() => act(a)}
            >
              {t(tk(`exp.a.${a}`))}
            </Button>
          ))}
          {actions.includes("schedule") && (
            <span className="flex items-end gap-1">
              <label className="text-2xs">
                <span className="mb-1 block">{t("exp.startDate")}</span>
                <Input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="h-8"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !start}
                onClick={() => act("schedule", { start })}
              >
                {t("exp.a.schedule")}
              </Button>
            </span>
          )}
          {x.status === "proposed" && !admin && (
            <p className="text-2xs text-muted-foreground">{t("bi.imp.awaitAdmin")}</p>
          )}
          {x.status === "completed" && (
            <Button size="sm" variant="outline" onClick={onFollowUp}>
              {t("exp.followUp")}
            </Button>
          )}
        </div>
      )}
      {events.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-2xs font-medium">{t("exp.hist")}</summary>
          <ol className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
            {events.map((e) => (
              <li key={e.id}>
                {fm.date(e.created_at)} ·{" "}
                {["created", "revised", "observation"].includes(e.action)
                  ? t(tk(`exp.h.${e.action}`))
                  : t(tk(`exp.a.${e.action}`))}
                {e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function Results({
  x,
  obs,
  ev,
}: {
  x: ExperimentRow;
  obs: ExperimentObservationRow[];
  ev: ReturnType<typeof evaluateExperiment>;
}) {
  const { t } = useI18n();
  const fm = useFmt();
  const controlled = x.method === "ab_test" || x.method === "comparison_group";
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
      <p className="font-medium">{t("exp.obs.title")}</p>
      {!obs.length ? (
        <p className="mt-1 text-muted-foreground">{t("exp.obs.none")}</p>
      ) : (
        <>
          <p className="mt-1">
            {t("exp.ev.rates", {
              v: ev.variantRate ?? "—",
              c: ev.controlRate ?? "—",
              d: ev.difference ?? "—",
              lo: ev.interval?.[0] ?? "—",
              hi: ev.interval?.[1] ?? "—",
            })}
          </p>
          {controlled && (
            <p className="mt-1 text-muted-foreground">
              {t("exp.ev.progress", {
                vn: obs[0]!.variant_n,
                cn: obs[0]!.control_n,
                need: ev.needed,
              })}
            </p>
          )}
          <p
            className={cn(
              "mt-1",
              ev.verdict === "better"
                ? "text-primary"
                : ev.verdict === "worse"
                  ? "text-destructive"
                  : "",
            )}
          >
            {t(tk(`exp.ev.v.${ev.verdict}`), { z: ev.z ?? "—" })}
          </p>
          {ev.guardrailHit && (
            <p className="mt-1 text-destructive">
              {t("exp.ev.guardrail", { g: x.guardrail_min_rate ?? "" })}
            </p>
          )}
          {ev.simulated && <p className="mt-1 text-warning">{t("exp.ev.simulated")}</p>}
          <details className="mt-1">
            <summary className="cursor-pointer text-2xs text-muted-foreground">
              {obs.length}×
            </summary>
            <ul className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
              {obs.map((r) => (
                <li key={r.id}>
                  {t("exp.obs.row", {
                    d: fm.date(r.observed_on),
                    vc: r.variant_conversions,
                    vn: r.variant_n,
                    cc: r.control_conversions,
                    cn: r.control_n,
                    cls: t(tk(`exp.obs.cls.${r.data_class}`)),
                  })}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function RecordResults({
  x,
  latest,
  onSaved,
}: {
  x: ExperimentRow;
  latest: ExperimentObservationRow | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [cls, setCls] = useState<"manual" | "simulated" | "imported">(
    latest?.data_class ?? "manual",
  );
  const [v, setV] = useState({ vn: "", vc: "", cn: "", cc: "" });
  const controlled = x.method === "ab_test" || x.method === "comparison_group";
  if (!open)
    return (
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>
        {t("exp.obs.add")}
      </Button>
    );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Object.fromEntries(
      Object.entries(v).map(([k, s]) => [k, /^\d+$/.test(s.trim()) ? Number(s) : NaN]),
    ) as Record<keyof typeof v, number>;
    if (Object.values(n).some((z) => Number.isNaN(z)) || n.vc > n.vn || n.cc > n.cn)
      return void toast.error(t("exp.obs.bad"));
    setBusy(true);
    const r = await growthDb.rpc("record_experiment_observation", {
      _experiment: x.id,
      _request: key,
      _p: {
        variant_n: n.vn,
        variant_conversions: n.vc,
        control_n: n.cn,
        control_conversions: n.cc,
        data_class: cls,
      } as Json,
    });
    setBusy(false);
    if (r.error) return void toast.error(t("bi.failed", { e: r.error.message }));
    toast.success(t("exp.done", { a: t("exp.h.observation") }));
    setKey(crypto.randomUUID());
    setV({ vn: "", vc: "", cn: "", cc: "" });
    setOpen(false);
    onSaved();
  }
  const f = (k: keyof typeof v, label: string) => (
    <label className="text-2xs">
      <span className="mb-1 block font-medium">{label}</span>
      <Input
        inputMode="numeric"
        value={v[k]}
        onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
        required
      />
    </label>
  );
  return (
    <form
      onSubmit={save}
      className="mt-3 grid gap-2 rounded-md border border-border p-2 sm:grid-cols-4"
      aria-label={t("exp.obs.add")}
    >
      <p className="font-medium sm:col-span-4">{t("exp.obs.add")}</p>
      {f("vn", t("exp.obs.vn"))}
      {f("vc", t("exp.obs.vc"))}
      {f("cn", controlled ? t("exp.obs.cn") : t("exp.obs.cnBefore"))}
      {f("cc", controlled ? t("exp.obs.cc") : t("exp.obs.ccBefore"))}
      <label className="text-2xs sm:col-span-2">
        <span className="mb-1 block font-medium">{t("exp.obs.class")}</span>
        <select className={sel} value={cls} onChange={(e) => setCls(e.target.value as typeof cls)}>
          {(["manual", "simulated", "imported"] as const).map((c) => (
            <option key={c} value={c}>
              {t(tk(`exp.obs.cls.${c}`))}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {t("exp.obs.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("bi.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Complete({
  x,
  allowed,
  busy,
  onSubmit,
}: {
  x: ExperimentRow;
  allowed: Outcome[];
  busy: boolean;
  onSubmit: (d: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<Outcome>(
    allowed.includes("inconclusive") ? "inconclusive" : allowed[0]!,
  );
  const [result, setResult] = useState("");
  const [conclusion, setConclusion] = useState("");
  return (
    <form
      className="mt-3 grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
      aria-label={t("exp.a.complete")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ outcome, actual_result: result, conclusion });
      }}
    >
      <label className="text-2xs sm:col-span-2">
        <span className="mb-1 block font-medium">{t("exp.complete.outcome")}</span>
        <select
          className={sel}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
        >
          {(["successful", "unsuccessful", "inconclusive"] as const).map((o) => (
            <option key={o} value={o} disabled={!allowed.includes(o)}>
              {t(tk(`exp.outcome.${o}`))}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-muted-foreground">{t("exp.complete.only")}</span>
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.exp.result")} *</span>
        <Textarea
          rows={2}
          value={result}
          onChange={(e) => setResult(e.target.value)}
          required
          maxLength={1000}
        />
      </label>
      <label className="text-2xs">
        <span className="mb-1 block font-medium">{t("bi.exp.conclusion")} *</span>
        <Textarea
          rows={2}
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          required
          maxLength={1000}
        />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {t("exp.a.complete")}
        </Button>
      </div>
      <span className="sr-only">{x.title}</span>
    </form>
  );
}

function OutcomeView({ x }: { x: ExperimentRow }) {
  const { t } = useI18n();
  const s = x.evidence_strength ?? "inconclusive";
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
      <p className="flex flex-wrap items-center gap-2">
        {x.outcome ? (
          <Badge
            kind={
              x.outcome === "successful" ? "high" : x.outcome === "unsuccessful" ? "none" : "low"
            }
          >
            {t(tk(`exp.outcome.${x.outcome}`))}
          </Badge>
        ) : (
          <span className="text-2xs text-muted-foreground">{t("exp.legacy")}</span>
        )}
        <Badge kind={s === "controlled" ? "high" : s === "correlational" ? "medium" : "low"}>
          {t(tk(`bi.strength.${s}`))}
        </Badge>
        <span className="text-2xs text-muted-foreground">{t(tk(`bi.strengthHelp.${s}`))}</span>
      </p>
      {x.result_data_class === "simulated" && (
        <p className="mt-1 text-2xs text-warning">{t("exp.simNotEvidence")}</p>
      )}
      <p className="mt-1">
        <span className="font-medium">{t("bi.exp.result")}:</span> {x.actual_result}
      </p>
      <p className="mt-1">
        <span className="font-medium">{t("bi.exp.conclusion")}:</span> {x.conclusion}
      </p>
      {x.z_score != null && (
        <p className="mt-1 text-2xs text-muted-foreground">
          {Math.abs(Number(x.z_score)) >= 1.96 && s === "controlled"
            ? t("bi.exp.significant", { z: Number(x.z_score) })
            : t("bi.exp.notSignificant", { z: Number(x.z_score) })}
        </p>
      )}
    </div>
  );
}
