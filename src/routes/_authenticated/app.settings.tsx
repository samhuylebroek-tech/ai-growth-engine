import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { assignableRoles, can, hasRole, type OrgRole } from "@/lib/permissions";
import { PageHeader, Panel } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/app/settings")({ head: () => pageHead("Organization settings", "Manage workspaces, invitations and team."), component: SettingsPage });

function SettingsPage() {
  const o = useOrg(); const qc = useQueryClient(); const orgId = o.org?.id; const admin = can(o.role, "members.manage");
  const [orgName, setOrgName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState<OrgRole>("member");
  const [wsName, setWsName] = useState(""); const [newOrg, setNewOrg] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const assignments = useQuery({ queryKey: ["workspace-assignments", orgId], enabled: !!orgId && o.role === "owner", queryFn: async () => {
    const ids = o.workspaces.map(w => w.id); if (!ids.length) return [];
    const result = await supabase.from("workspace_members").select("workspace_id,user_id,role").in("workspace_id", ids);
    if (result.error) throw result.error; return result.data ?? [];
  } });
  async function assignWorkspace(workspaceId: string, userId: string, role: string) {
    const { error } = await supabase.rpc("set_workspace_member", { _workspace: workspaceId, _user: userId, ...(role === "none" ? {} : { _role: role as OrgRole }) });
    if (error) { toast.error(error.message); return; }
    toast.success("Workspace access saved"); await qc.invalidateQueries({ queryKey: ["workspace-assignments", orgId] }); await o.refresh();
  }
  const members = useQuery({ queryKey: ["members", orgId], enabled: !!orgId, queryFn: async () => {
    const { data: m } = await supabase.from("organization_members").select("user_id,role,created_at").eq("org_id", orgId!);
    const ids = (m ?? []).map((x) => x.user_id);
    const { data: p } = ids.length ? await supabase.from("profiles").select("user_id,display_name").in("user_id", ids) : { data: [] };
    const names = new Map((p ?? []).map((x) => [x.user_id, x.display_name]));
    return (m ?? []).map((x) => ({ ...x, name: names.get(x.user_id) ?? "Member" }));
  } });
  const invites = useQuery({ queryKey: ["invites", orgId], enabled: !!orgId && admin, queryFn: async () => (await supabase.from("invitations").select("*").eq("org_id", orgId!).is("accepted_at", null).order("created_at", { ascending: false })).data ?? [] });

  async function rename(e: React.FormEvent) { e.preventDefault(); if (!orgId || !o.org) return; const { error } = await supabase.from("organizations").update({ name: orgName.trim() || o.org.name }).eq("id", orgId); if (error) toast.error("Not allowed"); else { toast.success("Saved"); await supabase.rpc("log_audit", { _org: orgId, _action: "organization.renamed", _target_type: "organization", _target_id: orgId }); o.refresh(); } }
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("create_invitation", { _org: orgId!, _email: email, _role: role });
    if (error) { toast.error(error.message); return; }
    setEmail(""); qc.invalidateQueries({ queryKey: ["invites"] }); toast.success("Invitation created — copy the link and send it yourself.");
  }
  async function changeRole(userId: string, r: OrgRole) { const { error } = await supabase.from("organization_members").update({ role: r }).eq("org_id", orgId!).eq("user_id", userId); if (error) toast.error("Not allowed"); else await supabase.rpc("log_audit", { _org: orgId!, _action: "member.role_changed", _target_type: "user", _target_id: userId, _metadata: { role: r } }); qc.invalidateQueries({ queryKey: ["members"] }); }
  async function removeMember(userId: string) { const { error } = await supabase.from("organization_members").delete().eq("org_id", orgId!).eq("user_id", userId); if (error) toast.error("Not allowed"); else await supabase.rpc("log_audit", { _org: orgId!, _action: "member.removed", _target_type: "user", _target_id: userId }); qc.invalidateQueries({ queryKey: ["members"] }); }
  async function addWs(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || creatingWs) return;
    setCreatingWs(true);
    try {
      const { data, error } = await supabase.rpc("create_workspace", { _org: orgId, _name: wsName.trim() });
      if (error) { toast.error(error.message); return; }
      setWsName(""); if (data) o.setWorkspaceId(data); await o.refresh(); toast.success("Workspace created");
    } finally { setCreatingWs(false); }
  }
  async function createOrg(e: React.FormEvent) { e.preventDefault(); const { data, error } = await supabase.rpc("create_organization", { _name: newOrg, _workspace_name: newOrg }); if (error) toast.error(error.message); else { setNewOrg(""); o.setOrgId(data as string); o.refresh(); } }
  const link = (t: string) => `${window.location.origin}/invite/${t}`;

  return (
    <>
      <PageHeader title="Organization" description={`${o.org?.name} · your role: ${o.role}`} />
      <div className="grid gap-4 md:grid-cols-2">
        {can(o.role, "org.update") && <Panel><form onSubmit={rename} className="space-y-3"><Label>Organization name</Label><Input defaultValue={o.org?.name} onChange={(e) => setOrgName(e.target.value)} required maxLength={120} /><Button size="sm">Save</Button></form></Panel>}
        {can(o.role, "workspace.create") && <Panel><form onSubmit={addWs} className="space-y-3"><Label htmlFor="new-workspace">Add a brand or workspace</Label><Input id="new-workspace" value={wsName} onChange={(e) => setWsName(e.target.value)} required maxLength={120} placeholder="e.g. Second brand" /><Button size="sm" disabled={creatingWs}>{creatingWs ? "Creating…" : "Create workspace"}</Button></form></Panel>}
      </div>
      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Workspaces & access</h2>
        {assignments.isError && <p role="alert" className="text-sm text-destructive">Workspace access could not load. <Button variant="link" onClick={() => assignments.refetch()}>Retry</Button></p>}
        <div className="divide-y divide-border">{o.workspaces.map(w => <div key={w.id} className="py-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{w.name}</h3><Button variant="outline" size="sm" onClick={() => o.setWorkspaceId(w.id)} disabled={o.workspace?.id === w.id}>{o.workspace?.id === w.id ? "Selected" : "Open workspace"}</Button></div>
          {o.role === "owner" && members.data?.filter(m => m.role !== "owner").map(m => <div key={m.user_id} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{m.name}</span><select aria-label={`Workspace access for ${m.name} in ${w.name}`} className="rounded-md border border-border bg-background px-3" disabled={assignments.isLoading} value={assignments.data?.find(a => a.user_id === m.user_id && a.workspace_id === w.id)?.role ?? "none"} onChange={e => assignWorkspace(w.id, m.user_id, e.target.value)}><option value="none">No access</option>{(["viewer", "member", "admin"] as const).filter(r => hasRole(m.role, r)).map(r => <option key={r} value={r}>{r}</option>)}</select></div>)}
        </div>)}</div>
        <p className="mt-2 text-xs text-muted-foreground">Organization owners can administer all workspaces. Other team members need an explicit assignment.</p>
      </section>
      <h2 className="mb-3 mt-10 font-semibold">Members</h2>
      <div className="divide-y divide-border rounded-lg border border-border">{members.data?.map((m) => (
        <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="flex-1">{m.user_id === o.userId ? `You (${o.email})` : m.name}</span>
          {admin && m.role !== "owner" && m.user_id !== o.userId ? (
            <>
              <select className="rounded-md border border-input bg-background px-2 py-1 text-sm" value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as OrgRole)}>{assignableRoles(o.role).map((r) => <option key={r} value={r}>{r}</option>)}</select>
              <Button size="sm" variant="ghost" onClick={() => removeMember(m.user_id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </>
          ) : <span className="capitalize">{m.role}</span>}
        </div>
      ))}</div>
      {admin && (
        <>
          <form onSubmit={invite} className="mt-4 flex flex-wrap gap-2">
            <Input type="email" required placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
            <select className="rounded-md border border-input bg-background px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>{assignableRoles(o.role).map((r) => <option key={r}>{r}</option>)}</select>
            <Button type="submit">Create invite link</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Invitation emails are not sent automatically yet. Copy the link and share it. It works only for that email address and expires in 7 days.</p>
          {invites.data?.length ? <div className="mt-3 divide-y divide-border rounded-lg border border-border">{invites.data.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"><span className="flex-1">{i.email} · <span className="capitalize text-muted-foreground">{i.role}</span></span>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(link(i.token)); toast.success("Link copied"); }}><Copy className="mr-1 h-3.5 w-3.5" /> Copy link</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("invitations").delete().eq("id", i.id); qc.invalidateQueries({ queryKey: ["invites"] }); }} aria-label="Revoke"><Trash2 className="h-4 w-4" /></Button></div>
          ))}</div> : null}
        </>
      )}
      <h2 className="mb-3 mt-10 font-semibold">Another organization</h2>
      <form onSubmit={createOrg} className="flex gap-2"><Input placeholder="New organization name" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} required maxLength={120} className="max-w-xs" /><Button variant="outline">Create</Button></form>
    </>
  );
}
