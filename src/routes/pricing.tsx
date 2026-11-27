import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { LanguagePicker } from "@/components/app/language-picker";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [...localHead("pricing").meta] }),
  component: Pricing,
});

const FEATURES = ["workspaces", "seats", "documents", "integrations", "client_orgs"] as const;
const isFeature = (k: string): k is (typeof FEATURES)[number] =>
  (FEATURES as readonly string[]).includes(k);

function Pricing() {
  const { t: tx, tag } = useI18n();
  const q = useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const [p, e] = await Promise.all([
        supabase.from("plans").select("*").order("tier"),
        supabase.from("plan_entitlements").select("*"),
      ]);
      if (p.error) throw p.error;
      if (e.error) throw e.error;
      return { plans: (p.data ?? []).filter((x) => x.key !== "trial"), ents: e.data ?? [] };
    },
  });
  return (
    <div className="min-h-screen bg-background">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-5 py-6">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 font-display text-sm font-bold sm:text-lg"
        >
          <Zap className="h-5 w-5 text-primary" /> AI Growth Engine
        </Link>
        <div className="flex items-center gap-2">
          <LanguagePicker />
          <Button variant="outline" size="sm" asChild>
            <Link to="/auth" search={{ redirect: undefined }}>
              {tx("pages.pub.signIn")}
            </Link>
          </Button>
        </div>
      </nav>
      <header className="mx-auto max-w-3xl px-6 pb-12 pt-12 text-center">
        <h1 className="text-4xl font-extrabold md:text-5xl">{tx("pages.pr.title")}</h1>
        <p className="mt-4 text-muted-foreground">{tx("pages.pr.sub")}</p>
        <p className="mt-3 text-sm text-warning">{tx("pages.pr.indicative")}</p>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{tx("site.pricing.d")}</p>
      </header>
      {q.isPending && (
        <p role="status" className="mx-auto max-w-6xl px-6 pb-10 text-sm text-muted-foreground">
          {tx("site.plans.loading")}
        </p>
      )}
      {q.isError && (
        <div role="alert" className="mx-auto max-w-6xl px-6 pb-10">
          <p className="text-sm text-destructive">{tx("site.plans.failed")}</p>
          <Button variant="outline" className="mt-3" onClick={() => q.refetch()}>
            {tx("work.retry")}
          </Button>
        </div>
      )}
      {!q.isPending && !q.isError && !q.data?.plans.length && (
        <p role="status" className="mx-auto max-w-6xl px-6 pb-10 text-sm text-muted-foreground">
          {tx("site.plans.empty")}
        </p>
      )}
      <div className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3 lg:grid-cols-5">
        {q.data?.plans.map((p) => (
          <div
            key={p.key}
            className={`flex min-w-0 flex-col rounded-lg border bg-card p-5 ${p.key === "professional" ? "border-primary/50" : "border-border"}`}
          >
            <div className="font-semibold">{p.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
            <div className="mt-4 font-display text-3xl font-bold">
              {p.price_monthly_eur === null
                ? tx("pages.pr.custom")
                : new Intl.NumberFormat(tag, {
                    style: "currency",
                    currency: "EUR",
                    maximumFractionDigits: 0,
                  }).format(Number(p.price_monthly_eur))}
              <span className="text-sm font-normal text-muted-foreground">
                {p.price_monthly_eur !== null && tx("pages.pr.perMonth")}
              </span>
            </div>
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {p.monthly_credits > 0 && (
                <li className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                  {tx("pages.pr.credits", { n: p.monthly_credits.toLocaleString(tag) })}
                </li>
              )}
              {q.data.ents
                .filter((e) => e.plan_key === p.key && isFeature(e.feature_key))
                .map((e) => (
                  <li key={e.feature_key} className="flex gap-2">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    {e.limit_value === null ? tx("pages.pr.unlimited") : e.limit_value}{" "}
                    {isFeature(e.feature_key) ? tx(`pages.pr.f.${e.feature_key}`) : e.feature_key}
                  </li>
                ))}
            </ul>
            <Button variant="secondary" className="mt-6 h-auto min-h-11 whitespace-normal" asChild>
              <Link to="/auth" search={{ redirect: undefined, mode: "signup" }}>
                {tx("pages.pr.start")}
              </Link>
            </Button>
          </div>
        ))}
      </div>
      <p className="pb-12 text-center text-xs text-muted-foreground">{tx("pages.pr.vat")}</p>
    </div>
  );
}
