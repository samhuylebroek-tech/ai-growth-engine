import { CrmGuidance } from "@/components/crm/guidance";
import { collectPages } from "@/lib/pagination";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { Field } from "@/components/app/field";
import { PageHeader } from "@/components/app/status";
import { useI18n } from "@/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import {
  STAGES,
  pipelineSummary,
  pipelineCurrencies,
  nextStage,
  pipelineMatches,
  type Stage,
} from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const sel =
  "h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm sm:w-auto sm:max-w-56";
const money = (n: number, tag?: string, currency = "EUR") =>
  new Intl.NumberFormat(tag, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

export function Pipeline() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  const { t: tx } = useI18n();
  if (loading) return <p className="p-6 text-muted-foreground">{tx("marketing.crm.loading")}</p>;
  if (!workspace || !org)
    return <p className="p-6 text-muted-foreground">{tx("marketing.crm.chooseWs")}</p>;
  return (
    <Board
      key={`${org.id}/${workspace.id}`}
      orgId={org.id}
      wsId={workspace.id}
      canEdit={hasRole(workspaceRole, "member")}
    />
  );
}

function Board({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const stageLabel = (s: string) =>
    STAGES.includes(s as Stage) ? tx(`marketing.crm.stage.${s as Stage}`) : s;
  const data = useQuery({
    queryKey: ["pipeline", orgId, wsId],
    queryFn: async () => {
      const watermark = new Date().toISOString();
      const contacts = await collectPages(async (cursor, size) => {
        let query = supabase
          .from("crm_contacts")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("status", "active")
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) query = query.gt("id", cursor);
        return await query;
      });
      const [deals, goals] = await Promise.all([
        collectPages(async (cursor, size) => {
          let query = supabase
            .from("crm_deals")
            .select("*")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .lte("created_at", watermark)
            .order("id")
            .limit(size);
          if (cursor) query = query.gt("id", cursor);
          return await query;
        }),
        collectPages(async (cursor, size) => {
          let query = supabase
            .from("growth_goals")
            .select("id,title")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .neq("status", "archived")
            .order("id")
            .limit(size);
          if (cursor) query = query.gt("id", cursor);
          return await query;
        }),
      ]);
      return {
        contacts: contacts.sort((a, b) => a.name.localeCompare(b.name)),
        deals: deals.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        goals,
      };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pipeline", orgId, wsId] });
  const [tab, setTab] = useState<"deals" | "contacts">("deals");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("open");
  const [c, setC] = useState({ name: "", company: "", email: "", phone: "", source: "" });
  const [d, setD] = useState({
    title: "",
    contact: "",
    value: "",
    close: "",
    goal: "",
    currency: "EUR",
  });

  const addContact = async () => {
    if (busy) return;
    const valid = z
      .object({
        name: z.string().trim().min(1).max(200),
        company: z.string().trim().max(200),
        email: z.union([z.email().max(255), z.literal("")]),
        phone: z.string().trim().max(60),
        source: z.string().trim().max(80),
      })
      .safeParse({ ...c, email: c.email.trim().toLowerCase() });
    if (!valid.success) return void toast.error(tx("lead.invalid"));
    setBusy(true);
    const r = await supabase.from("crm_contacts").insert({
      org_id: orgId,
      workspace_id: wsId,
      ...valid.data,
    });
    setBusy(false);
    if (r.error) return void toast.error(tx("marketing.crm.contactFailed"));
    setCreating(false);
    setC({ name: "", company: "", email: "", phone: "", source: "" });
    await refresh();
  };
  const addDeal = async () => {
    if (busy) return;
    if (!d.title.trim() || d.title.trim().length > 200)
      return void toast.error(tx("marketing.crm.nameDeal"));
    const value = d.value.trim() === "" ? 0 : Number(d.value);
    if (!Number.isFinite(value) || value < 0)
      return void toast.error(tx("marketing.crm.validValue"));
    if (!/^[A-Z]{3}$/.test(d.currency)) return void toast.error(tx("marketing.crm.validValue"));
    setBusy(true);
    const r = await supabase.from("crm_deals").insert({
      org_id: orgId,
      workspace_id: wsId,
      title: d.title.trim(),
      contact_id: d.contact || null,
      goal_id: d.goal || null,
      value,
      currency: d.currency,
      expected_close: d.close || null,
    });
    setBusy(false);
    if (r.error) return void toast.error(tx("marketing.crm.dealFailed"));
    setCreating(false);
    setD({ title: "", contact: "", value: "", close: "", goal: "", currency: "EUR" });
    await refresh();
  };
  const setStage = async (id: string, stage: string) => {
    let lost_reason = "";
    if (stage === "lost")
      lost_reason = (window.prompt(tx("marketing.crm.lostWhy")) ?? "").slice(0, 500);
    const r = await supabase
      .from("crm_deals")
      .update({ stage, lost_reason })
      .eq("id", id)
      .eq("org_id", orgId)
      .eq("workspace_id", wsId);
    if (r.error) toast.error(tx("marketing.crm.updateFailed"));
    await refresh();
  };
  const archiveContact = async (id: string) => {
    const r = await supabase
      .from("crm_contacts")
      .update({ status: "archived" })
      .eq("id", id)
      .eq("org_id", orgId)
      .eq("workspace_id", wsId);
    if (r.error) toast.error(tx("marketing.crm.archiveFailed"));
    await refresh();
  };

  if (data.isLoading)
    return <p className="p-6 text-muted-foreground">{tx("marketing.crm.loadingPipe")}</p>;
  if (data.error || !data.data)
    return <p className="p-6 text-destructive">{tx("marketing.crm.loadFailed")}</p>;
  const { contacts, deals, goals } = data.data;
  const s = pipelineSummary(deals.map((d) => ({ stage: d.stage, value: 0 })));
  const currencies = pipelineCurrencies(deals);
  const contactName = (id: string | null) => contacts.find((x) => x.id === id)?.name;
  const visibleContacts = contacts.filter((c) =>
    pipelineMatches([c.name, c.company, c.email, c.phone, c.source], search),
  );
  const visibleDeals = deals.filter(
    (d) =>
      pipelineMatches([d.title, contactName(d.contact_id) ?? null], search) &&
      (filter === "all" ||
        (filter === "open" ? d.stage !== "won" && d.stage !== "lost" : d.stage === filter)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tx("marketing.crm.title")}
        description={tx("marketing.crm.intro")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/leads">{tx("lead.title")}</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [
            tx("marketing.crm.openValue"),
            currencies.map((c) => money(c.open, tag, c.currency)).join(" · ") || "—",
            tx("marketing.crm.openDeals", { n: s.openCount }),
          ],
          [
            tx("marketing.crm.wonValue"),
            currencies.map((c) => money(c.won, tag, c.currency)).join(" · ") || "—",
            tx("marketing.crm.wonN", { n: s.wonCount }),
          ],
          [tx("marketing.crm.lost"), String(s.lostCount), tx("marketing.crm.deals")],
          [
            tx("marketing.crm.winRate"),
            s.winRate === null ? "—" : `${s.winRate}%`,
            tx("marketing.crm.ofClosed"),
          ],
        ].map(([l, v, h]) => (
          <div key={l} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="break-words text-lg font-semibold">{v}</p>
            <p className="text-xs text-muted-foreground">{h}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{tx("marketing.crm.guideNote")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={tab === "deals" ? "default" : "outline"}
          size="sm"
          aria-pressed={tab === "deals"}
          onClick={() => {
            setTab("deals");
            setCreating(false);
          }}
        >
          {tx("marketing.crm.dealsTab")}
        </Button>
        <Button
          variant={tab === "contacts" ? "default" : "outline"}
          size="sm"
          aria-pressed={tab === "contacts"}
          onClick={() => {
            setTab("contacts");
            setCreating(false);
          }}
        >
          {tx("marketing.crm.contactsTab", { n: contacts.length })}
        </Button>
        {canEdit && (
          <Button
            className="ml-auto"
            variant="outline"
            onClick={() => setCreating((v) => !v)}
            aria-expanded={creating}
          >
            <Plus />
            {tab === "deals" ? tx("marketing.crm.addDeal") : tx("marketing.crm.addContact")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={tx("lead.searchCrm")} className="w-full sm:max-w-sm">
          <Input
            type="search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {tab === "deals" && (
          <Field label={tx("lead.showDeals")}>
            <select className={sel} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="open">{tx("lead.openDeals")}</option>
              <option value="all">{tx("lead.allDeals")}</option>
              <option value="won">{stageLabel("won")}</option>
              <option value="lost">{stageLabel("lost")}</option>
            </select>
          </Field>
        )}
      </div>

      {tab === "deals" ? (
        <>
          {canEdit && creating && (
            <form
              className="grid gap-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addDeal();
              }}
            >
              <Field label={tx("marketing.crm.dealName")}>
                <Input
                  required
                  maxLength={200}
                  value={d.title}
                  onChange={(e) => setD({ ...d, title: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.contact")}>
                <select
                  className={sel}
                  value={d.contact}
                  onChange={(e) => setD({ ...d, contact: e.target.value })}
                >
                  <option value="">{tx("marketing.crm.noContact")}</option>
                  {contacts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tx("marketing.crm.value")}>
                <Input
                  inputMode="decimal"
                  value={d.value}
                  onChange={(e) => setD({ ...d, value: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.currency")}>
                <Input
                  required
                  maxLength={3}
                  value={d.currency}
                  onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={tx("marketing.crm.expectedClose")}>
                <Input
                  type="date"
                  value={d.close}
                  onChange={(e) => setD({ ...d, close: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.goal")}>
                <select
                  className={sel}
                  value={d.goal}
                  onChange={(e) => setD({ ...d, goal: e.target.value })}
                >
                  <option value="">{tx("marketing.crm.noGoal")}</option>
                  {goals.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Button disabled={busy} type="submit">
                <Plus />
                {tx("marketing.crm.addDeal")}
              </Button>
            </form>
          )}
          {!visibleDeals.length && (search || filter !== "all") && (
            <p role="status" className="text-sm text-muted-foreground">
              {tx("lead.noMatches")}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STAGES.map((stage) => {
              const list = visibleDeals.filter((x) => x.stage === stage);
              return (
                <section key={stage} className="min-w-0 rounded-lg border bg-muted/40 p-2">
                  <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
                    {stageLabel(stage)}
                    <Badge variant="secondary">{list.length}</Badge>
                  </h2>
                  <div className="space-y-2">
                    {list.length === 0 && (
                      <p className="px-1 text-xs text-muted-foreground">
                        {tx("marketing.crm.noDeals")}
                      </p>
                    )}
                    {list.map((x) => {
                      const n = nextStage(x.stage);
                      return (
                        <article
                          key={x.id}
                          className="space-y-1 rounded-md border bg-card p-2 text-sm"
                        >
                          <p className="break-words font-medium">{x.title}</p>
                          <CrmGuidance kind="crm_deals" id={x.id} stage={x.stage} />
                          <p className="text-xs text-muted-foreground">
                            {money(Number(x.value), tag, x.currency)}
                            {contactName(x.contact_id) ? ` · ${contactName(x.contact_id)}` : ""}
                            {x.expected_close
                              ? tx("marketing.crm.close", {
                                  d: new Date(`${x.expected_close}T12:00:00`).toLocaleDateString(
                                    tag,
                                  ),
                                })
                              : ""}
                          </p>
                          {x.stage === "lost" && x.lost_reason && (
                            <p className="text-xs text-muted-foreground">
                              {tx("marketing.crm.reason", { r: x.lost_reason })}
                            </p>
                          )}
                          {canEdit && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {n && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setStage(x.id, n)}
                                >
                                  → {stageLabel(n)}
                                </Button>
                              )}
                              {x.stage !== "won" && x.stage !== "lost" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setStage(x.id, "won")}
                                  >
                                    {tx("marketing.crm.won")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setStage(x.id, "lost")}
                                  >
                                    {tx("marketing.crm.lostBtn")}
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setStage(x.id, "negotiation")}
                                >
                                  {tx("marketing.crm.reopen")}
                                </Button>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {canEdit && creating && (
            <form
              className="grid gap-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addContact();
              }}
            >
              <Field label={tx("marketing.crm.contactName")}>
                <Input
                  required
                  maxLength={200}
                  autoComplete="name"
                  value={c.name}
                  onChange={(e) => setC({ ...c, name: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.company")}>
                <Input
                  maxLength={200}
                  autoComplete="organization"
                  value={c.company}
                  onChange={(e) => setC({ ...c, company: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.email")}>
                <Input
                  type="email"
                  maxLength={255}
                  autoComplete="email"
                  value={c.email}
                  onChange={(e) => setC({ ...c, email: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.phone")}>
                <Input
                  type="tel"
                  maxLength={60}
                  autoComplete="tel"
                  value={c.phone}
                  onChange={(e) => setC({ ...c, phone: e.target.value })}
                />
              </Field>
              <Field label={tx("marketing.crm.source")}>
                <Input
                  maxLength={80}
                  value={c.source}
                  onChange={(e) => setC({ ...c, source: e.target.value })}
                />
              </Field>
              <Button disabled={busy} type="submit">
                <Plus />
                {tx("marketing.crm.addContact")}
              </Button>
            </form>
          )}
          {visibleContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search ? tx("lead.noMatches") : tx("marketing.crm.noContacts")}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {visibleContacts.map((x) => {
                const open = deals.filter(
                  (y) => y.contact_id === x.id && y.stage !== "won" && y.stage !== "lost",
                ).length;
                return (
                  <li
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {x.name}
                        {x.company ? (
                          <span className="text-muted-foreground"> · {x.company}</span>
                        ) : null}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">
                        {[x.email, x.phone, x.source].filter(Boolean).join(" · ") ||
                          tx("marketing.crm.noDetails")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CrmGuidance kind="crm_contacts" id={x.id} />
                      <Badge variant="outline">
                        {tx("marketing.crm.openDealsBadge", { n: open })}
                      </Badge>
                      {canEdit && (
                        <Button size="sm" variant="ghost" onClick={() => archiveContact(x.id)}>
                          {tx("marketing.crm.archive")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
