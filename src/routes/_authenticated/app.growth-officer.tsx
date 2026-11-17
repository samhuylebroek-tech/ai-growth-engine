import { requestAttemptKey } from "@/lib/single-ai-request";
import { SingleAIRecovery } from "@/components/app/single-ai-recovery";
import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Plus, BookOpen, ArrowUpRight, Copy, Download, CheckSquare, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { askGrowthOfficer, runCoordinatedAnalysis } from "@/lib/ai.functions";
import { COORDINATION_LIMITS } from "@/lib/coordination";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { PlanReview } from "@/components/execution/plan-review";
import { ExecutionContextPicker } from "@/components/execution/context-picker";
import type { ExecutionRef } from "@/lib/execution-context";
import { consumeGrowthDraft, growthDraftKey } from "@/lib/growth-draft";

export const Route = createFileRoute("/_authenticated/app/growth-officer")({ head: () => pageHead("Growth Officer", "Evidence-aware conversations and recommendations."), component: GrowthOfficer });

const STARTERS = ["Find my biggest growth opportunities", "Create a 30-day action plan", "What information am I missing?", "Draft a marketing strategy using confirmed facts"];

function GrowthOfficer() {
  const o = useOrg(); const qc = useQueryClient(); const ask = useServerFn(askGrowthOfficer); const deepRun = useServerFn(runCoordinatedAnalysis);
  const [conv, setConv] = useState<string | null>(null); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null); const [deepAnalysis, setDeepAnalysis] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const restoredDraft = useRef<string | null>(null);
  const [executionContext, setExecutionContext] = useState<ExecutionRef[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    setConv(null); setPending(null); setExecutionContext([]);
    if (!o.org || !o.workspace) { setText(""); return; }
    const key = growthDraftKey(o.org.id, o.workspace.id);
    if (restoredDraft.current === key) return;
    restoredDraft.current = key;
    setText(consumeGrowthDraft(sessionStorage, o.org.id, o.workspace.id));
  }, [o.org?.id, o.workspace?.id]);
  const convs = useQuery({ queryKey: ["convs", o.org?.id, o.workspace?.id], enabled: !!o.org && !!o.workspace, queryFn: async () => {
    if (!o.org || !o.workspace) return [];
    const r = await supabase.from("conversations").select("id,title,created_at").eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).order("created_at", { ascending: false }).limit(30);
    if (r.error) throw r.error; return r.data ?? [];
  } });
  const msgs = useQuery({ queryKey: ["msgs", conv, o.workspace?.id], enabled: !!conv && !!o.org && !!o.workspace, queryFn: async () => {
    if (!conv || !o.org || !o.workspace) return [];
    const owner = await supabase.from("conversations").select("id").eq("id", conv).eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) throw new Error("Conversation unavailable in this workspace.");
    const r = await supabase.from("messages").select("id,role,content,created_at").eq("org_id", o.org.id).eq("conversation_id", owner.data.id).order("created_at");
    if (r.error) throw r.error; return r.data ?? [];
  } });
  const context = useQuery({ queryKey: ["officer-context", o.org?.id, o.workspace?.id], enabled: !!o.org && !!o.workspace, queryFn: async () => {
    if (!o.org || !o.workspace) return [];
    const r = await supabase.from("business_facts").select("id,key,value,verified").eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).order("created_at", { ascending: false });
    if (r.error) throw r.error; return r.data ?? [];
  } });
  useEffect(() => { end.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" }); }, [msgs.data, pending]);

  async function send(message: string) {
    if (!o.org || !o.workspace || !message.trim() || busy || !can(o.workspaceRole, "ai.use")) return;
    setBusy(true); setPending(message); setText("");
    try {
      if (deepAnalysis) {
        const requestKey = requestAttemptKey(
          sessionStorage,
          `${o.userId}/${o.org.id}/${o.workspace.id}/officer-deep`,
          JSON.stringify({ conv, message, executionContext }),
          () => crypto.randomUUID(),
        );
        const result = await deepRun({ data: {
          orgId: o.org.id, workspaceId: o.workspace.id, requestKey,
          mode: "auto", request: message, executionContext,
        } });
        if (!result.ok) { toast.error(result.error); setText(message); return; }
        setConv(result.data.conversationId);
        setDeepAnalysis(false);
        toast.success(`Growth Officer analysis completed · ${result.data.credits} credits used`);
        qc.invalidateQueries({ queryKey: ["msgs", result.data.conversationId] });
        qc.invalidateQueries({ queryKey: ["convs"] });
        qc.invalidateQueries({ queryKey: ["officer-deep-analysis-recovery"] });
        qc.invalidateQueries({ queryKey: ["coordination"] });
      } else {
        const r = await ask({ data: {
          orgId: o.org.id, workspaceId: o.workspace.id,
          requestKey: requestAttemptKey(sessionStorage, `${o.userId}/${o.org.id}/${o.workspace.id}/officer`, JSON.stringify({ conv, message, executionContext }), () => crypto.randomUUID()),
          conversationId: conv, message, executionContext,
        } });
        if (!r.ok) { toast.error(r.error); setText(message); return; }
        setConv(r.data.conversationId);
        if (r.data.proposals) toast.success(`${r.data.proposals} action${r.data.proposals > 1 ? "s" : ""} sent to Approvals`);
        qc.invalidateQueries({ queryKey: ["msgs", r.data.conversationId] });
        qc.invalidateQueries({ queryKey: ["convs"] });
        qc.invalidateQueries({ queryKey: ["single-ai-history"] });
        qc.invalidateQueries({ queryKey: ["overview"] });
        qc.invalidateQueries({ queryKey: ["billing"] });
      }
    } catch { toast.error("The answer could not finish. Your question is preserved."); setText(message); }
    finally {
      setBusy(false); setPending(null);
      qc.invalidateQueries({ queryKey: ["single-ai-history"] });
      qc.invalidateQueries({ queryKey: ["officer-deep-analysis-recovery"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
    }
  }
  const allowed = can(o.workspaceRole, "ai.use"); const list = msgs.data ?? [];
  const verified = context.data?.filter(f => f.verified) ?? [];
  const title = convs.data?.find(c => c.id === conv)?.title;
  async function exportConversation() {
    if (!list.length) return;
    const text = list.map(m => `## ${m.role === "user" ? "You" : "Growth Officer"}\n\n${m.content}`).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([`# ${title ?? "Growth conversation"}\n\n${text}`], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = "growth-conversation.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="section-label mb-2">AI workspace / {o.workspace?.name}</p><h1 className="text-2xl font-semibold">Growth Officer</h1></div><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="View business context" title="Business context" onClick={() => setContextOpen(!contextOpen)}><BookOpen /></Button><Button variant="ghost" size="icon" aria-label="Export conversation" title="Export conversation" disabled={!list.length || busy} onClick={exportConversation}><Download /></Button><Button variant="outline" size="sm" disabled={busy} onClick={() => { setConv(null); setText(""); }}><Plus />New conversation</Button></div></div>
    <div className="grid min-h-[560px] gap-6 lg:grid-cols-[176px_minmax(0,1fr)] xl:grid-cols-[176px_minmax(0,1fr)_224px]">
      <aside className="hidden min-w-0 flex-col border-r border-border pr-4 lg:flex"><p className="section-label mb-4">Conversations</p>{convs.isLoading && <p role="status" className="text-xs text-muted-foreground">Loading history…</p>}{convs.isError && <p role="alert" className="text-xs text-destructive">History could not load.<Button variant="link" size="sm" onClick={() => convs.refetch()}>Retry</Button></p>}<div className="max-h-[600px] space-y-1 overflow-y-auto">{convs.data?.map(c => <Button key={c.id} variant="ghost" disabled={busy} onClick={() => setConv(c.id)} className={cn("h-auto w-full justify-start whitespace-normal break-words px-2 py-3 text-left text-xs text-muted-foreground", conv === c.id && "bg-secondary text-foreground")}><span className="line-clamp-3">{c.title}</span></Button>)}</div>{!convs.isLoading && !convs.data?.length && <p className="text-xs text-muted-foreground">No conversations yet.</p>}<Button variant="link" size="sm" className="mt-5 justify-start px-0" asChild><Link to="/app/activity">Activity & results <ArrowUpRight /></Link></Button></aside>
      <div className="flex min-w-0 flex-col"><div className="mb-4 flex lg:hidden"><select aria-label="Conversation" className="w-full min-w-0 rounded-md border border-border bg-card px-3 text-xs" disabled={busy} value={conv ?? ""} onChange={e => setConv(e.target.value || null)}><option value="">New conversation</option>{convs.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
        <div className="max-h-[600px] min-h-[310px] flex-1 overflow-y-auto pr-1">
          {msgs.isLoading && <p role="status" className="py-5 text-sm text-muted-foreground">Opening conversation…</p>}
          {msgs.isError && <p role="alert" className="text-sm text-destructive">Conversation could not load.<Button variant="link" onClick={() => msgs.refetch()}>Retry</Button></p>}
          {!conv && !pending ? <div className="py-10"><Sparkles className="mb-6 h-7 w-7 text-primary" /><h2 className="max-w-lg text-2xl font-semibold leading-snug">A clear next move.<br />Built around your business.</h2><p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">{verified.length ? `${verified.length} confirmed business facts are available in ${o.workspace?.name}.` : "Your business context is not confirmed yet. I’ll make missing evidence and assumptions explicit."}</p><div className="mt-7 grid gap-2 sm:grid-cols-2">{STARTERS.map(starter => <Button key={starter} variant="outline" className="h-auto min-h-16 justify-between whitespace-normal p-3 text-left text-xs" disabled={!allowed || busy} onClick={() => setText(starter)}>{starter}<ArrowUpRight className="shrink-0 text-muted-foreground" /></Button>)}</div></div> : <div className="space-y-6 pb-4">{list.map(m => <div key={m.id}><Bubble role={m.role} content={m.content} />{m.role === "assistant" && allowed && <div className="mt-3"><PlanReview sourceId={m.id} content={m.content} /></div>}</div>)}{pending && <><Bubble role="user" content={pending} /><div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" />Working on your question…</div></>}<div ref={end} /></div>}
        </div>
        {allowed && <div className="mt-3"><ExecutionContextPicker value={executionContext} onChange={setExecutionContext} disabled={busy} /></div>}
        {allowed ? <div className="mt-5 space-y-2"><label htmlFor="growth-officer-deep-analysis" className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs"><Checkbox id="growth-officer-deep-analysis" checked={deepAnalysis} onCheckedChange={v => setDeepAnalysis(v === true)} disabled={busy} /><span><strong className="block font-medium">Deep analysis</strong><span className="text-muted-foreground">Growth Officer chooses the specialist team automatically. Up to {COORDINATION_LIMITS.maxCredits} credits are reserved across three bounded calls; unused credits are returned. No external action is performed.</span></span></label><form onSubmit={e => { e.preventDefault(); send(text); }} className="rounded-lg border border-border bg-card p-3 focus-within:border-primary/50"><Textarea aria-label="Question for Growth Officer" value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000} placeholder="Ask a question or describe your next goal…" className="min-h-20 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} /><div className="mt-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><BookOpen className="h-3 w-3" />{verified.length} confirmed facts · workspace-scoped</span><Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send" title="Send question"><Send /></Button></div></form></div> : <p className="mt-5 text-sm text-muted-foreground">Viewer access · conversations are read-only.</p>}
        <p className="mt-3 text-[10px] text-muted-foreground">AI credits apply · <Link to="/app/billing" className="underline">View usage</Link> · Verify important decisions.</p>
      </div>
      <aside className={cn("min-w-0 border-t border-border pt-5 xl:block xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0", !contextOpen && "hidden")}><p className="section-label mb-4">Business context</p><p className="text-sm font-semibold">{o.workspace?.name}</p>{context.isError ? <p role="alert" className="mt-3 text-xs text-destructive">Context could not load.</p> : <><p className="mt-2 text-[11px] text-muted-foreground">{verified.length} confirmed · {(context.data?.length ?? 0) - verified.length} awaiting review</p><div className="mt-4 space-y-4">{verified.slice(0,4).map(f => <div key={f.id}><h3 className="text-[11px] font-semibold">{f.key}</h3><p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{f.value}</p></div>)}</div>{!verified.length && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Unconfirmed claims are not trusted business evidence.</p>}</>}<Button variant="link" size="sm" className="mt-3 px-0" asChild><Link to="/app/profile">Review knowledge <ArrowUpRight /></Link></Button><div className="mt-6 border-t border-border pt-5"><p className="section-label mb-3">Related work</p><Button variant="ghost" size="sm" className="w-full justify-start px-0" asChild><Link to="/app/documents"><FileText />Documents</Link></Button><Button variant="ghost" size="sm" className="w-full justify-start px-0" asChild><Link to="/app/approvals"><CheckSquare />Review & approvals</Link></Button></div><p className="mt-6 text-[10px] leading-relaxed text-muted-foreground">Results are saved in your conversation. External actions require review; automatic execution is not configured.</p></aside>
    </div>
    <SingleAIRecovery onRecovered={setConv} />
  </div>;
}

function Bubble({ role, content }: { role: string; content: string }) {
  async function copy() { try { await navigator.clipboard.writeText(content); toast.success("Result copied"); } catch { toast.error("Could not copy this result"); } }
  return <article className={cn("min-w-0 break-words", role === "user" ? "ml-6 rounded-lg bg-secondary p-4" : "border-b border-border py-4")}><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] font-semibold">{role === "user" ? "You" : <><Sparkles className="h-3.5 w-3.5 text-primary" />Growth Officer</>}</span>{role !== "user" && <Button variant="ghost" size="icon" aria-label="Copy result" title="Copy result" onClick={copy}><Copy /></Button>}</div><div className={cn("text-sm leading-relaxed", role === "user" ? "whitespace-pre-wrap" : "prose-chat")} >{role === "user" ? content : <ReactMarkdown skipHtml>{content}</ReactMarkdown>}</div></article>;
}
