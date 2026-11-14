import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Upload, Wand2, Trash2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { validateUpload, safeFileName } from "@/lib/security/upload";
import { extractDocumentFacts } from "@/lib/ai.functions";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/documents")({ head: () => pageHead("Documents", "Private documents and evidence extraction."), component: Documents });

function Documents() {
  const o = useOrg(); const qc = useQueryClient(); const ws = o.workspace?.id; const orgId = o.org?.id;
  const extract = useServerFn(extractDocumentFacts); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["docs", orgId, ws], enabled: !!ws && !!orgId, queryFn: async () => {
    if (!ws || !orgId) return [];
    const result = await supabase.from("documents").select("id,name,mime,size_bytes,status,created_at,storage_path").eq("org_id", orgId).eq("workspace_id", ws).order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return result.data ?? [];
  } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["docs", orgId, ws] });

  async function upload(files: FileList | null) {
    if (!files || !orgId || !ws) return;
    const selectedFiles = Array.from(files);
    const { data: ent } = await supabase.rpc("org_entitlement", { _org: orgId, _feature: "documents" });
    let uploadedCount = q.data?.length ?? 0;
    for (const file of selectedFiles) {
      const v = validateUpload(file.name, file.type, file.size);
      if (!v.ok) { toast.error(`${file.name}: ${v.reason}`); continue; }
      if (typeof ent === "number" && uploadedCount >= ent) { toast.error(`Your plan allows ${ent} documents. Upgrade for more.`); break; }
      setBusy(file.name);
      const path = `${orgId}/${ws}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) { toast.error(`Upload failed: ${file.name}`); continue; }
      const { error } = await supabase.from("documents").insert({ org_id: orgId, workspace_id: ws, name: file.name.slice(0, 200), storage_path: path, mime: file.type || "application/octet-stream", size_bytes: file.size, uploaded_by: o.userId });
      if (error) { await supabase.storage.from("documents").remove([path]); toast.error("Could not save document"); } else uploadedCount++;
    }
    setBusy(null); refresh();
  }
  async function runExtract(id: string) {
    if (!orgId || !ws) return;
    setBusy(id);
    try { const r = await extract({ data: { documentId: id, orgId, workspaceId: ws } }); if (r.ok) toast.success(`Extracted ${r.data.facts} facts (${r.data.credits} credits). Review them in Business profile.`); else toast.error(r.error); } catch { toast.error("Document reading could not finish."); } finally { setBusy(null); refresh(); }
  }
  async function download(id: string) {
    const doc = q.data?.find(d => d.id === id); if (!doc) return;
    const result = await supabase.storage.from("documents").download(doc.storage_path);
    if (result.error || !result.data) { toast.error("Could not download document."); return; }
    const url = URL.createObjectURL(result.data); const link = document.createElement("a"); link.href = url; link.download = doc.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(id: string) {
    const doc = q.data?.find((d) => d.id === id); if (!doc) return;
    if (!orgId || !ws || !window.confirm(`Delete ${doc.name}?`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", id).eq("org_id", orgId).eq("workspace_id", ws);
    if (error) { toast.error("Not allowed"); return; }
    const removed = await supabase.storage.from("documents").remove([doc.storage_path]);
    if (removed.error) toast.error("Document removed from the list; stored file cleanup could not finish.");
    refresh();
  }
  const canUpload = can(o.role, "documents.upload");
  return (
    <>
      <PageHeader title="Documents" description="Business plans, brand guidelines, pricing and strategy files. Stored privately for your organization only."
        actions={canUpload && <><input ref={input} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /><Button onClick={() => input.current?.click()} disabled={!!busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? "Working…" : "Upload"}</Button></>} />
      <p className="mb-4 text-xs text-muted-foreground">PDF, DOCX, XLSX, CSV, TXT & MD · Max 20 MB · Private storage</p>
      {q.isLoading && <p role="status">Loading documents…</p>}
      {q.isError && <p role="alert" className="text-destructive">Documents could not load. <Button variant="link" onClick={() => q.refetch()}>Retry</Button></p>}
      {q.data?.length ? (
        <div className="divide-y divide-border rounded-lg border border-border">{q.data.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{(d.size_bytes / 1024).toFixed(0)} KB · {new Date(d.created_at).toLocaleDateString()}</div></div>
            <StatusChip status={d.status} />
            <Button size="icon" variant="ghost" onClick={() => download(d.id)} aria-label={`Download ${d.name}`} title="Download document"><Download className="h-4 w-4" /></Button>
            {canUpload && <Button size="sm" variant="outline" onClick={() => runExtract(d.id)} disabled={!!busy}><Wand2 className="mr-1 h-3.5 w-3.5" />{busy === d.id ? "Reading…" : "Extract facts"}</Button>}
            {can(o.role, "members.manage") && <Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}</div>
      ) : !q.isLoading && !q.isError ? <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" text="Upload a business plan or brand guide so the Growth Officer can learn from it." /> : null}
    </>
  );
}
