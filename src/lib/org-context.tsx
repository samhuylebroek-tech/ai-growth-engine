import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_RANK, type OrgRole } from "@/lib/permissions";

export interface Membership { org_id: string; role: OrgRole; organizations: { id: string; name: string; type: string; status: string } | null }
export interface Workspace { id: string; org_id: string; name: string; kind: string }

interface OrgCtx {
  userId: string; email: string;
  memberships: Membership[];
  org: Membership["organizations"]; role: OrgRole | null;
  workspaceRole: OrgRole | null; error: boolean;
  workspaces: Workspace[]; workspace: Workspace | null;
  setOrgId: (id: string) => void; setWorkspaceId: (id: string) => void;
  isPlatformStaff: boolean; loading: boolean; refresh: () => Promise<void>;
}
// One context identity per page: when a hot reload or a separately loaded chunk re-evaluates this module,
// it reuses the existing context instead of creating a second one that the mounted provider does not fill.
const CTX_KEY = "__agoOrgContext";
const store = globalThis as unknown as Record<string, React.Context<OrgCtx | null> | undefined>;
const Ctx = store[CTX_KEY] ?? (store[CTX_KEY] = createContext<OrgCtx | null>(null));

const ORG_KEY = "ago.org"; const WS_KEY = "ago.ws";

export function OrgProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [wsId, setWsIdState] = useState<string | null>(null);
  useEffect(() => { setOrgIdState(localStorage.getItem(ORG_KEY)); setWsIdState(localStorage.getItem(WS_KEY)); }, []);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const [members, staffResult] = await Promise.all([
        supabase.from("organization_members").select("org_id, role, organizations(id,name,type,status)").eq("user_id", user.id),
        supabase.rpc("is_platform_staff"),
      ]);
      if (members.error || staffResult.error) throw new Error("Could not load your organizations.");
      return { userId: user.id, email: user.email ?? "", memberships: (members.data ?? []) as Membership[], isPlatformStaff: !!staffResult.data };
    },
  });
  const memberships = (me.data?.memberships ?? []).filter((m) => m.organizations?.status === "active");
  const current = memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null;

  const ws = useQuery({
    queryKey: ["workspaces", current?.org_id],
    enabled: !!current,
    queryFn: async () => {
      if (!current) return [];
      const result = await supabase.from("workspaces").select("id,org_id,name,kind").eq("org_id", current.org_id).order("created_at");
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const workspaces = ws.data ?? [];
  const workspace = workspaces.find((w) => w.id === wsId) ?? workspaces[0] ?? null;
  const access = useQuery({ queryKey: ["workspace-access", workspace?.id, me.data?.userId], enabled: !!workspace && !!me.data,
    queryFn: async () => {
      if (!workspace || !me.data) return null;
      if (current?.role === "owner") return "owner" as OrgRole;
      const result = await supabase.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", me.data.userId).maybeSingle();
      if (result.error) throw result.error;
      const role = result.data?.role;
      if (!role || !current) return null;
      return ROLE_RANK[role] < ROLE_RANK[current.role] ? role : current.role;
    },
  });

  const setOrgId = useCallback((id: string) => { localStorage.setItem(ORG_KEY, id); localStorage.removeItem(WS_KEY); setOrgIdState(id); setWsIdState(null); }, []);
  const setWorkspaceId = useCallback((id: string) => { localStorage.setItem(WS_KEY, id); setWsIdState(id); }, []);
  const refresh = useCallback(async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["workspaces"] }), qc.invalidateQueries({ queryKey: ["workspace-access"] })]); }, [qc]);

  const value = useMemo<OrgCtx>(() => ({
    userId: me.data?.userId ?? "", email: me.data?.email ?? "", memberships,
    org: current?.organizations ?? null, role: current?.role ?? null, workspaces, workspace,
    workspaceRole: access.data ?? null, error: me.isError || ws.isError || access.isError,
    setOrgId, setWorkspaceId, isPlatformStaff: me.data?.isPlatformStaff ?? false,
    loading: me.isLoading || (!!current && ws.isLoading) || (!!workspace && access.isLoading), refresh,
  }), [me.data, memberships, current, workspaces, workspace, setOrgId, setWorkspaceId, me.isLoading, ws.isLoading, access.data, access.isLoading, me.isError, ws.isError, access.isError, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrg must be used inside OrgProvider");
  return c;
}
