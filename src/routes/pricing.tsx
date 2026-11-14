import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [
    { title: "Pricing — AI Growth OS" }, { name: "description", content: "Simple plans for businesses, agencies and enterprises. Start with a 14-day free trial." },
    { property: "og:title", content: "Pricing — AI Growth OS" }, { property: "og:description", content: "Simple plans for businesses, agencies and enterprises. Start with a 14-day free trial." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Pricing,
});

const LABEL: Record<string, string> = { workspaces: "workspaces", seats: "team seats", documents: "documents", integrations: "integrations", client_orgs: "client organizations" };

function Pricing() {
  const q = useQuery({ queryKey: ["public-plans"], queryFn: async () => {
    const [p, e] = await Promise.all([supabase.from("plans").select("*").order("tier"), supabase.from("plan_entitlements").select("*")]);
    return { plans: (p.data ?? []).filter((x) => x.key !== "trial"), ents: e.data ?? [] };
  } });
  return (
    <div className="min-h-screen bg-background">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold"><Zap className="h-5 w-5 text-primary" /> AI Growth OS</Link>
        <Link to="/auth" search={{ redirect: undefined }} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">Sign in</Link>
      </nav>
      <header className="mx-auto max-w-3xl px-6 pb-12 pt-12 text-center">
        <h1 className="text-4xl font-extrabold md:text-5xl">Pricing that grows with you</h1>
        <p className="mt-4 text-muted-foreground">Every plan starts with a 14-day free trial. No card required.</p><p className="mt-3 text-sm text-warning">Indicative prices — not yet approved for sale. Online checkout is unavailable.</p>
      </header>
      <div className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3 lg:grid-cols-5">
        {q.data?.plans.map((p) => (
          <div key={p.key} className={`flex min-w-0 flex-col rounded-lg border bg-card p-5 ${p.key === "professional" ? "border-primary/50" : "border-border"}`}>
            <div className="font-semibold">{p.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
            <div className="mt-4 font-display text-3xl font-bold">{p.price_monthly_eur === null ? "Custom" : `€${Number(p.price_monthly_eur)}`}<span className="text-sm font-normal text-muted-foreground">{p.price_monthly_eur !== null && "/mo"}</span></div>
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {p.monthly_credits > 0 && <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />{p.monthly_credits.toLocaleString()} AI credits / month</li>}
              {q.data.ents.filter((e) => e.plan_key === p.key && LABEL[e.feature_key]).map((e) => (
                <li key={e.feature_key} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />{e.limit_value === null ? "Unlimited" : e.limit_value} {LABEL[e.feature_key]}</li>
              ))}
            </ul>
            <Link to="/auth" search={{ redirect: undefined }} className="mt-6 rounded-md bg-secondary px-4 py-2 text-center text-sm font-medium hover:bg-primary hover:text-primary-foreground">Start free trial</Link>
          </div>
        ))}
      </div>
      <p className="pb-12 text-center text-xs text-muted-foreground">Prices exclude VAT. Online checkout is coming soon.</p>
    </div>
  );
}
