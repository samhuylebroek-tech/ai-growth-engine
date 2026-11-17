import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
      setResult(response.data); toast.success("Coordinated analysis saved");
    } catch { toast.error("The request could not finish. Check history before starting another analysis."); }
    finally {
      setBusy(false);
      for (const key of ["coordination", "convs", "command-center", "overview", "billing", "notification-center"]) qc.invalidateQueries({ queryKey: [key] });
    }
  }
  async function open(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || !row.conversation_id || !row.message_id) return;
    const parent = await supabase.from("conversations").select("id").eq("id", row.conversation_id).eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).maybeSingle();
    if (parent.error || !parent.data) { toast.error("Saved analysis is no longer available in this workspace."); return; }
    const message = await supabase.from("messages").select("content").eq("conversation_id", parent.data.id).eq("org_id", o.org.id).eq("id", row.message_id).single();
    if (message.error) { toast.error("Could not open the saved result."); return; }
    setResult({ reply: message.data.content, messageId: row.message_id });
  }
  async function recoverRow(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || busy) return;
    setBusy(true);
    try {
      const response = await recover({ data: { orgId: o.org.id, workspaceId: o.workspace.id, analysisId: row.id, close: new Date(row.lease_expires_at).getTime() <= Date.now() } });
      if (!response.ok) toast.error(response.error);
      else toast.success(response.data.pending ? "Saved work recovered; uncertain AI usage remains reserved for investigation." : response.data.status === "succeeded" ? "Saved analysis recovered without new AI calls." : "Saved usage reconciled. No new AI calls were made.");
    } catch { toast.error("Recovery could not finish. No new AI request was sent."); }
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
    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Network className="h-5 w-5 text-primary" />Coordinated analysis</h2>
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="mb-4 flex flex-wrap gap-5">{(Object.keys(SPECIALISTS) as SpecialistKey[]).map(key => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox aria-label={`Coordinate ${SPECIALISTS[key].name}`} checked={agents.includes(key)} disabled={busy || (!agents.includes(key) && agents.length === 2)} onCheckedChange={checked => setAgents(current => checked ? [...current, key] : current.filter(a => a !== key))} />{SPECIALISTS[key].name}</label>)}</div>
      <label htmlFor="coordination-assignment" className="mb-2 block text-sm font-semibold">Assignment for the team</label>
      <Textarea id="coordination-assignment" value={request} onChange={e => setRequest(e.target.value)} disabled={busy} maxLength={4000} rows={3} placeholder="Compare two perspectives and propose a focused next move…" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><ExecutionContextPicker value={refs} onChange={setRefs} disabled={busy} /><Button type="submit" disabled={busy || agents.length !== 2 || request.trim().length < 3 || !can(o.workspaceRole, "ai.use")}><Network />{busy ? "Coordinating…" : "Coordinate specialists"}</Button></div>
      <p className="mt-3 text-xs text-muted-foreground">Two specialist analyses + Growth Officer synthesis · maximum {COORDINATION_LIMITS.maxCredits} credits reserved · unused credits returned · no external actions.</p>
    </form>
    {busy && <p role="status" className="mt-4 text-sm text-muted-foreground">Specialists are analyzing, then Growth Officer compares their findings.</p>}
    <div className="mt-6"><h3 className="mb-2 text-sm font-semibold">Recent coordinated history</h3>
      {history.isLoading && <p role="status" className="text-xs text-muted-foreground">Loading analyses…</p>}
      {history.isError && <p role="alert" className="text-xs text-destructive">History could not load.<Button variant="link" size="sm" onClick={() => history.refetch()}>Retry</Button></p>}
      {history.data?.map(row => <div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-xs"><span className="min-w-0 break-words">{new Date(row.created_at).toLocaleString()} · {row.status}{row.error ? ` · ${row.error}` : ""}</span><div className="flex flex-wrap gap-1">{row.status === "succeeded" ? <Button variant="link" size="sm" disabled={busy} onClick={() => open(row)}>Open saved analysis</Button> : <Button variant="outline" size="sm" disabled={busy} onClick={() => recoverRow(row)}><RotateCcw />Recover saved work</Button>}{row.partial_results && Object.keys(row.partial_results).length > 0 && <Button variant="ghost" size="icon" title="Download preserved steps" aria-label="Download preserved steps" onClick={() => downloadPartial(row)}><FileText /></Button>}</div></div>)}
      {!history.isLoading && !history.isError && !history.data?.length && <p className="text-xs text-muted-foreground">No coordinated analyses yet.</p>}
    </div>
    {result && <article className="mt-6 border-t border-border pt-5"><div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Saved team analysis{result.credits !== undefined ? ` · ${result.credits} credits` : ""}</p><Button variant="ghost" size="icon" aria-label="Download coordinated analysis" title="Download analysis" onClick={download}><Download /></Button></div><div className="prose-chat min-w-0 break-words text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{result.reply}</ReactMarkdown></div><div className="mt-4"><PlanReview sourceId={result.messageId} content={result.reply} /></div></article>}
  </section>;
}