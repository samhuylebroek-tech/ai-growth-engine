import { newestFirst, readFactPages } from "@/lib/facts-read";
import { readLocale, useI18n } from "@/lib/i18n";
import { translate } from "@/lib/i18n/messages";
import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { growthDb } from "@/lib/pending-schema";
import { REPORTING_CURRENCIES } from "@/lib/org/consolidation";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FactConflicts } from "@/components/app/fact-conflicts";
import { BusinessUnderstanding } from "@/components/app/business-understanding";

export const Route = createFileRoute("/_authenticated/app/profile")({
  head: () =>
    pageHead(
      translate(readLocale(), "account.profile.headTitle"),
      translate(readLocale(), "account.profile.headDescription"),
    ),
  component: Profile,
});

const SOURCE_LABEL = {
  user: "account.profile.source.user",
  document: "account.profile.source.document",
  website: "account.profile.source.website",
  ai_assumption: "account.profile.source.ai_assumption",
  external: "account.profile.source.external",
} as const;

function Profile() {
  const { t } = useI18n();
  const o = useOrg();
  const qc = useQueryClient();
  const ws = o.workspace?.id;
  const edit = can(o.workspaceRole, "profile.edit");
  const confirmFacts = can(o.workspaceRole, "profile.confirm");
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const q = useQuery({
    queryKey: ["profile", ws],
    enabled: !!ws,
    queryFn: async () => {
      const [bp, facts] = await Promise.all([
        growthDb
          .from("business_profiles")
          .select("*")
          .eq("workspace_id", ws ?? "")
          .maybeSingle(),
        // Every fact, in keyset pages: conflict checks need the full set, not the newest few hundred.
        readFactPages((cursor, size) => {
          const page = supabase
            .from("business_facts")
            .select("*")
            .eq("org_id", o.org?.id ?? "")
            .eq("workspace_id", ws ?? "")
            .order("id")
            .limit(size);
          return cursor ? page.gt("id", cursor) : page;
        }),
      ]);
      if (bp.error) throw bp.error;
      return { bp: bp.data, facts: newestFirst(facts.rows), complete: facts.complete };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", ws] });

  async function addFact(e: React.FormEvent) {
    e.preventDefault();
    if (!o.org || !ws) return;
    // Members add suggestions; only editors and above add confirmed facts (enforced in the database).
    const { error } = await supabase.from("business_facts").insert({
      org_id: o.org.id,
      workspace_id: ws,
      key: k.trim(),
      value: v.trim(),
      source_type: "user",
      verified: confirmFacts,
    });
    if (error) toast.error(t("account.profile.addFailed"));
    else {
      setK("");
      setV("");
      refresh();
    }
  }
  async function setCurrency(cur: string) {
    if (!ws) return;
    const { error } = await growthDb.rpc("set_business_currency", {
      _workspace: ws,
      _currency: cur,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(t("account.profile.currencySet", { currency: cur }));
      refresh();
    }
  }
  async function verify(id: string) {
    const { error } = await supabase.from("business_facts").update({ verified: true }).eq("id", id);
    if (error) toast.error(t("account.notAllowed"));
    refresh();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("business_facts").delete().eq("id", id);
    if (error) toast.error(t("account.notAllowed"));
    refresh();
  }
  async function saveFact(id: string) {
    if (!value.trim()) return;
    const { error } = await supabase
      .from("business_facts")
      .update({ value: value.trim(), verified: false })
      .eq("id", id);
    if (error) toast.error(t("account.profile.saveFailed"));
    else {
      setEditing(null);
      refresh();
    }
  }

  const visibleFacts =
    q.data?.facts.filter(
      (f) =>
        (filter === "all" || (filter === "confirmed" ? f.verified : !f.verified)) &&
        `${f.key} ${f.value}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const bp = q.data?.bp;
  const list = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
  return (
    <>
      <PageHeader
        title={t("account.profile.title")}
        description={o.workspace?.name ?? t("account.workspace")}
        actions={
          edit && (
            <Button variant="outline" asChild>
              <Link to="/app/onboarding">{t("account.profile.edit")}</Link>
            </Button>
          )
        }
      />
      {q.isLoading && (
        <div role="status" className="py-12 text-sm text-muted-foreground">
          {t("account.profile.loading")}
        </div>
      )}
      {q.isError && (
        <div role="alert" className="py-4 text-sm text-destructive">
          {t("account.profile.failed")}
        </div>
      )}
      {q.data && (
        <BusinessUnderstanding
          profile={q.data.bp}
          facts={q.data.facts}
          complete={q.data.complete}
          canConfirm={confirmFacts}
        />
      )}
      {bp && (
        <div>
          <p className="mb-4 text-xs text-muted-foreground">{t("account.profile.hint")}</p>
          {"reporting_currency" in bp && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t("account.profile.currency")}</span>
              {confirmFacts ? (
                <select
                  aria-label={t("account.profile.currency")}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={bp.reporting_currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {[...new Set([bp.reporting_currency, ...REPORTING_CURRENCIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium">{bp.reporting_currency}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {t("account.profile.currencyHint")}
              </span>
            </div>
          )}
          <div className="grid gap-x-8 gap-y-6 border-y border-border py-6 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground">
                {t("account.profile.description")}
              </div>
              <p className="mt-1 text-sm">{bp.description || "—"}</p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("account.profile.industry")}
                  </div>
                  {bp.industry || "—"}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("account.profile.model")}</div>
                  {bp.business_model || "—"}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("account.profile.website")}
                  </div>
                  <span className="break-all">{bp.website || "—"}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("account.profile.budget")}</div>
                  {bp.monthly_budget_eur ? `€${bp.monthly_budget_eur}` : "—"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("account.profile.objectives")}</div>
              <ul className="mt-1 space-y-1 text-sm">
                {list(bp.objectives).map((x) => (
                  <li key={x}>• {x}</li>
                ))}
              </ul>
              {!list(bp.objectives).length && t("account.notSet")}
            </div>
            {(["offerings", "audiences", "markets", "competitors"] as const).map((key) => (
              <div key={key}>
                <div className="text-xs capitalize text-muted-foreground">
                  {t(`account.field.${key}`)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {list(bp[key]).map((x) => (
                    <span key={x} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                      {x}
                    </span>
                  ))}
                  {!list(bp[key]).length && <span className="text-sm">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <h2 className="mb-3 mt-10 font-semibold">{t("account.profile.knowledge")}</h2>
      {q.data && (
        <FactConflicts
          facts={q.data.facts}
          complete={q.data.complete}
          canDecide={confirmFacts}
          onResolved={refresh}
          sourceLabel={(st) =>
            st in SOURCE_LABEL ? t(SOURCE_LABEL[st as keyof typeof SOURCE_LABEL]) : st
          }
        />
      )}
      <p className="mb-4 text-sm text-muted-foreground">{t("account.profile.trust")}</p>
      <div className="mb-5 flex flex-wrap gap-3">
        <Input
          aria-label={t("account.profile.searchLabel")}
          placeholder={t("account.profile.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          aria-label={t("account.profile.status")}
          className="rounded-md border border-border bg-card px-3 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t("account.profile.all")}</option>
          <option value="confirmed">{t("account.confirmed")}</option>
          <option value="review">{t("account.reviewNeeded")}</option>
        </select>
      </div>
      {edit && (
        <form onSubmit={addFact} className="mb-4 flex flex-wrap gap-2">
          <Input
            placeholder={t("account.profile.topic")}
            value={k}
            onChange={(e) => setK(e.target.value)}
            required
            maxLength={120}
            className="max-w-xs"
          />
          <Input
            placeholder={t("account.profile.fact")}
            value={v}
            onChange={(e) => setV(e.target.value)}
            required
            maxLength={1000}
            className="min-w-0 flex-1"
          />
          <Button type="submit">{t("account.profile.add")}</Button>
        </form>
      )}
      {visibleFacts.length ? (
        <div className="divide-y divide-border border-y border-border">
          {visibleFacts.map((f) => (
            <article key={f.id} className="grid gap-3 py-5 md:grid-cols-[180px_minmax(0,1fr)_auto]">
              <div>
                <h3 className="text-sm font-semibold">{f.key}</h3>
                <div className="mt-2">
                  <StatusChip status={f.verified ? "approved" : "pending"}>
                    {f.verified
                      ? t("account.confirmed")
                      : f.source_type === "ai_assumption"
                        ? t("account.hypothesis")
                        : t("account.reviewNeeded")}
                  </StatusChip>
                </div>
              </div>
              <div className="min-w-0">
                {editing === f.id ? (
                  <Textarea
                    aria-label={t("account.profile.editValue")}
                    maxLength={3000}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <p className="break-words text-sm leading-relaxed">{f.value}</p>
                )}
                <p className="mt-2 break-all text-[10px] text-muted-foreground">
                  {f.source_type in SOURCE_LABEL
                    ? t(SOURCE_LABEL[f.source_type as keyof typeof SOURCE_LABEL])
                    : f.source_type}
                  {f.source_ref ? ` · ${f.source_ref}` : ""}
                  {f.confidence !== null
                    ? ` · ${t("account.confidence", { count: Math.round(f.confidence * 100) })}`
                    : ""}
                </p>
              </div>
              {edit && (confirmFacts || !f.verified) && (
                <div className="flex items-start gap-1">
                  {editing === f.id ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => saveFact(f.id)}>
                        {t("account.save")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("account.profile.cancel")}
                        onClick={() => setEditing(null)}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(f.id);
                          setValue(f.value);
                        }}
                        aria-label={t("account.profile.editFact")}
                        title={t("account.profile.editFact")}
                      >
                        <Pencil />
                      </Button>
                      {!f.verified && confirmFacts && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => verify(f.id)}
                          aria-label={t("account.profile.confirmFact")}
                          title={t("account.profile.confirmFact")}
                        >
                          <Check />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(f.id)}
                        aria-label={t("account.delete")}
                        title={t("account.profile.deleteFact")}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : !q.isLoading && !q.isError ? (
        <EmptyState
          title={
            q.data?.facts.length ? t("account.profile.noMatch") : t("account.profile.foundation")
          }
          text={
            q.data?.facts.length ? t("account.profile.noKnowledge") : t("account.profile.emptyHint")
          }
          action={
            <Button variant="outline" asChild>
              <Link to="/app/onboarding">{t("account.profile.discover")}</Link>
            </Button>
          }
        />
      ) : null}
    </>
  );
}
