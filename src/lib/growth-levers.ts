// The fifteen growth levers the Growth Officer checks systematically (pure). For each lever it lists which of the
// business's own records can support a recommendation and which data is missing, so advice is grounded in what
// exists and a gap is named instead of filled with an invented figure. Availability is not evidence of a result.
export type Lever =
  | "acquisition"
  | "existing_customers"
  | "conversion"
  | "retention"
  | "new_offerings"
  | "new_markets"
  | "new_channels"
  | "partnerships"
  | "referrals"
  | "pricing"
  | "upsell_cross_sell"
  | "reactivation"
  | "efficient_spend"
  | "margins"
  | "revenue_models";
export const LEVERS: Lever[] = [
  "acquisition",
  "existing_customers",
  "conversion",
  "retention",
  "new_offerings",
  "new_markets",
  "new_channels",
  "partnerships",
  "referrals",
  "pricing",
  "upsell_cross_sell",
  "reactivation",
  "efficient_spend",
  "margins",
  "revenue_models",
];
export type Source =
  | "marketing_metric"
  | "conversion_metric"
  | "retention_metric"
  | "margin_metric"
  | "acquisition_cost_metric"
  | "customer_value_metric"
  | "revenue_ledger"
  | "attributed_revenue"
  | "pipeline"
  | "budget"
  | "campaigns"
  | "experiments"
  | "competitor_observations"
  | "offerings_fact"
  | "markets_fact"
  | "pricing_fact"
  | "partner_fact"
  | "referral_fact"
  | "business_model_fact"
  | "capacity_fact"
  | "seasonality_fact";
export type LeverInput = {
  facts: readonly { key: string; verified: boolean }[];
  metricLabels: readonly string[];
  revenueRows: number;
  attributedTouches: number;
  deals: number;
  budgetLines: number;
  campaigns: number;
  experiments: number;
  /** Omit when the caller did not read competitor data: that source is then left out instead of reported missing. */
  competitorObservations?: number;
};
export type LeverCoverage = { lever: Lever; have: Source[]; missing: Source[] };

const NEEDS: Record<Lever, Source[]> = {
  acquisition: ["marketing_metric", "acquisition_cost_metric", "budget", "campaigns"],
  existing_customers: ["revenue_ledger", "customer_value_metric", "offerings_fact"],
  conversion: ["conversion_metric", "pipeline"],
  retention: ["retention_metric", "revenue_ledger"],
  new_offerings: ["offerings_fact", "competitor_observations", "capacity_fact"],
  new_markets: ["markets_fact", "competitor_observations"],
  new_channels: ["budget", "attributed_revenue", "campaigns"],
  partnerships: ["partner_fact", "offerings_fact"],
  referrals: ["referral_fact", "retention_metric"],
  pricing: ["pricing_fact", "margin_metric", "competitor_observations"],
  upsell_cross_sell: ["revenue_ledger", "offerings_fact", "customer_value_metric"],
  reactivation: ["retention_metric", "revenue_ledger"],
  efficient_spend: ["budget", "attributed_revenue", "acquisition_cost_metric"],
  margins: ["margin_metric", "pricing_fact"],
  revenue_models: ["business_model_fact", "revenue_ledger", "seasonality_fact"],
};
const FACT: Partial<Record<Source, RegExp>> = {
  offerings_fact: /offer|product|service|assortiment|aanbod|dienst|produit|prestation/i,
  markets_fact: /market|markt|marché|region|regio|land|country|pays/i,
  pricing_fact: /pric|prijs|tarif|prix|cost|kost/i,
  partner_fact: /partner/i,
  referral_fact: /referr|verwijz|aanbevel|parrain|recommand/i,
  business_model_fact: /business model|bedrijfsmodel|verdienmodel|revenue model|modèle/i,
  capacity_fact: /capacit|staff|personeel|team size|effectif/i,
  seasonality_fact: /season|seizoen|saison|peak|piek/i,
};
const METRIC: Partial<Record<Source, RegExp>> = {
  marketing_metric:
    /lead|visit|bezoek|traffic|click|klik|impression|new customer|nieuwe klant|nouveau client|booking|boeking|réservation/i,
  conversion_metric: /conver/i,
  retention_metric: /retent|churn|repeat|terugke|herhaal|returning|fidél|récurr|abonn|subscri/i,
  margin_metric: /margin|marge/i,
  acquisition_cost_metric: /\bcac\b|cost per|kosten per|coût par|acquisition/i,
  customer_value_metric:
    /\bltv\b|lifetime|klantwaarde|valeur client|average order|gemiddelde order|panier moyen/i,
};

export function leverCoverage(i: LeverInput): LeverCoverage[] {
  const has = (s: Source): boolean => {
    const f = FACT[s];
    if (f) return i.facts.some((x) => x.verified && f.test(x.key));
    const m = METRIC[s];
    if (m) return i.metricLabels.some((l) => m.test(l));
    switch (s) {
      case "revenue_ledger":
        return i.revenueRows > 0;
      case "attributed_revenue":
        return i.attributedTouches > 0;
      case "pipeline":
        return i.deals > 0;
      case "budget":
        return i.budgetLines > 0;
      case "campaigns":
        return i.campaigns > 0;
      case "experiments":
        return i.experiments > 0;
      case "competitor_observations":
        return (i.competitorObservations ?? 0) > 0;
      default:
        return false;
    }
  };
  const known = (s: Source) =>
    s !== "competitor_observations" || i.competitorObservations !== undefined;
  return LEVERS.map((lever) => {
    const need = NEEDS[lever].filter(known);
    const have = need.filter(has);
    return { lever, have, missing: need.filter((s) => !have.includes(s)) };
  });
}

/** Prompt lines: one per lever, data first, then what is missing. */
export function leverLines(c: readonly LeverCoverage[]): string[] {
  const w = (s: string) => s.replace(/_/g, " ");
  return c.map(
    (x) =>
      `- ${w(x.lever)}: ${x.have.length ? `data: ${x.have.map(w).join(", ")}` : "no supporting data"}${x.missing.length ? `; missing: ${x.missing.map(w).join(", ")}` : ""}`,
  );
}
