import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Globe2, Loader2, Pencil, Sparkles, X, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { discoverBusiness } from "@/lib/ai.functions";
import { DISCOVERY_FIELDS, type Discovery, type DiscoveryFact } from "@/lib/discovery";
import { pageHead } from "@/lib/page-head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/app/status";

export const Route = createFileRoute("/_authenticated/app/onboarding")({
  head: () => pageHead("Business discovery", "Discover, review and confirm your business profile with website-sourced findings."), component: Onboarding,
});
type ReviewFact = DiscoveryFact & { accepted: boolean };
const list = (text: string) => text.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 30);

function Onboarding() {
  const o = useOrg(); const navigate = useNavigate(); const qc = useQueryClient(); const discover = useServerFn(discoverBusiness);
  const [step, setStep] = useState<"website" | "review" | "goals">("website");
  const [website, setWebsite] = useState(""); const [facts, setFacts] = useState<ReviewFact[]>([]);
  const [suggestions, setSuggestions] = useState<Discovery["suggestions"]>([]);
  const [choices, setChoices] = useState<Record<number, "accepted" | "saved" | "rejected">>({});
  const [goals, setGoals] = useState(""); const [budget, setBudget] = useState("");
  const [first, setFirst] = useState({ title: "", metric: "", target: "", due: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sources, setSources] = useState<string[]>([]);
  const editable = can(o.workspaceRole, "profile.edit");
  useEffect(() => {
    if (!o.workspace) return;
    let active = true;
    supabase.from("business_profiles").select("*").eq("workspace_id", o.workspace.id).maybeSingle().then(({ data }) => {
      if (!active || !data) return;
      setWebsite(data.website ?? ""); setGoals(Array.isArray(data.objectives) ? data.objectives.join("\n") : ""); setBudget(data.monthly_budget_eur?.toString() ?? "");
      setFacts(DISCOVERY_FIELDS.flatMap(field => {
        const value = field.key in data ? data[field.key as keyof typeof data] : "";
        const text = Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : "";
        return text ? [{ key: field.key, value: text, confidence: 1, source: "", provenance: "extracted" as const, accepted: true }] : [];
      }));
    });
    return () => { active = false; };
  }, [o.workspace?.id]);

  async function analyze(e: React.FormEvent) {
    e.preventDefault(); if (!o.workspace || busy || !editable) return;
    setBusy(true); setError("");
    try {
      const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
      const result = await discover({ data: { workspaceId: o.workspace.id, url } });
      if (!result.ok) { setError(result.error); return; }
      setWebsite(url); setFacts(result.data.facts.map(f => ({ ...f, accepted: false })));
      setSuggestions(result.data.suggestions); setSources(result.data.sources); setChoices({}); setStep("review");
      toast.success(`Discovery complete · ${result.data.credits} credits`);
    } catch { setError("Discovery could not finish. Your website is saved here; you can enter details instead."); }
    finally { setBusy(false); }
  }
  function manual() {
    if (!facts.length) setFacts(DISCOVERY_FIELDS.map(f => ({ key: f.key, value: "", confidence: 1, source: "", provenance: "assumption", accepted: false })));
    setStep("review");
  }
  function update(key: DiscoveryFact["key"], patch: Partial<ReviewFact>) {
    setFacts(current => current.map(f => f.key === key ? { ...f, ...patch } : f));
  }
  async function saveSuggestion(index: number) {
    const suggestion = suggestions[index]; if (!suggestion || !o.org || !o.workspace || choices[index] === "saved") return;
    const { error } = await supabase.from("business_facts").insert({ org_id: o.org.id, workspace_id: o.workspace.id, key: `Opportunity: ${suggestion.title}`, value: suggestion.value, source_type: "ai_assumption", source_ref: suggestion.source || website, confidence: suggestion.confidence, verified: false });
    if (error) { toast.error("Could not save this opportunity."); return; }
    setChoices(c => ({ ...c, [index]: "saved" })); toast.success("Saved as an unconfirmed opportunity");
  }
  async function confirm() {
    if (!o.org || !o.workspace || busy || !editable) return;
    const accepted = facts.filter(f => f.accepted && f.value.trim());
    if (!accepted.length) { setError("Confirm at least one business detail before continuing."); setStep("review"); return; }
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(accepted.map(f => [f.key, f.value]));
      const profile = {
        website: website || null,
        description: values["description"] || null, industry: values["industry"] || null, business_model: values["business_model"] || null,
        offerings: list(values["offerings"] ?? ""), audiences: list(values["audiences"] ?? ""), markets: list(values["markets"] ?? ""), competitors: list(values["competitors"] ?? ""),
        objectives: list(goals), monthly_budget_eur: budget ? Number(budget) : null, 
      };
      const rows = accepted.map(f => ({ org_id: o.org?.id ?? "", workspace_id: o.workspace?.id ?? "", key: DISCOVERY_FIELDS.find(x => x.key === f.key)?.label ?? f.key, value: f.value, verified: true, source_type: f.source ? (f.provenance === "assumption" ? "ai_assumption" as const : "website" as const) : "user" as const, source_ref: f.source || "Customer confirmation", confidence: f.confidence }));
      const acceptedSuggestions = suggestions.filter((_, i) => choices[i] === "accepted").map(s => ({ org_id: o.org?.id ?? "", workspace_id: o.workspace?.id ?? "", key: `Opportunity: ${s.title}`, value: s.value, verified: false, source_type: "ai_assumption" as const, source_ref: s.source || website, confidence: s.confidence }));
      const { error: saveError } = await supabase.rpc("confirm_business_profile", { _workspace: o.workspace.id, _profile: profile, _facts: [...rows, ...acceptedSuggestions] });
      if (saveError) throw new Error("Could not save the business profile. No partial changes were made.");
      if (first.title.trim()) {
        const t = Number(first.target);
        const existing = await supabase.from("growth_goals").select("id", { count: "exact", head: true }).eq("workspace_id", o.workspace.id).eq("priority", "primary").neq("status", "archived");
        const g = await supabase.from("growth_goals").insert({ org_id: o.org.id, workspace_id: o.workspace.id, title: first.title.trim().slice(0, 200), objective: "leads", metric: first.metric.trim().slice(0, 120) || "Result", target: Number.isFinite(t) && first.target !== "" ? t : null, due_date: first.due || null, priority: (existing.count ?? 0) === 0 ? "primary" : "secondary" });
        await qc.invalidateQueries();
        if (g.error) { toast.error("Profile saved, but the first goal could not be added. Add it on the Goals page."); navigate({ to: "/app/goals" }); return; }
        toast.success("Profile confirmed and first goal set"); navigate({ to: "/app/goals" }); return;
      }
      await qc.invalidateQueries(); toast.success("Business profile confirmed"); navigate({ to: "/app" });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your business profile."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-4xl">
    <div className="mb-8 flex items-center gap-3 text-xs text-muted-foreground"><span className={step === "website" ? "font-semibold text-primary" : ""}>01 Your business</span><ArrowRight className="h-3 w-3" /><span className={step === "review" ? "font-semibold text-primary" : ""}>02 Confirm facts</span><ArrowRight className="h-3 w-3" /><span className={step === "goals" ? "font-semibold text-primary" : ""}>03 Growth direction</span></div>
    {!editable && <p role="alert" className="mb-6 text-destructive">Member access is required to edit the business profile.</p>}
    {error && <div role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    {step === "website" ? <div className="max-w-2xl py-8">
      <Globe2 className="mb-6 h-10 w-10 text-primary" /><h1 className="text-3xl font-semibold">Start with your website.</h1><p className="mt-3 max-w-lg text-muted-foreground">Build the foundation for your first growth analysis.</p>
      <form onSubmit={analyze} className="mt-8 space-y-3"><Label htmlFor="business-website">Business website</Label><div className="flex flex-col gap-3 sm:flex-row"><Input id="business-website" inputMode="url" autoComplete="url" placeholder="https://yourbusiness.com" value={website} onChange={e => setWebsite(e.target.value)} required maxLength={500} className="min-h-12 flex-1" /><Button disabled={busy || !editable} className="min-h-12">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? "Discovering…" : "Discover my business"}</Button></div></form>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Public pages only · AI credits apply</span><Button variant="link" disabled={busy || !editable} onClick={manual}>Enter details instead</Button></div>
      {busy && <div role="status" aria-live="polite" className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">Reading public pages and preparing findings…</div>}
    </div> : step === "review" ? <>
      <h1 className="text-3xl font-semibold">Confirm your business foundation.</h1><p className="mt-3 text-muted-foreground">Review the findings. Only details you confirm become approved context.</p>
      <div className="mt-8 divide-y divide-border border-y border-border">{DISCOVERY_FIELDS.map(field => {
        const fact = facts.find(f => f.key === field.key);
        return <div key={field.key} className="grid gap-3 py-5 sm:grid-cols-[180px_1fr]">
          <Label htmlFor={`discovery-${field.key}`} className="pt-2 text-sm">{field.label}</Label><div>
            <Textarea id={`discovery-${field.key}`} rows={field.key === "description" ? 3 : 2} maxLength={3000} value={fact?.value ?? ""} placeholder="Not found — add a detail" disabled={!editable} onChange={e => { if (fact) update(field.key, { value: e.target.value, accepted: false }); else setFacts(current => [...current, { key: field.key, value: e.target.value, accepted: false, source: "", confidence: 1, provenance: "assumption" }]); }} />
            {fact?.value && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusChip status={fact.accepted ? "approved" : "pending"}>{fact.accepted ? "User-confirmed" : fact.source ? fact.provenance === "extracted" ? "Extracted" : "AI assumption" : "Your entry"}</StatusChip>{fact.source && <><span>{Math.round(fact.confidence * 100)}% confidence</span><a href={fact.source} target="_blank" rel="noopener noreferrer" className="underline">Source</a></>}</div><div className="flex gap-1"><Button size="sm" variant={fact.accepted ? "secondary" : "outline"} disabled={!editable} onClick={() => update(field.key, { accepted: !fact.accepted })}><Check />{fact.accepted ? "Confirmed" : "Confirm"}</Button><Button size="icon" variant="ghost" aria-label={`Reject ${field.label}`} onClick={() => update(field.key, { value: "", accepted: false })}><X /></Button></div></div>}
          </div>
        </div>;
      })}</div>
      {!!suggestions.length && <section className="mt-10"><h2 className="text-xl font-semibold">Potential growth opportunities</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{suggestions.map((s, i) => <article key={i} className="rounded-lg border border-border bg-card p-4"><div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><span className="capitalize">{s.category}</span><span>AI hypothesis · {Math.round(s.confidence * 100)}%</span></div><h3 className="font-semibold">{s.title}</h3><Textarea className="mt-3" aria-label={`Edit ${s.title}`} value={s.value} rows={3} onChange={e => setSuggestions(current => current.map((item, index) => index === i ? { ...item, value: e.target.value } : item))} /><div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => setChoices(c => ({ ...c, [i]: "accepted" }))} disabled={!!choices[i]}><Check />{choices[i] === "accepted" ? "Accepted" : "Accept"}</Button><Button size="sm" variant="ghost" onClick={() => saveSuggestion(i)} disabled={!!choices[i]}><Bookmark />{choices[i] === "saved" ? "Saved" : "Save"}</Button><Button size="icon" variant="ghost" aria-label={`Reject opportunity ${s.title}`} onClick={() => setChoices(c => ({ ...c, [i]: "rejected" }))} disabled={!!choices[i]}><X /></Button>{choices[i] === "rejected" && <span className="self-center text-xs text-muted-foreground">Rejected</span>}</div></article>)}</div></section>}
      <div className="mt-8 flex justify-between gap-3"><Button variant="ghost" onClick={() => setStep("website")}>Back</Button><Button onClick={() => setStep("goals")} disabled={!facts.some(f => f.accepted && f.value.trim())}>Continue <ArrowRight /></Button></div>
    </> : <div className="max-w-2xl"><h1 className="text-3xl font-semibold">Choose your growth direction.</h1><div className="mt-8 space-y-6"><div className="space-y-2"><Label htmlFor="growth-objectives">Business objectives</Label><Textarea id="growth-objectives" rows={4} value={goals} onChange={e => setGoals(e.target.value)} placeholder="Your priorities, one per line" maxLength={3000} /></div><div className="space-y-2"><Label htmlFor="growth-budget">Monthly growth budget (EUR, optional)</Label><Input id="growth-budget" type="number" min={0} max={100000000} value={budget} onChange={e => setBudget(e.target.value)} /></div><fieldset className="space-y-3 rounded-md border border-border p-4"><legend className="px-1 text-sm font-medium">First measurable goal (optional)</legend><div className="space-y-2"><Label htmlFor="first-goal">Goal</Label><Input id="first-goal" maxLength={200} placeholder="e.g. More catering enquiries" value={first.title} onChange={e => setFirst(f => ({ ...f, title: e.target.value }))} /></div><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="first-metric">Measured as</Label><Input id="first-metric" maxLength={120} placeholder="Enquiries per month" value={first.metric} onChange={e => setFirst(f => ({ ...f, metric: e.target.value }))} /></div><div className="space-y-2"><Label htmlFor="first-target">Target</Label><Input id="first-target" type="number" min={0} value={first.target} onChange={e => setFirst(f => ({ ...f, target: e.target.value }))} /></div><div className="space-y-2"><Label htmlFor="first-due">By</Label><Input id="first-due" type="date" value={first.due} onChange={e => setFirst(f => ({ ...f, due: e.target.value }))} /></div></div></fieldset><div className="border-t border-border pt-5 text-sm text-muted-foreground">{facts.filter(f => f.accepted).length} details confirmed · {Object.values(choices).filter(c => c === "accepted").length} opportunities selected</div></div><div className="mt-8 flex justify-between gap-3"><Button variant="ghost" onClick={() => setStep("review")} disabled={busy}><Pencil />Review</Button><Button onClick={confirm} disabled={busy || !editable}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{busy ? "Saving…" : "Confirm business profile"}</Button></div></div>}
  </div>;
}
