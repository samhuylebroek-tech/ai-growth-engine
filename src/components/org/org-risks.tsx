import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import type { MonitorItem } from "@/lib/org/monitoring";
import { orgDecisionsOptions } from "@/components/org/org-data";
import { Section, Badge, useFmt } from "@/components/bi/parts";
import { Button } from "@/components/ui/button";
import { tk, useNames, Empty, type OrgModel } from "@/components/org/org-model";
import { FindingCard, subjectLabel } from "@/components/org/org-parts";

type Open = (
  id: string,
  to?: "/app" | "/app/goals" | "/app/campaigns" | "/app/tasks" | "/app/costs" | "/app/approvals",
) => void;
const ROUTE: Partial<
  Record<MonitorItem["code"], "/app/goals" | "/app/tasks" | "/app/campaigns" | "/app">
> = {
  behind_target: "/app/goals",
  exceeding: "/app/goals",
  priority_without_goal: "/app/goals",
  shared_bottleneck: "/app/tasks",
  conflicting_strategies: "/app/campaigns",
  execution_paused: "/app",
};

export function RisksTab({ m, open }: { m: OrgModel; open: Open }) {
  const o = useOrg();
  const { t } = useI18n();
  const name = useNames();
  const f = useFmt();
  const admin = can(o.role, "audit.read");
  const history = useQuery(orgDecisionsOptions(o.org?.id, admin));
  if (!m.model) return null;
  const { iq, view } = m.model;
  const pendingCommitments = (m.intel.data?.commitments ?? []).filter(
    (c) => c.status === "pending",
  );
  return (
    <>
      <Section title={t("ogo.mon.title")} intro={t("ogo.mon.intro")}>
        {iq.monitor.length ? (
          <ul className="divide-y divide-border border-y border-border">
            {iq.monitor.map((x) => (
              <li
                key={x.key}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      kind={
                        x.severity === "high" ? "low" : x.severity === "medium" ? "medium" : "high"
                      }
                    >
                      {t(tk(`ogo.sev.${x.severity}`))}
                    </Badge>
                    <span className="font-medium">
                      {t(tk(`ogo.mon.${x.code}`), {
                        ...x.params,
                        names: x.businesses.map(name).join(" · "),
                        specialist: x.params["specialist"]
                          ? subjectLabel(t, "specialist_contention", x.params["specialist"])
                          : "",
                        subject: subjectLabel(
                          t,
                          x.params["kind"] === "budget_overlap" ||
                            x.params["kind"] === "campaign_conflict"
                            ? "x"
                            : "shared_bottleneck",
                          x.params["subject"] ?? "",
                        ),
                      })}
                    </span>
                  </div>
                </div>
                {ROUTE[x.code] && x.businesses[0] && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => open(x.businesses[0]!, ROUTE[x.code])}
                  >
                    {t("org.openBusiness", { name: name(x.businesses[0]) })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("ogo.mon.none")}</Empty>
        )}
      </Section>

      <Section title={t("org.coord.title")} intro={t("org.coord.intro")}>
        {view.findings.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {view.findings.map((x) => (
              <FindingCard key={x.key} f={x} name={name} />
            ))}
          </ul>
        ) : (
          <Empty>{t("org.coord.none", { n: String(m.businesses.length) })}</Empty>
        )}
      </Section>

      <Section title={t("ogo.pending.title")} intro={t("ogo.pending.intro")}>
        <ul className="space-y-1.5 text-sm">
          <li>{t("ogo.pending.strategies", { n: String(iq.pending.strategyDrafts) })}</li>
          <li>
            {t("ogo.pending.commitments", {
              n: String(pendingCommitments.length),
              mine: String(iq.pending.commitmentsToDecide.length),
            })}
          </li>
          {pendingCommitments.map((c) => (
            <li key={c.id} className="pl-4 text-xs text-muted-foreground">
              • {name(c.workspace_id)}:{" "}
              {m.intel.data?.initiatives.find((i) => i.id === c.initiative_id)?.title ?? ""}
            </li>
          ))}
          <li>{t("ogo.pending.proposals", { n: String(iq.pending.proposals.length) })}</li>
          <li>{t("ogo.pending.validated", { n: String(iq.pending.validated.length) })}</li>
        </ul>
      </Section>

      <Section title={t("ogo.hist.title")} intro={t("ogo.hist.intro")}>
        {!admin ? (
          <Empty>{t("ogo.hist.adminsOnly")}</Empty>
        ) : history.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("ogo.hist.failed")}
          </p>
        ) : (history.data ?? []).length ? (
          <ul className="divide-y divide-border border-y border-border">
            {history.data!.map((h) => {
              const key = `ogo.audit.${h.action.replace(/^org\./, "").replace(/\./g, "_")}`;
              return (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs">
                  <span>
                    <span className="font-medium">
                      {key in MESSAGES.en ? t(tk(key)) : h.action}
                    </span>{" "}
                    · {h.actor_id === o.userId ? t("ogo.hist.you") : t("ogo.hist.someone")}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {f.date(h.created_at)} {new Date(h.created_at).toISOString().slice(11, 16)} UTC
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{t("ogo.hist.none")}</Empty>
        )}
      </Section>
    </>
  );
}
