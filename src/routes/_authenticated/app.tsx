import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Shield, LogOut, Zap, Menu, X, Sun, Moon, Search, ChevronDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrgProvider, useOrg } from "@/lib/org-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NAVIGATION } from "@/lib/navigation";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => pageHead("Workspace", "Your business growth workspace."),
  component: () => <OrgProvider><Shell /></OrgProvider>,
});

function Shell() {
  const o = useOrg();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const qc = useQueryClient(); const navigate = useNavigate();
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(s => !s); } if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  if (o.loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (o.error) return <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4"><p>Your workspace could not load.</p><Button onClick={() => o.refresh()}>Retry</Button></div>;
  if (o.memberships.length === 0) return <CreateOrganization />;

  return (
    <div className="flex min-h-screen bg-background">
      <a href="#main-content" className="sr-only z-50 focus:not-sr-only focus:fixed focus:bg-card focus:p-3">Skip to content</a>
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-5 py-5">
          <Link to="/app" className="flex items-center gap-2 font-display font-bold"><Zap className="h-4 w-4 text-primary" /> AI Growth OS</Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></Button>
        </div>
        <div className="px-3">
          <select
            aria-label="Organization"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={o.org?.id}
            onChange={(e) => { if (e.target.value === "__new") { navigate({ to: "/app/settings" }); return; } o.setOrgId(e.target.value); }}
          >
            {o.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.organizations?.name}</option>)}
          </select>
          {o.workspaces.length > 1 && (
            <select aria-label="Workspace" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={o.workspace?.id} onChange={(e) => o.setWorkspaceId(e.target.value)}>
              {o.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
          <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={() => setSearch(true)}><Search className="h-4 w-4" /> Search pages</Button>
          {NAVIGATION.map((g) => (
            <div key={g.group}>
              <Button variant="ghost" size="sm" className="mb-1 w-full justify-between px-3 text-xs text-muted-foreground" aria-expanded={!collapsed.includes(g.group)} onClick={() => setCollapsed(c => c.includes(g.group) ? c.filter(x => x !== g.group) : [...c, g.group])}>{g.group}<ChevronDown className={cn("h-3 w-3 transition-transform", collapsed.includes(g.group) && "-rotate-90")} /></Button>
              {!collapsed.includes(g.group) && g.items.map((it) => (
                <Link key={it.to} to={it.to} onClick={() => setOpen(false)} activeOptions={{ exact: "exact" in it }}
                   className="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                   activeProps={{ className: "bg-accent font-semibold text-primary" }}>
                  <it.icon className="h-4 w-4" /> {it.label}
                </Link>
              ))}
            </div>
          ))}
          {o.isPlatformStaff && (
            <div>
              <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Platform</div>
              <Link to="/admin" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"><Shield className="h-4 w-4" /> Owner center</Link>
            </div>
          )}
        </nav>
        <div className="border-t border-border p-3">
          <div className="truncate px-3 text-xs text-muted-foreground">{o.email}</div>
          <div className="px-3 text-[11px] capitalize text-muted-foreground/70">{o.role}</div>
          <div className="mt-2 flex items-center justify-between"><Button variant="ghost" onClick={signOut} className="text-muted-foreground"><LogOut className="h-4 w-4" /> Sign out</Button><Button variant="ghost" size="icon" aria-label="Toggle color theme" title="Toggle color theme" onClick={() => { const dark = document.documentElement.classList.toggle("dark"); localStorage.setItem("ago.theme", dark ? "dark" : "light"); }}><Sun className="hidden dark:block" /><Moon className="dark:hidden" /></Button></div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" onClick={() => setOpen(false)} />}
      <CommandDialog open={search} onOpenChange={setSearch}><CommandInput placeholder="Find a page…" /><CommandList><CommandEmpty>No matching pages.</CommandEmpty>{NAVIGATION.map(g => <CommandGroup key={g.group} heading={g.group}>{g.items.map(it => <CommandItem key={it.to} value={`${g.group} ${it.label}`} onSelect={() => { setSearch(false); setOpen(false); navigate({ to: it.to }); }}><it.icon />{it.label}</CommandItem>)}</CommandGroup>)}</CommandList></CommandDialog>
      <main id="main-content" className="min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
          <span className="font-display font-bold">AI Growth OS</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setSearch(true)} aria-label="Search pages"><Search /></Button>
        </div>
        <div key={`${o.org?.id}/${o.workspace?.id}`} className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{!o.workspace && <div role="status" className="mb-6 border-l-2 border-warning pl-4 text-sm">No workspace access has been assigned. Ask your organization owner to assign access.</div>}<Outlet /></div>
      </main>
    </div>
  );
}

function CreateOrganization() {
  const o = useOrg(); const navigate = useNavigate();
  const [name, setName] = useState(""); const [ws, setWs] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { data, error } = await supabase.rpc("create_organization", { _name: name, _workspace_name: ws || name });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    o.setOrgId(data as string); await o.refresh();
    navigate({ to: "/app/onboarding" });
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-glow px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        <div className="text-xs font-medium uppercase tracking-wider text-primary">Step 1 of 2</div>
        <h1 className="mt-2 text-2xl font-bold">Create your organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">You'll start on a 14-day free trial with 200 AI credits. No card needed.</p>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="org">Organization name</Label><Input id="org" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." /></div>
          <div className="space-y-1.5"><Label htmlFor="ws">First brand or workspace <span className="text-muted-foreground">(optional)</span></Label><Input id="ws" maxLength={120} value={ws} onChange={(e) => setWs(e.target.value)} placeholder="Same as organization" /></div>
          <Button className="w-full" disabled={busy}>{busy ? "Creating…" : "Continue"}</Button>
        </div>
      </form>
    </div>
  );
}
