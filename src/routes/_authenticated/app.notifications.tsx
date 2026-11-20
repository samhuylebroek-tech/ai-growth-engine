import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, Check, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localHead } from "@/lib/page-head";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { executionOptions, localDay } from "@/lib/execution";
import { commandCenterOptions } from "@/lib/command-center";
import { buildNotifications, notificationPreferenceKey } from "@/lib/notifications";

export const Route = createFileRoute("/_authenticated/app/notifications")({ head: () => localHead("notifications"), component: Notifications });
function Notifications() {
  const o = useOrg(); const { t: tx } = useI18n(); const t = tx as (k: string, v?: Record<string, string | number>) => string;
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const center = useQuery(commandCenterOptions(o.org?.id, o.workspace?.id, o.userId));
  const [read, setRead] = useState<string[]>([]); const [filter, setFilter] = useState("unread"); const [ready, setReady] = useState(false);
  const key = notificationPreferenceKey(o.userId, o.org?.id ?? "", o.workspace?.id ?? "");
  useEffect(() => { try { const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); setRead(Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string") : []); } catch { setRead([]); } setReady(true); }, [key]);
  function mark(ids: string[]) { const next = [...new Set([...read, ...ids])].slice(-2000); setRead(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Browser persistence may be unavailable. */ } }
  const notices = work.data && center.data ? buildNotifications({ tasks: work.data.tasks, approvals: work.data.approvals, runs: center.data.runs, documents: center.data.documents, connections: center.data.connections }, localDay()) : [];
  const unread = notices.filter(n => !read.includes(n.id));
  const visible = notices.filter(n => filter === "all" || (filter === "unread" && !read.includes(n.id)) || (filter === "urgent" && n.severity === "urgent"));
  return <div><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><p className="section-label mb-2">{t("pg.not.ws", { n: o.workspace?.name ?? "" })}</p><h1 className="text-2xl font-semibold">{t("pg.not.title")}</h1><p className="mt-2 text-xs text-muted-foreground">{t("pg.not.summary", { n: unread.length })}</p></div><Button variant="outline" size="sm" disabled={!ready || !unread.length} onClick={() => mark(unread.map(n => n.id))}><Check />{t("pg.not.markAll")}</Button></div><div className="mb-5 flex gap-1">{["unread", "urgent", "all"].map(f => <Button key={f} variant={filter === f ? "secondary" : "ghost"} size="sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`pg.not.f.${f}`)}</Button>)}</div>
    {work.isError || center.isError ? <p role="alert" className="text-sm text-destructive">{t("pg.not.failed")}<Button variant="link" onClick={() => { work.refetch(); center.refetch(); }}><RotateCcw />{t("pg.retry")}</Button></p> : work.isLoading || center.isLoading || !ready ? <p role="status" className="text-sm text-muted-foreground">{t("pg.not.loading")}</p> : visible.length ? <div className="divide-y divide-border border-y border-border">{visible.map(n => <article key={n.id} className="flex min-w-0 items-start gap-3 py-4"><Bell className={`mt-1 h-4 w-4 shrink-0 ${n.severity === "urgent" ? "text-destructive" : n.severity === "attention" ? "text-warning" : "text-muted-foreground"}`} /><div className="min-w-0 flex-1"><h2 className="break-words text-sm font-medium">{n.title}</h2><p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{n.detail}</p>{read.includes(n.id) && <p className="mt-1 text-[10px] text-muted-foreground">{t("pg.not.read")}</p>}</div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" disabled={read.includes(n.id)} aria-label={t("pg.not.markOne", { t: n.title })} onClick={() => mark([n.id])}><Check /></Button><Button variant="ghost" size="icon" asChild><Link to={n.to} aria-label={t("pg.not.open", { t: n.title })}><ArrowUpRight /></Link></Button></div></article>)}</div> : <p className="border-t border-border py-8 text-sm text-muted-foreground">{t(filter === "unread" ? "pg.not.upToDate" : "pg.not.noMatch")}</p>}
    <p className="mt-6 text-[10px] text-muted-foreground">{t("pg.not.footer")}</p>
  </div>;
}