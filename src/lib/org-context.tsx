import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OrgRole } from "@/lib/permissions";

export interface Membership { org_id: string; role: OrgRole; organizations: { id: string; name: string; type: string; status: string } | null }
export interface Workspace { id: string; org_id: string; name: string; kind: string }

interface OrgCtx {
  userId: string; email: string;
  memberships: Membership[];
  org: Membership["organizations"]; role: OrgRole | null;
  workspaces: Workspace[]; workspace: Workspace | null;
  setOrgId: (id: string) => void; setWorkspaceId: (id: string) => void;
  isPlatformStaff: boolean; loading: boolean; refresh: () => Promise<void>;
}
const Ctx = createContext<OrgCtx | null>(null);

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
      const [{ data: m }, { data: staff }] = await Promise.all([
        supabase.from("organization_members").select("org_id, role, organizations(id,name,type,status)").eq("user_id", user.id),
        supabase.rpc("is_platform_staff"),
      ]);
      return { userId: user.id, email: user.email ?? "", memberships: (m ?? []) as Membership[], isPlatformStaff: !!staff };
    },
  });
  const memberships = (me.data?.memberships ?? []).filter((m) => m.organizations?.status === "active");
  const current = memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null;

  const ws = useQuery({
    queryKey: ["workspaces", current?.org_id],
    enabled: !!current,
    queryFn: async () => (await supabase.from("workspaces").select("id,org_id,name,kind").eq("org_id", current!.org_id).order("created_at")).data ?? [],
  });
  const workspaces = ws.data ?? [];
  const workspace = workspaces.find((w) => w.id === wsId) ?? workspaces[0] ?? null;

  const setOrgId = useCallback((id: string) => { localStorage.setItem(ORG_KEY, id); localStorage.removeItem(WS_KEY); setOrgIdState(id); setWsIdState(null); }, []);
  const setWorkspaceId = useCallback((id: string) => { localStorage.setItem(WS_KEY, id); setWsIdState(id); }, []);
  const refresh = useCallback(async () => { await qc.invalidateQueries({ queryKey: ["me"] }); await qc.invalidateQueries({ queryKey: ["workspaces"] }); }, [qc]);

  const value = useMemo<OrgCtx>(() => ({
    userId: me.data?.userId ?? "", email: me.data?.email ?? "", memberships,
    org: current?.organizations ?? null, role: current?.role ?? null, workspaces, workspace,
    setOrgId, setWorkspaceId, isPlatformStaff: me.data?.isPlatformStaff ?? false,
    loading: me.isLoading || (!!current && ws.isLoading), refresh,
  }), [me.data, memberships, current, workspaces, workspace, setOrgId, setWorkspaceId, me.isLoading, ws.isLoading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrg must be used inside OrgProvider");
  return c;
}
