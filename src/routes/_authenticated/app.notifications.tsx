import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/status";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, Check, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localHead } from "@/lib/page-head";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { executionOptions, localDay } from "@/lib/execution";
import { commandCenterOptions } from "@/lib/command-center";
import { buildNotifications, notificationPreferenceKey, type Notice } from "@/lib/notifications";
import { AGENTS } from "@/lib/registry/agents";
import { CONNECTORS } from "@/lib/registry/connectors";
import { agentText } from "@/lib/i18n/registry-text";
import { plainPreview } from "@/lib/text-preview";

export const Route = createFileRoute("/_authenticated/app/notifications")({
  head: () => localHead("notifications"),
  component: Notifications,
});
function Notifications() {
  const o = useOrg();
  const { t: tx, tag } = useI18n();
  const t = tx as (k: string, v?: Record<string, string | number>) => string;
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const center = useQuery(commandCenterOptions(o.org?.id, o.workspace?.id, o.userId));
  const [read, setRead] = useState<string[]>([]);
  const [filter, setFilter] = useState("unread");
  const [ready, setReady] = useState(false);
  const key = notificationPreferenceKey(o.userId, o.org?.id ?? "", o.workspace?.id ?? "");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      setRead(Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string") : []);
    } catch {
      setRead([]);
    }
    setReady(true);
  }, [key]);
  function mark(ids: string[]) {
    const next = [...new Set([...read, ...ids])].slice(-2000);
    setRead(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Browser persistence may be unavailable. */
    }
  }
  const notices =
    work.data && center.data
      ? buildNotifications(
          {
            tasks: work.data.tasks,
            approvals: work.data.approvals,
            runs: center.data.runs,
            documents: center.data.documents,
            connections: center.data.connections,
          },
          localDay(),
        )
      : [];
  const unread = notices.filter((n) => !read.includes(n.id));
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(tag);
  /** Title and detail in the chosen language; record titles and AI summaries stay as written. */
  function words(n: Notice): { title: string; detail: string } {
    const agent = AGENTS.find((a) => a.key === n.subject);
    const who = agent ? agentText(t, agent).name : (n.subject ?? "").replace(/_/g, " ");
    const connector = CONNECTORS.find((c) => c.key === n.subject)?.name ?? who;
    switch (n.kind) {
      case "task_overdue":
        return { title: n.title, detail: t("pg.not.k.overdue", { d: n.date ? date(n.date) : "" }) };
      case "task_today":
        return { title: n.title, detail: t("pg.not.k.today") };
      case "approval":
        return { title: n.title, detail: t("pg.not.k.approval") };
      case "run_failed":
      case "run_done":
        return {
          title: t(n.kind === "run_failed" ? "pg.not.k.runFailed" : "pg.not.k.runDone", { a: who }),
          detail: n.text ? plainPreview(n.text, 220) : t("pg.not.k.run"),
        };
      case "document_failed":
        return { title: n.title, detail: t("pg.not.k.document") };
      case "connection_failed":
        return { title: connector, detail: t("pg.not.k.connection", { s: n.text ?? "" }) };
    }
  }
  const visible = notices.filter(
    (n) =>
      filter === "all" ||
      (filter === "unread" && !read.includes(n.id)) ||
      (filter === "urgent" && n.severity === "urgent"),
  );
  return (
    <div>
      <PageHeader
        eyebrow={t("pg.not.ws", { n: o.workspace?.name ?? "" })}
        title={t("pg.not.title")}
        description={t("ph.notifications")}
        meta={t("pg.not.summary", { n: unread.length })}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || !unread.length}
            onClick={() => mark(unread.map((n) => n.id))}
          >
            <Check />
            {t("pg.not.markAll")}
          </Button>
        }
      />
      <div className="mb-5 flex gap-1">
        {["unread", "urgent", "all"].map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`pg.not.f.${f}`)}
          </Button>
        ))}
      </div>
      {work.isError || center.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("pg.not.failed")}
          <Button
            variant="link"
            onClick={() => {
              work.refetch();
              center.refetch();
            }}
          >
            <RotateCcw />
            {t("pg.retry")}
          </Button>
        </p>
      ) : work.isLoading || center.isLoading || !ready ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pg.not.loading")}
        </p>
      ) : visible.length ? (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((n) => {
            const w = words(n);
            return (
              <article key={n.id} className="flex min-w-0 items-start gap-3 py-4">
                <Bell
                  className={`mt-1 h-4 w-4 shrink-0 ${n.severity === "urgent" ? "text-destructive" : n.severity === "attention" ? "text-warning" : "text-muted-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-sm font-medium">{w.title}</h2>
                  <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                    {w.detail}
                  </p>
                  {read.includes(n.id) && (
                    <p className="mt-1 text-2xs text-muted-foreground">{t("pg.not.read")}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={read.includes(n.id)}
                    aria-label={t("pg.not.markOne", { t: w.title })}
                    onClick={() => mark([n.id])}
                  >
                    <Check />
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <Link to={n.to} aria-label={t("pg.not.open", { t: w.title })}>
                      <ArrowUpRight />
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="border-t border-border py-8 text-sm text-muted-foreground">
          {t(filter === "unread" ? "pg.not.upToDate" : "pg.not.noMatch")}
        </p>
      )}
      <p className="mt-6 text-2xs text-muted-foreground">{t("pg.not.footer")}</p>
    </div>
  );
}
