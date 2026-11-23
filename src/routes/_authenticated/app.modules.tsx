import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Compass,
  Megaphone,
  Users,
  Globe2,
  LineChart,
  ArrowUpRight,
  Search,
  Sparkles,
} from "lucide-react";
import { EXTENSIONS } from "@/lib/registry/extensions";
import { PageHeader, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GrowthQuestion } from "@/components/app/growth-question";
import { useI18n } from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/app/modules")({
  head: () => localHead("modules"),
  component: Modules,
});
const AREAS = [
  { id: "strategy", icon: Compass, keys: ["strategy"], to: "/app/intelligence" as const },
  {
    id: "marketing",
    icon: Megaphone,
    keys: ["seo_content", "social_ads", "email_automation"],
    to: "/app/content" as const,
  },
  { id: "sales", icon: Users, keys: ["crm_sales"], to: "/app/pipeline" as const },
  { id: "website", icon: Globe2, keys: ["seo_content"], to: "/app/seo" as const },
  { id: "analytics", icon: LineChart, keys: ["revenue", "reports"], to: "/app/business" as const },
];
function Modules() {
  const [filter, setFilter] = useState("");
  const { t: tx } = useI18n();
  const t = tx as (k: string) => string;
  const areas = AREAS.map((a) => ({
    ...a,
    title: t(`pg.mod.${a.id}.t`),
    text: t(`pg.mod.${a.id}.x`),
    action: t(`pg.mod.${a.id}.a`),
    note: t(`pg.mod.${a.id}.n`),
  })).filter((a) => `${a.title} ${a.text}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <PageHeader title={t("pg.mod.title")} description={t("pg.mod.intro")} />
      <div className="mb-7 flex items-center gap-2 border-b border-border pb-5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          aria-label={t("pg.mod.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("pg.mod.searchPh")}
          className="max-w-sm"
        />
      </div>
      <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
        {areas.map((a) => (
          <section key={a.id} className="border-b border-border pb-7">
            <a.icon className="mb-4 h-6 w-6 text-primary" />
            <h2 className="text-base font-semibold">{a.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{a.text}</p>
            <div className="mt-4 space-y-2">
              {EXTENSIONS.filter((e) => a.keys.includes(e.key)).map((e) => (
                <div key={e.key} className="flex items-center justify-between gap-3 text-xs">
                  <span>{t(`reg.ext.${e.key}.name`)}</span>
                  <StatusChip status={e.status} />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{a.note}</p>
            <Button variant="link" className="mt-3 px-0" asChild>
              <Link to={a.to}>
                {a.action}
                <ArrowUpRight />
              </Link>
            </Button>
          </section>
        ))}
      </div>
      {!areas.length && <p className="py-10 text-sm text-muted-foreground">{t("pg.mod.none")}</p>}
      <section className="mt-10 max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">{t("pg.mod.start")}</h2>
        </div>
        <GrowthQuestion compact />
      </section>
    </>
  );
}
