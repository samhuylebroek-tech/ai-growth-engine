import { ArrowUpRight, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { WorkItem, Task } from "@/lib/execution";
import type { CampaignOsColumns, CampaignSpendRow } from "@/lib/pending-schema";
import { campaignOverviewMoney, campaignWorkProgress } from "@/lib/campaign-overview";

export function CampaignCard({
  item,
  tasks,
  entries,
  statusLabel,
  onOpen,
}: {
  item: WorkItem;
  tasks: readonly Task[];
  entries: readonly CampaignSpendRow[] | undefined;
  statusLabel: string;
  onOpen: () => void;
}) {
  const { t, tag } = useI18n();
  if (!("budget_eur" in item)) return null;
  const campaign = item as typeof item & Partial<CampaignOsColumns>;
  const progress = campaignWorkProgress(tasks.filter((x) => x.campaign_id === item.id));
  const money = campaignOverviewMoney(
    Number(item.budget_eur),
    entries?.filter((x) => x.campaign_id === item.id),
  );
  const currency = (n: number, code = "EUR") =>
    new Intl.NumberFormat(tag, { style: "currency", currency: code }).format(n);
  const actual = money
    ? Object.entries(money.byCurrency)
        .map(([code, total]) => currency(total.spent, code))
        .join(" · ") || currency(0)
    : t("ch.unavailable");
  const reserved = money
    ? Object.entries(money.byCurrency)
        .map(([code, total]) => currency(total.committed, code))
        .join(" · ") || currency(0)
    : t("ch.unavailable");
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Megaphone className="size-4 shrink-0 text-primary" />
        <span>{statusLabel}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto shrink-0"
          aria-label={t("work.openX", { t: item.title })}
          onClick={onOpen}
        >
          <ArrowUpRight />
        </Button>
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        <Button
          variant="link"
          className="h-auto min-h-6 whitespace-normal p-0 text-left text-lg text-foreground"
          onClick={onOpen}
        >
          {item.title}
        </Button>
      </h2>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
        {item.objective.trim() || t("ch.noObjective")}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("ch.budget")}</dt>
          <dd className="mt-1 font-medium">
            {Number(item.budget_eur) > 0 ? currency(Number(item.budget_eur)) : t("ch.noBudget")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("ch.available")}</dt>
          <dd className="mt-1 font-medium">
            {money?.remaining === null
              ? t("ch.noBudget")
              : money
                ? currency(money.remaining ?? 0)
                : t("ch.unavailable")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("ch.spent")}</dt>
          <dd className="mt-1 break-words">{actual}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("ch.reserved")}</dt>
          <dd className="mt-1 break-words">{reserved}</dd>
        </div>
      </dl>
      <div className="mt-5 border-t border-border pt-4 text-sm">
        <p className="font-medium">{campaign.primary_kpi || t("ch.noKpi")}</p>
        <p className="mt-1 text-muted-foreground">
          {campaign.kpi_actual === null || campaign.kpi_actual === undefined
            ? t("ch.noResult")
            : `${t("ch.result")}: ${campaign.kpi_actual} ${campaign.kpi_unit ?? ""}`}
        </p>
        {campaign.kpi_target !== null && campaign.kpi_target !== undefined && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("ch.target", { n: campaign.kpi_target })}
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {progress === null ? t("ch.noProgress") : `${t("ch.progress")}: ${progress}%`}
      </p>
      <Button
        variant="outline"
        className="mt-5 h-auto min-h-11 justify-between whitespace-normal text-left"
        onClick={onOpen}
      >
        {item.status === "awaiting_approval" ? t("ch.review") : t("ch.open")}
        <ArrowUpRight />
      </Button>
    </article>
  );
}
