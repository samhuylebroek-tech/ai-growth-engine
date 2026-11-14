import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { askGrowthOfficer } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/app/growth-officer")({ head: () => pageHead("Growth Officer", "Evidence-aware conversations and recommendations."), component: GrowthOfficer });

const STARTERS = ["Create a growth strategy for the next 90 days", "Where are we likely losing customers?", "What opportunities might we be missing?", "Analyze our competitors"];

function GrowthOfficer() {
  const o = useOrg(); const qc = useQueryClient(); const ask = useServerFn(askGrowthOfficer);
  const [conv, setConv] = useState<string | null>(null); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setConv(null); setPending(null); setText(""); }, [o.workspace?.id]);
  const convs = useQuery({ queryKey: ["convs", o.workspace?.id], enabled: !!o.workspace, queryFn: async () => (await supabase.from("conversations").select("id,title,created_at").eq("workspace_id", o.workspace!.id).order("created_at", { ascending: false }).limit(30)).data ?? [] });
  const msgs = useQuery({ queryKey: ["msgs", conv], enabled: !!conv, queryFn: async () => (await supabase.from("messages").select("id,role,content,created_at").eq("conversation_id", conv!).order("created_at")).data ?? [] });
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.data, pending]);

  async function send(message: string) {
    if (!o.org || !o.workspace || !message.trim() || busy || !can(o.role, "ai.use")) return;
    setBusy(true); setPending(message); setText("");
    try {
      const r = await ask({ data: { orgId: o.org.id, workspaceId: o.workspace.id, conversationId: conv, message } });
      if (!r.ok) { toast.error(r.error); setText(message); return; }
      setConv(r.data.conversationId);
      if (r.data.proposals) toast.success(`${r.data.proposals} action${r.data.proposals > 1 ? "s" : ""} sent to Approvals`);
      qc.invalidateQueries({ queryKey: ["msgs", r.data.conversationId] }); qc.invalidateQueries({ queryKey: ["convs"] });
      qc.invalidateQueries({ queryKey: ["overview"] }); qc.invalidateQueries({ queryKey: ["billing"] });
    } catch { toast.error("The answer could not finish. Your question is preserved."); setText(message); }
    finally { setBusy(false); setPending(null); }
  }
  const allowed = can(o.role, "ai.use");
  const list = msgs.data ?? [];
  return (
    <div className="grid h-[calc(100dvh-10rem)] min-h-[420px] gap-6 md:h-[calc(100dvh-5rem)] md:grid-cols-[200px_1fr]">
      <div className="hidden flex-col md:flex">
        <Button variant="outline" size="sm" onClick={() => setConv(null)}><Plus className="mr-1 h-4 w-4" /> New conversation</Button>
        <div className="mt-4 space-y-0.5 overflow-y-auto">{convs.data?.map((c) => (
          <Button key={c.id} variant="ghost" onClick={() => setConv(c.id)} className={cn("block w-full truncate px-2 text-left text-sm text-muted-foreground", conv === c.id && "bg-secondary text-foreground")}>{c.title}</Button>
        ))}</div>
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex items-center gap-2 md:hidden"><select aria-label="Conversation" className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm" value={conv ?? ""} onChange={e => setConv(e.target.value || null)}><option value="">New conversation</option>{convs.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><Button variant="ghost" size="icon" aria-label="New conversation" onClick={() => setConv(null)}><Plus /></Button></div>
        <div className="flex-1 overflow-y-auto pr-1">
          {!conv && !pending ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-6 w-6" /></div>
              <h1 className="mt-4 text-2xl font-bold">Your Chief Growth Officer</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Tell me what you want to achieve. I'll use your business profile and documents, explain my reasoning, and send any actions to you for approval.</p>
              <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">{STARTERS.map((s) => <Button variant="outline" key={s} disabled={!allowed || busy} onClick={() => send(s)} className="h-auto whitespace-normal p-3 text-left text-sm">{s}</Button>)}</div>
            </div>
          ) : (
            <div className="space-y-5 pb-4">
              {list.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)}
              {pending && <><Bubble role="user" content={pending} /><div className="text-sm text-muted-foreground">Thinking…</div></>}
              <div ref={end} />
            </div>
          )}
        </div>
        {allowed ? (
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="mt-3 flex items-end gap-2 rounded-lg border border-border bg-card p-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder="Ask anything about growing your business…" className="min-h-0 resize-none border-0 bg-transparent focus-visible:ring-0"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        ) : <p className="mt-3 text-center text-sm text-muted-foreground">Viewers can read but not ask. Ask an admin for member access.</p>}
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Each answer uses AI credits · <Link to="/app/billing" className="underline">see usage</Link> · AI can be wrong; verify important decisions.</p>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] break-words rounded-lg px-4 py-3 text-sm leading-relaxed", role === "user" ? "whitespace-pre-wrap bg-secondary" : "prose-chat")}>
        {role === "user" ? content : <ReactMarkdown skipHtml>{content}</ReactMarkdown>}
      </div>
    </div>
  );
}
