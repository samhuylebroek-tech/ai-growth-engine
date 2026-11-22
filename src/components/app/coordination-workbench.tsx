import { useRef, useState } from "react";
import { AiMarkdown } from "@/components/ai/ai-markdown";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Network, Download, RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ExecutionContextPicker } from "@/components/execution/context-picker";
import { PlanReview } from "@/components/execution/plan-review";
import { runCoordinatedAnalysis, recoverCoordinatedAnalysis } from "@/lib/ai.functions";
import { SPECIALISTS, type SpecialistKey } from "@/lib/specialists";
import { COORDINATION_LIMITS } from "@/lib/coordination";
import type { ExecutionRef } from "@/lib/execution-context";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";

export function CoordinationWorkbench() {
  const o = useOrg(); const qc = useQueryClient(); const run = useServerFn(runCoordinatedAnalysis);
  const recover = useServerFn(recoverCoordinatedAnalysis);
  const { t, tag } = useI18n();
  const [agents, setAgents] = useState<SpecialistKey[]>(["strategy", "research"]);
  const [request, setRequest] = useState(""); const [refs, setRefs] = useState<ExecutionRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ reply: string; messageId: string; credits?: number } | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const history = useQuery({ queryKey: ["coordination", o.org?.id, o.workspace?.id, o.userId], enabled: !!o.org && !!o.workspace,
    refetchInterval: busy ? 5000 : false, refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!o.org || !o.workspace) return [];
      const response = await supabase.from("coordinated_analyses").select("id,input,status,conversation_id,message_id,error,created_at,partial_results,lease_expires_at").eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).order("created_at", { ascending: false }).limit(20);
      if (response.error) throw response.error; return response.data;
    },
  });
  async function submit() {
    if (!o.org || !o.workspace || busy || agents.length !== 2 || !can(o.workspaceRole, "ai.use")) return;
    const fingerprint = JSON.stringify({ request: request.trim(), agents, refs });
    const storageKey = `age.coordination.attempt:${o.userId}:${o.org.id}:${o.workspace.id}`;
    if (attempt.current?.fingerprint !== fingerprint) {
      let retained: unknown = null;
      try { retained = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { /* Unavailable storage does not block the action. */ }
      if (retained && typeof retained === "object" && "fingerprint" in retained && "key" in retained && retained.fingerprint === fingerprint && typeof retained.key === "string") attempt.current = { fingerprint, key: retained.key };
      else attempt.current = { fingerprint, key: crypto.randomUUID() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(attempt.current)); } catch { /* Database claim remains authoritative. */ }
    }
    const requestKey = attempt.current.key;
    setBusy(true); setResult(null);
    try {
      const response = await run({ data: { orgId: o.org.id, workspaceId: o.workspace.id, requestKey, request, agents, executionContext: refs } });
      if (!response.ok) { toast.error(response.error); return; }
      setResult(response.data); toast.success(t("officer.coordSaved"));
    } catch { toast.error(t("officer.coordFailed")); }
    finally {
      setBusy(false);
      for (const key of ["coordination", "convs", "command-center", "overview", "billing", "notification-center"]) qc.invalidateQueries({ queryKey: [key] });
    }
  }
  async function open(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || !row.conversation_id || !row.message_id) return;
    const parent = await supabase.from("conversations").select("id").eq("id", row.conversation_id).eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).maybeSingle();
    if (parent.error || !parent.data) { toast.error(t("officer.savedGone")); return; }
    const message = await supabase.from("messages").select("content").eq("conversation_id", parent.data.id).eq("org_id", o.org.id).eq("id", row.message_id).single();
    if (message.error) { toast.error(t("officer.openFailed")); return; }
    setResult({ reply: message.data.content, messageId: row.message_id });
  }
  async function recoverRow(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || busy) return;
    setBusy(true);
    try {
      const response = await recover({ data: { orgId: o.org.id, workspaceId: o.workspace.id, analysisId: row.id, close: new Date(row.lease_expires_at).getTime() <= Date.now() } });
      if (!response.ok) toast.error(response.error);
      else toast.success(response.data.pending ? t("officer.recPending") : response.data.status === "succeeded" ? t("officer.recSucceeded") : t("officer.recReconciled"));
    } catch { toast.error(t("officer.recFailed")); }
    finally { setBusy(false); for (const key of ["coordination", "billing", "convs", "command-center"]) qc.invalidateQueries({ queryKey: [key] }); }
  }
  function downloadPartial(row: NonNullable<typeof history.data>[number]) {
    const entries = row.partial_results && typeof row.partial_results === "object" && !Array.isArray(row.partial_results) ? Object.entries(row.partial_results).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
    const url = URL.createObjectURL(new Blob([entries.map(([step, text]) => `## Preserved step ${Number(step) + 1}\n\n${text}`).join("\n\n")], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = "preserved-team-work.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.reply], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = "coordinated-growth-analysis.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="mb-10 border-b border-border pb-7">
    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Network className="h-5 w-5 text-primary" />{t("officer.coordTitle")}</h2>
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="mb-4 flex flex-wrap gap-5">{(Object.keys(SPECIALISTS) as SpecialistKey[]).map(key => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox aria-label={t("officer.coordinate", { name: t(`officer.spec.${key}` as MessageKey) })} checked={agents.includes(key)} disabled={busy || (!agents.includes(key) && agents.length === 2)} onCheckedChange={checked => setAgents(current => checked ? [...current, key] : current.filter(a => a !== key))} />{t(`officer.spec.${key}` as MessageKey)}</label>)}</div>
      <label htmlFor="coordination-assignment" className="mb-2 block text-sm font-semibold">{t("officer.teamAssignment")}</label>
      <Textarea id="coordination-assignment" value={request} onChange={e => setRequest(e.target.value)} disabled={busy} maxLength={4000} rows={3} placeholder={t("officer.teamPlaceholder")} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><ExecutionContextPicker value={refs} onChange={setRefs} disabled={busy} /><Button type="submit" disabled={busy || agents.length !== 2 || request.trim().length < 3 || !can(o.workspaceRole, "ai.use")}><Network />{busy ? t("officer.coordinating") : t("officer.coordinateBtn")}</Button></div>
      <p className="mt-3 text-xs text-muted-foreground">{t("officer.coordNote", { n: COORDINATION_LIMITS.maxCredits })}</p>
    </form>
    {busy && <p role="status" className="mt-4 text-sm text-muted-foreground">{t("officer.coordBusy")}</p>}
    <div className="mt-6"><h3 className="mb-2 text-sm font-semibold">{t("officer.recentCoord")}</h3>
      {history.isLoading && <p role="status" className="text-xs text-muted-foreground">{t("officer.loadingAnalyses")}</p>}
      {history.isError && <p role="alert" className="text-xs text-destructive">{t("officer.historyFailed")}<Button variant="link" size="sm" onClick={() => history.refetch()}>{t("officer.retry")}</Button></p>}
      {history.data?.map(row => <div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-xs"><span className="min-w-0 break-words">{new Date(row.created_at).toLocaleString(tag)} · {t(`officer.status.${row.status}` as MessageKey)}{row.error ? ` · ${row.error}` : ""}</span><div className="flex flex-wrap gap-1">{row.status === "succeeded" ? <Button variant="link" size="sm" disabled={busy} onClick={() => open(row)}>{t("officer.openSaved")}</Button> : <Button variant="outline" size="sm" disabled={busy} onClick={() => recoverRow(row)}><RotateCcw />{t("officer.recover")}</Button>}{row.partial_results && Object.keys(row.partial_results).length > 0 && <Button variant="ghost" size="icon" title={t("officer.downloadSteps")} aria-label={t("officer.downloadSteps")} onClick={() => downloadPartial(row)}><FileText /></Button>}</div></div>)}
      {!history.isLoading && !history.isError && !history.data?.length && <p className="text-xs text-muted-foreground">{t("officer.noCoord")}</p>}
    </div>
    {result && <article className="mt-6 border-t border-border pt-5"><div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t("officer.savedTeam")}{result.credits !== undefined ? t("officer.creditsSuffix", { n: result.credits }) : ""}</p><Button variant="ghost" size="icon" aria-label={t("officer.downloadAnalysis")} title={t("officer.downloadAnalysis")} onClick={download}><Download /></Button></div><div className="prose-chat min-w-0 break-words text-sm leading-relaxed"><AiMarkdown content={result.reply} /></div><div className="mt-4"><PlanReview sourceId={result.messageId} content={result.reply} /></div></article>}
  </section>;
}