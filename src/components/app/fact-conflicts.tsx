// Conflicting business facts on the business profile: every value with its source, date and confirmation state,
// the status from the decision history (open / in review / resolved / disputed again), which improvement
// proposals rely on it, and the editor's one-step decision (resolve_fact_conflict). Nothing is chosen silently;
// earlier decisions stay visible with who decided, when and why (proposal 0075).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { supabase } from "@/integrations/supabase/client";
import {
  conflictDependents,
  conflictStatus,
  detectFactConflicts,
  type ConflictEvent,
  type ConflictStatus,
  type FactRow,
} from "@/lib/fact-conflicts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/app/status";

const STATUS_CHIP: Record<ConflictStatus, string> = { open: "pending", in_review: "running", resolved: "approved", redisputed: "failed" };

function useConflictContext(enabled: boolean) {
  const o = useOrg();
  const ws = o.workspace?.id;
  return useQuery({
    queryKey: ["fact-conflict-context", o.org?.id, ws],
    enabled: enabled && !!ws && !!o.org,
    queryFn: async () => {
      const sc = <Q extends { eq(c: string, v: string): Q }>(q: Q) => q.eq("org_id", o.org!.id).eq("workspace_id", ws!);
      const [ev, items, links, props, members] = await Promise.all([
        sc(growthDb.from("fact_conflict_events").select("*")).order("created_at", { ascending: false }).limit(500),
        sc(growthDb.from("evidence_items").select("id,source_kind,source_ref")).eq("source_kind", "business_fact").limit(1000),
        sc(growthDb.from("proposal_evidence").select("evidence_id,proposal_id")).limit(2000),
        sc(growthDb.from("optimization_proposals").select("id,title,status")).limit(500),
        supabase.rpc("execution_workspace_members", { _workspace: ws! }),
      ]);
      // Optional parts (not installed yet) read as empty; any other failure is shown instead of a partial picture.
      for (const r of [ev, items, links, props]) if (r.error && !isNotInstalled(r.error)) throw r.error;
      return {
        installed: !ev.error,
        events: (ev.data ?? []) as ConflictEvent[],
        evidence: (items.error ? [] : items.data ?? []) as { id: string; source_kind: string; source_ref: string }[],
        links: (links.error ? [] : links.data ?? []) as { evidence_id: string; proposal_id: string }[],
        proposals: (props.error ? [] : props.data ?? []) as { id: string; title: string; status: string }[],
        names: new Map(((members.data ?? []) as { user_id: string; display_name: string | null }[]).map((m) => [m.user_id, m.display_name ?? ""])),
      };
    },
  });
}

export function FactConflicts({ facts, canDecide, sourceLabel, onResolved }: {
  facts: FactRow[]; canDecide: boolean; sourceLabel: (s: string) => string; onResolved: () => void;
}) {
  const { t, tag } = useI18n();
  const o = useOrg();
  const qc = useQueryClient();
  const conflicts = useMemo(() => detectFactConflicts(facts), [facts]);
  const ctx = useConflictContext(conflicts.length > 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!conflicts.length) return null;
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["fact-conflict-context"] });
    onResolved();
  };
  const fail = (e: { code?: string; message: string }) =>
    toast.error(e.code === "PGRST202" || isNotInstalled(e) ? t("ev.cf.notInstalled") : e.code === "42501" ? t("ev.cf.editorOnly") : e.message);
  async function keep(topic: string, id: string, others: string[]) {
    setBusy(id);
    const r = await growthDb.rpc("resolve_fact_conflict", { _keep: id, _others: others, _note: notes[topic] ?? "" });
    setBusy(null);
    if (r.error) {
      fail(r.error);
      return;
    }
    toast.success(t("ev.cf.done"));
    await done();
  }
  async function mark(topic: string, kind: "review_started" | "reopened") {
    if (!o.workspace) return;
    setBusy(topic);
    const r = await growthDb.rpc("mark_fact_conflict", { _workspace: o.workspace.id, _topic: topic, _kind: kind, _note: notes[topic] ?? "" });
    setBusy(null);
    if (r.error) {
      fail(r.error);
      return;
    }
    toast.success(t(kind === "review_started" ? "ev.cf.reviewDone" : "ev.cf.reopenDone"));
    await done();
  }
  const when = (s: string) => new Date(s).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-labelledby="fact-conflicts" className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <h2 id="fact-conflicts" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" />{t("ev.cf.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("ev.cf.intro")}</p>
      {ctx.isError && <p role="alert" className="mt-2 text-xs text-destructive">{t("ev.cf.contextFailed")}</p>}
      <div className="mt-3 space-y-4">
        {conflicts.map((c) => {
          const st = conflictStatus(c, ctx.data?.events ?? []);
          const deps = ctx.data ? conflictDependents(c, ctx.data.evidence, ctx.data.links, ctx.data.proposals) : [];
          const open = st.status !== "resolved";
          return (
            <article key={c.topic} className="min-w-0 rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-sm font-medium">{c.key}</h3>
                <StatusChip status={STATUS_CHIP[st.status]}>{t(`ev.cf.status.${st.status}` as MessageKey)}</StatusChip>
                <span className="text-[11px] text-muted-foreground">{t("ev.cf.values", { n: c.values })}</span>
              </div>
              {c.confirmedConflict && <p className="mt-1 text-[11px] text-warning">{t("ev.cf.bothConfirmed")}</p>}
              {open && !c.preferred && <p className="mt-1 text-[11px] text-muted-foreground">{t("ev.cf.undetermined")}</p>}
              {open && (
                <p className="mt-1 text-[11px]">
                  <span className="font-medium">{t("ev.cf.impact")}</span>{" "}
                  {deps.length
                    ? deps.map((p) => p.title).join(" · ")
                    : c.confirmedConflict ? t("ev.cf.impactOfficer") : t("ev.cf.impactNone")}
                </p>
              )}
              <ul className="mt-2 divide-y divide-border">
                {c.facts.map((f) => (
                  <li key={f.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">{f.value}</p>
                      <p className="mt-0.5 break-all text-[10px] text-muted-foreground">
                        {sourceLabel(f.source_type)}{f.source_ref ? ` · ${f.source_ref}` : ""}{f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString(tag)}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <StatusChip status={f.verified ? "approved" : "pending"}>{f.verified ? t("ev.cf.confirmed") : t("ev.cf.review")}</StatusChip>
                        {st.status === "resolved" && st.latest?.kept_fact_id === f.id && <StatusChip status="implemented">{t("ev.cf.chosen")}</StatusChip>}
                        {open && c.preferred === f.id && <StatusChip status="implemented">{t("ev.cf.preferred")} · {t(c.basis === "confirmed" ? "ev.cf.basis.confirmed" : "ev.cf.basis.source")}</StatusChip>}
                      </div>
                    </div>
                    {canDecide && (open || st.latest?.kept_fact_id !== f.id) && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => keep(c.topic, f.id, c.facts.filter((x) => x.id !== f.id).map((x) => x.id))}>
                        {t("ev.cf.keep")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {canDecide ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input aria-label={t("ev.cf.note")} placeholder={t("ev.cf.note")} maxLength={500} className="h-8 min-w-0 flex-1" value={notes[c.topic] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.topic]: e.target.value }))} />
                  {ctx.data?.installed && st.status === "open" && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => mark(c.topic, "review_started")}>{t("ev.cf.startReview")}</Button>
                  )}
                  {ctx.data?.installed && st.status === "resolved" && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => mark(c.topic, "reopened")}>{t("ev.cf.reopen")}</Button>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">{t("ev.cf.editorOnly")}</p>
              )}
              {st.history.length > 0 && (
                <details className="mt-2 text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground">{t("ev.cf.history", { n: st.history.length })}</summary>
                  <ol className="mt-1 space-y-1">
                    {st.history.map((e) => (
                      <li key={e.id} className="break-words">
                        <span className="font-medium">{t(`ev.cf.kind.${e.kind}` as MessageKey)}</span>
                        {e.kept_value ? ` · “${e.kept_value}”` : ""} · {ctx.data?.names.get(e.actor_id) || t("ev.cf.someone")} · {when(e.created_at)}
                        {e.note ? ` — ${e.note}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
