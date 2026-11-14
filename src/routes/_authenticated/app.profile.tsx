import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { PageHeader, Panel, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/profile")({ head: () => pageHead("Business profile", "Confirmed knowledge, sources and editable facts."), component: Profile });

const SOURCE_LABEL: Record<string, string> = { user: "You", document: "Document", website: "Website", ai_assumption: "AI assumption", external: "External research" };

function Profile() {
  const o = useOrg(); const qc = useQueryClient(); const ws = o.workspace?.id; const edit = can(o.role, "profile.edit");
  const [k, setK] = useState(""); const [v, setV] = useState("");
  const [editing, setEditing] = useState<string | null>(null); const [value, setValue] = useState("");
  const q = useQuery({
    queryKey: ["profile", ws], enabled: !!ws,
    queryFn: async () => {
      const [bp, facts] = await Promise.all([
        supabase.from("business_profiles").select("*").eq("workspace_id", ws!).maybeSingle(),
        supabase.from("business_facts").select("*").eq("workspace_id", ws!).order("created_at", { ascending: false }),
      ]);
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

  const bp = q.data?.bp; const list = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
  return (
    <>
      <PageHeader title="Business profile" description="What the Growth Officer knows about this business. You can correct anything."
        actions={edit && <Button variant="outline" asChild><Link to="/app/onboarding">Edit profile</Link></Button>} />
      {q.isLoading && <div role="status" className="py-12 text-sm text-muted-foreground">Loading business knowledge…</div>}
      {q.isError && <div role="alert" className="py-4 text-sm text-destructive">Business knowledge could not load.</div>}
      {bp && (
        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="md:col-span-2"><div className="text-xs text-muted-foreground">Description</div><p className="mt-1 text-sm">{bp.description || "—"}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><div className="text-xs text-muted-foreground">Industry</div>{bp.industry || "—"}</div><div><div className="text-xs text-muted-foreground">Business model</div>{bp.business_model || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Website</div><span className="break-all">{bp.website || "—"}</span></div><div><div className="text-xs text-muted-foreground">Monthly budget</div>{bp.monthly_budget_eur ? `€${bp.monthly_budget_eur}` : "—"}</div></div>
          </Panel>
          <Panel><div className="text-xs text-muted-foreground">Objectives</div><ul className="mt-1 space-y-1 text-sm">{list(bp.objectives).map((x) => <li key={x}>• {x}</li>)}</ul>{!list(bp.objectives).length && "—"}</Panel>
          {(["offerings", "audiences", "markets", "competitors"] as const).map((key) => (
            <Panel key={key}><div className="text-xs capitalize text-muted-foreground">{key}</div><div className="mt-2 flex flex-wrap gap-1.5">{list(bp[key]).map((x) => <span key={x} className="rounded-md bg-secondary px-2 py-0.5 text-xs">{x}</span>)}{!list(bp[key]).length && <span className="text-sm">—</span>}</div></Panel>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-10 font-semibold">Knowledge base</h2>
      <p className="mb-4 text-sm text-muted-foreground">Facts from you are trusted. Facts from documents, your website or AI are treated as claims until you verify them.</p>
      {edit && (
        <form onSubmit={addFact} className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Topic (e.g. Average order value)" value={k} onChange={(e) => setK(e.target.value)} required maxLength={120} className="max-w-xs" />
          <Input placeholder="Fact" value={v} onChange={(e) => setV(e.target.value)} required maxLength={1000} className="min-w-0 flex-1" />
          <Button type="submit">Add fact</Button>
        </form>
      )}
      {q.data?.facts.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Topic</th><th className="px-4 py-2">Fact</th><th className="px-4 py-2">Source</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-border">{q.data.facts.map((f) => (
              <tr key={f.id}><td className="px-4 py-2.5 font-medium">{f.key}</td><td className="px-4 py-2.5 text-muted-foreground">{editing === f.id ? <Textarea aria-label="Edit fact value" maxLength={3000} value={value} onChange={e => setValue(e.target.value)} /> : f.value}</td>
                <td className="px-4 py-2.5"><div className="flex flex-wrap items-center gap-1.5"><StatusChip status={f.verified ? "approved" : "pending"}>{f.verified ? "User-confirmed" : f.source_type === "ai_assumption" ? "AI assumption" : "Extracted"}</StatusChip><span className="text-xs text-muted-foreground">{SOURCE_LABEL[f.source_type]}{f.source_ref ? ` · ${f.source_ref}` : ""}{f.confidence !== null ? ` · ${Math.round(f.confidence * 100)}% confidence` : ""}</span></div></td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">{edit && <>{editing === f.id ? <><Button size="sm" variant="outline" onClick={() => saveFact(f.id)}>Save</Button><Button size="icon" variant="ghost" aria-label="Cancel editing" onClick={() => setEditing(null)}><X /></Button></> : <><Button size="icon" variant="ghost" onClick={() => { setEditing(f.id); setValue(f.value); }} aria-label="Edit fact" title="Edit fact"><Pencil /></Button>{!f.verified && <Button size="icon" variant="ghost" onClick={() => verify(f.id)} aria-label="Confirm fact" title="Confirm fact"><Check /></Button>}<Button size="icon" variant="ghost" onClick={() => remove(f.id)} aria-label="Delete" title="Delete fact"><Trash2 /></Button></>}</>}</td></tr>
            ))}</tbody></table>
        </div>
      ) : <EmptyState title="No facts yet" text="Add facts yourself, upload documents, or let us analyze your website during onboarding." />}
    </>
  );
}
