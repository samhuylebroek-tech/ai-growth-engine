import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { approvedContextFacts } from "@/lib/discovery";
import { quoteUntrusted } from "./upload";

type DB = SupabaseClient<Database>;
export type WorkspaceScope = { orgId: string; workspaceId: string };

export async function requireWorkspace(sb: DB, scope: WorkspaceScope) {
  const result = await sb.from("workspaces").select("id,org_id,name,kind").eq("id", scope.workspaceId).eq("org_id", scope.orgId).maybeSingle();
  if (result.error || !result.data) throw new Error("Workspace not found.");
  return result.data;
}

export async function readConversation(sb: DB, scope: WorkspaceScope, id: string, userId: string) {
  const result = await sb.from("conversations").select("id").eq("id", id).eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("user_id", userId).maybeSingle();
  if (result.error || !result.data) throw new Error("Conversation not found in this workspace.");
  const history = await sb.from("messages").select("role,content").eq("conversation_id", id).eq("org_id", scope.orgId).order("created_at", { ascending: false }).limit(12);
  if (history.error) throw new Error("Could not read conversation.");
  return history.data ?? [];
}

export async function readDocument(sb: DB, scope: WorkspaceScope, id: string) {
  await requireWorkspace(sb, scope);
  const result = await sb.from("documents").select("*").eq("id", id).eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).maybeSingle();
  if (result.error || !result.data || !result.data.storage_path.startsWith(`${scope.orgId}/${scope.workspaceId}/`)) throw new Error("Document not found in this workspace.");
  return result.data;
}

export async function workspaceContext(sb: DB, scope: WorkspaceScope) {
  const workspace = await requireWorkspace(sb, scope);
  const [profile, facts, recommendations, goals, plans, budgetLines] = await Promise.all([
    sb.from("business_profiles").select("objectives,monthly_budget_eur,onboarding_completed_at").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).maybeSingle(),
    sb.from("business_facts").select("key,value,source_type,verified").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("verified", true).order("created_at", { ascending: false }).limit(60),
    sb.from("approvals").select("title,reasoning,status").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(10),
    sb.from("growth_goals").select("id,title,objective,metric,baseline,target,current_value,due_date,priority,status").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).in("status", ["active", "paused"]).order("priority").order("updated_at", { ascending: false }).limit(12),
    sb.from("growth_plan_versions").select("id,goal_id,version,title,summary,approved_at").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("status", "approved").order("approved_at", { ascending: false }).limit(12),
    sb.from("budget_lines").select("channel,period_month,planned,actual,hard_cap,currency,goal_id,initiative_id").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).order("period_month", { ascending: false }).order("created_at", { ascending: false }).limit(30),
  ]);
  if (profile.error || facts.error || recommendations.error || goals.error || plans.error || budgetLines.error) {
    throw new Error("Could not read business context.");
  }
  const planIds = (plans.data ?? []).map(plan => plan.id);
  const initiativesResult = planIds.length
    ? await sb.from("growth_initiatives").select("id,plan_version_id,goal_id,title,detail,channel,target_week,effort,status,project_id")
        .eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).in("plan_version_id", planIds)
        .neq("status", "cancelled").order("sort_order").limit(40)
    : { data: [], error: null };
  if (initiativesResult.error) throw new Error("Could not read approved growth initiatives.");
  const initiativeIds = (initiativesResult.data ?? []).map(item => item.id);
  const operationsResult = initiativeIds.length
    ? await sb.from("growth_initiative_operations").select("initiative_id,due_date,success_metric,baseline_value,target_value,current_value,blocker_note,owner_id")
        .eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).in("initiative_id", initiativeIds)
    : { data: [], error: null };
  if (operationsResult.error) throw new Error("Could not read growth initiative operations.");
  const projectIds = [...new Set((initiativesResult.data ?? []).map(item => item.project_id).filter((id): id is string => !!id))];
  const projectsResult = projectIds.length
    ? await sb.from("projects").select("id,title,status,priority,start_date,end_date,owner_id")
        .eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).in("id", projectIds)
    : { data: [], error: null };
  if (projectsResult.error) throw new Error("Could not read initiative work projects.");
  const linkedProjectIds = (projectsResult.data ?? []).map(project => project.id);
  const tasksResult = linkedProjectIds.length
    ? await sb.from("tasks").select("id,project_id,title,status,priority,due_date,owner_id")
        .eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).in("project_id", linkedProjectIds)
        .order("due_date", { ascending: true }).limit(80)
    : { data: [], error: null };
  if (tasksResult.error) throw new Error("Could not read initiative work tasks.");

  // Descriptive profile fields can be stale after a fact is edited/rejected; never use them as a second trust path.
  const objectives = profile.data?.onboarding_completed_at ? { objectives: profile.data.objectives, monthly_budget_eur: profile.data.monthly_budget_eur } : {};
  const plansAndInitiatives = (plans.data ?? []).map(plan => ({
    goal: (goals.data ?? []).find(goal => goal.id === plan.goal_id)?.title ?? "Growth goal",
    version: plan.version, title: plan.title, summary: plan.summary.slice(0, 700),
    initiatives: (initiativesResult.data ?? []).filter(item => item.plan_version_id === plan.id).map(item => {
      const operations = operationsResult.data?.find(op => op.initiative_id === item.id);
      return {
        title: item.title, detail: item.detail.slice(0, 500), channel: item.channel, status: item.status,
        target_week: item.target_week, effort: item.effort, linked_work_created: !!item.project_id,
        due_date: operations?.due_date ?? null, owner_assigned: !!operations?.owner_id,
        success_metric: operations?.success_metric || null,
        baseline: operations?.baseline_value ?? null, target: operations?.target_value ?? null,
        current: operations?.current_value ?? null, blocker: operations?.blocker_note || null,
        work_project: projectsResult.data?.filter(project => project.id === item.project_id).map(project => ({
          title: project.title, status: project.status, priority: project.priority,
          start_date: project.start_date, end_date: project.end_date, owner_assigned: !!project.owner_id,
        }))[0] ?? null,
        tasks: (tasksResult.data ?? []).filter(task => task.project_id === item.project_id).map(task => ({
          title: task.title, status: task.status, priority: task.priority, due_date: task.due_date, owner_assigned: !!task.owner_id,
        })).slice(0, 12),
      };
    }),
  }));
  const budgets = (budgetLines.data ?? []).map(line => ({
    channel: line.channel, month: line.period_month, planned: line.planned, manually_recorded_actual: line.actual,
    hard_cap: line.hard_cap, currency: line.currency,
    linked_goal: (goals.data ?? []).find(goal => goal.id === line.goal_id)?.title ?? null,
    initiative_linked: !!line.initiative_id,
    record_type: "manual budget entry; not synced spend",
  }));
  return [
    `CUSTOMER OBJECTIVES (not evidence):\n${quoteUntrusted("objectives", JSON.stringify(objectives))}`,
    `VERIFIED FACTS:\n${quoteUntrusted("verified-facts", approvedContextFacts(facts.data ?? []).map(f => `- ${f.key}: ${f.value}`).join("\n") || "(none)")}`,
    `WORKSPACE:\n${quoteUntrusted("workspace", JSON.stringify(workspace))}`,
    `CURRENT GROWTH GOALS (user-maintained planning records, not connected measurements):\n${quoteUntrusted("growth-goals", JSON.stringify(goals.data ?? []), 9000)}`,
    `APPROVED GROWTH PLANS AND INITIATIVES (approved planning direction, not verified outcomes):\n${quoteUntrusted("approved-growth-plans", JSON.stringify(plansAndInitiatives), 12000)}`,
    `RECENT BUDGET ENTRIES (manual planning and actual-spend inputs, currencies must remain separate):\n${quoteUntrusted("budget-lines", JSON.stringify(budgets), 6000)}`,
    `PREVIOUS RECOMMENDATIONS (hypotheses, never facts):\n${quoteUntrusted("recommendations", JSON.stringify(recommendations.data ?? []))}`,
    "Unconfirmed claims and descriptive profile mirrors are excluded. Initiative owners are represented only as assigned/unassigned, not personal identifiers. Budget actuals are manually entered and are not verified ad-platform or payment data. Conversation history is not verified evidence; ask for confirmation when evidence is missing.",
  ].join("\n\n");
}
