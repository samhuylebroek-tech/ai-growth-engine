// Growth Officer analysis of an open re-planning proposal (proposal 0082): one metered call that explains cause,
// consequences, affected tasks and the options. Advice only; the editor still applies an option in the panel above.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type TaskReplanAnalysisRow } from "@/lib/pending-schema";
import { analyzeReplan } from "@/lib/ai.functions";
import { analysisStale, type ReplanAnalysis } from "@/lib/replan-analysis";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;

export function replanAnalysesOptions(orgId: string | undefined, wsId: string | undefined, proposalId: string | undefined) {
  return {
    queryKey: ["replan-analyses", orgId ?? "", wsId ?? "", proposalId ?? ""] as const,
    enabled: !!orgId && !!wsId && !!proposalId,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<TaskReplanAnalysisRow[] | null> => {
      const r = await growthDb.from("task_replan_analyses").select("*").eq("org_id", orgId!).eq("workspace_id", wsId!).eq("proposal_id", proposalId!).order("created_at", { ascending: false }).limit(10);
      if (r.error) { if (isNotInstalled(r.error)) return null; throw r.error; }
      return r.data ?? [];
    },
  };
}

export function ReplanAnalysisPanel({ proposalId, taskUpdatedAt, title }: { proposalId: string; taskUpdatedAt: string; title: (id: string) => string }) {
  const o = useOrg();
  const { t, tag, locale } = useI18n();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeReplan);
  const q = useQuery(replanAnalysesOptions(o.org?.id, o.workspace?.id, proposalId));
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  if (q.data === null || q.data === undefined) return null;
  const latest = q.data[0] ?? null;
  const stale = latest ? analysisStale(latest, { updated_at: taskUpdatedAt }) : false;
  const member = can(o.workspaceRole, "ai.use");

  const ask = async () => {
    if (busy || !o.org || !o.workspace) return;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const r = await analyze({ data: { orgId: o.org.id, workspaceId: o.workspace.id, proposalId, requestKey: key.current, locale } });
      if (!r.ok) return void toast.error(r.error);
      key.current = null;
      toast.success(t("ra.done", { c: r.data.credits }));
      await qc.invalidateQueries({ queryKey: ["replan-analyses"] });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(t("ra.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };

  const a = latest ? (latest.analysis as unknown as ReplanAnalysis) : null;
  return (
    <section aria-label={t("ra.title")} className="space-y-2 rounded-md border border-border bg-card p-3 text-xs">
      <h4 className="flex items-center gap-1 text-sm font-semibold"><Sparkles className="h-4 w-4" aria-hidden />{t("ra.title")}</h4>
      {!a && <p className="text-muted-foreground">{t("ra.intro")}</p>}
      {a && latest && (
        <div className={cn("space-y-2", stale && "opacity-70")}>
          <p className="text-muted-foreground">{t("ra.when", { d: new Date(latest.created_at).toLocaleString(tag), c: latest.credits ?? "—" })}</p>
          {stale && <p className="rounded-md border border-warning/50 p-2 text-warning">{t("ra.stale")}</p>}
          <Block h={t("ra.cause")} body={a.cause} />
          <Block h={t("ra.consequences")} body={a.consequences} />
          {a.affected.length > 0 && (
            <div><p className="font-medium">{t("ra.affected")}</p>
              <ul className="list-disc pl-5">{a.affected.map((x) => <li key={x.task_id}><span className="font-medium">{title(x.task_id)}</span>: {x.effect}</li>)}</ul></div>
          )}
          {a.options.length > 0 && (
            <div><p className="font-medium">{t("ra.options")}</p>
              <ul className="space-y-1">{a.options.map((x) => (
                <li key={x.key} className={cn("rounded border border-border p-1.5", latest.recommended === x.key && "border-primary")}>
                  <span className="font-medium">{t("ra.option", { k: x.key.toUpperCase() })}</span> · {t("ra.riskOf", { r: t(tk(`rp.risk.${x.risk}`)) })}
                  {latest.recommended === x.key && <span className="ml-1 text-primary">· {t("ra.badge")}</span>}
                  <span className="block">{x.assessment}</span>
                </li>
              ))}</ul></div>
          )}
          <p className="font-medium">{latest.recommended === "none" ? t("ra.recommendedNone") : t("ra.recommended", { k: latest.recommended.toUpperCase() })}</p>
          {a.why && <p>{a.why}</p>}
          {a.extra.length > 0 && (
            <div><p className="font-medium">{t("ra.extra")}</p>
              <ul className="list-disc pl-5">{a.extra.map((x, i) => <li key={i}><span className="font-medium">{t(tk(`ra.x.${x.kind}`))}</span>: {x.suggestion}</li>)}</ul></div>
          )}
          {a.risks.length > 0 && <div><p className="font-medium">{t("ra.risks")}</p><ul className="list-disc pl-5">{a.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          <Block h={t("ra.cost")} body={a.cost} />
          <Block h={t("ra.approval")} body={a.approval} />
          <Block h={t("ra.verification")} body={a.verification} />
          {a.evidence_gaps.length > 0 && <div><p className="font-medium">{t("ra.gaps")}</p><ul className="list-disc pl-5">{a.evidence_gaps.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          <p className="text-muted-foreground">{t("ra.advice")}</p>
        </div>
      )}
      {member && (!a || stale) && (
        <Button size="sm" variant="outline" onClick={ask} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
          {busy ? t("ra.asking") : t("ra.ask")}
        </Button>
      )}
    </section>
  );
}

function Block({ h, body }: { h: string; body: string }) {
  if (!body) return null;
  return <div><p className="font-medium">{h}</p><p className="break-words">{body}</p></div>;
}
