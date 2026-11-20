import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, LogOut, Zap, Menu, X, Sun, Moon, Search, ChevronRight, Sparkles, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrgProvider, useOrg } from "@/lib/org-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NAVIGATION, primaryNavigation } from "@/lib/navigation";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { pageHead } from "@/lib/page-head";
import { WorkspaceContext, WorkspaceTools } from "@/components/app/workspace-tools";
import { searchWorkspace, type WorkspaceSearchHit } from "@/lib/workspace-search";
import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_NAME, MESSAGES, isLocale, type MessageKey } from "@/lib/i18n/messages";
import { browserEnvironment } from "@/lib/environment";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => pageHead("Workspace", "Your business growth workspace."),
  component: () => <OrgProvider><Shell /></OrgProvider>,
});

function Shell() {
  const { t, locale, setLocale } = useI18n();
  const roleLabel = (r: string) => (`settings.role.${r}` in MESSAGES.en ? t(`settings.role.${r}` as MessageKey) : r);
  const kindLabel = (k: string) => (`pages.sh.kind.${k}` in MESSAGES.en ? t(`pages.sh.kind.${k}` as MessageKey) : k.replaceAll("_", " "));
  const navLabel = (to: string) => t(`nav.${to}` as MessageKey); const groupLabel = (g: string) => t(`nav.group.${g}` as MessageKey);
  const staging = browserEnvironment(import.meta.env["VITE_APP_ENVIRONMENT"]) === "staging";
  const o = useOrg(); const qc = useQueryClient(); const navigate = useNavigate();
  const path = useRouterState({ select: s => s.location.pathname });
  // Detail pages (e.g. /app/performance/<id>) belong to their parent destination.
  const isAt = (to: string) => to === path || (to !== "/app" && path.startsWith(`${to}/`));
  const group = NAVIGATION.find(g => g.items.some(it => isAt(it.to))) ?? NAVIGATION.find(g => g.group === "Knowledge");
  const current = group?.items.find(it => isAt(it.to));
  const [open, setOpen] = useState(false); const [search, setSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); const [debouncedTerm, setDebouncedTerm] = useState("");
  useEffect(() => { const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 250); return () => clearTimeout(timer); }, [searchTerm]);
  useEffect(() => { setSearchTerm(""); setDebouncedTerm(""); }, [o.org?.id, o.workspace?.id]);
  const records = useQuery({ queryKey: ["workspace-search", o.org?.id, o.workspace?.id, o.userId, debouncedTerm], enabled: search && !!o.org && !!o.workspace && debouncedTerm.length >= 2, queryFn: () => {
    if (!o.org || !o.workspace) return [];
    return searchWorkspace(supabase, { orgId: o.org.id, workspaceId: o.workspace.id, userId: o.userId }, debouncedTerm);
  } });
  function openRecord(hit: WorkspaceSearchHit) {
    setSearch(false); setOpen(false);
    if (hit.kind === "projects") navigate({ to: "/app/projects", search: { item: hit.id } });
    else if (hit.kind === "tasks") navigate({ to: "/app/tasks", search: { item: hit.id } });
    else if (hit.kind === "campaigns") navigate({ to: "/app/campaigns", search: { item: hit.id } });
    else navigate({ to: hit.kind === "documents" ? "/app/documents" : hit.kind === "business_facts" ? "/app/profile" : "/app/growth-officer" });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(s => !s); } if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (!open) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [open]);
  async function signOut() { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); navigate({ to: "/auth", search: { redirect: undefined }, replace: true }); }
  if (o.loading) return <div role="status" className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("pages.sh.opening")}</div>;
  if (o.error) return <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4"><p>{t("pages.sh.loadFailed")}</p><Button onClick={() => o.refresh()}>{t("pages.sh.retry")}</Button></div>;
  if (!o.memberships.length) return <CreateOrganization />;
  return <div className="flex min-h-screen bg-background">
    <a href="#main-content" className="sr-only z-50 focus:not-sr-only focus:fixed focus:bg-card focus:p-3">{t("shell.skip")}</a>
    <aside aria-label={t("pages.sh.mainNav")} className={cn("fixed inset-y-0 left-0 z-40 flex w-[224px] shrink-0 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-20 items-center justify-between px-5"><Link to="/app" className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Zap className="h-4 w-4" /></span><span className="text-sm font-bold leading-tight">Growth Engine<span className="block text-[10px] font-medium text-muted-foreground">BUSINESS OPERATING SYSTEM</span></span></Link><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)} aria-label={t("shell.closeMenu")}><X /></Button></div>
      <div className="mx-5 border-b border-border pb-4 text-xs text-muted-foreground"><p className="truncate font-medium text-foreground">{o.org?.name}</p><p className="mt-1 truncate">{o.workspace?.name ?? t("shell.noWorkspace")}</p></div>
      <nav className="flex-1 overflow-y-auto px-3 py-5"><div className="mb-3 px-2 section-label">{t("shell.workspace")}</div><div className="space-y-1">{primaryNavigation.map(it => <Button key={it.to} variant="ghost" asChild className={cn("h-auto min-h-9 w-full justify-start gap-3 whitespace-normal px-3 py-2 text-left text-sm text-muted-foreground", group?.group === it.group && "bg-card font-semibold text-foreground shadow-sm")}><Link to={it.to} onClick={() => setOpen(false)}><it.icon className={cn(group?.group === it.group && "text-primary")} />{groupLabel(it.group)}</Link></Button>)}</div><Button variant="ghost" onClick={() => setSearch(true)} className="mt-6 w-full justify-start gap-3 px-3 text-muted-foreground"><Search />{t("shell.searchActions")}</Button>{o.isPlatformStaff && <Button variant="ghost" className="mt-3 w-full justify-start" asChild><Link to="/admin"><Shield />{t("shell.ownerCenter")}</Link></Button>}</nav>
      <div className="border-t border-border p-3"><div className="flex items-center gap-2 px-2 py-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold">{o.email.slice(0,1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-xs font-medium">{o.email}</p><p className="mt-0.5 text-[10px] capitalize text-muted-foreground">{o.role ? roleLabel(o.role) : ""} · {o.workspaceRole ? roleLabel(o.workspaceRole) : t("pages.sh.noWsAccess")}</p></div></div><div className="px-2 pb-2"><select aria-label={t("shell.language")} title={t("shell.language")} value={locale} onChange={e => { if (isLocale(e.target.value)) setLocale(e.target.value); }} className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{LOCALES.map(l => <option key={l} value={l}>{LOCALE_NAME[l]}</option>)}</select></div><div className="flex items-center justify-between"><Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground"><LogOut />{t("shell.signOut")}</Button><Button variant="ghost" size="icon" aria-label={t("shell.theme")} title={t("shell.theme")} onClick={() => { const dark = document.documentElement.classList.toggle("dark"); localStorage.setItem("ago.theme", dark ? "dark" : "light"); }}><Sun className="hidden dark:block" /><Moon className="dark:hidden" /></Button></div></div>
    </aside>
    {open && <div className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" onClick={() => setOpen(false)} />}
    <CommandDialog open={search} onOpenChange={setSearch}><CommandInput value={searchTerm} onValueChange={setSearchTerm} maxLength={100} placeholder={t("shell.searchPlaceholder")} /><CommandList><CommandEmpty>{records.isFetching ? t("pages.sh.searching") : t("pages.sh.noMatches")}</CommandEmpty>{records.isError && <p role="alert" className="px-4 py-3 text-xs text-destructive">{t("pages.sh.recordsFailed")}<Button variant="link" size="sm" onClick={() => records.refetch()}>{t("pages.sh.retry")}</Button></p>}{!!records.data?.length && <CommandGroup heading={t("pages.sh.records")}>{records.data.map(hit => <CommandItem key={`${hit.kind}:${hit.id}`} value={`${searchTerm} ${hit.kind} ${hit.title}`} onSelect={() => openRecord(hit)}><Search /><span className="min-w-0 break-words"><span className="block">{hit.title}</span><span className="text-xs text-muted-foreground">{kindLabel(hit.kind)}</span></span></CommandItem>)}</CommandGroup>}<CommandGroup heading={t("pages.sh.quick")}><CommandItem onSelect={() => { setSearch(false); navigate({ to: "/app/growth-officer" }); }}><Sparkles />{t("pages.sh.ask")}</CommandItem><CommandItem onSelect={() => { setSearch(false); navigate({ to: "/app/onboarding" }); }}><Building2 />{t("pages.sh.reviewProfile")}</CommandItem></CommandGroup>{NAVIGATION.map(g => <CommandGroup key={g.group} heading={groupLabel(g.group)}>{g.items.map(it => <CommandItem key={it.to} value={`${g.group} ${it.label} ${navLabel(it.to)}`} onSelect={() => { setSearch(false); setOpen(false); navigate({ to: it.to }); }}><it.icon />{navLabel(it.to)}</CommandItem>)}</CommandGroup>)}</CommandList></CommandDialog>
    <main id="main-content" className="min-w-0 flex-1">
      <header className="flex h-16 items-center gap-1 border-b border-border px-3 sm:gap-3 md:px-8"><Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={() => setOpen(true)} aria-label={t("shell.openMenu")}><Menu /></Button><div className="min-w-0"><WorkspaceContext /></div>{staging && <span role="note" className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning" title={t("shell.staging")}><span className="sm:hidden">Staging</span><span className="hidden sm:inline">{t("shell.staging")}</span></span>}<span className="hidden text-xs text-muted-foreground xl:block">/ {current ? navLabel(current.to) : t("shell.discovery")}</span><div className="ml-auto flex shrink-0 items-center gap-1"><Button variant="ghost" size="sm" className="px-2 text-muted-foreground" onClick={() => setSearch(true)} aria-label={t("shell.search")} title={t("shell.searchActions")}><Search /><span className="hidden text-xs lg:inline">{t("shell.searchShort")}</span></Button><div key={`${o.userId}/${o.org?.id}/${o.workspace?.id}`}><WorkspaceTools /></div></div></header>
      {group && group.items.length > 1 && <nav aria-label={groupLabel(group.group)} className="flex gap-4 overflow-x-auto border-b border-border px-4 md:px-8">{group.items.map(it => <Link key={it.to} to={it.to} className="shrink-0 border-b-2 border-transparent py-3 text-xs font-medium text-muted-foreground hover:text-foreground" activeProps={{ className: "border-primary text-foreground" }}><span>{navLabel(it.to)}</span></Link>)}</nav>}
      <div key={`${o.org?.id}/${o.workspace?.id}`} className="app-content mx-auto max-w-[1320px] px-4 py-7 md:px-8 md:py-9 lg:px-10">{!o.workspace && <div role="status" className="mb-6 border-l-2 border-warning pl-4 text-sm">{t("pages.sh.noAssignment")}</div>}<Outlet /></div>
    </main>
  </div>;
}

function CreateOrganization() {
  const o = useOrg(); const navigate = useNavigate(); const { t } = useI18n();
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-md py-8">
        <div className="text-xs font-medium uppercase tracking-wider text-primary">{t("pages.co.kicker")}</div>
        <h1 className="mt-2 text-2xl font-bold">{t("pages.co.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pages.co.sub")}</p>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="org">{t("pages.co.org")}</Label><Input id="org" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." /></div>
          <div className="space-y-1.5"><Label htmlFor="ws">{t("pages.co.ws")} <span className="text-muted-foreground">{t("pages.co.optional")}</span></Label><Input id="ws" maxLength={120} value={ws} onChange={(e) => setWs(e.target.value)} placeholder={t("pages.co.wsPh")} /></div>
          <Button className="w-full" disabled={busy}>{busy ? t("pages.co.creating") : t("pages.co.continue")}</Button>
        </div>
      </form>
    </div>
  );
}
