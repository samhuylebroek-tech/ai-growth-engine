import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { recoverSingleAIRequest } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function SingleAIRecovery({ onRecovered }: { onRecovered?: (id: string) => void }) {
  const o = useOrg(); const qc = useQueryClient(); const recover = useServerFn(recoverSingleAIRequest);
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["single-ai-history", o.userId, o.org?.id, o.workspace?.id], enabled: !!o.org && !!o.workspace, queryFn: async () => {
    if (!o.org || !o.workspace) return [];
    const r = await supabase.from("single_ai_requests").select("id,kind,status,created_at,reply,conversation_id").eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).order("created_at", { ascending: false }).limit(20);
    if (r.error) throw r.error; return r.data;
  } });
  async function restore(id: string) {
    if (!o.org || !o.workspace || busy) return;
    setBusy(id);
    try {
      const r = await recover({ data: { orgId: o.org.id, workspaceId: o.workspace.id, requestId: id } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.data.status === "succeeded" ? "Saved answer recovered" : "Unstarted request closed");
      if (r.data.conversationId) {
        if (onRecovered) onRecovered(r.data.conversationId);
        else {
          const saved = await supabase.from("single_ai_requests").select("reply").eq("id", id).eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId).single();
          if (saved.error) throw saved.error;
          setOpened(saved.data.reply);
        }
      }
      for (const key of ["single-ai-history", "convs", "msgs", "billing", "command-center", "approvals"]) qc.invalidateQueries({ queryKey: [key] });
    } catch { toast.error("Recovery could not finish. No AI request was resent."); }
    finally { setBusy(null); }
  }
  function download(reply: string) {
    const url = URL.createObjectURL(new Blob([reply], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = "saved-ai-answer.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!history.data?.length && !history.isError) return null;
  return <section className="mt-6 border-t border-border py-5"><h2 className="text-sm font-semibold">Saved requests</h2>{history.isError ? <Button variant="link" onClick={() => history.refetch()}>Reload saved requests</Button> : <div className="mt-3 divide-y divide-border">{history.data?.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="text-xs"><p className="font-medium capitalize">{row.kind.replaceAll("_", " ")}</p><p className="mt-1 text-muted-foreground">{row.status} · {new Date(row.created_at).toLocaleString()}</p></div><div className="flex gap-1">{row.reply && <Button variant="ghost" size="icon" title="Download saved answer" aria-label="Download saved answer" onClick={() => download(row.reply ?? "")}><Download /></Button>}<Button variant="outline" size="sm" disabled={!!busy} onClick={() => {
    if (row.status === "succeeded" && row.conversation_id) {
      if (onRecovered) onRecovered(row.conversation_id); else setOpened(row.reply);
    } else restore(row.id);
  }}><RotateCcw />{busy === row.id ? "Recovering…" : row.status === "succeeded" ? "Open saved answer" : "Recover saved work"}</Button></div></div>)}</div>}{opened && <article className="prose-chat mt-5 min-w-0 break-words border-t border-border pt-5 text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{opened}</ReactMarkdown></article>}</section>;
}