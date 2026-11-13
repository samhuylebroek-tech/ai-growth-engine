import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Upload, Wand2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { validateUpload, safeFileName } from "@/lib/security/upload";
import { extractDocumentFacts } from "@/lib/ai.functions";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/documents")({ component: Documents });

function Documents() {
  const o = useOrg(); const qc = useQueryClient(); const ws = o.workspace?.id; const orgId = o.org?.id;
  const extract = useServerFn(extractDocumentFacts); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["docs", ws], enabled: !!ws, queryFn: async () => (await supabase.from("documents").select("id,name,mime,size_bytes,status,created_at").eq("workspace_id", ws!).order("created_at", { ascending: false })).data ?? [] });
  const refresh = () => qc.invalidateQueries({ queryKey: ["docs", ws] });

  async function upload(files: FileList | null) {
    if (!files || !orgId || !ws) return;
    const { data: ent } = await supabase.rpc("org_entitlement", { _org: orgId, _feature: "documents" });
    for (const file of Array.from(files)) {
      const v = validateUpload(file.name, file.type, file.size);
      if (!v.ok) { toast.error(`${file.name}: ${v.reason}`); continue; }
      if (typeof ent === "number" && (q.data?.length ?? 0) >= ent) { toast.error(`Your plan allows ${ent} documents. Upgrade for more.`); break; }
      setBusy(file.name);
      const path = `${orgId}/${ws}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) { toast.error(`Upload failed: ${file.name}`); continue; }
      const { error } = await supabase.from("documents").insert({ org_id: orgId, workspace_id: ws, name: file.name.slice(0, 200), storage_path: path, mime: file.type || "application/octet-stream", size_bytes: file.size, uploaded_by: o.userId });
      if (error) { await supabase.storage.from("documents").remove([path]); toast.error("Could not save document"); }
    }
    setBusy(null); refresh();
  }
  async function runExtract(id: string) {
    setBusy(id); const r = await extract({ data: { documentId: id } }); setBusy(null); refresh();
    if (r.ok) toast.success(`Extracted ${r.data.facts} facts (${r.data.credits} credits). Review them in Business profile.`); else toast.error(r.error);
  }
  async function remove(id: string, path?: string) {
    const doc = q.data?.find((d) => d.id === id); if (!doc) return;
    const { data } = await supabase.from("documents").select("storage_path").eq("id", id).single();
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) { toast.error("Not allowed"); return; }
    if (data?.storage_path ?? path) await supabase.storage.from("documents").remove([data?.storage_path ?? path!]);
    refresh();
  }
  const canUpload = can(o.role, "documents.upload");
  return (
    <>
      <PageHeader title="Documents" description="Business plans, brand guidelines, pricing and strategy files. Stored privately for your organization only."
        actions={canUpload && <><input ref={input} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /><Button onClick={() => input.current?.click()} disabled={!!busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? "Working…" : "Upload"}</Button></>} />
      <p className="mb-4 text-xs text-muted-foreground">PDF, TXT, MD and CSV can be read by AI. Word and Excel files are stored but not yet read automatically. Max 20 MB.</p>
      {q.data?.length ? (
        <div className="divide-y divide-border rounded-xl border border-border">{q.data.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{(d.size_bytes / 1024).toFixed(0)} KB · {new Date(d.created_at).toLocaleDateString()}</div></div>
            <StatusChip status={d.status} />
            {canUpload && <Button size="sm" variant="outline" onClick={() => runExtract(d.id)} disabled={!!busy}><Wand2 className="mr-1 h-3.5 w-3.5" />{busy === d.id ? "Reading…" : "Extract facts"}</Button>}
            {can(o.role, "members.manage") && <Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}</div>
      ) : <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" text="Upload a business plan or brand guide so the Growth Officer can learn from it." />}
    </>
  );
}
