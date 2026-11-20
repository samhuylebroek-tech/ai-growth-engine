import { localHead } from "@/lib/page-head";
import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/documents")({ head: () => localHead("documents"), component: Documents });

function Documents() {
  const o = useOrg(); const { t: tx, tag } = useI18n(); const t = tx as (k: string, v?: Record<string, string | number>) => string; const qc = useQueryClient(); const ws = o.workspace?.id; const orgId = o.org?.id;
  const extract = useServerFn(extractDocumentFacts); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null); const [search, setSearch] = useState("");
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
      if (typeof ent === "number" && uploadedCount >= ent) { toast.error(t("pg.doc.planLimit", { n: ent })); break; }
      setBusy(file.name);
      const path = `${orgId}/${ws}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) { toast.error(t("pg.doc.uploadFailed", { n: file.name })); continue; }
      const { error } = await supabase.from("documents").insert({ org_id: orgId, workspace_id: ws, name: file.name.slice(0, 200), storage_path: path, mime: file.type || "application/octet-stream", size_bytes: file.size, uploaded_by: o.userId });
      if (error) { await supabase.storage.from("documents").remove([path]); toast.error(t("pg.doc.saveFailed")); } else uploadedCount++;
    }
    setBusy(null); refresh();
  }
  async function runExtract(id: string) {
    if (!orgId || !ws) return;
    setBusy(id);
    try { const r = await extract({ data: { documentId: id, orgId, workspaceId: ws } }); if (r.ok) toast.success(t("pg.doc.extracted", { f: r.data.facts, c: r.data.credits })); else toast.error(r.error); } catch { toast.error(t("pg.doc.extractFailed")); } finally { setBusy(null); refresh(); }
  }
  async function download(id: string) {
    const doc = q.data?.find(d => d.id === id); if (!doc) return;
    const result = await supabase.storage.from("documents").download(doc.storage_path);
    if (result.error || !result.data) { toast.error(t("pg.doc.downloadFailed")); return; }
    const url = URL.createObjectURL(result.data); const link = document.createElement("a"); link.href = url; link.download = doc.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(id: string) {
    const doc = q.data?.find((d) => d.id === id); if (!doc) return;
    if (!orgId || !ws || !window.confirm(t("pg.doc.confirmDelete", { n: doc.name }))) return;
    const { error } = await supabase.from("documents").delete().eq("id", id).eq("org_id", orgId).eq("workspace_id", ws);
    if (error) { toast.error(t("pg.doc.notAllowed")); return; }
    const removed = await supabase.storage.from("documents").remove([doc.storage_path]);
    if (removed.error) toast.error(t("pg.doc.cleanup"));
    refresh();
  }
  const canUpload = can(o.workspaceRole, "documents.upload");
  return (
    <>
      <PageHeader title={t("pg.doc.title")} description={t("pg.doc.intro")}
        actions={canUpload && <><input ref={input} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /><Button onClick={() => input.current?.click()} disabled={!!busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? t("pg.doc.working") : t("pg.doc.upload")}</Button></>} />
      <p className="mb-4 text-xs text-muted-foreground">{t("pg.doc.formats")}</p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><Input aria-label={t("pg.doc.search")} placeholder={t("pg.doc.searchPh")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" /><Button variant="link" size="sm" asChild><Link to="/app/profile">{t("pg.doc.review")}</Link></Button></div>
      {q.isLoading && <p role="status">{t("pg.doc.loading")}</p>}
      {q.isError && <p role="alert" className="text-destructive">{t("pg.doc.failed")} <Button variant="link" onClick={() => q.refetch()}>{t("pg.retry")}</Button></p>}
      {q.data?.length ? (
        <div className="divide-y divide-border rounded-lg border border-border">{q.data.filter(d => d.name.toLowerCase().includes(search.toLowerCase())).map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{(d.size_bytes / 1024).toFixed(0)} KB · {new Date(d.created_at).toLocaleDateString(tag)}</div></div>
            <StatusChip status={d.status} />
            <Button size="icon" variant="ghost" onClick={() => download(d.id)} aria-label={t("pg.doc.download", { n: d.name })} title={t("pg.doc.downloadTitle")}><Download className="h-4 w-4" /></Button>
            {canUpload && <Button size="sm" variant="outline" onClick={() => runExtract(d.id)} disabled={!!busy}><Wand2 className="mr-1 h-3.5 w-3.5" />{busy === d.id ? t("pg.doc.reading") : t("pg.doc.extract")}</Button>}
            {can(o.workspaceRole, "members.manage") && <Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label={t("pg.doc.delete")}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}</div>
      ) : !q.isLoading && !q.isError ? <EmptyState icon={<FileText className="h-5 w-5" />} title={t("pg.doc.emptyTitle")} text={t("pg.doc.emptyText")} action={canUpload && <Button variant="outline" onClick={() => input.current?.click()} disabled={!!busy}><Upload />{t("pg.doc.first")}</Button>} /> : null}
    </>
  );
}
