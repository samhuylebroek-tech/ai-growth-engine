// Home: executive business growth summary and the top next best growth actions, from the shared business view.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { isNotInstalled } from "@/lib/pending-schema";
import { buildView, NO_FILTERS } from "@/lib/bi/view";
import { SectionHeading } from "@/components/app/section-heading";
import { GrowthActions, periodText, useBi } from "./business-overview";
import { Figure, useFmt } from "./parts";
import { HomeConverted } from "./home-converted";
import { useOrg } from "@/lib/org-context";

export function HomeBusinessSummary() {
  const { t } = useI18n();
  const f = useFmt();
  const q = useBi();
  const o = useOrg();
  const v = useMemo(() => (q.data ? buildView(q.data, NO_FILTERS, "last_touch") : null), [q.data]);
  if (q.isError && isNotInstalled(q.error)) return null;
  return (
    <section aria-label={t("bi.home.title")} className="mb-8">
      <SectionHeading eyebrow={t("bi.home.eyebrow")} title={t("bi.home.title")} />
      {q.isLoading ? (
        <p role="status" className="py-3 text-xs text-muted-foreground">
          {t("bi.loading")}
        </p>
      ) : q.isError || !v ? (
        <p role="alert" className="py-3 text-xs text-destructive">
          {t("bi.loadFailed")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label={t("bi.fig.revenueRecorded")}
              value={f.moneyList(
                v.totals
                  .map((x) => ({ currency: x.currency, amount: x.net }))
                  .filter((x) => x.amount),
              )}
              cls={v.totals.some((x) => x.manual) ? "manual" : "actual"}
              source={v.importedSources.length ? t("bi.src.ledgerMixed") : t("bi.src.team")}
              period={periodText(v, f.date)}
              missing={t("bi.miss.noRevenue")}
            />
            <Figure
              label={t("bi.fig.attributed")}
              value={f.moneyList(v.scopedAttributed)}
              cls="manual"
              source={t("bi.src.attribution", { m: t("bi.model.last_touch") })}
              period={periodText(v, f.date)}
              missing={t("bi.miss.noAttribution")}
            />
            <Figure
              label={t("bi.fig.spend")}
              value={f.moneyList(v.spend)}
              cls="manual"
              source={t("bi.src.budget")}
              period={periodText(v, f.date)}
              missing={t("bi.miss.noSpend")}
            />
            <Figure
              label={t("bi.fig.pipeline")}
              value={f.moneyList(v.pipeline)}
              cls="estimated"
              source={t("bi.src.pipeline")}
              period={t("bi.period.now")}
              missing={t("bi.miss.noPipeline")}
            />
          </div>
          {o.org && o.workspace && <HomeConverted orgId={o.org.id} wsId={o.workspace.id} name={o.workspace.name} from={v.range.from} to={v.range.to} />}
          <h3 className="mb-2 mt-4 text-xs font-semibold">{t("bi.actions.title")}</h3>
          <GrowthActions actions={v.actions} compact />
          <Link
            to="/app/business"
            className="mt-3 inline-block text-xs text-primary hover:underline"
          >
            {t("bi.home.open")}
          </Link>
        </>
      )}
    </section>
  );
}
