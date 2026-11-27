// What the Growth Officer knows about the business, area by area, and what is missing. Pure.
// Verified facts count as known; profile text and records count as indications; nothing is assumed.
export type Area =
  | "business_model"
  | "revenue_model"
  | "segments"
  | "offerings"
  | "pricing"
  | "sales_process"
  | "channels"
  | "acquisition"
  | "retention"
  | "costs_margins"
  | "objectives"
  | "constraints";
export const AREAS: Area[] = [
  "business_model",
  "revenue_model",
  "segments",
  "offerings",
  "pricing",
  "sales_process",
  "channels",
  "acquisition",
  "retention",
  "costs_margins",
  "objectives",
  "constraints",
];
export type Knowledge = {
  area: Area;
  status: "verified" | "indicated" | "missing";
  source: "fact" | "profile" | "records" | null;
};

export type UnderstandingInput = {
  facts: readonly { key: string; verified: boolean }[];
  profile: {
    business_model: string | null;
    offerings: unknown;
    audiences: unknown;
    objectives: unknown;
    monthly_budget_eur: number | null;
  } | null;
  hasRevenue: boolean;
  hasDeals: boolean;
  hasRetentionMetric: boolean;
  hasMarginMetric: boolean;
  hasBudget: boolean;
  hasMarketingMetric: boolean;
  hasGoals: boolean;
};
const FACT_KEYS: Partial<Record<Area, string[]>> = {
  business_model: ["business_model"],
  revenue_model: ["revenue_model", "pricing_model"],
  segments: ["audiences", "segments", "customer_segments"],
  offerings: ["offerings", "products", "services"],
  pricing: ["pricing", "prices"],
  sales_process: ["sales_process"],
  channels: ["channels"],
  acquisition: ["acquisition", "customer_acquisition"],
  retention: ["retention"],
  costs_margins: ["margins", "costs", "gross_margin"],
  objectives: ["objectives", "goals"],
  constraints: ["constraints", "growth_constraints", "capacity"],
};
const filled = (v: unknown) =>
  Array.isArray(v)
    ? v.length > 0
    : typeof v === "string"
      ? v.trim().length > 0
      : v !== null && v !== undefined && typeof v === "object"
        ? Object.keys(v).length > 0
        : false;

export function understand(i: UnderstandingInput): Knowledge[] {
  const verified = new Set(i.facts.filter((f) => f.verified).map((f) => f.key));
  const p = i.profile;
  const indicated: Partial<Record<Area, { ok: boolean; source: "profile" | "records" }>> = {
    business_model: { ok: filled(p?.business_model), source: "profile" },
    revenue_model: { ok: i.hasRevenue, source: "records" },
    segments: { ok: filled(p?.audiences), source: "profile" },
    offerings: { ok: filled(p?.offerings), source: "profile" },
    sales_process: { ok: i.hasDeals, source: "records" },
    channels: { ok: i.hasBudget || i.hasMarketingMetric, source: "records" },
    acquisition: { ok: i.hasMarketingMetric, source: "records" },
    retention: { ok: i.hasRetentionMetric, source: "records" },
    costs_margins: { ok: i.hasMarginMetric, source: "records" },
    objectives: {
      ok: filled(p?.objectives) || i.hasGoals,
      source: i.hasGoals ? "records" : "profile",
    },
  };
  return AREAS.map((area) => {
    if ((FACT_KEYS[area] ?? []).some((k) => verified.has(k)))
      return { area, status: "verified", source: "fact" };
    const ind = indicated[area];
    if (ind?.ok) return { area, status: "indicated", source: ind.source };
    return { area, status: "missing", source: null };
  });
}
