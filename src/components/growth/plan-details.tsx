import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { AGENTS } from "@/lib/registry/agents";
import type { Strategy } from "@/lib/growth-strategy";
import { formatMetricValue } from "@/lib/performance";

const agentName = (key: string) => AGENTS.find((a) => a.key === key)?.name ?? key;

/** Everything a reviewer needs before approving: the why, audience, budget, timeline, steps, measurement, risks and evidence. */
export function PlanDetails({
  strategy,
  compact = false,
}: {
  strategy: Strategy;
  compact?: boolean;
}) {
  const { t, tag } = useI18n();
  const field = (
    k: "opportunity" | "relevance" | "outcome" | "audience" | "timeline" | "measurement",
  ) =>
    strategy[k] ? (
      <div key={k}>
        <dt className="text-xs font-medium text-muted-foreground">{t(`goals.pd.${k}`)}</dt>
        <dd>{strategy[k]}</dd>
      </div>
    ) : null;
  const list = (title: string, items: string[], tone?: string) =>
    items.length ? (
      <div>
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <ul className={`list-disc pl-5 ${tone ?? ""}`}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  const budget = strategy.budget;
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-2">
        {field("opportunity")}
        {field("relevance")}
        {field("outcome")}
        {field("audience")}
        {field("timeline")}
        {budget && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("goals.pd.budget")}</dt>
            <dd>
              {budget.amount == null
                ? t("goals.pd.budgetUnknown")
                : formatMetricValue(budget.amount, "currency", budget.currency, tag)}{" "}
              <Badge variant="outline">{t("goals.pd.estimate")}</Badge>
              {budget.basis && (
                <span className="block text-xs text-muted-foreground">{budget.basis}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {strategy.channels.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("goals.s.channelFocus")}</p>
          <ul className="space-y-1">
            {strategy.channels.map((c) => (
              <li key={c.name}>
                <span className="font-medium">{c.name}</span> · {t("goals.s.share", { n: c.share })}{" "}
                — <span className="text-muted-foreground">{c.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t("goals.pd.steps")}</p>
        <ol className="space-y-1">
          {strategy.actions.map((a, i) => (
            <li key={i} className="rounded-md bg-background/70 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-medium">
                  {i + 1}. {t("goals.s.weekTitle", { n: a.week, title: a.title })}
                </span>
                <Badge variant="outline">{t(`goals.pd.kind.${a.kind}`)}</Badge>
                <Badge variant="outline">{t(`goals.effort.${a.effort}` as MessageKey)}</Badge>
                {a.needsApproval && (
                  <Badge variant="secondary">{t("goals.pd.needsApproval")}</Badge>
                )}
              </div>
              {!compact && a.detail && (
                <span className="block text-muted-foreground">{a.detail}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {[
                  a.channel && t("goals.channelX", { c: a.channel }),
                  a.specialist && t("goals.pd.specialist", { s: agentName(a.specialist) }),
                  a.budget != null &&
                    t("goals.pd.stepBudget", {
                      v: formatMetricValue(a.budget, "currency", budget?.currency ?? "EUR", tag),
                    }),
                  a.integrations.length > 0 &&
                    t("goals.pd.integrations", { v: a.integrations.join(", ") }),
                  a.dependsOn.length > 0 && t("goals.pd.after", { v: a.dependsOn.join(", ") }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {field("measurement")}
      {strategy.kpis.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("goals.s.measure")}</p>
          <ul className="list-disc pl-5">
            {strategy.kpis.map((k) => (
              <li key={k.metric}>
                {k.metric}: {k.target}{" "}
                <span className="text-xs text-muted-foreground">({t("goals.pd.target")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {list(t("goals.s.risks"), strategy.risks)}
      {list(t("goals.pd.dependencies"), strategy.dependencies)}
      {strategy.evidence.facts.length +
        strategy.evidence.estimates.length +
        strategy.evidence.hypotheses.length >
        0 && (
        <div className="grid gap-2 rounded-md border p-2">
          {list(t("goals.pd.facts"), strategy.evidence.facts)}
          {list(t("goals.pd.estimates"), strategy.evidence.estimates)}
          {list(t("goals.pd.hypotheses"), strategy.evidence.hypotheses)}
        </div>
      )}
      {list(t("goals.s.assumptions"), strategy.assumptions)}
    </div>
  );
}
