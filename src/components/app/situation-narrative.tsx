// AI-written explanation of the growth situation (one metered Growth Officer call, started by a member). Each
// statement shows its kind and the findings it rests on; an explanation older than the current findings is marked
// outdated. The latest own explanation is read back from the private request record, so it is never paid twice.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { explainSituation } from "@/lib/ai.functions";
import { CAMPAIGN_PURPOSE, narrativeFindings, parseNarrative, PURPOSE, questionsFor, type NarrativeFinding, type Scope } from "@/lib/situation-narrative";
import type { Finding, Situation } from "@/lib/situation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;
const KIND_TONE = { fact: "border-success/40 text-success", hypothesis: "border-warning/50 text-warning", estimate: "border-warning/50 text-warning", recommendation: "border-primary/40 text-primary" } as const;
const fingerprint = (f: readonly NarrativeFinding[]) => f.map((x) => `${x.id}=${x.text}`).sort().join("|");

export function SituationNarrative({ situation, text }: { situation: Situation; text: (f: Finding) => string }) {
  const { t } = useI18n();
  const findings = narrativeFindings(situation, text, {
    noData: (k) => `${t(tk(`sa.k.${k}`))}: ${t("sa.st.unknown")}`,
    missing: (m) => t("sa.missing", { list: t(tk(`sa.m.${m}`)) }),
  });
  return <AiExplanation scope="business" prefix="sn" findings={findings} unknownSections={situation.sections.filter((s) => s.status === "unknown").length} />;
}

/** Shared engine for the business situation ("sn" texts) and campaign advice ("cn" texts). */
export function AiExplanation({ scope, campaignId, prefix, findings, unknownSections }: { scope: Scope; campaignId?: string; prefix: "sn" | "cn"; findings: NarrativeFinding[]; unknownSections: number }) {
  const o = useOrg();
  const { t, tag, locale } = useI18n();
  const qc = useQueryClient();
  const explain = useServerFn(explainSituation);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const questions = questionsFor(scope);
  const saved = useQuery({
    queryKey: ["situation-narrative", scope, campaignId ?? "", o.org?.id ?? "", o.workspace?.id ?? "", o.userId ?? ""],
    enabled: !!o.org && !!o.workspace && !!o.userId,
    queryFn: async () => {
      let q = supabase.from("single_ai_requests").select("id,input,reply,status,created_at,credits")
        .eq("org_id", o.org!.id).eq("workspace_id", o.workspace!.id).eq("user_id", o.userId!).eq("kind", "growth_officer")
        .eq("input->>purpose", scope === "campaign" ? CAMPAIGN_PURPOSE : PURPOSE).eq("status", "succeeded");
      if (campaignId) q = q.eq("input->>campaignId", campaignId);
      const r = await q.order("created_at", { ascending: false }).limit(1);
      if (r.error) throw r.error;
      return r.data?.[0] ?? null;
    },
  });
  const member = can(o.workspaceRole, "ai.use");

  const ask = async () => {
    if (busy || !o.org || !o.workspace) return;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const r = await explain({ data: { orgId: o.org.id, workspaceId: o.workspace.id, requestKey: key.current, locale, findings, unknownSections, scope, ...(campaignId ? { campaignId } : {}) } });
      if (!r.ok) return void toast.error(r.error);
      key.current = null;
      toast.success(t("sn.done", { c: r.data.credits }));
      await qc.invalidateQueries({ queryKey: ["situation-narrative"] });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(t("sn.unconfirmed"));
    } finally { setBusy(false); }
  };

  let body: ReturnType<typeof parseNarrative> | null = null;
  let stale = false;
  let usedFindings: NarrativeFinding[] = [];
  if (saved.data?.reply) {
    const input = saved.data.input as { findings?: NarrativeFinding[]; unknownSections?: number } | null;
    usedFindings = input?.findings ?? [];
    try { body = parseNarrative(saved.data.reply, usedFindings, scope === "business" && (input?.unknownSections ?? 0) >= 5, questions); } catch { body = null; }
    stale = fingerprint(usedFindings) !== fingerprint(findings);
  }
  const label = new Map(usedFindings.map((f) => [f.id, f.text]));

  return (
    <section aria-label={t(tk(`${prefix}.title`))} className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 font-semibold"><Sparkles className="h-4 w-4" aria-hidden />{t(tk(`${prefix}.title`))}</h3>
        {member && <Button size="sm" variant="outline" onClick={ask} disabled={busy}>{busy && <Loader2 className="animate-spin" />}{body ? t("sn.again") : t("sn.ask")}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{t(tk(`${prefix}.intro`))}</p>
      {saved.error && <p role="alert" className="text-xs text-destructive">{t("sn.loadFailed")}</p>}
      {saved.data && !body && <p className="text-xs text-destructive">{t("sn.unreadable")}</p>}
      {body && saved.data && (
        <div className={cn("space-y-3", stale && "opacity-75")}>
          <p className="text-xs text-muted-foreground">{t("sn.when", { d: new Date(saved.data.created_at).toLocaleString(tag), c: saved.data.credits ?? "—" })}</p>
          {stale && <p className="rounded border border-warning/50 px-2 py-1 text-xs text-warning">{t("sn.stale")}</p>}
          {body.insufficient && <p className="rounded border border-warning/50 px-2 py-1 text-xs text-warning">{t("sn.insufficient")}</p>}
          {body.answers.map((a) => (
            <div key={a.question}>
              <p className="text-xs font-semibold">{t(tk(`${prefix}.q.${a.question}`))}</p>
              <ul className="mt-1 space-y-1.5">
                {a.statements.map((st, n) => (
                  <li key={n} className="break-words">
                    <span className={cn("mr-1.5 rounded border px-1 py-0.5 text-[10px]", KIND_TONE[st.kind])}>{t(tk(`sn.k.${st.kind}`))}</span>{st.text}
                    <span className="block text-[11px] text-muted-foreground">{t("sn.basis", { list: st.basis.map((b) => label.get(b) ?? b).join(" · ") })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {body.uncertainty && <p className="text-xs"><span className="font-medium">{t("sn.uncertainty")}</span> {body.uncertainty}</p>}
        </div>
      )}
    </section>
  );
}
