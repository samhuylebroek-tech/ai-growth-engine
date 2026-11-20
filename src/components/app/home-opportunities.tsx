import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { priorityScore } from "@/lib/opportunities";
import { Button } from "@/components/ui/button";

/** Command Center summary of opportunities awaiting a decision. Reads as the caller; no AI credits. */
export function HomeOpportunities() {
  const o = useOrg();
  const { t } = useI18n();
  const orgId = o.org?.id; const wsId = o.workspace?.id;
  const q = useQuery({
    enabled: !!orgId && !!wsId,
    queryKey: ["home-opportunities", orgId, wsId],
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb.from("growth_opportunities").select("id,title,domain,status,impact,feasibility,cost,time_to_value,risk")
        .eq("org_id", orgId!).eq("workspace_id", wsId!).in("status", ["open", "shortlisted"]).order("created_at", { ascending: false }).limit(30);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  if (isNotInstalled(q.error) || q.isLoading) return null;
  const rows = q.data ?? [];
  const shortlisted = rows.filter((r) => r.status === "shortlisted").length;
  const top = [...rows].sort((a, b) => (a.status === "shortlisted" ? 0 : 1) - (b.status === "shortlisted" ? 0 : 1) || priorityScore(b) - priorityScore(a)).slice(0, 3);
  return (
    <section aria-label={t("home.opps.title")} className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Lightbulb className="h-4 w-4 text-primary" aria-hidden />{t("home.opps.title")}</h2>
        <Button size="sm" variant="ghost" asChild><Link to="/app/opportunities">{t("home.opps.open")}<ArrowUpRight /></Link></Button>
      </div>
      {q.error ? <p role="alert" className="mt-2 text-sm text-destructive">{t("opp.loadError")}</p>
        : rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("home.opps.none")}</p>
        : <>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.opps.count", { n: rows.length - shortlisted, s: shortlisted })}</p>
          <ul className="mt-2 space-y-1 text-sm">{top.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{r.title}</span><span className="text-xs text-muted-foreground">{t(`opp.domain.${r.domain}` as MessageKey)}{r.status === "shortlisted" ? ` · ${t("opp.status.shortlisted")}` : ""}</span></li>
          ))}</ul>
        </>}
    </section>
  );
}
