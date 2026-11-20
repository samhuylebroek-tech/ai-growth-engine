import { requestAttemptKey } from "@/lib/single-ai-request";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { SingleAIRecovery } from "@/components/app/single-ai-recovery";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Sparkles, ArrowUpRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExecutionContextPicker } from "@/components/execution/context-picker";
import { PlanReview } from "@/components/execution/plan-review";
import { SPECIALISTS, type SpecialistKey } from "@/lib/specialists";
import { runSpecialist } from "@/lib/ai.functions";
import type { ExecutionRef } from "@/lib/execution-context";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";

export function SpecialistWorkbench() {
  const o = useOrg(); const run = useServerFn(runSpecialist); const qc = useQueryClient(); const { t } = useI18n();
  const [agent, setAgent] = useState<SpecialistKey>("strategy");
  const [request, setRequest] = useState(() => t("officer.specStarter.strategy"));
  const [refs, setRefs] = useState<ExecutionRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ reply: string; messageId: string; credits: number } | null>(null);
  async function submit() {
    if (!o.org || !o.workspace || busy) return;
    setBusy(true); setResult(null);
    try {
      const response = await run({ data: { orgId: o.org.id, workspaceId: o.workspace.id, requestKey: requestAttemptKey(sessionStorage, `${o.userId}/${o.org.id}/${o.workspace.id}/specialist`, JSON.stringify({ agent, request, refs }), () => crypto.randomUUID()), agent, request, executionContext: refs } });
      if (!response.ok) { toast.error(response.error); return; }
      setResult(response.data); toast.success(t("officer.analysisSaved"));
      for (const key of ["convs", "command-center", "overview", "billing", "notification-center", "single-ai-history"]) qc.invalidateQueries({ queryKey: [key] });
    } catch { toast.error(t("officer.analysisFailed")); }
    finally { setBusy(false); qc.invalidateQueries({ queryKey: ["single-ai-history"] }); }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.reply], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = `${agent}-analysis.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="mb-10 border-y border-border py-6"><div className="mb-5 flex flex-wrap gap-1">{(Object.keys(SPECIALISTS) as SpecialistKey[]).map(key => <Button key={key} variant={agent === key ? "secondary" : "ghost"} aria-pressed={agent === key} disabled={busy} onClick={() => { setAgent(key); setRequest(t(`officer.specStarter.${key}` as MessageKey)); setResult(null); }}>{t(`officer.spec.${key}` as MessageKey)}</Button>)}</div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]"><form onSubmit={e => { e.preventDefault(); submit(); }} className="min-w-0"><label htmlFor="specialist-request" className="mb-2 block text-sm font-semibold">{t("officer.assignment", { name: t(`officer.spec.${agent}` as MessageKey) })}</label><Textarea id="specialist-request" value={request} onChange={e => setRequest(e.target.value)} maxLength={4000} rows={4} disabled={busy} /><div className="mt-3 flex flex-wrap justify-between gap-2"><ExecutionContextPicker value={refs} onChange={setRefs} disabled={busy} /><Button type="submit" disabled={busy || request.trim().length < 3 || !can(o.workspaceRole, "ai.use")}><Sparkles />{busy ? t("officer.analyzing") : t("officer.runAnalysis")}</Button></div></form><aside className="border-l border-border pl-5 text-xs leading-relaxed text-muted-foreground"><p className="font-semibold text-foreground">{o.workspace?.name}</p><p className="mt-3">{t("officer.specialistContext")}</p><p className="mt-3">{t("officer.specialistNote")}</p><Button variant="link" size="sm" className="mt-3 px-0" asChild><Link to="/app/activity">{t("officer.savedActivity")} <ArrowUpRight /></Link></Button></aside></div>
    {busy && <p role="status" className="mt-5 text-sm text-muted-foreground">{t("officer.preparing")}</p>}
    {result && <article className="mt-8 border-t border-border pt-6"><div className="mb-5 flex items-center justify-between"><p className="text-xs text-muted-foreground">{t("officer.savedAnalysis", { n: result.credits })}</p><Button variant="ghost" size="icon" aria-label={t("officer.downloadAnalysis")} onClick={download}><Download /></Button></div><div className="prose-chat min-w-0 break-words text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{result.reply}</ReactMarkdown></div><div className="mt-5"><PlanReview sourceId={result.messageId} content={result.reply} /></div></article>}
    <SingleAIRecovery />
  </section>;
}