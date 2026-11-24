import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AGENTS } from "@/lib/registry/agents";
import { CAPABILITIES, capabilityByKey } from "@/lib/registry/capabilities";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { SpecialistWorkbench } from "@/components/app/specialist-workbench";
import { CoordinationWorkbench } from "@/components/app/coordination-workbench";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CollapsibleSection } from "@/components/app/section-heading";
import { agentText, capText } from "@/lib/i18n/registry-text";

export const Route = createFileRoute("/_authenticated/app/agents")({
  head: () => localHead("agents"),
  component: Agents,
});

function Agents() {
  const { t: tx } = useI18n();
  const t = tx as (k: string) => string;
  // The full capability table is reference material: folded by default so the specialists come first.
  const [capsOpen, setCapsOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={t("reg.title")}
        description={t("reg.intro")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/growth-officer">
              <Sparkles />
              {t("reg.workGo")}
            </Link>
          </Button>
        }
      />
      <SpecialistWorkbench />
      <CoordinationWorkbench />
      <div className="grid gap-4 md:grid-cols-2">
        {AGENTS.map((a) => (
          <Panel key={a.key}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{agentText(t, a).name}</div>
              <StatusChip status={a.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{agentText(t, a).description}</p>
            {a.status === "implemented" && (
              <Button variant="link" size="sm" className="mt-3 px-0" asChild>
                <Link
                  to={
                    a.key === "growth_officer"
                      ? "/app/growth-officer"
                      : a.key === "business_intelligence"
                        ? "/app/onboarding"
                        : "/app/agents"
                  }
                >
                  {t(
                    a.key === "growth_officer"
                      ? "reg.openConversation"
                      : a.key === "business_intelligence"
                        ? "reg.research"
                        : "reg.openWorkspace",
                  )}
                  <ArrowUpRight />
                </Link>
              </Button>
            )}
            {a.status === "planned" && (
              <p className="mt-3 text-2xs text-muted-foreground">{t("reg.notOperational")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.capabilities.map((k) => (
                <span key={k} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                  {(() => {
                    const c = capabilityByKey(k);
                    return c ? capText(t, c).name : k;
                  })()}
                </span>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <div className="mt-10">
        <CollapsibleSection
          id="agents-capabilities"
          title={t("reg.capabilities")}
          eyebrow={tx("reg.capabilitiesCount", { n: CAPABILITIES.length })}
          open={capsOpen}
          onOpenChange={setCapsOpen}
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="mobile-records w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">{t("reg.col.capability")}</th>
                  <th className="px-4 py-2">{t("reg.col.touches")}</th>
                  <th className="px-4 py-2">{t("reg.col.role")}</th>
                  <th className="px-4 py-2">{t("reg.col.credits")}</th>
                  <th className="px-4 py-2">{t("reg.col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CAPABILITIES.map((c) => (
                  <tr key={c.key}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{capText(t, c).name}</div>
                      <div className="text-xs text-muted-foreground">
                        {capText(t, c).description}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {t(`reg.risk.${c.risk}`)}
                    </td>
                    <td className="px-4 py-2.5">{t(`reg.role.${c.minRole}`)}</td>
                    <td className="px-4 py-2.5">{c.credits}</td>
                    <td className="px-4 py-2.5">
                      <StatusChip status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
}
