import { useState } from "react";
import { PageHeader } from "@/components/app/status";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, ListPlus, Plug } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { runSeoAudit } from "@/lib/seo.functions";
import { severityRank, type SeoFinding, type SeoPage } from "@/lib/seo-audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";

/** Findings are stored in English by the deterministic checker; show them in the chosen language by their code. */
function findingText(
  f: SeoFinding,
  tx: (k: MessageKey, v?: Record<string, string | number>) => string,
) {
  const key = `marketing.seo.c.${f.code}`;
  if (!(key in MESSAGES.en)) return f.message;
  const n = /\d+/.exec(f.message)?.[0] ?? "";
  const p =
    f.code === "title_duplicate" ? f.message.replace(/^Same title as /, "").replace(/\.$/, "") : "";
  return tx(key as MessageKey, { n, p });
}

export function SeoWorkspace() {
  const o = useOrg();
  const { t: tx } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{tx("marketing.seo.loading")}</p>;
  if (!o.workspace || !o.org)
    return <p className="p-6 text-muted-foreground">{tx("marketing.seo.chooseWs")}</p>;
  return (
    <Seo
      key={o.workspace.id}
      orgId={o.org.id}
      wsId={o.workspace.id}
      userId={o.userId}
      canEdit={hasRole(o.workspaceRole, "member")}
    />
  );
}

const sevVariant = { high: "destructive", medium: "default", low: "secondary" } as const;

function Seo({
  orgId,
  wsId,
  userId,
  canEdit,
}: {
  orgId: string;
  wsId: string;
  userId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const run = useServerFn(runSeoAudit);
  const { t: tx, tag } = useI18n();
  const site = useQuery({
    queryKey: ["seo-site", wsId],
    queryFn: async () =>
      (
        await supabase
          .from("business_profiles")
          .select("website")
          .eq("workspace_id", wsId)
          .maybeSingle()
      ).data?.website ?? "",
  });
  const audits = useQuery({
    queryKey: ["seo-audits", wsId],
    queryFn: async () => {
      const r = await supabase
        .from("seo_audits")
        .select("id,site_url,page_count,created_at,robots,sitemap,pages,findings")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [sev, setSev] = useState<"all" | SeoFinding["severity"]>("all");
  const [made, setMade] = useState<Set<string>>(new Set());
  const existing = useQuery({
    queryKey: ["seo-tasks", wsId],
    queryFn: async () => {
      const r = await supabase
        .from("tasks")
        .select("title,description")
        .eq("workspace_id", wsId)
        .contains("labels", ["seo"])
        .limit(500);
      return new Set((r.data ?? []).map((t) => `${t.title}|${t.description.split("\n")[0]}`));
    },
  });
  const taskKey = (f: SeoFinding) => `${`SEO: ${f.message}`.slice(0, 200)}|Page: ${f.url}`;
  const target = url || site.data || "";
  const current = audits.data?.find((a) => a.id === picked) ?? audits.data?.[0];
  const findings = ((current?.findings ?? []) as SeoFinding[])
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const pages = (current?.pages ?? []) as SeoPage[];
  const robots = (current?.robots ?? {}) as { found?: boolean; blocksAll?: boolean };
  const sitemap = (current?.sitemap ?? {}) as { found?: boolean; urls?: number };
  const count = (s: SeoFinding["severity"]) => findings.filter((f) => f.severity === s).length;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim() || busy) return;
    setBusy(true);
    try {
      const r = await run({ data: { workspaceId: wsId, url: target } });
      if (!r.ok)
        return void toast.error(
          r.error === "not_registered" ? tx("marketing.seo.notRegistered") : r.error,
        );
      setPicked(r.id);
      await qc.invalidateQueries({ queryKey: ["seo-audits", wsId] });
      toast.success(tx("marketing.seo.done"));
    } catch {
      toast.error(tx("marketing.seo.failed"));
    } finally {
      setBusy(false);
    }
  };
  const toTask = async (f: SeoFinding) => {
    const key = taskKey(f);
    if (existing.data?.has(key)) return;
    const r = await supabase.from("tasks").insert({
      org_id: orgId,
      workspace_id: wsId,
      title: `SEO: ${f.message}`.slice(0, 200),
      description: `Page: ${f.url}\nFound by the website check on ${new Date(current?.created_at ?? Date.now()).toLocaleDateString()}.`,
      priority: f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low",
      labels: ["seo", f.code],
      owner_id: userId,
      created_by: userId,
    });
    if (r.error) return void toast.error(tx("marketing.seo.taskFailed"));
    setMade((s) => new Set(s).add(key));
    toast.success(tx("marketing.seo.taskAdded"));
    qc.invalidateQueries({ queryKey: ["execution"] });
  };

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader title={tx("ph.seo.title")} description={tx("marketing.seo.intro")} />
      <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label={tx("marketing.seo.site")}
          inputMode="url"
          placeholder="https://yourbusiness.com"
          value={target}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={500}
          className="min-h-11 flex-1"
        />
        <Button disabled={!canEdit || busy || !target.trim()} className="min-h-11">
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          {busy ? tx("marketing.seo.checking") : tx("marketing.seo.check")}
        </Button>
      </form>
      {!canEdit && (
        <p className="text-sm text-muted-foreground">{tx("marketing.seo.memberNeeded")}</p>
      )}
      <p className="text-xs text-muted-foreground">{tx("marketing.seo.reads")}</p>

      {audits.isLoading ? (
        <p className="text-muted-foreground">{tx("marketing.seo.loading")}</p>
      ) : !current ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          {tx("marketing.seo.none")}
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label={tx("marketing.seo.pages")} value={String(current.page_count)} />
            <Stat label={tx("marketing.seo.high")} value={String(count("high"))} />
            <Stat label={tx("marketing.seo.medium")} value={String(count("medium"))} />
            <Stat
              label="robots.txt"
              value={
                !robots.found
                  ? tx("marketing.seo.notFound")
                  : robots.blocksAll
                    ? tx("marketing.seo.blocksAll")
                    : tx("marketing.seo.found")
              }
            />
            <Stat
              label={tx("marketing.seo.sitemap")}
              value={
                sitemap.found
                  ? tx("marketing.seo.urls", { n: sitemap.urls ?? 0 })
                  : tx("marketing.seo.notFound")
              }
            />
          </section>
          {(audits.data?.length ?? 0) > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{tx("marketing.seo.earlier")}</span>
              {audits.data!.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant={a.id === current.id ? "default" : "outline"}
                  onClick={() => setPicked(a.id)}
                >
                  {new Date(a.created_at).toLocaleString(tag, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}{" "}
                  · {(a.findings as SeoFinding[]).length}
                </Button>
              ))}
            </div>
          )}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {tx("marketing.seo.findings", { s: current.site_url })}
              </h2>
              <div className="flex gap-1">
                {(["all", "high", "medium", "low"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={sev === s ? "default" : "ghost"}
                    onClick={() => setSev(s)}
                  >
                    {tx(`marketing.seo.sev.${s}`)}
                  </Button>
                ))}
              </div>
            </div>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tx("marketing.seo.noIssues")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {findings
                  .filter((f) => sev === "all" || f.severity === sev)
                  .slice(0, 150)
                  .map((f, i) => {
                    const key = taskKey(f);
                    const done = made.has(key) || !!existing.data?.has(key);
                    return (
                      <li key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                        <Badge variant={sevVariant[f.severity]} className="w-fit">
                          {tx(`marketing.seo.sev.${f.severity}`)}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{findingText(f, tx)}</p>
                          <p className="truncate text-xs text-muted-foreground">{f.url}</p>
                        </div>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={done}
                            onClick={() => toTask(f)}
                          >
                            <ListPlus />
                            {done ? tx("marketing.seo.taskDone") : tx("marketing.seo.createTask")}
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{tx("marketing.seo.pagesTitle")}</h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">{tx("marketing.seo.th.page")}</th>
                    <th className="p-2">{tx("marketing.seo.th.title")}</th>
                    <th className="p-2">H1</th>
                    <th className="p-2">{tx("marketing.seo.th.words")}</th>
                    <th className="p-2">{tx("marketing.seo.th.links")}</th>
                    <th className="p-2">{tx("marketing.seo.th.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.url} className="border-t border-border">
                      <td className="max-w-[220px] truncate p-2">{new URL(p.url).pathname}</td>
                      <td className="max-w-[240px] truncate p-2">{p.title || "—"}</td>
                      <td className="p-2">{p.h1.length}</td>
                      <td className="p-2">{p.words}</td>
                      <td className="p-2">
                        {p.internalLinks}/{p.externalLinks}
                      </td>
                      <td className="p-2">{p.noindex ? "noindex" : p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <section className="rounded-md border border-border p-4">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          <h2 className="font-semibold">{tx("marketing.seo.gsc")}</h2>
          <Badge variant="outline">{tx("marketing.seo.notConfigured")}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{tx("marketing.seo.gscBody")}</p>
      </section>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
