import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerOverview } from "@/lib/admin.functions";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { CreditPrices } from "@/components/admin/credit-prices";
import { SecurityPanel } from "@/components/admin/security-panel";
import { MfaChallenge } from "@/components/security/mfa-challenge";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    ...localHead("owner"),
    meta: [...localHead("owner").meta, { name: "robots", content: "noindex" }],
  }),
  component: Admin,
});

const eur = (n: number) => `€${n.toFixed(n < 10 ? 2 : 0)}`;

function Admin() {
  const fn = useServerFn(getOwnerOverview);
  const qc = useQueryClient();
  const { t, tag } = useI18n();
  const q = useQuery({ queryKey: ["owner"], queryFn: () => fn() });
  const [grant, setGrant] = useState<Record<string, string>>({});
  if (q.isLoading)
    return <div className="p-10 text-sm text-muted-foreground">{t("own.loading")}</div>;
  if (q.data && !q.data.ok && q.data.error === "mfa_required")
    return <MfaChallenge onVerified={() => qc.invalidateQueries({ queryKey: ["owner"] })} />;
  if (!q.data?.ok)
    return (
      <div className="p-10">
        <p className="text-sm">{t("own.denied")}</p>
        <Link to="/app" className="text-sm text-primary">
          {t("own.back")}
        </Link>
      </div>
    );
  const { rows, totals, plans } = q.data;

  async function setPlan(orgId: string, planKey: string) {
    const { error } = await supabase
      .from("subscriptions")
      .update({ plan_key: planKey, status: planKey === "trial" ? "trialing" : "active" })
      .eq("org_id", orgId);
    if (error) toast.error(t("own.notAllowed"));
    else {
      // With proposal 0088 the database audits subscription changes itself and refuses this direct call;
      // older databases still record it here.
      await supabase.rpc("log_audit", {
        _org: orgId,
        _action: "subscription.plan_changed",
        _target_type: "organization",
        _target_id: orgId,
        _metadata: { plan: planKey, manual: true },
      });
      toast.success(t("own.planUpdated"));
      qc.invalidateQueries({ queryKey: ["owner"] });
    }
  }
  async function grantCredits(orgId: string) {
    const n = parseInt(grant[orgId] ?? "", 10);
    if (!n) return;
    const { error } = await supabase.rpc("admin_grant_credits", {
      _org: orgId,
      _amount: n,
      _note: "owner center",
    });
    if (error) toast.error(t("own.notAllowed"));
    else {
      toast.success(t("own.creditsAdjusted"));
      setGrant({ ...grant, [orgId]: "" });
    }
  }
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link
        to="/app"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("own.back")}
      </Link>
      <PageHeader title={t("own.title")} description={t("own.desc")} />
      <div className="grid gap-4 md:grid-cols-5">
        <Panel>
          <div className="text-xs text-muted-foreground">{t("own.orgs")}</div>
          <div className="mt-1 font-display text-2xl font-bold">{totals.orgs}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("own.trial")}</div>
          <div className="mt-1 font-display text-2xl font-bold">{totals.trialing}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("own.active")}</div>
          <div className="mt-1 font-display text-2xl font-bold">{totals.active}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("own.mrr")}</div>
          <div className="mt-1 font-display text-2xl font-bold">{eur(totals.configuredMrr)}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("own.ai30")}</div>
          <div className="mt-1 font-display text-2xl font-bold">{eur(totals.aiCost30d)}</div>
          <div className="text-xs text-muted-foreground">
            {t("own.calls", { n: totals.aiCalls30d })}
          </div>
        </Panel>
      </div>
      <h2 className="mb-3 mt-10 font-semibold">{t("own.orgs")}</h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">{t("own.col.org")}</th>
              <th className="px-4 py-2">{t("own.col.plan")}</th>
              <th className="px-4 py-2">{t("own.col.status")}</th>
              <th className="px-4 py-2 text-right">{t("own.col.mrr")}</th>
              <th className="px-4 py-2 text-right">{t("own.col.ai")}</th>
              <th className="px-4 py-2 text-right">{t("own.col.margin")}</th>
              <th className="px-4 py-2">{t("own.col.credits")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString(tag)}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                    value={r.plan ?? ""}
                    onChange={(e) => setPlan(r.id, e.target.value)}
                  >
                    {plans.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  {r.subStatus && <StatusChip status={r.subStatus} />}
                </td>
                <td className="px-4 py-2.5 text-right">{eur(r.configuredMrr)}</td>
                <td className="px-4 py-2.5 text-right">{eur(r.aiCost30d)}</td>
                <td
                  className={`px-4 py-2.5 text-right ${r.margin30d < 0 ? "text-destructive" : ""}`}
                >
                  {eur(r.margin30d)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <Input
                      className="h-8 w-20"
                      type="number"
                      placeholder="±"
                      value={grant[r.id] ?? ""}
                      onChange={(e) => setGrant({ ...grant, [r.id]: e.target.value })}
                    />
                    <Button size="sm" variant="outline" onClick={() => grantCredits(r.id)}>
                      {t("own.apply")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("own.marginNote")}</p>
      <SecurityPanel />
      <CreditPrices />
    </div>
  );
}
