import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { summarizeMetric, formatMetricValue, type Measurement } from "@/lib/performance";
import { buildBusinessTiles, type Loaded, type Tile, type TileValue } from "@/lib/business-tiles";
import { useI18n } from "@/lib/i18n";
import { SectionHeading } from "@/components/app/section-heading";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DEAL_LIMIT = 2000,
  RUN_LIMIT = 500;
type Res<T> = { data: T | null; error: unknown; count?: number | null };
const settle = async <T,>(
  p: PromiseLike<Res<T>>,
  map: (r: Res<T>) => Loaded<unknown> | null = () => null,
): Promise<Loaded<T>> => {
  try {
    const r = await p;
    if (r.error)
      return { ok: false, reason: isNotInstalled(r.error) ? "not_switched_on" : "load_failed" };
    const special = map(r);
    if (special) return special as Loaded<T>;
    return { ok: true, data: r.data as T };
  } catch {
    return { ok: false, reason: "load_failed" };
  }
};
// Awaiting a query builder twice sends the request twice, so the count is captured during the single settle.
const counted = async (p: PromiseLike<Res<unknown>>): Promise<Loaded<number>> => {
  let n = 0;
  const r = await settle(p, (res) => {
    n = res.count ?? 0;
    return null;
  });
  return r.ok ? { ok: true, data: n } : r;
};

/** Reads every tile's source under the caller's RLS, scoped to the active organization and workspace. */
export function businessTilesOptions(orgId: string | undefined, wsId: string | undefined) {
  const month = new Date().toISOString().slice(0, 7);
  return {
    queryKey: ["business-tiles", orgId, wsId, month],
    enabled: !!orgId && !!wsId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const since = `${month}-01T00:00:00Z`;
      const scope = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) =>
        q.eq("org_id", orgId).eq("workspace_id", wsId);
      const [
        openOpportunities,
        activeGoals,
        activeCampaigns,
        tasksDone,
        pendingApprovals,
        deals,
        budget,
        runs,
        revenueDefs,
      ] = await Promise.all([
        counted(
          scope(
            growthDb.from("growth_opportunities").select("id", { count: "exact", head: true }),
          ).in("status", ["open", "shortlisted"]),
        ),
        counted(
          scope(supabase.from("growth_goals").select("id", { count: "exact", head: true })).eq(
            "status",
            "active",
          ),
        ),
        counted(
          scope(supabase.from("campaigns").select("id", { count: "exact", head: true })).in(
            "status",
            ["active", "needs_attention", "optimizing"],
          ),
        ),
        counted(
          scope(supabase.from("tasks").select("id", { count: "exact", head: true })).eq(
            "status",
            "done",
          ),
        ),
        counted(
          scope(supabase.from("approvals").select("id", { count: "exact", head: true })).eq(
            "status",
            "pending",
          ),
        ),
        settle(
          scope(
            supabase.from("crm_deals").select("stage,value,currency,closed_at", { count: "exact" }),
          )
            .or(
              `stage.in.(lead,qualified,proposal,negotiation),and(stage.eq.won,closed_at.gte.${since})`,
            )
            .limit(DEAL_LIMIT),
          (r) => ((r.count ?? 0) > DEAL_LIMIT ? { ok: false, reason: "too_many" } : null),
        ),
        settle(
          scope(supabase.from("budget_lines").select("planned,actual,currency"))
            .eq("period_month", `${month}-01`)
            .limit(500),
        ),
        // Organization-level analyses are recorded under one business only for their receipt; they are not that business's cost.
        settle(
          scope(supabase.from("agent_runs").select("id", { count: "exact" }))
            .gte("created_at", since)
            .neq("agent_key", "organization_growth_officer")
            .limit(RUN_LIMIT),
          (r) => ((r.count ?? 0) > RUN_LIMIT ? { ok: false, reason: "too_many" } : null),
        ),
        settle(
          scope(growthDb.from("metric_definitions").select("id,currency"))
            .like("key", "stripe_net_revenue_%")
            .eq("archived", false)
            .limit(20),
        ),
      ]);
      const aiRunsThisMonth: Loaded<number> = runs.ok ? { ok: true, data: runs.data.length } : runs;
      let aiCreditsThisMonth: Loaded<number> = runs.ok ? { ok: true, data: 0 } : runs;
      if (runs.ok && runs.data.length) {
        const ids = runs.data.map((r) => r.id);
        let total = 0;
        for (let k = 0; k < ids.length && aiCreditsThisMonth.ok; k += 100) {
          const u = await settle(
            supabase
              .from("ai_usage_events")
              .select("credits_charged")
              .eq("org_id", orgId)
              .in("run_id", ids.slice(k, k + 100))
              .limit(1000),
          );
          if (!u.ok) aiCreditsThisMonth = u;
          else if (u.data.length >= 1000) aiCreditsThisMonth = { ok: false, reason: "too_many" };
          else total += u.data.reduce((s, e) => s + Number(e.credits_charged), 0);
        }
        if (aiCreditsThisMonth.ok) aiCreditsThisMonth = { ok: true, data: total };
      }
      let revenue: Loaded<
        { currency: string | null; summary: ReturnType<typeof summarizeMetric> }[]
      > = revenueDefs.ok ? { ok: true, data: [] } : revenueDefs;
      if (revenueDefs.ok && revenueDefs.data.length) {
        const m = await settle(
          scope(
            growthDb
              .from("performance_measurements")
              .select(
                "id,metric_id,kind,period_start,period_end,value,corrects_id,created_at,source",
              ),
          )
            .in(
              "metric_id",
              revenueDefs.data.map((d) => d.id),
            )
            .in("kind", ["imported_actual", "planned"])
            .order("period_start", { ascending: false })
            .limit(500),
        );
        revenue = m.ok
          ? {
              ok: true,
              data: revenueDefs.data.map((d) => ({
                currency: d.currency,
                summary: summarizeMetric(
                  { id: d.id, direction: "increase" },
                  m.data as Measurement[],
                ),
              })),
            }
          : m;
      }
      return buildBusinessTiles({
        now: new Date(),
        openOpportunities,
        activeGoals,
        activeCampaigns,
        tasksDone,
        pendingApprovals,
        aiRunsThisMonth,
        aiCreditsThisMonth,
        revenue,
        deals: deals.ok
          ? { ok: true, data: deals.data.map((d) => ({ ...d, value: Number(d.value) })) }
          : deals,
        budget: budget.ok
          ? {
              ok: true,
              data: budget.data.map((b) => ({
                planned: Number(b.planned),
                actual: Number(b.actual),
                currency: b.currency,
              })),
            }
          : budget,
      });
    },
  };
}

/** Command-center number tiles: real records only, each labelled with its kind, source and period. */
export function BusinessTiles() {
  const { org, workspace } = useOrg();
  const { t } = useI18n();
  const q = useQuery(businessTilesOptions(org?.id, workspace?.id));
  return (
    <section aria-label={t("home.tiles.title")} className="mb-8">
      <SectionHeading eyebrow={t("home.tiles.eyebrow")} title={t("home.tiles.title")} />
      {q.isLoading ? (
        <p role="status" className="py-3 text-xs text-muted-foreground">
          {t("home.tiles.loading")}
        </p>
      ) : q.isError || !q.data ? (
        <p role="alert" className="py-3 text-xs text-destructive">
          {t("home.tiles.failed")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-5">
          {q.data.map((tile) => (
            <TileCard key={tile.key} tile={tile} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">{t("home.tiles.note")}</p>
    </section>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const { t, tag } = useI18n();
  const fmt = (v: TileValue) =>
    v.unit === "percent"
      ? `${v.amount.toLocaleString(tag)}%${v.currency ? ` · ${v.currency}` : ""}`
      : v.unit === "currency"
        ? formatMetricValue(v.amount, "currency", v.currency ?? null, tag)
        : v.amount.toLocaleString(tag);
  const label = t(`home.tiles.k.${tile.key}`);
  const period = tile.periodStart
    ? new Date(`${tile.periodStart.slice(0, 10)}T12:00:00`).toLocaleDateString(tag, {
        month: "long",
        year: "numeric",
      })
    : t(`home.tiles.p.${tile.period}`);
  return (
    <div className="flex min-w-0 flex-col bg-card p-3 [&:last-child:nth-child(odd)]:col-span-2 md:[&:last-child:nth-child(odd)]:col-span-1">
      <div className="flex items-start justify-between gap-1">
        <Link
          to={tile.to}
          className="group min-w-0 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <span className="break-words">{label}</span>
          <ArrowUpRight className="ml-0.5 inline h-3 w-3 opacity-0 group-hover:opacity-100" />
        </Link>
        <Popover>
          <PopoverTrigger
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("home.tiles.about", { k: label })}
          >
            <Info className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-72 text-xs">
            <p className="font-semibold">{label}</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {t(`home.tiles.d.${tile.key}`)}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t("home.tiles.kindLabel")}</dt>
              <dd>{t(`home.tiles.kind.${tile.kind}`)}</dd>
              <dt className="text-muted-foreground">{t("home.tiles.sourceLabel")}</dt>
              <dd>{t(`home.tiles.s.${tile.source}`)}</dd>
              <dt className="text-muted-foreground">{t("home.tiles.periodLabel")}</dt>
              <dd>{period}</dd>
            </dl>
          </PopoverContent>
        </Popover>
      </div>
      {tile.unavailable ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(`home.tiles.na.${tile.unavailable}`)}
        </p>
      ) : (
        <Link to={tile.to} className="mt-1 block min-w-0">
          {tile.values.map((v, i) => (
            <span
              key={i}
              className={cn(
                "block break-words tabular-nums",
                i === 0 ? "text-xl font-semibold" : "text-xs text-muted-foreground",
              )}
            >
              {fmt(v)}
            </span>
          ))}
        </Link>
      )}
      <p className="mt-auto pt-2 text-[10px] text-muted-foreground">
        <span
          className={cn(
            "mr-1 rounded border px-1",
            tile.kind === "actual"
              ? "border-success/40 text-success"
              : tile.kind === "estimate" || tile.kind === "forecast"
                ? "border-warning/40 text-warning"
                : "border-border",
          )}
        >
          {t(`home.tiles.kind.${tile.kind}`)}
        </span>
        {period}
      </p>
    </div>
  );
}
