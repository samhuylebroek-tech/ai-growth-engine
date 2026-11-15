import { supabase } from "@/integrations/supabase/client";
import type { OrgRole } from "@/lib/permissions";

export function growthSummaryOptions(orgId: string | undefined, workspaceId: string | undefined, role: OrgRole | null) {
  // The remake changed bp/docs to profile/documents and expanded fact fields.
  // Keep the invalidation prefix but never reuse an older mounted preview's cache.
  return { queryKey: ["overview", "growth-summary-v3", orgId, workspaceId, role], enabled: !!orgId && !!workspaceId, queryFn: async () => {
    if (!orgId || !workspaceId) throw new Error("Select a workspace.");
    if (role !== "viewer") { const grant = await supabase.rpc("ensure_monthly_credit_grant", { _org: orgId }); if (grant.error) throw grant.error; }
    const [balance, subscription, approvals, profile, facts, runs, documents] = await Promise.all([
      supabase.rpc("credit_balance", { _org: orgId }),
      supabase.from("subscriptions").select("plan_key,status,trial_ends_at").eq("org_id", orgId).maybeSingle(),
      supabase.from("approvals").select("id,title,reasoning,expected_impact,risk,status,capability_key,created_at", { count: "exact" }).eq("org_id", orgId).eq("workspace_id", workspaceId).eq("status", "pending").order("created_at", { ascending: false }).limit(50),
      supabase.from("business_profiles").select("onboarding_completed_at,objectives,website").eq("org_id", orgId).eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("business_facts").select("id,key,value,verified,source_type,source_ref").eq("org_id", orgId).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("agent_runs").select("id,agent_key,status,summary,created_at").eq("org_id", orgId).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(6),
      supabase.from("documents").select("id,name,status").eq("org_id", orgId).eq("workspace_id", workspaceId),
    ]);
    for (const result of [balance, subscription, approvals, profile, facts, runs, documents]) if (result.error) throw result.error;
    return { balance: balance.data, sub: subscription.data, approvals: approvals.data ?? [], approvalCount: approvals.count ?? 0, profile: profile.data, facts: facts.data ?? [], runs: runs.data ?? [], documents: documents.data ?? [] };
  } };
}