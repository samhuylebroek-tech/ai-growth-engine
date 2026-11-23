import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ArrowUpRight, Sparkles, FileText, CheckSquare } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { AGENTS } from "@/lib/registry/agents";
import { mergeActivity } from "@/lib/command-center";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";
import { useI18n } from "@/lib/i18n";
import { agentText } from "@/lib/i18n/registry-text";

export const Route = createFileRoute("/_authenticated/app/activity")({
  head: () => localHead("activity"),
  validateSearch: (search: Record<string, unknown>): { run?: string } =>
    typeof search["run"] === "string" ? { run: search["run"] } : {},
  component: ActivityPage,
});
const PAGE_SIZE = 50;
function ActivityPage() {
  const o = useOrg();
  const { t: tx, tag } = useI18n();
  const t = tx as (k: string, v?: Record<string, string | number>) => string;
  const orgId = o.org?.id;
  const workspaceId = o.workspace?.id;
  const { run } = Route.useSearch();
  const [filter, setFilter] = useState("all");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const activity = useInfiniteQuery({
    queryKey: ["activity-history", orgId, workspaceId],
    enabled: !!orgId && !!workspaceId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!orgId || !workspaceId) throw new Error("Select a workspace.");
      const start = pageParam * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      const [runs, documents, approvals] = await Promise.all([
        supabase
          .from("agent_runs")
          .select("id,agent_key,status,summary,error,created_at,finished_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, end),
        supabase
          .from("documents")
          .select("id,name,status,created_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, end),
        supabase
          .from("approvals")
          .select("id,title,status,risk,reasoning,expected_impact,created_at,decided_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, end),
      ]);
      for (const r of [runs, documents, approvals]) if (r.error) throw r.error;
      return {
        events: mergeActivity(runs.data ?? [], documents.data ?? [], approvals.data ?? []),
        more: [runs, documents, approvals].some((r) => r.data?.length === PAGE_SIZE),
      };
    },
    getNextPageParam: (last, pages) => (last.more ? pages.length : undefined),
  });
  const selectedRun = useQuery({
    queryKey: ["selected-run", orgId, workspaceId, run],
    enabled: !!orgId && !!workspaceId && !!run,
    queryFn: async () => {
      if (!orgId || !workspaceId || !run) return [];
      const r = await supabase
        .from("agent_runs")
        .select("id,agent_key,status,summary,error,created_at,finished_at")
        .eq("org_id", orgId)
        .eq("workspace_id", workspaceId)
        .eq("id", run)
        .maybeSingle();
      if (r.error) throw r.error;
      return mergeActivity(r.data ? [r.data] : [], [], []);
    },
  });
  const audit = useQuery({
    queryKey: ["audit", orgId],
    enabled: !!orgId && can(o.role, "audit.read"),
    queryFn: async () => {
      if (!orgId) throw new Error("Select an organization.");
      const result = await supabase
        .from("audit_logs")
        .select("id,action,created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const all = [
    ...new Map(
      [...(selectedRun.data ?? []), ...(activity.data?.pages.flatMap((p) => p.events) ?? [])].map(
        (a) => [a.id, a],
      ),
    ).values(),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const visible = all.filter(
    (a) =>
      (filter === "all" || a.status === filter) &&
      (source === "all" || a.kind === source) &&
      `${a.title} ${a.detail}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title={t("pg.act.title")}
        description={t("pg.act.intro")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/growth-officer">
              {t("pg.act.saved")} <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap gap-3">
        <Input
          aria-label={t("pg.act.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pg.act.searchPh")}
          className="max-w-sm"
        />
        <select
          aria-label={t("pg.act.source")}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-border bg-card px-3 text-xs"
        >
          {["all", "ai", "documents", "approvals"].map((x) => (
            <option key={x} value={x}>
              {t(`pg.act.src.${x}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("pg.act.statusLabel")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 text-xs"
        >
          <option value="all">{t("pg.act.st.all")}</option>
          {["succeeded", "failed", "running", "pending", "ready", "approved", "rejected"].map(
            (x) => (
              <option key={x} value={x}>
                {t(`status.${x}`)}
              </option>
            ),
          )}
        </select>
      </div>
      {activity.isLoading && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          {t("pg.act.loading")}
        </p>
      )}
      {(activity.isError || selectedRun.isError) && (
        <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {t("pg.act.failed")}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              activity.refetch();
              selectedRun.refetch();
            }}
          >
            {t("pg.retry")}
          </Button>
        </div>
      )}
      {visible.length ? (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((a) => {
            const Icon =
              a.kind === "ai" ? Sparkles : a.kind === "documents" ? FileText : CheckSquare;
            const open = expanded === a.id || (!expanded && run === a.entityId && a.kind === "ai");
            return (
              <article key={a.id} className="py-4">
                <div className="flex items-start gap-3">
                  <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-sm font-medium">
                      {a.kind === "ai"
                        ? (() => {
                            const ag = AGENTS.find(
                              (agent) => agent.key === a.title.replace(/ /g, "_"),
                            );
                            return ag ? agentText(t, ag).name : a.title;
                          })()
                        : a.title}
                    </h2>
                    <time className="mt-1 block text-[10px] text-muted-foreground">
                      {new Date(a.time).toLocaleString(tag)} · {t(`pg.act.kind.${a.kind}`)}
                    </time>
                  </div>
                  <StatusChip status={a.status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("pg.act.detailsFor", { t: a.title })}
                    title={t("pg.act.details")}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? "closed" : a.id)}
                  >
                    <ChevronDown />
                  </Button>
                </div>
                {open && (
                  <div className="mt-4 border-l-2 border-border pl-4">
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                      {a.detail}
                    </p>
                    <Button variant="link" size="sm" className="mt-3 px-0" asChild>
                      <Link to={a.kind === "ai" ? "/app/growth-officer" : a.to}>
                        {t(a.kind === "ai" ? "pg.act.openSaved" : "pg.act.openSource")}{" "}
                        <ArrowUpRight />
                      </Link>
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : !activity.isLoading && !activity.isError ? (
        <EmptyState
          title={t(all.length ? "pg.act.noMatch" : "pg.act.none")}
          text={t(all.length ? "pg.act.noMatchText" : "pg.act.noneText")}
        />
      ) : null}
      {activity.hasNextPage && (
        <Button
          variant="outline"
          className="mt-5"
          disabled={activity.isFetchingNextPage}
          onClick={() => activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage ? t("pg.loading") : t("pg.act.older")}
          <ChevronDown />
        </Button>
      )}
      {can(o.role, "audit.read") && (
        <section className="mt-10 border-t border-border pt-6">
          <h2 className="mb-3 font-semibold">{t("pg.act.audit")}</h2>
          {audit.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {t("pg.act.auditUnavailable")}
            </p>
          ) : audit.data?.length ? (
            <div className="divide-y divide-border text-sm">
              {audit.data.map((a) => (
                <div key={a.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                  <span className="break-words font-mono text-xs">{a.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString(tag)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {audit.isLoading ? t("pg.act.auditLoading") : t("pg.act.auditNone")}
            </p>
          )}
        </section>
      )}
    </>
  );
}
