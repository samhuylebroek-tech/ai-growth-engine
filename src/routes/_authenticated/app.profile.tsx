import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/profile")({ head: () => pageHead("Business profile", "Confirmed knowledge, sources and editable facts."), component: Profile });

const SOURCE_LABEL: Record<string, string> = { user: "You", document: "Document", website: "Website", ai_assumption: "AI assumption", external: "External research" };

function Profile() {
  const o = useOrg(); const qc = useQueryClient(); const ws = o.workspace?.id; const edit = can(o.workspaceRole, "profile.edit");
  const [k, setK] = useState(""); const [v, setV] = useState("");
  const [filter, setFilter] = useState("all"); const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null); const [value, setValue] = useState("");
  const q = useQuery({
    queryKey: ["profile", ws], enabled: !!ws,
    queryFn: async () => {
      const [bp, facts] = await Promise.all([
        supabase.from("business_profiles").select("*").eq("workspace_id", ws ?? "").maybeSingle(),
        supabase.from("business_facts").select("*").eq("workspace_id", ws ?? "").order("created_at", { ascending: false }),
      ]);
      if (bp.error) throw bp.error; if (facts.error) throw facts.error;
      return { bp: bp.data, facts: facts.data ?? [] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", ws] });

  async function addFact(e: React.FormEvent) {
    e.preventDefault(); if (!o.org || !ws) return;
    const { error } = await supabase.from("business_facts").insert({ org_id: o.org.id, workspace_id: ws, key: k.trim(), value: v.trim(), source_type: "user", verified: true });
    if (error) toast.error("Could not add fact"); else { setK(""); setV(""); refresh(); }
  }
  async function verify(id: string) { const { error } = await supabase.from("business_facts").update({ verified: true }).eq("id", id); if (error) toast.error("Not allowed"); refresh(); }
  async function remove(id: string) { const { error } = await supabase.from("business_facts").delete().eq("id", id); if (error) toast.error("Not allowed"); refresh(); }
  async function saveFact(id: string) {
    if (!value.trim()) return;
    const { error } = await supabase.from("business_facts").update({ value: value.trim(), verified: false }).eq("id", id);
    if (error) toast.error("Could not save fact"); else { setEditing(null); refresh(); }
  }

  const visibleFacts = q.data?.facts.filter(f => (filter === "all" || (filter === "confirmed" ? f.verified : !f.verified)) && `${f.key} ${f.value}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const bp = q.data?.bp; const list = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
  return (
    <>
      <PageHeader title="Business knowledge" description={o.workspace?.name ?? "Workspace"}
        actions={edit && <Button variant="outline" asChild><Link to="/app/onboarding">Edit profile</Link></Button>} />
      {q.isLoading && <div role="status" className="py-12 text-sm text-muted-foreground">Loading business knowledge…</div>}
      {q.isError && <div role="alert" className="py-4 text-sm text-destructive">Business knowledge could not load.</div>}
      {bp && (
        <div><p className="mb-4 text-xs text-muted-foreground">Profile entries · confirm the sourced facts below before using them as trusted AI context.</p><div className="grid gap-x-8 gap-y-6 border-y border-border py-6 md:grid-cols-3">
          <div className="md:col-span-2"><div className="text-xs text-muted-foreground">Description</div><p className="mt-1 text-sm">{bp.description || "—"}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><div className="text-xs text-muted-foreground">Industry</div>{bp.industry || "—"}</div><div><div className="text-xs text-muted-foreground">Business model</div>{bp.business_model || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Website</div><span className="break-all">{bp.website || "—"}</span></div><div><div className="text-xs text-muted-foreground">Monthly budget</div>{bp.monthly_budget_eur ? `€${bp.monthly_budget_eur}` : "—"}</div></div>
          </div>
          <div><div className="text-xs text-muted-foreground">Objectives</div><ul className="mt-1 space-y-1 text-sm">{list(bp.objectives).map((x) => <li key={x}>• {x}</li>)}</ul>{!list(bp.objectives).length && "Not set"}</div>
          {(["offerings", "audiences", "markets", "competitors"] as const).map((key) => (
            <div key={key}><div className="text-xs capitalize text-muted-foreground">{key}</div><div className="mt-2 flex flex-wrap gap-1.5">{list(bp[key]).map((x) => <span key={x} className="rounded-md bg-secondary px-2 py-0.5 text-xs">{x}</span>)}{!list(bp[key]).length && <span className="text-sm">—</span>}</div></div>
          ))}
        </div></div>
      )}
      <h2 className="mb-3 mt-10 font-semibold">Knowledge base</h2>
      <p className="mb-4 text-sm text-muted-foreground">Facts from you are trusted. Facts from documents, your website or AI are treated as claims until you verify them.</p>
      <div className="mb-5 flex flex-wrap gap-3"><Input aria-label="Search business facts" placeholder="Search knowledge…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" /><select aria-label="Knowledge status" className="rounded-md border border-border bg-card px-3 text-xs" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All knowledge</option><option value="confirmed">Confirmed</option><option value="review">Needs review</option></select></div>
      {edit && (
        <form onSubmit={addFact} className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Topic (e.g. Average order value)" value={k} onChange={(e) => setK(e.target.value)} required maxLength={120} className="max-w-xs" />
          <Input placeholder="Fact" value={v} onChange={(e) => setV(e.target.value)} required maxLength={1000} className="min-w-0 flex-1" />
          <Button type="submit">Add fact</Button>
        </form>
      )}
      {visibleFacts.length ? <div className="divide-y divide-border border-y border-border">{visibleFacts.map(f => <article key={f.id} className="grid gap-3 py-5 md:grid-cols-[180px_minmax(0,1fr)_auto]"><div><h3 className="text-sm font-semibold">{f.key}</h3><div className="mt-2"><StatusChip status={f.verified ? "approved" : "pending"}>{f.verified ? "Confirmed" : f.source_type === "ai_assumption" ? "AI hypothesis" : "Needs review"}</StatusChip></div></div><div className="min-w-0">{editing === f.id ? <Textarea aria-label="Edit fact value" maxLength={3000} value={value} onChange={e => setValue(e.target.value)} /> : <p className="break-words text-sm leading-relaxed">{f.value}</p>}<p className="mt-2 break-all text-[10px] text-muted-foreground">{SOURCE_LABEL[f.source_type]}{f.source_ref ? ` · ${f.source_ref}` : ""}{f.confidence !== null ? ` · ${Math.round(f.confidence * 100)}% confidence` : ""}</p></div>{edit && <div className="flex items-start gap-1">{editing === f.id ? <><Button size="sm" variant="outline" onClick={() => saveFact(f.id)}>Save</Button><Button size="icon" variant="ghost" aria-label="Cancel editing" onClick={() => setEditing(null)}><X /></Button></> : <><Button size="icon" variant="ghost" onClick={() => { setEditing(f.id); setValue(f.value); }} aria-label="Edit fact" title="Edit fact"><Pencil /></Button>{!f.verified && <Button size="icon" variant="ghost" onClick={() => verify(f.id)} aria-label="Confirm fact" title="Confirm fact"><Check /></Button>}<Button size="icon" variant="ghost" onClick={() => remove(f.id)} aria-label="Delete" title="Delete fact"><Trash2 /></Button></>}</div>}</article>)}</div> : !q.isLoading && !q.isError ? <EmptyState title={q.data?.facts.length ? "No matching facts" : "Build a reliable business foundation"} text={q.data?.facts.length ? "No knowledge matches these filters." : "Add a business fact, research your website or upload a document."} action={<Button variant="outline" asChild><Link to="/app/onboarding">Discover your business</Link></Button>} /> : null}

    </>
  );
}
