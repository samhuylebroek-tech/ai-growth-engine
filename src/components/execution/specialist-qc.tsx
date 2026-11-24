// Quality control of one finished specialist result (proposal 0081): free rule checks, an optional independent
// second review by a different specialist (one metered call), and the final decision by an editor or higher.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can, hasRole } from "@/lib/permissions";
import {
  growthDb,
  isNotInstalled,
  type SpecialistDecisionRow,
  type SpecialistReviewRow,
  type TaskRunRow,
} from "@/lib/pending-schema";
import { reviewSpecialistResult } from "@/lib/ai.functions";
import { requestAttemptKey } from "@/lib/single-ai-request";
import {
  DIMENSIONS,
  figuresToVerify,
  suggestReviewer,
  type Severity,
} from "@/lib/specialist-review";
import { SPECIALIST_KEYS, type TaskSpecialist } from "@/lib/task-execution";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;
const sel = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs";

type Qc = {
  installed: boolean;
  reviews: SpecialistReviewRow[];
  decision: SpecialistDecisionRow | null;
  required: boolean;
};
const qcKey = (org?: string, ws?: string, run?: string) =>
  ["specialist-qc", org ?? "", ws ?? "", run ?? ""] as const;

export function SpecialistQC({ run }: { run: TaskRunRow }) {
  const o = useOrg();
  const { t, tag, locale } = useI18n();
  const qc = useQueryClient();
  const review = useServerFn(reviewSpecialistResult);
  const key = qcKey(o.org?.id, o.workspace?.id, run.id);
  const q = useQuery({
    queryKey: key,
    enabled: !!o.org && !!o.workspace,
    queryFn: async (): Promise<Qc> => {
      const [r, d, req] = await Promise.all([
        growthDb
          .from("specialist_reviews")
          .select("*")
          .eq("workspace_id", o.workspace!.id)
          .eq("task_run_id", run.id)
          .order("created_at", { ascending: false })
          .limit(10),
        growthDb
          .from("specialist_result_decisions")
          .select("*")
          .eq("workspace_id", o.workspace!.id)
          .eq("task_run_id", run.id)
          .maybeSingle(),
        growthDb.rpc("specialist_review_required", { _run: run.id }),
      ]);
      if ((r.error && isNotInstalled(r.error)) || (req.error && isNotInstalled(req.error)))
        return { installed: false, reviews: [], decision: null, required: false };
      if (r.error) throw r.error;
      if (d.error) throw d.error;
      if (req.error) throw req.error;
      return {
        installed: true,
        reviews: r.data ?? [],
        decision: d.data ?? null,
        required: !!req.data,
      };
    },
  });
  const original = run.specialist_key as TaskSpecialist;
  const [reviewer, setReviewer] = useState<TaskSpecialist>(() => suggestReviewer(original));
  const [busy, setBusy] = useState(false);
  const member = can(o.workspaceRole, "ai.use");
  const editor = hasRole(o.workspaceRole, "editor");
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  if (!q.data?.installed) return null;
  const d = q.data;
  const figures = figuresToVerify(JSON.stringify(run.output ?? ""));
  const latest = d.reviews[0] ?? null;

  const ask = async () => {
    if (busy || !o.org || !o.workspace) return;
    setBusy(true);
    const scope = `qc/${o.org.id}/${o.workspace.id}/${run.id}`;
    const requestKey = requestAttemptKey(
      sessionStorage,
      scope,
      JSON.stringify({ reviewer, locale }),
      () => crypto.randomUUID(),
    );
    try {
      const r = await review({
        data: {
          orgId: o.org.id,
          workspaceId: o.workspace.id,
          runId: run.id,
          reviewer,
          requestKey,
          locale,
        },
      });
      if (!r.ok) return void toast.error(r.error);
      sessionStorage.removeItem(`single-ai-attempt:${scope}`);
      toast.success(
        t("qc.requested", {
          s: r.data.score,
          v: t(tk(`qc.v.${r.data.verdict}`)),
          c: r.data.credits,
        }),
      );
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(t("qc.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-2 rounded-md border border-border p-2 text-xs"
      aria-label={t("qc.title")}
    >
      <h4 className="flex items-center gap-1 font-semibold">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {t("qc.title")}
      </h4>
      <p className="text-muted-foreground">{t("qc.disclaimer")}</p>
      {figures > 0 && <p>{t("qc.figures", { n: figures })}</p>}
      {d.required && !d.decision && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2">{t("qc.required")}</p>
      )}
      {d.reviews.length === 0 && <p className="text-muted-foreground">{t("qc.none")}</p>}
      {d.reviews.map((r) => (
        <ReviewCard key={r.id} r={r} when={fmt(r.created_at)} />
      ))}
      {member && !d.decision && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block font-medium">{t("qc.reviewer")}</span>
            <select
              className={sel}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value as TaskSpecialist)}
            >
              {SPECIALIST_KEYS.filter((k) => k !== original).map((k) => (
                <option key={k} value={k}>
                  {t(tk(`run.sp.${k}`))}
                  {k === suggestReviewer(original) ? ` (${t("qc.suggested")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={ask} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
            {t("qc.request")}
          </Button>
        </div>
      )}
      {d.decision ? (
        <Decided d={d.decision} when={fmt(d.decision.created_at)} />
      ) : editor ? (
        <Decide
          runId={run.id}
          required={d.required}
          latest={latest}
          onDone={() => void qc.invalidateQueries({ queryKey: key })}
        />
      ) : (
        <p className="text-muted-foreground">{t("qc.editorOnly")}</p>
      )}
    </section>
  );
}

function ReviewCard({ r, when }: { r: SpecialistReviewRow; when: string }) {
  const { t } = useI18n();
  const dims = (r.dimensions ?? {}) as Record<string, { score: number; note?: string }>;
  const findings = (Array.isArray(r.findings) ? r.findings : []) as {
    dimension: string;
    severity: Severity;
    finding: string;
    correction?: string;
  }[];
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {t("qc.by", { r: t(tk(`run.sp.${r.reviewer_specialist}`)), d: when })}
        </span>
        <Badge
          variant={r.verdict === "acceptable" ? "secondary" : "outline"}
          className={cn(
            "font-normal",
            r.verdict === "unreliable" && "border-destructive text-destructive",
            r.verdict === "needs_changes" && "border-warning text-warning",
          )}
        >
          {t(tk(`qc.v.${r.verdict}`))}
        </Badge>
      </div>
      <p className="mt-1">{t("qc.score", { s: r.score, n: r.assessed })}</p>
      <p className="text-2xs text-muted-foreground">{t("qc.scoreHow")}</p>
      {r.independence_warning && <p className="mt-1 text-warning">{t("qc.uncritical")}</p>}
      {r.summary && <p className="mt-1">{r.summary}</p>}
      <ul className="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
        {DIMENSIONS.map((k) => (
          <li key={k} className="min-w-0">
            <span className="font-medium">{t(tk(`qc.d.${k}`))}:</span>{" "}
            {dims[k] ? `${dims[k].score}/5` : t("qc.na")}
            {dims[k]?.note ? (
              <span className="text-muted-foreground"> · {dims[k].note}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {findings.length > 0 && (
        <>
          <p className="mt-2 font-medium">{t("qc.findings")}</p>
          <ul className="mt-1 space-y-1">
            {findings.map((f, i) => (
              <li key={i} className="break-words">
                <span
                  className={cn(
                    "font-medium",
                    f.severity === "critical" && "text-destructive",
                    f.severity === "warning" && "text-warning",
                  )}
                >
                  {t(tk(`qc.sev.${f.severity}`))}
                </span>
                {f.dimension && (DIMENSIONS as readonly string[]).includes(f.dimension)
                  ? ` · ${t(tk(`qc.d.${f.dimension}`))}`
                  : ""}
                : {f.finding}
                {f.correction ? (
                  <span className="block text-muted-foreground">
                    {t("qc.correction", { c: f.correction })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Decide({
  runId,
  required,
  latest,
  onDone,
}: {
  runId: string;
  required: boolean;
  latest: SpecialistReviewRow | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [decision, setDecision] = useState<
    "accepted" | "accepted_with_corrections" | "needs_rework" | "rejected"
  >(latest?.verdict === "acceptable" || !latest ? "accepted" : "accepted_with_corrections");
  const [note, setNote] = useState("");
  const [corr, setCorr] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked =
    (decision === "accepted" || decision === "accepted_with_corrections") && required && !latest;
  const unreliable = decision === "accepted" && latest?.verdict === "unreliable";
  const save = async () => {
    setBusy(true);
    const r = await growthDb.rpc("decide_specialist_result", {
      _run: runId,
      _decision: decision,
      _note: note,
      _corrections: corr,
    });
    setBusy(false);
    if (r.error) return void toast.error(r.error.message);
    toast.success(t("qc.saved"));
    onDone();
  };
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <p className="font-medium">{t("qc.decide")}</p>
      <select
        className={sel}
        value={decision}
        onChange={(e) => setDecision(e.target.value as typeof decision)}
        aria-label={t("qc.decide")}
      >
        {(["accepted", "accepted_with_corrections", "needs_rework", "rejected"] as const).map(
          (k) => (
            <option key={k} value={k}>
              {t(tk(`qc.dec.${k}`))}
            </option>
          ),
        )}
      </select>
      {(decision === "needs_rework" || decision === "rejected" || decision === "accepted") && (
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={600}
          placeholder={t("qc.decNote")}
          aria-label={t("qc.decNote")}
        />
      )}
      {decision === "accepted_with_corrections" && (
        <Textarea
          rows={3}
          value={corr}
          onChange={(e) => setCorr(e.target.value)}
          maxLength={2000}
          placeholder={t("qc.decCorrections")}
          aria-label={t("qc.decCorrections")}
        />
      )}
      {blocked && <p className="text-warning">{t("qc.required")}</p>}
      {unreliable && <p className="text-destructive">{t("qc.unreliableBlock")}</p>}
      <Button size="sm" onClick={save} disabled={busy || blocked || unreliable}>
        {t("qc.save")}
      </Button>
    </div>
  );
}

function Decided({ d, when }: { d: SpecialistDecisionRow; when: string }) {
  const { t } = useI18n();
  return (
    <div className="border-t border-border pt-2">
      <p className="font-medium">
        {t("qc.decided", { d: t(tk(`qc.dec.${d.decision}`)), date: when })}
      </p>
      {d.note && <p>{t("qc.decidedNote", { n: d.note })}</p>}
      {d.corrections && <p>{t("qc.decidedCorr", { c: d.corrections })}</p>}
    </div>
  );
}
