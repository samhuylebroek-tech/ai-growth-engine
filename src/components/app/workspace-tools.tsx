import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  ChevronDown,
  FileText,
  Sparkles,
  Settings,
  Target,
  Network,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { executionOptions, executionSummary } from "@/lib/execution";
import { growthSummaryOptions } from "@/lib/growth-summary";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function WorkspaceContext() {
  const o = useOrg();
  const { t } = useI18n();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const unitParam = useRouterState({
    select: (r) => (r.location.search as { unit?: string }).unit ?? null,
  });
  const onOrg = path.startsWith("/app/organization");
  const units = useQuery({
    queryKey: ["context-units", o.org?.id, o.workspace?.id],
    enabled: !!o.org && !!o.workspace,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const r = await growthDb
        .from("business_units")
        .select("id,name,kind")
        .eq("org_id", o.org!.id)
        .eq("workspace_id", o.workspace!.id)
        .eq("archived", false)
        .order("name")
        .limit(50);
      if (r.error) {
        if (isNotInstalled(r.error)) return [];
        throw r.error;
      }
      return r.data ?? [];
    },
  });
  const unit =
    !onOrg && path.startsWith("/app/business") && unitParam
      ? (units.data?.find((u) => u.id === unitParam) ?? null)
      : null;
  const multi = o.workspaces.length > 1;
  // The trigger always names the context being viewed: the organization overview, a business, or a brand/unit inside it.
  const label = onOrg ? t("ogo.context.org") : (o.workspace?.name ?? t("ogo.context.noBusiness"));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto min-w-0 justify-start gap-2 px-1 py-1 text-left"
          aria-label={t("ogo.context.change")}
        >
          <span className="min-w-0">
            <span className="block max-w-40 truncate text-[10px] text-muted-foreground">
              {o.org?.name}
              {!onOrg && multi ? ` · ${t("ogo.context.business")}` : ""}
            </span>
            <span className="block max-w-40 truncate text-xs font-semibold">
              {label}
              {unit ? ` · ${unit.name}` : ""}
            </span>
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <label htmlFor="organization-selector" className="text-xs font-medium">
          {t("ogo.context.organization")}
        </label>
        <select
          id="organization-selector"
          aria-label={t("ogo.context.organization")}
          className="mt-1 mb-3 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={o.org?.id}
          onChange={(e) => o.setOrgId(e.target.value)}
        >
          {o.memberships.map((m) => (
            <option key={m.org_id} value={m.org_id}>
              {m.organizations?.name}
            </option>
          ))}
        </select>
        {multi && (
          <Button
            variant={onOrg ? "secondary" : "outline"}
            size="sm"
            className="mb-3 w-full justify-start text-xs"
            asChild
          >
            <Link to="/app/organization">
              <Network className="h-3.5 w-3.5" />
              {t("ogo.context.orgOverview", { n: String(o.workspaces.length) })}
            </Link>
          </Button>
        )}
        <label htmlFor="workspace-selector" className="text-xs font-medium">
          {t("ogo.context.business")}
        </label>
        <select
          id="workspace-selector"
          aria-label={t("ogo.context.business")}
          className="mt-1 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={o.workspace?.id ?? ""}
          onChange={(e) => o.setWorkspaceId(e.target.value)}
        >
          {!o.workspaces.length && <option value="">{t("ogo.context.noBusiness")}</option>}
          {o.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {onOrg && o.workspace && (
          <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" asChild>
            <Link to="/app">{t("ogo.context.openBusiness", { name: o.workspace.name })}</Link>
          </Button>
        )}
        {(units.data ?? []).length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium">{t("ogo.context.units")}</p>
            <ul className="mt-1 space-y-0.5">
              <li>
                <Link
                  to="/app/business"
                  className={`block rounded px-1 py-0.5 text-xs hover:bg-muted ${!unit && path.startsWith("/app/business") ? "font-semibold" : ""}`}
                >
                  {t("ogo.context.wholeBusiness")}
                </Link>
              </li>
              {units.data!.map((u) => (
                <li key={u.id}>
                  <Link
                    to="/app/business"
                    search={{ unit: u.id }}
                    className={`block rounded px-1 py-0.5 text-xs hover:bg-muted ${unit?.id === u.id ? "font-semibold" : ""}`}
                  >
                    {u.name}{" "}
                    <span className="text-muted-foreground">
                      ({t(u.kind === "brand" ? "ogo.context.brand" : "ogo.context.unit")})
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceTools() {
  const o = useOrg();
  const q = useQuery(growthSummaryOptions(o.org?.id, o.workspace?.id, o.role));
  const execution = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const summary = execution.data
    ? executionSummary(
        execution.data.tasks,
        execution.data.projects,
        execution.data.campaigns,
        o.userId,
      )
    : null;
  const taskCount = new Set(
    [...(summary?.overdue ?? []), ...(summary?.today ?? [])].map((t) => t.id),
  ).size;
  const count = (q.data?.approvalCount ?? 0) + taskCount;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Quick actions" title="Quick actions">
            <Plus />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60">
          <p className="mb-3 text-xs font-semibold">Quick actions</p>
          {can(o.workspaceRole, "ai.use") && (
            <Tool to="/app/growth-officer" label="New AI assignment" icon={<Sparkles />} />
          )}
          {can(o.workspaceRole, "profile.edit") && (
            <Tool to="/app/onboarding" label="Research website" icon={<Target />} />
          )}
          {can(o.workspaceRole, "documents.upload") && (
            <Tool to="/app/documents" label="Add document" icon={<FileText />} />
          )}
          {can(o.role, "members.invite") && (
            <Tool to="/app/settings" label="Team & settings" icon={<Settings />} />
          )}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Workspace notifications"
            title="Notifications"
          >
            <Bell />
            {count > 0 && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end">
          <p className="mb-3 text-sm font-semibold">Workspace attention</p>
          {q.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Notifications unavailable.
            </p>
          ) : count ? (
            <>
              <p className="text-xs text-muted-foreground">
                {q.data?.approvalCount ?? 0} recommendations await review.
              </p>
              <Button variant="link" className="mt-2 px-0" size="sm" asChild>
                <Link to="/app/approvals">
                  {can(o.workspaceRole, "approvals.decide")
                    ? "Review decisions"
                    : "View review queue"}
                </Link>
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {q.isLoading ? "Checking review queue…" : "No pending decisions."}
            </p>
          )}
          {taskCount > 0 && (
            <Button variant="link" className="mt-2 px-0" size="sm" asChild>
              <Link to="/app/tasks">{taskCount} tasks due today or overdue</Link>
            </Button>
          )}
          <Button variant="ghost" className="mt-3 w-full justify-start px-0" size="sm" asChild>
            <Link to="/app/notifications">Open notification center</Link>
          </Button>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" asChild title="Profile and settings">
        <Link to="/app/settings" aria-label="Profile and settings">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold">
            {o.email.slice(0, 1).toUpperCase()}
          </span>
        </Link>
      </Button>
    </div>
  );
}
function Tool({
  to,
  label,
  icon,
}: {
  to: "/app/growth-officer" | "/app/documents" | "/app/settings" | "/app/onboarding";
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="sm" className="w-full justify-start text-xs" asChild>
      <Link to={to}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}
