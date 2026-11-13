import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { analyzeWebsite } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/app/onboarding")({ component: Onboarding });

const INDUSTRIES = ["Software & SaaS", "E-commerce & retail", "Professional services", "Agency", "Healthcare", "Education", "Manufacturing", "Hospitality & travel", "Real estate", "Finance", "Non-profit", "Other"];
const MODELS = ["B2B", "B2C", "B2B2C", "Marketplace", "Subscription", "Services / projects", "Other"];

const toList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 30);

function Onboarding() {
  const o = useOrg(); const navigate = useNavigate(); const analyze = useServerFn(analyzeWebsite);
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ website: "", description: "", industry: "", business_model: "", offerings: "", audiences: "", markets: "", competitors: "", objectives: "", budget: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    if (!o.workspace) return;
    supabase.from("business_profiles").select("*").eq("workspace_id", o.workspace.id).maybeSingle().then(({ data }) => {
      if (!data) return;
      const j = (v: unknown) => (Array.isArray(v) ? (v as string[]).join("\n") : "");
      setF({ website: data.website ?? "", description: data.description ?? "", industry: data.industry ?? "", business_model: data.business_model ?? "", offerings: j(data.offerings), audiences: j(data.audiences), markets: j(data.markets), competitors: j(data.competitors), objectives: j(data.objectives), budget: data.monthly_budget_eur?.toString() ?? "" });
    });
  }, [o.workspace]);

  const steps = [
    { title: "Your business", body: (
      <>
        <Field label="Website"><Input value={f.website} onChange={set("website")} placeholder="https://example.com" type="url" /></Field>
        <Field label="What does your business do?"><Textarea rows={4} value={f.description} onChange={set("description")} maxLength={3000} placeholder="In a few sentences…" /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Industry"><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={f.industry} onChange={set("industry")}><option value="">Choose…</option>{INDUSTRIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Business model"><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={f.business_model} onChange={set("business_model")}><option value="">Choose…</option>{MODELS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
      </>) },
    { title: "Customers and offer", body: (
      <>
        <Field label="Products or services (one per line)"><Textarea rows={4} value={f.offerings} onChange={set("offerings")} /></Field>
        <Field label="Target audiences (one per line)"><Textarea rows={3} value={f.audiences} onChange={set("audiences")} /></Field>
        <Field label="Markets / countries (one per line)"><Textarea rows={2} value={f.markets} onChange={set("markets")} /></Field>
      </>) },
    { title: "Goals", body: (
      <>
        <Field label="Main competitors (one per line)"><Textarea rows={3} value={f.competitors} onChange={set("competitors")} /></Field>
        <Field label="What do you want to achieve? (one per line)"><Textarea rows={3} value={f.objectives} onChange={set("objectives")} placeholder="Increase revenue by 20% this year" /></Field>
        <Field label="Monthly growth budget (EUR, optional)"><Input type="number" min={0} value={f.budget} onChange={set("budget")} /></Field>
      </>) },
  ];

  async function save(finish: boolean) {
    if (!o.workspace || !o.org) return;
    setBusy(true);
    const { error } = await supabase.from("business_profiles").upsert({
      workspace_id: o.workspace.id, org_id: o.org.id, website: f.website || null, description: f.description || null, industry: f.industry || null, business_model: f.business_model || null,
      offerings: toList(f.offerings), audiences: toList(f.audiences), markets: toList(f.markets), competitors: toList(f.competitors), objectives: toList(f.objectives),
      monthly_budget_eur: f.budget ? Number(f.budget) : null, ...(finish ? { onboarding_completed_at: new Date().toISOString() } : {}),
    });
    if (error) { setBusy(false); toast.error("Could not save. Do you have editing rights?"); return; }
    if (finish && f.website) {
      toast.info("Analyzing your website…");
      const r = await analyze({ data: { workspaceId: o.workspace.id, url: f.website } });
      if (r.ok) toast.success(`Found ${r.data.facts} facts on your website`); else toast.error(`Website analysis: ${r.error}`);
    }
    setBusy(false);
    if (finish) navigate({ to: "/app" }); else setStep((s) => s + 1);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-xs font-medium uppercase tracking-wider text-primary">Step 2 of 2 · {steps[step]?.title}</div>
      <h1 className="mt-2 text-2xl font-bold">Tell us about your business</h1>
      <Progress value={((step + 1) / steps.length) * 100} className="mt-4 h-1" />
      <div className="mt-8 space-y-5">{steps[step]?.body}</div>
      <div className="mt-8 flex justify-between">
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
        {step < steps.length - 1 ? <Button onClick={() => save(false)} disabled={busy}>Next</Button> : <Button onClick={() => save(true)} disabled={busy}>{busy ? "Saving…" : "Finish"}</Button>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
