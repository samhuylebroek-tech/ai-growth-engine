import { readLocale, useI18n } from "@/lib/i18n";
import { MESSAGES, translate, type MessageKey } from "@/lib/i18n/messages";
import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/app/billing")({
  head: () =>
    pageHead(
      translate(readLocale(), "account.billing.headTitle"),
      translate(readLocale(), "account.billing.headDescription"),
    ),
  component: Billing,
});

const FEATURE_LABEL = {
  workspaces: "account.billing.feature.workspaces",
  seats: "account.billing.feature.seats",
  documents: "account.billing.feature.documents",
  integrations: "account.billing.feature.integrations",
  client_orgs: "account.billing.feature.client_orgs",
  ai_assistant: "account.billing.feature.ai_assistant",
  approvals: "account.billing.feature.approvals",
} as const;

function Billing() {
  const { t, tag } = useI18n();
  const o = useOrg();
  const orgId = o.org?.id;
  const q = useQuery({
    queryKey: ["billing", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) throw new Error(t("account.billing.noOrg"));
      if (o.role !== "viewer") {
        const grant = await supabase.rpc("ensure_monthly_credit_grant", { _org: orgId });
        if (grant.error) throw grant.error;
      }
      const [sub, bal, ledger, usage, plans, ents, bp] = await Promise.all([
        supabase.from("subscriptions").select("*").eq("org_id", orgId!).maybeSingle(),
        supabase.rpc("credit_balance", { _org: orgId! }),
        supabase
          .from("credit_ledger")
          .select("*")
          .eq("org_id", orgId!)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("ai_usage_events")
          .select("credits_charged,created_at")
          .eq("org_id", orgId!)
          .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()),
        supabase.from("plans").select("*").order("tier"),
        supabase.from("plan_entitlements").select("*"),
        can(o.role, "billing.manage")
          ? supabase.from("billing_profiles").select("*").eq("org_id", orgId!).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      for (const result of [sub, bal, ledger, usage, plans, ents])
        if (result.error) throw result.error;
      return {
        sub: sub.data,
        balance: bal.data ?? 0,
        ledger: ledger.data ?? [],
        used30: (usage.data ?? []).reduce((a, u) => a + u.credits_charged, 0),
        calls30: usage.data?.length ?? 0,
        plans: plans.data ?? [],
        ents: ents.data ?? [],
        bp: bp.data,
      };
    },
  });
  const d = q.data;
  const plan = d?.plans.find((p) => p.key === d.sub?.plan_key);
  return (
    <>
      <PageHeader
        title={t("account.billing.title")}
        description={t("account.billing.description")}
      />
      {q.isLoading && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          {t("account.billing.loading")}
        </p>
      )}
      {q.isError && (
        <p role="alert" className="py-5 text-sm text-destructive">
          {t("account.billing.failed")}
          <Button variant="link" onClick={() => q.refetch()}>
            {t("account.retry")}
          </Button>
        </p>
      )}
      {d && (
        <>
          <div className="grid gap-6 border-y border-border py-6 md:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{t("account.billing.current")}</div>
              <div className="mt-1 flex items-center gap-2 font-display text-xl font-bold">
                {plan?.name ?? "—"} {d?.sub && <StatusChip status={d.sub.status} />}
              </div>
              {d?.sub?.trial_ends_at && d.sub.status === "trialing" && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("account.billing.trialEnds", {
                    date: new Date(d.sub.trial_ends_at).toLocaleDateString(tag),
                  })}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("account.billing.remaining")}</div>
              <div className="mt-1 font-display text-xl font-bold">
                {d?.balance.toLocaleString(tag) ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("account.billing.included", {
                  count: plan?.monthly_credits?.toLocaleString(tag) ?? "",
                })}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("account.billing.last30")}</div>
              <div className="mt-1 font-display text-xl font-bold">
                {t("account.billing.credits", { count: d?.used30 ?? 0 })}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("account.billing.calls", { count: d?.calls30 ?? 0 })}
              </div>
            </div>
          </div>
          <h2 className="mb-3 mt-10 font-semibold">{t("account.billing.includes")}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {d?.ents
              .filter((e) => e.plan_key === d.sub?.plan_key)
              .map((e) => (
                <div
                  key={e.feature_key}
                  className="flex justify-between rounded-lg border border-border px-4 py-2.5 text-sm"
                >
                  <span>
                    {e.feature_key in FEATURE_LABEL
                      ? t(FEATURE_LABEL[e.feature_key as keyof typeof FEATURE_LABEL])
                      : e.feature_key}
                  </span>
                  <span className="text-muted-foreground">
                    {e.limit_value === null ? t("account.billing.unlimited") : e.limit_value}
                  </span>
                </div>
              ))}
          </div>
          <h2 className="mb-3 mt-10 font-semibold">{t("account.billing.change")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("account.billing.indicative")}</p>
          <Panel className="border-warning/30 bg-warning/5 text-sm">
            {t("account.billing.payment")}
          </Panel>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {d?.plans
              .filter((p) => p.key !== "trial")
              .map((p) => (
                <Panel key={p.key} className={p.key === d.sub?.plan_key ? "border-primary/40" : ""}>
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 font-display text-2xl font-bold">
                    {p.price_monthly_eur === null
                      ? t("account.billing.custom")
                      : `€${Number(p.price_monthly_eur)}`}
                    <span className="text-sm font-normal text-muted-foreground">
                      {p.price_monthly_eur !== null && t("account.billing.perMonth")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.monthly_credits
                      ? t("account.billing.monthlyCredits", {
                          count: p.monthly_credits.toLocaleString(tag),
                        })
                      : t("account.billing.customCredits")}
                  </div>
                </Panel>
              ))}
          </div>
          {orgId && d && can(o.role, "billing.manage") && (
            <BillingProfile
              key={`${orgId}-${d.bp?.legal_name ?? ""}`}
              orgId={orgId}
              initial={d.bp ?? null}
            />
          )}
          <h2 className="mb-3 mt-10 font-semibold">{t("account.billing.history")}</h2>
          <div className="divide-y divide-border rounded-lg border border-border text-sm">
            {d?.ledger.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <span className="text-muted-foreground">
                  {new Date(l.created_at).toLocaleString(tag)} ·{" "}
                  {`account.billing.reason.${l.reason}` in MESSAGES.en
                    ? t(`account.billing.reason.${l.reason}` as MessageKey)
                    : l.reason.replace("_", " ")}
                </span>
                <span className={l.delta > 0 ? "text-success" : ""}>
                  {l.delta > 0 ? "+" : ""}
                  {l.delta}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BillingProfile({
  orgId,
  initial,
}: {
  orgId: string;
  initial: {
    legal_name: string | null;
    country: string | null;
    vat_id: string | null;
    address: string | null;
  } | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    legal_name: initial?.legal_name ?? "",
    country: initial?.country ?? "",
    vat_id: initial?.vat_id ?? "",
    address: initial?.address ?? "",
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("billing_profiles").upsert({
      org_id: orgId,
      legal_name: f.legal_name || null,
      country: f.country.toUpperCase().slice(0, 2) || null,
      vat_id: f.vat_id || null,
      address: f.address || null,
    });
    if (error) toast.error(t("account.billing.saveFailed"));
    else toast.success(t("account.billing.saved"));
  }
  return (
    <>
      <h2 className="mb-3 mt-10 font-semibold">{t("account.billing.details")}</h2>
      <form
        onSubmit={save}
        className="grid gap-3 rounded-lg border border-border p-5 md:grid-cols-2"
      >
        <div className="space-y-1.5">
          <Label>{t("account.billing.legal")}</Label>
          <Input
            value={f.legal_name}
            onChange={(e) => setF({ ...f, legal_name: e.target.value })}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("account.billing.country")}</Label>
          <Input
            value={f.country}
            onChange={(e) => setF({ ...f, country: e.target.value })}
            maxLength={2}
            placeholder="BE"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("account.billing.vat")}</Label>
          <Input
            value={f.vat_id}
            onChange={(e) => setF({ ...f, vat_id: e.target.value })}
            maxLength={30}
          />
          <p className="text-xs text-muted-foreground">{t("account.billing.vatHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("account.billing.address")}</Label>
          <Input
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            maxLength={500}
          />
        </div>
        <div>
          <Button size="sm">{t("account.billing.save")}</Button>
        </div>
      </form>
    </>
  );
}
