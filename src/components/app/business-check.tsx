import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type BusinessCheckRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import { readBusinessDomains } from "@/lib/security/business-context";
import { detectSignals } from "@/lib/signals";
import { checkDue, compareFindings, findingsFrom, inspectedRecords, parseFindings, type Frequency, type Finding, type Inspected } from "@/lib/business-check";
import { SectionHeading } from "@/components/app/section-heading";
import { Button } from "@/components/ui/button";

const MEMBER = new Set(["owner", "admin", "editor", "member"]);
const ADMIN = new Set(["owner", "admin"]);
const FREQS: Frequency[] = ["off", "daily", "weekly", "monthly"];

type Data = { checks: BusinessCheckRow[]; frequency: Frequency };

function checksOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: ["business-checks", orgId, wsId],
    enabled: !!orgId && !!wsId,
    retry: retryUnlessNotInstalled,
    staleTime: 30_000,
    queryFn: async (): Promise<Data> => {
      const [c, s] = await Promise.all([
        growthDb.from("business_checks").select("*").eq("org_id", orgId!).eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(6),
        growthDb.from("business_check_settings").select("frequency").eq("org_id", orgId!).eq("workspace_id", wsId!).maybeSingle(),
      ]);
      if (c.error) throw c.error;
      if (s.error) throw s.error;
      return { checks: c.data ?? [], frequency: (s.data?.frequency ?? "off") as Frequency };
    },
  };
}

/** Records a business check on request and shows what changed since the previous one. No background work. */
export function BusinessCheck() {
  const o = useOrg();
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const q = useQuery(checksOptions(o.org?.id, o.workspace?.id));
  const [busy, setBusy] = useState(false);
  const canRun = MEMBER.has(o.workspaceRole ?? "");
  const canSet = ADMIN.has(o.workspaceRole ?? "");
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
  const title = (f: Finding) => t(`signal.${f.code}.title` as MessageKey, f.vars);

  if (q.isError && isNotInstalled(q.error)) return null;
  const checks = q.data?.checks ?? [];
  const last = checks[0] ?? null;
  const prev = checks[1] ?? null;
  const frequency = q.data?.frequency ?? "off";
  const due = checkDue(frequency, last?.created_at ?? null);
  const diff = last ? compareFindings(parseFindings(last.findings), prev ? parseFindings(prev.findings) : last.previous_id ? null : []) : null;
  const sum = (last?.summary ?? {}) as { findings?: number; new?: number; still_open?: number; resolved?: number };

  async function run() {
    if (!o.org || !o.workspace) return;
    setBusy(true);
    try {
      const d = await readBusinessDomains(supabase, { orgId: o.org.id, workspaceId: o.workspace.id }, { id: o.workspace.id, name: o.workspace.name });
      const kind = due.due && frequency !== "off" ? frequency : "manual";
      const r = await growthDb.rpc("record_business_check", {
        _workspace: o.workspace.id, _kind: kind, _subject: null,
        _inspected: inspectedRecords(d) as unknown as Json, _findings: findingsFrom(detectSignals(d)) as unknown as Json,
      });
      if (r.error) {
        toast.error(r.error.message === "check_too_soon" ? t("mon.tooSoon") : r.error.code === "42501" ? t("mon.notAllowed") : isNotInstalled(r.error) ? t("mon.unavailable") : t("mon.failed"));
        return;
      }
      const j = r.data as { new: number; resolved: number; first: boolean };
      toast.success(j.first ? t("mon.doneFirst", { n: j.new }) : t("mon.done", { n: j.new, r: j.resolved }));
      await qc.invalidateQueries({ queryKey: ["business-checks", o.org.id, o.workspace.id] });
    } catch {
      toast.error(t("mon.failed"));
    } finally {
      setBusy(false);
    }
  }
  async function setFrequency(f: Frequency) {
    if (!o.org || !o.workspace) return;
    const r = await growthDb.rpc("set_business_check_frequency", { _workspace: o.workspace.id, _frequency: f });
    if (r.error) { toast.error(r.error.code === "42501" ? t("mon.adminOnly") : t("mon.failed")); return; }
    toast.success(t("mon.freqSaved"));
    await qc.invalidateQueries({ queryKey: ["business-checks", o.org.id, o.workspace.id] });
  }

  const inspected = (last?.inspected ?? null) as Inspected | null;
  return (
    <section aria-label={t("mon.title")} className="min-w-0">
      <SectionHeading
        eyebrow={t("mon.eyebrow")}
        title={t("mon.title")}
        action={canRun ? <Button size="sm" variant="outline" disabled={busy || q.isLoading} onClick={run}><ClipboardCheck />{busy ? t("mon.running") : t("mon.run")}</Button> : undefined}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{t("mon.intro")} {t("mon.manualOnly")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="mon-freq" className="text-muted-foreground">{t("mon.frequency")}</label>
        <select id="mon-freq" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={frequency} disabled={!canSet} onChange={(e) => setFrequency(e.target.value as Frequency)} title={canSet ? undefined : t("mon.adminOnly")}>
          {FREQS.map((f) => <option key={f} value={f}>{t(`mon.freq.${f}` as MessageKey)}</option>)}
        </select>
        {frequency !== "off" && <span role="status" className={due.due ? "font-medium text-warning" : "text-muted-foreground"}>{due.due ? t("mon.due") : due.next ? t("mon.next", { t: when(due.next) }) : null}</span>}
      </div>
      {q.isLoading ? <div role="status" className="mt-3 h-12 animate-pulse rounded-md bg-muted" /> : q.isError ? <p role="alert" className="mt-3 text-xs text-destructive">{t("mon.failed")}</p> : !last ? <p className="mt-3 text-xs text-muted-foreground">{t("mon.never")}</p> : (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-card p-3 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{t("mon.last", { t: when(last.created_at) })} · {t(`mon.kind.${last.kind}` as MessageKey)}</p>
            <p className="text-muted-foreground">{t("mon.summary", { f: sum.findings ?? 0, n: sum.new ?? 0, o: sum.still_open ?? 0, r: sum.resolved ?? 0 })}</p>
          </div>
          {diff && diff.added.length > 0 && <div><p className="font-medium text-warning">{t("mon.new")}</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{diff.added.slice(0, 6).map((f) => <li key={f.id} className="break-words">{title(f)}</li>)}</ul></div>}
          {diff && diff.resolved.length > 0 && <div><p className="font-medium text-success">{t("mon.resolved")}</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{diff.resolved.slice(0, 6).map((f) => <li key={f.id} className="break-words">{title(f)}</li>)}</ul></div>}
          {inspected && <details><summary className="cursor-pointer text-muted-foreground">{t("mon.inspected")}</summary>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">{(Object.keys(inspected) as (keyof Inspected)[]).map((area) => (
              <div key={area}><dt className="font-medium">{t(`mon.area.${area}` as MessageKey)}</dt><dd className="text-muted-foreground">{Object.entries(inspected[area] ?? {}).map(([k, v]) => `${t(`mon.rec.${k}` as MessageKey)}: ${v === null ? t("mon.unknown") : v}`).join(" · ")}</dd></div>
            ))}</dl></details>}
          {checks.length > 1 && <details><summary className="cursor-pointer text-muted-foreground">{t("mon.history", { n: checks.length - 1 })}</summary>
            <ul className="mt-2 space-y-1">{checks.slice(1).map((c) => { const s = c.summary as { findings?: number; new?: number; still_open?: number; resolved?: number }; return <li key={c.id} className="flex flex-wrap justify-between gap-2"><span>{when(c.created_at)} · {t(`mon.kind.${c.kind}` as MessageKey)}</span><span className="text-muted-foreground">{t("mon.summary", { f: s.findings ?? 0, n: s.new ?? 0, o: s.still_open ?? 0, r: s.resolved ?? 0 })}</span></li>; })}</ul></details>}
        </div>
      )}
    </section>
  );
}
