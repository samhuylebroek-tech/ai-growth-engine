import { readLocale, useI18n } from "@/lib/i18n";
import { translate } from "@/lib/i18n/messages";
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
import { GuidedOverview, SectionForm, UnderstandingSummary, useGuidedData } from "@/components/onboarding/guided";
import { SECTIONS, type SectionId } from "@/lib/onboarding/questions";

type Step = "basics" | SectionId | "summary";
const STEPS: readonly string[] = ["basics", ...SECTIONS, "summary"];
export const Route = createFileRoute("/_authenticated/app/onboarding")({
  validateSearch: (s: Record<string, unknown>): { section?: Step } => (typeof s["section"] === "string" && STEPS.includes(s["section"]) ? { section: s["section"] as Step } : {}),
  head: () => pageHead(translate(readLocale(), "account.discovery.headTitle"), translate(readLocale(), "account.discovery.headDescription")), component: Onboarding,
});

/**
 * First visit: website and basic details, then the guided questions. Afterwards the page opens on the overview of
 * steps; `?section=` opens one step or the summary. Keyed by business so drafts never cross businesses.
 */
function Onboarding() {
  const { t } = useI18n();
  const o = useOrg();
  const { section } = Route.useSearch();
  const data = useGuidedData();
  const scope = `${o.org?.id ?? ""}:${o.workspace?.id ?? ""}`;
  if (section === "basics") return <BasicsFlow key={scope} />;
  if (data.isPending) return <p role="status" className="mx-auto max-w-3xl py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{t("ob.loading")}</p>;
  if (data.isError || !data.data) return <p role="alert" className="mx-auto max-w-3xl py-10 text-sm text-destructive">{t("ob.readFailed")}</p>;
  // Only editors can save the basics, so everyone else opens the read-only overview instead of a form they cannot use.
  const startHere = !data.data.profile?.onboarding_completed_at && can(o.workspaceRole, "profile.confirm");
  if (!section) return startHere ? <BasicsFlow key={scope} /> : <GuidedOverview key={scope} data={data.data} />;
  if (section === "summary") return <UnderstandingSummary key={scope} data={data.data} />;
  return <SectionForm key={`${scope}:${section}`} section={section} data={data.data} />;
}
type ReviewFact = DiscoveryFact & { accepted: boolean };
const list = (text: string) => text.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 30);

function BasicsFlow() {
  const { t } = useI18n();
  const o = useOrg(); const navigate = useNavigate(); const qc = useQueryClient(); const discover = useServerFn(discoverBusiness);
  const [step, setStep] = useState<"website" | "review" | "goals">("website");
  const [website, setWebsite] = useState(""); const [facts, setFacts] = useState<ReviewFact[]>([]);
  const [suggestions, setSuggestions] = useState<Discovery["suggestions"]>([]);
  const [choices, setChoices] = useState<Record<number, "accepted" | "saved" | "rejected">>({});
  const [goals, setGoals] = useState(""); const [budget, setBudget] = useState("");
  const [first, setFirst] = useState({ title: "", metric: "", target: "", due: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sources, setSources] = useState<string[]>([]);
  const editable = can(o.workspaceRole, "profile.confirm");
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
      toast.success(t("account.discovery.complete", { credits: result.data.credits }));
    } catch { setError(t("account.discovery.failed")); }
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
    if (error) { toast.error(t("account.discovery.saveOpportunityFailed")); return; }
    setChoices(c => ({ ...c, [index]: "saved" })); toast.success(t("account.discovery.opportunitySaved"));
  }
  async function confirm() {
    if (!o.org || !o.workspace || busy || !editable) return;
    const accepted = facts.filter(f => f.accepted && f.value.trim());
    if (!accepted.length) { setError(t("account.discovery.confirmOne")); setStep("review"); return; }
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
      if (saveError) throw new Error(t("account.discovery.saveFailedAtomic"));
      if (first.title.trim()) {
        const target = Number(first.target);
        const existing = await supabase.from("growth_goals").select("id", { count: "exact", head: true }).eq("workspace_id", o.workspace.id).eq("priority", "primary").neq("status", "archived");
        const g = await supabase.from("growth_goals").insert({ org_id: o.org.id, workspace_id: o.workspace.id, title: first.title.trim().slice(0, 200), objective: "leads", metric: first.metric.trim().slice(0, 120) || "Result", target: Number.isFinite(target) && first.target !== "" ? target : null, due_date: first.due || null, priority: (existing.count ?? 0) === 0 ? "primary" : "secondary" });
        await qc.invalidateQueries();
        if (g.error) { toast.error(t("account.discovery.goalFailed")); navigate({ to: "/app/goals" }); return; }
        toast.success(t("account.discovery.profileGoalSaved")); navigate({ to: "/app/onboarding", search: { section: "customers" } }); return;
      }
      await qc.invalidateQueries(); toast.success(t("account.discovery.profileSaved")); navigate({ to: "/app/onboarding", search: { section: "customers" } });
    } catch (e) { setError(e instanceof Error ? e.message : t("account.discovery.saveFailed")); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-4xl">
    <div className="mb-8 flex items-center gap-3 text-xs text-muted-foreground"><span className={step === "website" ? "font-semibold text-primary" : ""}>{t("account.discovery.step1")}</span><ArrowRight className="h-3 w-3" /><span className={step === "review" ? "font-semibold text-primary" : ""}>{t("account.discovery.step2")}</span><ArrowRight className="h-3 w-3" /><span className={step === "goals" ? "font-semibold text-primary" : ""}>{t("account.discovery.step3")}</span></div>
    {!editable && <p role="alert" className="mb-6 text-destructive">{t("account.discovery.permission")}</p>}
    {error && <div role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    {step === "website" ? <div className="max-w-2xl py-8">
      <Globe2 className="mb-6 h-10 w-10 text-primary" /><h1 className="text-3xl font-semibold">{t("account.discovery.start")}</h1><p className="mt-3 max-w-lg text-muted-foreground">{t("account.discovery.intro")}</p>
      <form onSubmit={analyze} className="mt-8 space-y-3"><Label htmlFor="business-website">{t("account.discovery.website")}</Label><div className="flex flex-col gap-3 sm:flex-row"><Input id="business-website" inputMode="url" autoComplete="url" placeholder={t("account.discovery.url")} value={website} onChange={e => setWebsite(e.target.value)} required maxLength={500} className="min-h-12 flex-1" /><Button disabled={busy || !editable} className="min-h-12">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? t("account.discovery.busy") : t("account.discovery.discover")}</Button></div></form>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{t("account.discovery.public")}</span><Button variant="link" disabled={busy || !editable} onClick={manual}>{t("account.discovery.manual")}</Button></div>
      {busy && <div role="status" aria-live="polite" className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">{t("account.discovery.reading")}</div>}
    </div> : step === "review" ? <>
      <h1 className="text-3xl font-semibold">{t("account.discovery.confirmTitle")}</h1><p className="mt-3 text-muted-foreground">{t("account.discovery.reviewHint")}</p>
      <div className="mt-8 divide-y divide-border border-y border-border">{DISCOVERY_FIELDS.map(field => {
        const fact = facts.find(f => f.key === field.key);
        return <div key={field.key} className="grid gap-3 py-5 sm:grid-cols-[180px_1fr]">
          <Label htmlFor={`discovery-${field.key}`} className="pt-2 text-sm">{t(`account.field.${field.key}`)}</Label><div>
            <Textarea id={`discovery-${field.key}`} rows={field.key === "description" ? 3 : 2} maxLength={3000} value={fact?.value ?? ""} placeholder={t("account.discovery.notFound")} disabled={!editable} onChange={e => { if (fact) update(field.key, { value: e.target.value, accepted: false }); else setFacts(current => [...current, { key: field.key, value: e.target.value, accepted: false, source: "", confidence: 1, provenance: "assumption" }]); }} />
            {fact?.value && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusChip status={fact.accepted ? "approved" : "pending"}>{fact.accepted ? t("account.discovery.userConfirmed") : fact.source ? fact.provenance === "extracted" ? t("account.discovery.extracted") : t("account.assumption") : t("account.discovery.entry")}</StatusChip>{fact.source && <><span>{t("account.confidence", { count: Math.round(fact.confidence * 100) })}</span><a href={fact.source} target="_blank" rel="noopener noreferrer" className="underline">{t("account.source")}</a></>}</div><div className="flex gap-1"><Button size="sm" variant={fact.accepted ? "secondary" : "outline"} disabled={!editable} onClick={() => update(field.key, { accepted: !fact.accepted })}><Check />{fact.accepted ? t("account.confirmed") : t("account.confirm")}</Button><Button size="icon" variant="ghost" aria-label={t("account.discovery.reject", { field: t(`account.field.${field.key}`) })} onClick={() => update(field.key, { value: "", accepted: false })}><X /></Button></div></div>}
          </div>
        </div>;
      })}</div>
      {!!suggestions.length && <section className="mt-10"><h2 className="text-xl font-semibold">{t("account.discovery.opportunities")}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{suggestions.map((s, i) => <article key={i} className="rounded-lg border border-border bg-card p-4"><div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><span className="capitalize">{t(`account.category.${s.category}`)}</span><span>{t("account.discovery.hypothesis", { count: Math.round(s.confidence * 100) })}</span></div><h3 className="font-semibold">{s.title}</h3><Textarea className="mt-3" aria-label={t("account.discovery.edit", { title: s.title })} value={s.value} rows={3} onChange={e => setSuggestions(current => current.map((item, index) => index === i ? { ...item, value: e.target.value } : item))} /><div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => setChoices(c => ({ ...c, [i]: "accepted" }))} disabled={!!choices[i]}><Check />{choices[i] === "accepted" ? t("account.accepted") : t("account.accept")}</Button><Button size="sm" variant="ghost" onClick={() => saveSuggestion(i)} disabled={!!choices[i]}><Bookmark />{choices[i] === "saved" ? t("account.saved") : t("account.save")}</Button><Button size="icon" variant="ghost" aria-label={t("account.discovery.rejectOpportunity", { title: s.title })} onClick={() => setChoices(c => ({ ...c, [i]: "rejected" }))} disabled={!!choices[i]}><X /></Button>{choices[i] === "rejected" && <span className="self-center text-xs text-muted-foreground">{t("account.rejected")}</span>}</div></article>)}</div></section>}
      <div className="mt-8 flex justify-between gap-3"><Button variant="ghost" onClick={() => setStep("website")}>{t("account.back")}</Button><Button onClick={() => setStep("goals")} disabled={!facts.some(f => f.accepted && f.value.trim())}>{t("account.continue")} <ArrowRight /></Button></div>
    </> : <div className="max-w-2xl"><h1 className="text-3xl font-semibold">{t("account.discovery.direction")}</h1><div className="mt-8 space-y-6"><div className="space-y-2"><Label htmlFor="growth-objectives">{t("account.discovery.objectives")}</Label><Textarea id="growth-objectives" rows={4} value={goals} onChange={e => setGoals(e.target.value)} placeholder={t("account.discovery.priorities")} maxLength={3000} /></div><div className="space-y-2"><Label htmlFor="growth-budget">{t("account.discovery.budget")}</Label><Input id="growth-budget" type="number" min={0} max={100000000} value={budget} onChange={e => setBudget(e.target.value)} /></div><fieldset className="space-y-3 rounded-md border border-border p-4"><legend className="px-1 text-sm font-medium">{t("account.discovery.firstGoal")}</legend><div className="space-y-2"><Label htmlFor="first-goal">{t("account.goal")}</Label><Input id="first-goal" maxLength={200} placeholder={t("account.discovery.example")} value={first.title} onChange={e => setFirst(f => ({ ...f, title: e.target.value }))} /></div><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="first-metric">{t("account.discovery.measured")}</Label><Input id="first-metric" maxLength={120} placeholder={t("account.discovery.metric")} value={first.metric} onChange={e => setFirst(f => ({ ...f, metric: e.target.value }))} /></div><div className="space-y-2"><Label htmlFor="first-target">{t("account.target")}</Label><Input id="first-target" type="number" min={0} value={first.target} onChange={e => setFirst(f => ({ ...f, target: e.target.value }))} /></div><div className="space-y-2"><Label htmlFor="first-due">{t("account.by")}</Label><Input id="first-due" type="date" value={first.due} onChange={e => setFirst(f => ({ ...f, due: e.target.value }))} /></div></div></fieldset><div className="border-t border-border pt-5 text-sm text-muted-foreground">{t("account.discovery.summary", { details: facts.filter(f => f.accepted).length, opportunities: Object.values(choices).filter(c => c === "accepted").length })}</div></div><div className="mt-8 flex justify-between gap-3"><Button variant="ghost" onClick={() => setStep("review")} disabled={busy}><Pencil />{t("account.review")}</Button><Button onClick={confirm} disabled={busy || !editable}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{busy ? t("account.saving") : t("account.discovery.confirm")}</Button></div></div>}
  </div>;
}
