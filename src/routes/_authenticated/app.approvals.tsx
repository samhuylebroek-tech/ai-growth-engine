import { localHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { CAPABILITIES, capabilityByKey } from "@/lib/registry/capabilities";
import { PageHeader, Panel, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { ExternalApprovalsNotice } from "@/components/integrations/external-approvals-notice";
import { useI18n } from "@/lib/i18n";
import { capText } from "@/lib/i18n/registry-text";
import type { MessageKey } from "@/lib/i18n/messages";
import { QualityBadge } from "@/components/bi/evidence";

export const Route = createFileRoute("/_authenticated/app/approvals")({
  head: () => localHead("approvals"),
  component: Approvals,
});

function Approvals() {
  const o = useOrg();
  const qc = useQueryClient();
  const { t, tag } = useI18n();
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);
  const [showPolicies, setShowPolicies] = useState(false);
  const canManage = can(o.role, "policies.manage");
  const q = useQuery({
    queryKey: ["approvals", o.org?.id, o.workspace?.id, tab],
    enabled: !!o.org && !!o.workspace,
    queryFn: async () => {
      if (!o.org || !o.workspace) return [];
      let s = supabase
        .from("approvals")
        .select("*")
        .eq("org_id", o.org.id)
        .eq("workspace_id", o.workspace.id)
        .order("created_at", { ascending: false })
        .limit(100);
      s = tab === "pending" ? s.eq("status", "pending") : s.neq("status", "pending");
      const result = await s;
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const policies = useQuery({
    queryKey: ["policies", o.org?.id],
    enabled: !!o.org && canManage,
    queryFn: async () => {
      const result = await supabase
        .from("policies")
        .select("capability_key,mode")
        .eq("org_id", o.org!.id);
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  async function setPolicy(capabilityKey: string, mode: "approval" | "blocked") {
    if (!o.org || policyBusy) return;
    setPolicyBusy(capabilityKey);
    const result = await supabase
      .from("policies")
      .upsert(
        { org_id: o.org.id, capability_key: capabilityKey, mode },
        { onConflict: "org_id,capability_key" },
      );
    if (result.error) toast.error(t("apv.policyError"));
    else {
      await supabase.rpc("log_audit", {
        _org: o.org.id,
        _action: "policy.changed",
        _target_type: "capability",
        _target_id: capabilityKey,
        _metadata: { mode },
      });
      toast.success(t(mode === "blocked" ? "apv.policySaved.blocked" : "apv.policySaved.approval"));
      await policies.refetch();
    }
    setPolicyBusy(null);
  }
  async function decide(id: string, approve: boolean) {
    if (busy) return;
    setBusy(id);
    try {
      const { error } = await supabase.rpc("decide_approval", {
        _id: id,
        _approve: approve,
        _note: "",
      });
      if (error)
        toast.error(error.message.includes("forbidden") ? t("apv.onlyAdminsToast") : error.message);
      else toast.success(t(approve ? "apv.approved" : "apv.rejected"));
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    } finally {
      setBusy(null);
    }
  }
  const canDecide = can(o.workspaceRole, "approvals.decide");
  return (
    <>
      <PageHeader
        title={t("apv.title")}
        description={t("apv.intro")}
        actions={
          canManage && (
            <Button
              variant="outline"
              onClick={() => setShowPolicies(!showPolicies)}
              aria-expanded={showPolicies}
            >
              {showPolicies ? t("apv.closePolicies") : t("apv.policies")}
            </Button>
          )
        }
      />
      <ExternalApprovalsNotice />
      <div className="mb-5 flex gap-1 rounded-lg bg-muted p-1 text-sm w-fit">
        {(["pending", "decided"] as const).map((x) => (
          <Button
            key={x}
            variant={tab === x ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab(x)}
            aria-pressed={tab === x}
          >
            {t(`apv.tab.${x}` as MessageKey)}
          </Button>
        ))}
      </div>
      {q.isLoading && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {t("apv.loading")}
        </p>
      )}
      {q.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("apv.loadFailed")}{" "}
          <Button variant="link" onClick={() => q.refetch()}>
            {t("apv.retry")}
          </Button>
        </p>
      )}
      {q.data?.length ? (
        <div className="space-y-3">
          {q.data.map((a) => {
            const cap = capabilityByKey(a.capability_key);
            const isBlocked =
              policies.data?.some(
                (p) => p.capability_key === a.capability_key && p.mode === "blocked",
              ) ?? false;
            return (
              <Panel key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{a.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {cap ? capText(t as (k: string) => string, cap).name : a.capability_key}
                      </span>
                      <StatusChip status={a.risk}>
                        {t("apv.risk", { r: t(`apv.risk.${a.risk}` as MessageKey) })}
                      </StatusChip>
                      <StatusChip status={a.status} />
                      {cap?.status === "planned" && (
                        <StatusChip status="planned">{t("apv.notAvailable")}</StatusChip>
                      )}
                    </div>
                  </div>
                  {a.status === "pending" && canDecide && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => decide(a.id, false)}
                      >
                        {t("apv.reject")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!busy || isBlocked}
                        title={isBlocked ? t("apv.blockedPolicy") : undefined}
                        onClick={() => decide(a.id, true)}
                      >
                        {busy === a.id ? t("apv.saving") : t("apv.approve")}
                      </Button>
                    </div>
                  )}
                </div>
                {a.run_id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <QualityBadge q="hypothesis" />
                    <span className="text-xs text-muted-foreground">{t("apv.aiNote")}</span>
                  </div>
                )}
                {a.reasoning && (
                  <p className="mt-3 text-sm">
                    <span className="text-muted-foreground">{t("apv.why")} </span>
                    {a.reasoning}
                  </p>
                )}
                {a.expected_impact && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">{t("apv.impact")} </span>
                    {a.expected_impact}
                  </p>
                )}
                {a.status !== "pending" && a.decided_at && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("apv.decidedAt", { d: new Date(a.decided_at).toLocaleString(tag) })}
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<CheckSquare className="h-5 w-5" />}
          title={tab === "pending" ? t("apv.emptyPending") : t("apv.emptyDecided")}
          text={t("apv.emptyText")}
        />
      )}
      {canManage && showPolicies && (
        <section className="mt-10">
          <h2 className="font-semibold">{t("apv.policies")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("apv.policyIntro")}</p>
          {policies.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t("apv.policyFailed")}{" "}
              <Button variant="link" onClick={() => policies.refetch()}>
                {t("apv.retry")}
              </Button>
            </p>
          )}
          <div className="mt-4 divide-y divide-border rounded-lg border border-border">
            {CAPABILITIES.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{capText(t as (k: string) => string, c).name}</div>
                  <div className="text-xs text-muted-foreground">
                    {capText(t as (k: string) => string, c).description}
                  </div>
                </div>
                <select
                  aria-label={t("apv.policyFor", {
                    c: capText(t as (k: string) => string, c).name,
                  })}
                  className="rounded-md border border-input bg-background px-3 text-sm"
                  disabled={policyBusy === c.key || policies.isLoading}
                  value={
                    policies.data?.find((p) => p.capability_key === c.key)?.mode === "blocked"
                      ? "blocked"
                      : "approval"
                  }
                  onChange={(e) => setPolicy(c.key, e.target.value as "approval" | "blocked")}
                >
                  <option value="approval">{t("apv.mode.approval")}</option>
                  <option value="blocked">{t("apv.mode.blocked")}</option>
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
      {!canDecide && <p className="mt-6 text-xs text-muted-foreground">{t("apv.onlyAdmins")}</p>}
      <p className="mt-6 text-xs text-muted-foreground">{t("apv.footer")}</p>
    </>
  );
}
