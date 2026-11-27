import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { collectPages, pageSlice } from "@/lib/pagination";
import { createDraftWriter } from "@/lib/draft-writer";
import { PageHeader } from "@/components/app/status";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, History, GitCompare, RotateCcw, Check, X, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { CHANNELS, diffLines, versionApproved } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DraftPanel } from "@/components/content/draft-panel";
import { ReviewPanel } from "@/components/content/review-panel";
import { RepurposePanel } from "@/components/content/repurpose-panel";
import { EditorialCalendar } from "@/components/content/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
const csKey = (prefix: string, s: string) => `marketing.cs.${prefix}.${s}`;
const csLabel = (tx: (k: MessageKey) => string, prefix: string, s: string) =>
  csKey(prefix, s) in MESSAGES.en ? tx(csKey(prefix, s) as MessageKey) : s;

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function ContentStudio({
  initialCampaign,
  initialAsset,
}: { initialCampaign?: string | undefined; initialAsset?: string | undefined } = {}) {
  const { workspace, org, workspaceRole, loading, userId } = useOrg();
  const { t: tx } = useI18n();
  if (loading) return <p className="p-6 text-muted-foreground">{tx("marketing.cs.loading")}</p>;
  if (!workspace || !org)
    return <p className="p-6 text-muted-foreground">{tx("marketing.cs.chooseWs")}</p>;
  return (
    <Studio
      key={`${org.id}/${workspace.id}`}
      orgId={org.id}
      wsId={workspace.id}
      role={workspaceRole}
      userId={userId}
      initialCampaign={initialCampaign}
      initialAsset={initialAsset}
    />
  );
}

function Studio({
  orgId,
  wsId,
  role,
  userId,
  initialCampaign,
  initialAsset,
}: {
  orgId: string;
  wsId: string;
  role: ReturnType<typeof useOrg>["workspaceRole"];
  userId: string;
  initialCampaign?: string | undefined;
  initialAsset?: string | undefined;
}) {
  const [tab, setTab] = useState("library");
  const { t: tx, tag } = useI18n();
  const canEdit = hasRole(role, "member");
  const [selected, setSelected] = useState<string | null>(initialAsset ?? null);
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const openAsset = (id: string) => {
    if (dirty) return void toast.info(tx("marketing.care.keepDraft"));
    setSelected(id);
  };
  const qc = useQueryClient();
  const assets = useQuery({
    queryKey: ["content-assets", wsId],
    queryFn: async () => {
      const watermark = new Date().toISOString();
      const rows = await collectPages(async (cursor, size) => {
        let q = supabase
          .from("content_assets")
          .select("id,title,channel,status,planned_date,updated_at,campaign_id")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
  });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [libraryPage, setLibraryPage] = useState(1);
  const create = async () => {
    if (creating || !canEdit || dirty) return;
    setCreating(true);
    try {
      const r = await supabase
        .from("content_assets")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          title: tx("marketing.cs.untitled"),
          campaign_id: initialCampaign ?? null,
        })
        .select("id")
        .single();
      if (r.error) return void toast.error(tx("marketing.cs.createFailed"));
      await qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
      setSelected(r.data.id);
    } catch {
      toast.error(tx("marketing.cs.createFailed"));
    } finally {
      setCreating(false);
    }
  };
  const visibleAssets = (assets.data ?? []).filter(
    (a) =>
      (!initialCampaign || a.campaign_id === initialCampaign) &&
      a.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const library = pageSlice(visibleAssets, libraryPage);
  return (
    <div className="space-y-6">
      <PageHeader
        title={tx("ph.content.title")}
        description={tx("marketing.cs.intro")}
        actions={
          canEdit && (
            <Button onClick={create} disabled={creating || dirty}>
              <Plus className="mr-1 h-4 w-4" />
              {tx("marketing.cs.new")}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (dirty) return void toast.info(tx("marketing.care.keepDraft"));
          setTab(next);
        }}
      >
        <TabsList>
          <TabsTrigger value="library">{tx("marketing.cs.tab.library")}</TabsTrigger>
          <TabsTrigger value="calendar">{tx("marketing.cs.tab.calendar")}</TabsTrigger>
          <TabsTrigger value="profiles">{tx("marketing.cs.tab.profiles")}</TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1 rounded-lg border bg-card p-2">
            <Input
              type="search"
              aria-label={tx("marketing.care.searchContent")}
              placeholder={tx("marketing.care.searchContent")}
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLibraryPage(1);
              }}
            />
            {assets.isError && (
              <p className="p-2 text-sm text-destructive">
                {tx("marketing.cs.loadFailed")}{" "}
                <Button variant="link" size="sm" onClick={() => void assets.refetch()}>
                  {tx("marketing.cs.retry")}
                </Button>
              </p>
            )}
            {assets.data && visibleAssets.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                {tx("marketing.cs.none")}{" "}
                {canEdit ? tx("marketing.cs.createFirst") : tx("marketing.cs.askMember")}
              </p>
            )}
            {library.rows.map((a) => (
              <Button
                variant="ghost"
                key={a.id}
                onClick={() => openAsset(a.id)}
                className={`h-auto w-full flex-col items-start whitespace-normal rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${selected === a.id ? "bg-accent" : ""}`}
              >
                <div className="w-full truncate font-medium" title={a.title}>
                  {a.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {csLabel(tx, "ch", a.channel)} · {csLabel(tx, "st", a.status)}
                  {a.planned_date
                    ? ` · ${new Date(`${a.planned_date}T12:00:00`).toLocaleDateString(tag)}`
                    : ""}
                </div>
              </Button>
            ))}
            {library.pages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={library.page === 1}
                  aria-label={tx("lead.previousPages")}
                  onClick={() => setLibraryPage(library.page - 1)}
                >
                  ←
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {library.page} / {library.pages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={library.page === library.pages}
                  aria-label={tx("lead.nextPages")}
                  onClick={() => setLibraryPage(library.page + 1)}
                >
                  →
                </Button>
              </div>
            )}
          </aside>
          {selected &&
          (!initialCampaign ||
            assets.data?.some((a) => a.id === selected && a.campaign_id === initialCampaign)) ? (
            <Editor
              key={selected}
              id={selected}
              wsId={wsId}
              orgId={orgId}
              canEdit={canEdit}
              canDecide={hasRole(role, "admin")}
              userId={userId}
              onDirty={setDirty}
            />
          ) : (
            <div className="grid place-items-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
              {tx("marketing.cs.select")}
            </div>
          )}
        </TabsContent>
        <TabsContent value="calendar">
          <EditorialCalendar
            assets={
              assets.data?.filter((a) => !initialCampaign || a.campaign_id === initialCampaign) ??
              []
            }
            onOpen={(id) => {
              setSelected(id);
              setTab("library");
            }}
          />
        </TabsContent>
        <TabsContent value="profiles">
          <Profiles orgId={orgId} wsId={wsId} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx("marketing.cs.notSaved")}</DialogTitle>
            <DialogDescription>{tx("marketing.care.keepDraft")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              {tx("marketing.cs.cancel")}
            </Button>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              {tx("marketing.care.leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Editor({
  id,
  wsId,
  orgId,
  canEdit,
  canDecide,
  userId,
  onDirty,
}: {
  id: string;
  wsId: string;
  orgId: string;
  canEdit: boolean;
  canDecide: boolean;
  userId: string;
  onDirty: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const data = useQuery({
    queryKey: ["content-asset", id],
    queryFn: async () => {
      const [a, v, d, c, p] = await Promise.all([
        supabase
          .from("content_assets")
          .select("*")
          .eq("id", id)
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .single(),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("content_versions")
            .select("*")
            .eq("asset_id", id)
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("content_version_decisions")
            .select("id,version_id,decision,note,decided_at")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("campaigns")
            .select("id,title")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("writing_profiles")
            .select("id,name")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
      ]);
      const err = a.error;
      if (err || !a.data) throw err ?? new Error("missing");
      return {
        asset: a.data,
        versions: v.sort((a, b) => b.version_no - a.version_no),
        decisions: d,
        campaigns: c.sort((a, b) => a.title.localeCompare(b.title)),
        profiles: p.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  });
  const [form, setForm] = useState<{
    title: string;
    draft_body: string;
    channel: string;
    planned_date: string;
    campaign_id: string;
    writing_profile_id: string;
  } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "error">("saved");
  useEffect(() => {
    onDirty(saveState !== "saved");
  }, [saveState, onDirty]);
  const [compare, setCompare] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const loaded = useRef(false);
  const persistedAt = useRef<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const writer = useRef<ReturnType<typeof createDraftWriter<NonNullable<typeof form>>> | null>(
    null,
  );
  useEffect(() => {
    if (data.data && !loaded.current) {
      const a = data.data.asset;
      loaded.current = true;
      persistedAt.current = a.updated_at;
      setForm({
        title: a.title,
        draft_body: a.draft_body,
        channel: a.channel,
        planned_date: a.planned_date ?? "",
        campaign_id: a.campaign_id ?? "",
        writing_profile_id: a.writing_profile_id ?? "",
      });
    }
  }, [data.data]);
  // Serialize saves and compare the last acknowledged revision; no stale request can overwrite a newer save.
  useEffect(() => {
    if (!form || !loaded.current || !canEdit || saveState !== "pending") return;
    let active = true;
    writer.current ??= createDraftWriter(async (draft: NonNullable<typeof form>) => {
      const expected = persistedAt.current;
      if (!expected) throw new Error("content_revision_missing");
      const r = await supabase
        .from("content_assets")
        .update({
          title: draft.title.trim() || tx("marketing.cs.untitled"),
          draft_body: draft.draft_body,
          channel: draft.channel,
          planned_date: draft.planned_date || null,
          campaign_id: draft.campaign_id || null,
          writing_profile_id: draft.writing_profile_id || null,
        })
        .eq("id", id)
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .eq("updated_at", expected)
        .select("updated_at")
        .single();
      if (r.error || !r.data) throw new Error("content_save_unconfirmed");
      persistedAt.current = r.data.updated_at;
    });
    const timer = setTimeout(async () => {
      try {
        await writer.current?.(form);
        if (active) setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
      } catch {
        if (active) setSaveState("error");
      }
    }, 800);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form, saveState, canEdit, id, orgId, wsId, qc, tx]);
  const set = (k: keyof NonNullable<typeof form>, v: string) => {
    onDirty(true);
    setForm((f) => f && { ...f, [k]: v });
    setSaveState("pending");
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["content-asset", id] });
  const saveVersion = async (restore?: string) => {
    if (actionLock.current || saveState !== "saved")
      return void toast.info(tx("marketing.cs.notSaved"));
    actionLock.current = true;
    setActionBusy(true);
    try {
      const r = await supabase.rpc("save_content_version", {
        _asset: id,
        _note: note,
        ...(restore ? { _restore_from: restore } : {}),
      });
      if (r.error)
        return void toast.error(
          r.error.message.includes("empty")
            ? tx("marketing.cs.writeFirst")
            : tx("marketing.cs.versionFailed"),
        );
      setNote("");
      toast.success(restore ? tx("marketing.cs.restored") : tx("marketing.cs.versionSaved"));
      if (restore) {
        loaded.current = false;
        setForm(null);
      }
      await refresh();
    } catch {
      toast.error(tx("marketing.cs.versionFailed"));
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  };
  const decide = async (vid: string, decision: "approved" | "rejected") => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionBusy(true);
    try {
      const r = await supabase.rpc("decide_content_version", {
        _version: vid,
        _decision: decision,
      });
      if (r.error)
        return void toast.error(
          r.error.message.includes("duplicate")
            ? tx("marketing.cs.alreadyDecided")
            : tx("marketing.cs.decideFailed"),
        );
      toast.success(
        decision === "approved" ? tx("marketing.cs.approvedOk") : tx("marketing.cs.rejectedOk"),
      );
      await refresh();
    } catch {
      toast.error(tx("marketing.cs.decideFailed"));
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  };
  const versions = data.data?.versions ?? [];
  const decisions = data.data?.decisions ?? [];
  const cmp = versions.find((v) => v.id === compare);
  const diff = useMemo(
    () => (cmp && form ? diffLines(cmp.body, form.draft_body) : null),
    [cmp, form],
  );
  if (data.isError)
    return (
      <p className="text-sm text-destructive">
        {tx("marketing.cs.loadOne")}{" "}
        <Button variant="link" size="sm" onClick={() => void data.refetch()}>
          {tx("marketing.cs.retry")}
        </Button>
      </p>
    );
  if (!form || !data.data)
    return <p className="text-sm text-muted-foreground">{tx("marketing.cs.loading")}</p>;
  const draftChanged = versions[0]
    ? versions[0].body !== form.draft_body || versions[0].title !== form.title
    : true;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={tx("marketing.cs.title")}
            value={form.title}
            disabled={!canEdit}
            onChange={(e) => set("title", e.target.value)}
            className="text-lg font-medium"
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">
            {saveState === "pending"
              ? tx("marketing.cs.saving")
              : saveState === "error"
                ? tx("marketing.cs.notSaved")
                : tx("marketing.cs.draftSaved")}
          </span>
        </div>
        {saveState === "error" && (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">{tx("marketing.care.contentUnconfirmed")}</p>
            <Button size="sm" variant="outline" onClick={() => setSaveState("pending")}>
              {tx("marketing.cs.retry")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={tx("marketing.cs.channel")}
            className={sel}
            value={form.channel}
            disabled={!canEdit}
            onChange={(e) => set("channel", e.target.value)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {tx(`marketing.cs.ch.${c}`)}
              </option>
            ))}
          </select>
          <Input
            aria-label={tx("marketing.cs.plannedDate")}
            type="date"
            className="w-40"
            value={form.planned_date}
            disabled={!canEdit}
            onChange={(e) => set("planned_date", e.target.value)}
          />
          <select
            aria-label={tx("marketing.cs.campaign")}
            className={sel}
            value={form.campaign_id}
            disabled={!canEdit}
            onChange={(e) => set("campaign_id", e.target.value)}
          >
            <option value="">{tx("marketing.cs.noCampaign")}</option>
            {(data.data.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <select
            aria-label={tx("marketing.cs.profile")}
            className={sel}
            value={form.writing_profile_id}
            disabled={!canEdit}
            onChange={(e) => set("writing_profile_id", e.target.value)}
          >
            <option value="">{tx("marketing.cs.noProfile")}</option>
            {(data.data.profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <DraftPanel
            orgId={orgId}
            wsId={wsId}
            assetId={id}
            hasDraft={!!form.draft_body.trim()}
            onUse={(t, m) =>
              set(
                "draft_body",
                m === "replace" ? t : `${form.draft_body}${form.draft_body ? "\n\n" : ""}${t}`,
              )
            }
          />
        )}
        {canEdit && (
          <ReviewPanel
            orgId={orgId}
            wsId={wsId}
            assetId={id}
            draft={form.draft_body}
            versions={versions}
            onApply={(t) => set("draft_body", t)}
          />
        )}
        {canEdit && form.draft_body.trim() && (
          <RepurposePanel
            orgId={orgId}
            wsId={wsId}
            assetId={id}
            source={form.channel}
            campaignId={form.campaign_id}
            profileId={form.writing_profile_id}
            userId={userId}
          />
        )}
        <Textarea
          aria-label={tx("marketing.cs.content")}
          value={form.draft_body}
          disabled={!canEdit}
          onChange={(e) => set("draft_body", e.target.value)}
          className="min-h-[360px] font-[inherit] leading-relaxed"
          placeholder={tx("marketing.cs.writePh")}
        />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={tx("marketing.cs.versionNote")}
              placeholder={tx("marketing.cs.versionNotePh")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="max-w-xs"
            />
            <Button
              onClick={() => saveVersion()}
              disabled={
                actionBusy || saveState !== "saved" || !draftChanged || !form.draft_body.trim()
              }
            >
              <Save className="mr-1 h-4 w-4" />
              {tx("marketing.cs.saveVersion")}
            </Button>
          </div>
        )}
        {diff && cmp && (
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <span>{tx("marketing.cs.comparing", { n: cmp.version_no })}</span>
              <Button size="sm" variant="ghost" onClick={() => setCompare(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-sm">
              {diff.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.kind === "added"
                      ? "bg-primary/15"
                      : l.kind === "removed"
                        ? "bg-destructive/15 line-through"
                        : ""
                  }
                >
                  {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
                  {l.text}
                </div>
              ))}
            </pre>
          </div>
        )}
      </section>
      <aside className="space-y-2 rounded-lg border bg-card p-3">
        <h2 className="flex items-center gap-1 text-sm font-semibold">
          <History className="h-4 w-4" />
          {tx("marketing.cs.versions")}
        </h2>
        {versions.length === 0 && (
          <p className="text-sm text-muted-foreground">{tx("marketing.cs.noVersions")}</p>
        )}
        {versions.map((v) => {
          const d = decisions.find((x) => x.version_id === v.id);
          return (
            <div key={v.id} className="space-y-1 rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">v{v.version_no}</span>
                {d ? (
                  <Badge variant={versionApproved(v.id, decisions) ? "default" : "destructive"}>
                    {csLabel(tx, "dec", d.decision)}
                  </Badge>
                ) : (
                  <Badge variant="outline">{tx("marketing.cs.awaiting")}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(v.created_at).toLocaleString(tag)}
                {v.restored_from ? tx("marketing.cs.restoredTag") : ""}
                {v.note ? ` · ${v.note}` : ""}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setCompare(v.id)}>
                  <GitCompare className="mr-1 h-3 w-3" />
                  {tx("marketing.cs.compare")}
                </Button>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={actionBusy || saveState !== "saved"}
                    onClick={() => saveVersion(v.id)}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    {tx("marketing.cs.restore")}
                  </Button>
                )}
                {canDecide && !d && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actionBusy}
                      onClick={() => decide(v.id, "approved")}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      {tx("marketing.cs.approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actionBusy}
                      onClick={() => decide(v.id, "rejected")}
                    >
                      <X className="mr-1 h-3 w-3" />
                      {tx("marketing.cs.reject")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <p className="pt-2 text-xs text-muted-foreground">{tx("marketing.cs.approvalNote")}</p>
      </aside>
    </div>
  );
}

function Profiles({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { t: tx } = useI18n();
  const list = useQuery({
    queryKey: ["writing-profiles", wsId],
    queryFn: async () => {
      const rows = await collectPages(async (cursor, size) => {
        let q = supabase
          .from("writing_profiles")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return await q;
      });
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const empty = {
    name: "",
    tone: "",
    style: "",
    audience: "",
    channels: "",
    examples: "",
    examples_authorized: false,
  };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const submit = async () => {
    if (!f.name.trim()) return void toast.error(tx("marketing.cs.pNameNeeded"));
    if (f.examples.trim() && !f.examples_authorized)
      return void toast.error(tx("marketing.cs.pAuthNeeded"));
    const row = {
      name: f.name.trim(),
      tone: f.tone,
      style: f.style,
      audience: f.audience,
      channels: f.channels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      examples: f.examples,
      examples_authorized: f.examples_authorized,
    };
    const r = editing
      ? await supabase
          .from("writing_profiles")
          .update(row)
          .eq("id", editing)
          .eq("workspace_id", wsId)
      : await supabase
          .from("writing_profiles")
          .insert({ ...row, org_id: orgId, workspace_id: wsId });
    if (r.error) return void toast.error(tx("marketing.cs.pFailed"));
    toast.success(tx("marketing.cs.pSaved"));
    setF(empty);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["writing-profiles", wsId] });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        {list.isError && (
          <p className="text-sm text-destructive">{tx("marketing.cs.pLoadFailed")}</p>
        )}
        {list.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{tx("marketing.cs.pNone")}</p>
        )}
        {list.data?.map((p) => (
          <div key={p.id} className="rounded-lg border bg-card p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{p.name}</span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(p.id);
                    setF({
                      name: p.name,
                      tone: p.tone,
                      style: p.style,
                      audience: p.audience,
                      channels: p.channels.join(", "),
                      examples: p.examples,
                      examples_authorized: p.examples_authorized,
                    });
                  }}
                >
                  <PenLine className="h-3 w-3" />
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">
              {[p.tone, p.audience, p.channels.join(", ")].filter(Boolean).join(" · ") ||
                tx("marketing.cs.noDetails")}
            </p>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {editing ? tx("marketing.cs.pEdit") : tx("marketing.cs.pNew")}
          </h2>
          <Input
            placeholder={tx("marketing.cs.p.name")}
            aria-label={tx("marketing.cs.p.nameLabel")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <Input
            placeholder={tx("marketing.cs.p.tonePh")}
            aria-label={tx("marketing.cs.p.tone")}
            value={f.tone}
            onChange={(e) => setF({ ...f, tone: e.target.value })}
          />
          <Input
            placeholder={tx("marketing.cs.p.audience")}
            aria-label={tx("marketing.cs.p.audience")}
            value={f.audience}
            onChange={(e) => setF({ ...f, audience: e.target.value })}
          />
          <Input
            placeholder={tx("marketing.cs.p.channelsPh")}
            aria-label={tx("marketing.cs.p.channels")}
            value={f.channels}
            onChange={(e) => setF({ ...f, channels: e.target.value })}
          />
          <Textarea
            placeholder={tx("marketing.cs.p.stylePh")}
            aria-label={tx("marketing.cs.p.style")}
            value={f.style}
            onChange={(e) => setF({ ...f, style: e.target.value })}
          />
          <Textarea
            placeholder={tx("marketing.cs.p.examplesPh")}
            aria-label={tx("marketing.cs.p.examples")}
            value={f.examples}
            onChange={(e) => setF({ ...f, examples: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.examples_authorized}
              onCheckedChange={(v) => setF({ ...f, examples_authorized: v === true })}
            />
            {tx("marketing.cs.p.authorized")}
          </label>
          <div className="flex gap-2">
            <Button onClick={submit}>{tx("marketing.cs.p.save")}</Button>
            {editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setF(empty);
                }}
              >
                {tx("marketing.cs.cancel")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
