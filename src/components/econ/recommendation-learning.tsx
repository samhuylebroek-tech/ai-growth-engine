// Recommendation learning: follows each improvement proposal from proposal to recorded learning, lets editors record
// what was learned (the database checks the outcome against the recorded measurement and computes credits/days), and
// shows patterns only where enough comparable actual learnings exist. Learning never changes plans by itself.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type ProposalRow, type RecommendationLearningRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import type { BiData } from "@/lib/bi/view";
import { allowedOutcomes, expectedVsActual, learningPatterns, stageOf, STAGES, type Stage } from "@/lib/econ/learning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Section, sel, tk, useFmt } from "@/components/bi/parts";

const learnKey = (o?: string, w?: string) => ["recommendation-learnings", o, w] as const;

export function RecommendationLearning({ d }: { d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const orgId = o.org?.id, wsId = o.workspace?.id;
  const q = useQuery({
    queryKey: learnKey(orgId, wsId), enabled: !!orgId && !!wsId, retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb.from("recommendation_learnings").select("*").eq("org_id", orgId!).eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(2000);
      if (r.error) { if (isNotInstalled(r.error)) return null; throw r.error; }
      return (r.data ?? []) as RecommendationLearningRow[];
    },
  });
  const proposals = d.proposals as unknown as ProposalRow[];
  const learnings = q.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const stages = useMemo(() => {
    const m = new Map<Stage, number>();
    for (const p of proposals) {
      const task = p.task_id ? (d.tasks as { id: string; status: string }[]).find((x) => x.id === p.task_id) : undefined;
      const s = stageOf(p, task ? { status: task.status, owner_id: null } : null, learnings, false, today);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [proposals, d.tasks, learnings, today]);
  const patterns = useMemo(() => learningPatterns(learnings, proposals), [learnings, proposals]);
  if (q.isLoading) return null;
  if (q.data === null) return <Section title={t("rl.title")}><p className="text-xs text-muted-foreground">{t("rl.notInstalled")}</p></Section>;
  if (q.isError) return <Section title={t("rl.title")}><p role="alert" className="text-xs text-destructive">{t("rl.loadFailed")}</p></Section>;
  const open = proposals.filter((p) => allowedOutcomes(p).length > 0);
  return (
    <Section title={t("rl.title")} intro={t("rl.intro")}>
      <div className="mb-4 flex flex-wrap gap-1" aria-label={t("rl.stages")}>
        {STAGES.filter((s) => stages.get(s)).map((s) => <Badge key={s} kind="none">{`${t(tk(`rl.stage.${s}`))}: ${stages.get(s)}`}</Badge>)}
        {!proposals.length && <p className="text-xs text-muted-foreground">{t("rl.noProposals")}</p>}
      </div>
      <h3 className="mb-2 text-sm font-medium">{t("rl.patterns")}</h3>
      {!patterns.length ? <p className="mb-4 text-xs text-muted-foreground">{t("rl.noPatterns")}</p> : (
        <ul className="mb-4 space-y-2">{patterns.map((p) => (
          <li key={p.key} className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{`${p.lever}${p.channel ? ` · ${p.channel}` : ""}`}</span>
              <Badge kind={p.confidence === "medium" ? "medium" : "low"}>{t(tk(`rl.conf.${p.confidence}`))}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{t("rl.patternLine", { n: p.observations, c: p.campaigns, pos: p.positive, neg: p.negative, nc: p.noChange, f: p.from, to: p.to })}</p>
            {p.confidence !== "not_enough" && <p className="mt-1">{t(tk(`rl.dir.${p.direction}`))}</p>}
            <p className="mt-1 text-muted-foreground">{p.limitations.map((l) => t(tk(`rl.lim.${l}`))).join(" · ")}</p>
          </li>))}</ul>)}
      <h3 className="mb-2 text-sm font-medium">{t("rl.recorded")}</h3>
      {!learnings.length ? <p className="mb-4 text-xs text-muted-foreground">{t("rl.none")}</p> : (
        <ul className="mb-4 space-y-2">{learnings.slice(0, 50).map((l) => <LearningItem key={l.id} l={l} title={proposals.find((p) => p.id === l.proposal_id)?.title ?? "—"} />)}</ul>)}
      {can(o.workspaceRole, "evidence.decide") ? (open.length > 0 && <RecordLearning proposals={open} />)
        : <p className="text-xs text-muted-foreground">{t("rl.editorsOnly")}</p>}
    </Section>
  );
}

function LearningItem({ l, title }: { l: RecommendationLearningRow; title: string }) {
  const { t } = useI18n();
  const f = useFmt();
  const ev = expectedVsActual(l);
  const parts = [
    ev.change !== null ? t("rl.change", { v: ev.change }) : t("rl.noChangeFigure"),
    ev.cost ? t("rl.cost", { e: f.money(ev.cost.expected, ev.cost.currency ?? "EUR"), a: f.money(ev.cost.actual, ev.cost.currency ?? "EUR") }) : null,
    ev.credits ? t("rl.credits", { e: ev.credits.expected, a: ev.credits.actual }) : t("rl.creditsActual", { a: l.actual_credits }),
    ev.days !== null ? t("rl.days", { n: ev.days }) : null,
    l.uncertain_runs ? t("rl.uncertain", { n: l.uncertain_runs }) : null,
  ].filter(Boolean);
  return (
    <li className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{title}</span>
        <span className="flex flex-wrap gap-1">
          <Badge kind={l.outcome_class === "positive" ? "high" : l.outcome_class === "negative" ? "low" : "none"}>{t(tk(`rl.out.${l.outcome_class}`))}</Badge>
          {l.evidence_class !== "actual" && <Badge kind="low">{t(tk(`rl.ev.${l.evidence_class}`))}</Badge>}
        </span>
      </div>
      <p className="mt-1">{l.lesson}</p>
      <p className="mt-1 text-muted-foreground">{parts.join(" · ")} · {t(tk(`rl.q.${l.execution_quality}`))} · {l.created_at.slice(0, 10)}</p>
    </li>
  );
}

function RecordLearning({ proposals }: { proposals: ProposalRow[] }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pid, setPid] = useState(proposals[0]!.id);
  const p = proposals.find((x) => x.id === pid) ?? proposals[0]!;
  const allowed = allowedOutcomes(p);
  const [oc, setOc] = useState("");
  const [ev, setEv] = useState("actual");
  const [quality, setQuality] = useState("unknown");
  const [channel, setChannel] = useState("");
  const [change, setChange] = useState("");
  const [cost, setCost] = useState("");
  const [lesson, setLesson] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  const outcome = allowed.includes(oc) ? oc : allowed[0]!;
  const reset = () => { request.current = null; };
  async function save() {
    const chg = p.status !== "measured" || change.trim() === "" ? null : Number(change.replace(",", "."));
    const ac = !p.currency || cost.trim() === "" ? null : Number(cost.replace(",", "."));
    if ((chg !== null && !Number.isFinite(chg)) || (ac !== null && (!Number.isFinite(ac) || ac < 0))) return void toast.error(t("rl.err.number"));
    if (lesson.trim().length < 3) return void toast.error(t("rl.err.lesson"));
    setBusy(true);
    request.current ??= crypto.randomUUID();
    const r = await growthDb.rpc("record_recommendation_learning", { _proposal: p.id, _request: request.current, _p: {
      outcome_class: outcome, evidence_class: ev, execution_quality: quality, lesson: lesson.trim(),
      ...(channel.trim() ? { channel: channel.trim() } : {}), ...(chg !== null ? { measured_change_pct: chg } : {}), ...(ac !== null ? { actual_cost: ac } : {}),
    } as Json });
    setBusy(false);
    if (r.error) {
      const m = r.error.message ?? "";
      return void toast.error(m.includes("learning_outcome_not_measured") ? t("rl.err.notMeasured") : m.includes("learning_needs_work") ? t("rl.err.needsWork") : r.error.code === "42501" ? t("rl.err.role") : t("rl.err.failed"));
    }
    request.current = null;
    setLesson(""); setChange(""); setCost(""); setChannel("");
    toast.success(t("rl.saved"));
    void qc.invalidateQueries({ queryKey: learnKey(o.org?.id, o.workspace?.id) });
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3 text-xs">
      <p className="font-medium">{t("rl.record")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-3">{t("rl.proposal")}
          <select className={sel} value={p.id} onChange={(e) => { setPid(e.target.value); setOc(""); reset(); }}>
            {proposals.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{t("rl.outcome")}
          <select className={sel} value={outcome} onChange={(e) => { setOc(e.target.value); reset(); }}>
            {allowed.map((k) => <option key={k} value={k}>{t(tk(`rl.out.${k}`))}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{t("rl.evidence")}
          <select className={sel} value={ev} onChange={(e) => { setEv(e.target.value); reset(); }}>
            {["actual", "estimated", "simulated"].map((k) => <option key={k} value={k}>{t(tk(`rl.ev.${k}`))}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{t("rl.quality")}
          <select className={sel} value={quality} onChange={(e) => { setQuality(e.target.value); reset(); }}>
            {["good", "acceptable", "poor", "unknown"].map((k) => <option key={k} value={k}>{t(tk(`rl.q.${k}`))}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{t("rl.channel")}<Input value={channel} maxLength={80} onChange={(e) => { setChannel(e.target.value); reset(); }} /></label>
        {p.status === "measured" && <label className="flex flex-col gap-1">{t("rl.changePct")}<Input inputMode="decimal" value={change} onChange={(e) => { setChange(e.target.value); reset(); }} /></label>}
        {p.currency && <label className="flex flex-col gap-1">{t("rl.actualCost", { c: p.currency })}<Input inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); reset(); }} /></label>}
        <label className="flex flex-col gap-1 sm:col-span-3">{t("rl.lesson")}<Textarea rows={2} maxLength={800} value={lesson} onChange={(e) => { setLesson(e.target.value); reset(); }} /></label>
      </div>
      <p className="text-muted-foreground">{t(p.status === "measured" ? "rl.measuredNote" : "rl.notMeasuredNote")}</p>
      <Button size="sm" disabled={busy} onClick={save}>{t("rl.save")}</Button>
    </div>
  );
}
