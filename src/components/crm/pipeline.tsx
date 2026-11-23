import { useState } from "react";
import { PageHeader } from "@/components/app/status";
import { useI18n } from "@/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, pipelineSummary, nextStage, type Stage } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const sel =
  "h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm sm:w-auto sm:max-w-56";
const money = (n: number, tag?: string) =>
  new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "EUR",
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
      key={workspace.id}
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
    queryKey: ["pipeline", wsId],
    queryFn: async () => {
      const [c, d, g] = await Promise.all([
        supabase
          .from("crm_contacts")
          .select("*")
          .eq("workspace_id", wsId)
          .eq("status", "active")
          .order("name")
          .limit(500),
        supabase
          .from("crm_deals")
          .select("*")
          .eq("workspace_id", wsId)
          .order("updated_at", { ascending: false })
          .limit(500),
        supabase
          .from("growth_goals")
          .select("id,title")
          .eq("workspace_id", wsId)
          .neq("status", "archived")
          .limit(100),
      ]);
      if (c.error || d.error || g.error) throw c.error ?? d.error ?? g.error;
      return { contacts: c.data, deals: d.data, goals: g.data };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pipeline", wsId] });
  const [tab, setTab] = useState<"deals" | "contacts">("deals");
  const [c, setC] = useState({ name: "", company: "", email: "", phone: "", source: "" });
  const [d, setD] = useState({ title: "", contact: "", value: "", close: "", goal: "" });

  const addContact = async () => {
    if (!c.name.trim()) return void toast.error(tx("marketing.crm.nameContact"));
    const r = await supabase.from("crm_contacts").insert({
      org_id: orgId,
      workspace_id: wsId,
      name: c.name.trim(),
      company: c.company.trim(),
      email: c.email.trim(),
      phone: c.phone.trim(),
      source: c.source.trim(),
    });
    if (r.error) return void toast.error(tx("marketing.crm.contactFailed"));
    setC({ name: "", company: "", email: "", phone: "", source: "" });
    await refresh();
  };
  const addDeal = async () => {
    if (!d.title.trim()) return void toast.error(tx("marketing.crm.nameDeal"));
    const value = d.value.trim() === "" ? 0 : Number(d.value);
    if (!Number.isFinite(value) || value < 0)
      return void toast.error(tx("marketing.crm.validValue"));
    const r = await supabase.from("crm_deals").insert({
      org_id: orgId,
      workspace_id: wsId,
      title: d.title.trim(),
      contact_id: d.contact || null,
      goal_id: d.goal || null,
      value,
      expected_close: d.close || null,
    });
    if (r.error) return void toast.error(tx("marketing.crm.dealFailed"));
    setD({ title: "", contact: "", value: "", close: "", goal: "" });
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
      .eq("workspace_id", wsId);
    if (r.error) toast.error(tx("marketing.crm.updateFailed"));
    await refresh();
  };
  const archiveContact = async (id: string) => {
    const r = await supabase
      .from("crm_contacts")
      .update({ status: "archived" })
      .eq("id", id)
      .eq("workspace_id", wsId);
    if (r.error) toast.error(tx("marketing.crm.archiveFailed"));
    await refresh();
  };

  if (data.isLoading)
    return <p className="p-6 text-muted-foreground">{tx("marketing.crm.loadingPipe")}</p>;
  if (data.error || !data.data)
    return <p className="p-6 text-destructive">{tx("marketing.crm.loadFailed")}</p>;
  const { contacts, deals, goals } = data.data;
  const s = pipelineSummary(deals);
  const contactName = (id: string | null) => contacts.find((x) => x.id === id)?.name;

  return (
    <div className="space-y-6">
      <PageHeader title={tx("marketing.crm.title")} description={tx("marketing.crm.intro")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [
            tx("marketing.crm.openValue"),
            money(s.open, tag),
            tx("marketing.crm.openDeals", { n: s.openCount }),
          ],
          [
            tx("marketing.crm.wonValue"),
            money(s.won, tag),
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
            <p className="text-xl font-semibold">{v}</p>
            <p className="text-xs text-muted-foreground">{h}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant={tab === "deals" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("deals")}
        >
          {tx("marketing.crm.dealsTab")}
        </Button>
        <Button
          variant={tab === "contacts" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("contacts")}
        >
          {tx("marketing.crm.contactsTab", { n: contacts.length })}
        </Button>
      </div>

      {tab === "deals" ? (
        <>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
              <Input
                aria-label={tx("marketing.crm.dealName")}
                placeholder={tx("marketing.crm.dealName")}
                className="w-full sm:w-56"
                value={d.title}
                onChange={(e) => setD({ ...d, title: e.target.value })}
              />
              <select
                aria-label={tx("marketing.crm.contact")}
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
              <Input
                aria-label={tx("marketing.crm.value")}
                placeholder={tx("marketing.crm.valueEur")}
                inputMode="decimal"
                className="w-32"
                value={d.value}
                onChange={(e) => setD({ ...d, value: e.target.value })}
              />
              <Input
                aria-label={tx("marketing.crm.expectedClose")}
                type="date"
                className="w-40"
                value={d.close}
                onChange={(e) => setD({ ...d, close: e.target.value })}
              />
              <select
                aria-label={tx("marketing.crm.goal")}
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
              <Button size="sm" onClick={addDeal}>
                <Plus className="mr-1 h-4 w-4" />
                {tx("marketing.crm.addDeal")}
              </Button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STAGES.map((stage) => {
              const list = deals.filter((x) => x.stage === stage);
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
                          <p className="text-xs text-muted-foreground">
                            {money(Number(x.value), tag)}
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
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
              <Input
                aria-label={tx("marketing.crm.contactName")}
                placeholder={tx("marketing.crm.name")}
                className="w-full sm:w-44"
                value={c.name}
                onChange={(e) => setC({ ...c, name: e.target.value })}
              />
              <Input
                aria-label={tx("marketing.crm.company")}
                placeholder={tx("marketing.crm.company")}
                className="w-full sm:w-44"
                value={c.company}
                onChange={(e) => setC({ ...c, company: e.target.value })}
              />
              <Input
                aria-label={tx("marketing.crm.email")}
                placeholder={tx("marketing.crm.email")}
                type="email"
                className="w-full sm:w-52"
                value={c.email}
                onChange={(e) => setC({ ...c, email: e.target.value })}
              />
              <Input
                aria-label={tx("marketing.crm.phone")}
                placeholder={tx("marketing.crm.phone")}
                className="w-full sm:w-36"
                value={c.phone}
                onChange={(e) => setC({ ...c, phone: e.target.value })}
              />
              <Input
                aria-label={tx("marketing.crm.source")}
                placeholder={tx("marketing.crm.sourcePh")}
                className="w-full sm:w-44"
                value={c.source}
                onChange={(e) => setC({ ...c, source: e.target.value })}
              />
              <Button size="sm" onClick={addContact}>
                <Plus className="mr-1 h-4 w-4" />
                {tx("marketing.crm.addContact")}
              </Button>
            </div>
          )}
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tx("marketing.crm.noContacts")}</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {contacts.map((x) => {
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
                    <div className="flex items-center gap-2">
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
