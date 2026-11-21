// Strategy and measurement of one campaign (proposal 0083): the goal, strategy and initiative it serves, its hypothesis,
// expected contribution, risks and one primary KPI. Gaps are explained, never filled in. The database refuses a strategy
// or initiative of another goal.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type CampaignOsColumns } from "@/lib/pending-schema";
import { linkGaps } from "@/lib/campaign-lifecycle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Campaign = { id: string; goal_id: string | null } & Partial<CampaignOsColumns>;
const sel = "w-full min-w-0 rounded-md border border-border bg-background px-2 py-2 text-xs";
const errText = (e: unknown) => (typeof e === "object" && e !== null ? String((e as { message?: unknown }).message ?? "") : "");
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function campaignLinkOptions(ws: string | undefined) {
  return {
    queryKey: ["campaign-link-options", ws] as const,
    enabled: !!ws,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const [g, s, i] = await Promise.all([
        growthDb.from("growth_goals").select("id,title,status").eq("workspace_id", ws ?? "").order("created_at", { ascending: false }).limit(200),
        growthDb.from("growth_strategies").select("id,goal_id,summary,created_at").eq("workspace_id", ws ?? "").order("created_at", { ascending: false }).limit(200),
        growthDb.from("growth_initiatives").select("id,goal_id,title,status").eq("workspace_id", ws ?? "").order("created_at", { ascending: false }).limit(300),
      ]);
      if (g.error) throw g.error;
      if (s.error) throw s.error;
      if (i.error && !isNotInstalled(i.error)) throw i.error;
      return { goals: g.data ?? [], strategies: s.data ?? [], initiatives: i.error ? [] : (i.data ?? []) };
    },
  };
}

export function CampaignStrategy({ campaign }: { campaign: Campaign }) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tx } = useI18n();
  const opts = useQuery(campaignLinkOptions(o.workspace?.id));
  const editable = can(o.workspaceRole, "profile.edit");
  const [f, setF] = useState(() => ({
    goal_id: campaign.goal_id ?? "", strategy_id: campaign.strategy_id ?? "", initiative_id: campaign.initiative_id ?? "",
    hypothesis: campaign.hypothesis ?? "", expected_contribution: campaign.expected_contribution ?? "", risks: campaign.risks ?? "",
    risk_level: campaign.risk_level ?? "medium", primary_kpi: campaign.primary_kpi ?? "", kpi_unit: campaign.kpi_unit ?? "",
    kpi_baseline: campaign.kpi_baseline === null || campaign.kpi_baseline === undefined ? "" : String(campaign.kpi_baseline),
    kpi_target: campaign.kpi_target === null || campaign.kpi_target === undefined ? "" : String(campaign.kpi_target),
  }));
  const [busy, setBusy] = useState(false);
  if (!("strategy_id" in campaign)) return null;
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const strategies = (opts.data?.strategies ?? []).filter((s) => s.goal_id === f.goal_id);
  const initiatives = (opts.data?.initiatives ?? []).filter((i) => i.goal_id === f.goal_id);
  const gaps = linkGaps({ goal_id: campaign.goal_id, strategy_id: campaign.strategy_id ?? null, initiative_id: campaign.initiative_id ?? null, primary_kpi: campaign.primary_kpi ?? "", kpi_target: campaign.kpi_target ?? null });

  async function save() {
    if (!o.org || !o.workspace || busy || !editable) return;
    const b = numOrNull(f.kpi_baseline), t = numOrNull(f.kpi_target);
    if ((b !== null && !Number.isFinite(b)) || (t !== null && !Number.isFinite(t))) { toast.error(tx("cos.life.e.invalid_actual")); return; }
    setBusy(true);
    try {
      const r = await growthDb.from("campaigns").update({
        goal_id: f.goal_id || null, strategy_id: f.strategy_id || null, initiative_id: f.initiative_id || null,
        hypothesis: f.hypothesis.trim(), expected_contribution: f.expected_contribution.trim(), risks: f.risks.trim(),
        risk_level: f.risk_level as CampaignOsColumns["risk_level"], primary_kpi: f.primary_kpi.trim(), kpi_unit: f.kpi_unit.trim(),
        kpi_baseline: b, kpi_target: t,
      }).eq("id", campaign.id).eq("org_id", o.org.id).eq("workspace_id", o.workspace.id);
      if (r.error) throw r.error;
      await qc.invalidateQueries({ queryKey: ["execution"] });
      toast.success(tx("cos.link.saved"));
    } catch (e) {
      const m = errText(e);
      toast.error(tx(m.includes("goal_mismatch") ? "cos.link.mismatch" : "cos.link.failed"));
    } finally { setBusy(false); }
  }

  return (
    <section aria-label={tx("cos.link.title")} className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{tx("cos.link.title")}</h3>
        <p className="text-muted-foreground">{tx("cos.link.intro")}</p>
      </div>
      {gaps.length === 0 ? <p className="text-success">{tx("cos.link.complete")}</p> : (
        <div className="rounded-md border border-warning/50 p-2">
          <p className="font-medium">{tx("cos.link.gaps")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{gaps.map((g) => <li key={g}>{tx(`cos.link.g.${g}` as MessageKey)}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">{tx("cos.link.goal")}
          <select className={sel} disabled={!editable} value={f.goal_id} onChange={(e) => setF((x) => ({ ...x, goal_id: e.target.value, strategy_id: "", initiative_id: "" }))}>
            <option value="">{tx("cos.link.noGoal")}</option>
            {(opts.data?.goals ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{tx("cos.link.strategy")}
          <select className={sel} disabled={!editable || !f.goal_id} value={f.strategy_id} onChange={(e) => set("strategy_id", e.target.value)}>
            <option value="">{tx("cos.link.noStrategy")}</option>
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.summary.length > 70 ? `${s.summary.slice(0, 70)}…` : s.summary}</option>)}
          </select></label>
        <label className="flex flex-col gap-1">{tx("cos.link.initiative")}
          <select className={sel} disabled={!editable || !f.goal_id} value={f.initiative_id} onChange={(e) => set("initiative_id", e.target.value)}>
            <option value="">{tx("cos.link.noInitiative")}</option>
            {initiatives.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select></label>
      </div>
      <p className="text-muted-foreground">{tx("cos.link.onlyGoal")}</p>
      <label className="flex flex-col gap-1">{tx("cos.link.hypothesis")}<Textarea rows={2} maxLength={1000} disabled={!editable} value={f.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">{tx("cos.link.contribution")}<Input maxLength={500} disabled={!editable} value={f.expected_contribution} onChange={(e) => set("expected_contribution", e.target.value)} /></label>
        <label className="flex flex-col gap-1">{tx("cos.link.riskLevel")}
          <select className={sel} disabled={!editable} value={f.risk_level} onChange={(e) => set("risk_level", e.target.value)}>
            {["low", "medium", "high"].map((r) => <option key={r} value={r}>{tx(`work.l.${r}` as MessageKey)}</option>)}
          </select></label>
      </div>
      <label className="flex flex-col gap-1">{tx("cos.link.risks")}<Textarea rows={2} maxLength={1000} disabled={!editable} value={f.risks} onChange={(e) => set("risks", e.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">{tx("cos.link.kpi")}<Input maxLength={80} placeholder={tx("cos.link.kpiPh")} disabled={!editable} value={f.primary_kpi} onChange={(e) => set("primary_kpi", e.target.value)} /></label>
        <label className="flex flex-col gap-1">{tx("cos.link.unit")}<Input maxLength={20} disabled={!editable} value={f.kpi_unit} onChange={(e) => set("kpi_unit", e.target.value)} /></label>
        <span />
        <label className="flex flex-col gap-1">{tx("cos.link.baseline")}<Input inputMode="decimal" disabled={!editable} value={f.kpi_baseline} onChange={(e) => set("kpi_baseline", e.target.value)} /></label>
        <label className="flex flex-col gap-1">{tx("cos.link.target")}<Input inputMode="decimal" disabled={!editable} value={f.kpi_target} onChange={(e) => set("kpi_target", e.target.value)} /></label>
        {campaign.kpi_actual !== null && campaign.kpi_actual !== undefined && <p className="sm:col-span-2 self-end">{tx("cos.link.actual")}: <span className="font-medium tabular-nums">{campaign.kpi_actual}{campaign.kpi_unit ? ` ${campaign.kpi_unit}` : ""}</span></p>}
      </div>
      <p className="text-muted-foreground">{tx("cos.link.baselineNote")}</p>
      {editable && <Button size="sm" disabled={busy} onClick={save}>{tx("cos.link.save")}</Button>}
    </section>
  );
}
