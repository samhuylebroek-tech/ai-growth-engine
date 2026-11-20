import { describe, expect, it } from "vitest";
import { renderBusinessContext, type BusinessDomains } from "@/lib/security/business-context";

const ok = <T>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
const base: BusinessDomains = {
  workspace: { id: "w", name: "Bakery" },
  objectives: null,
  facts: [{ key: "business_model", value: "B2B catering", source_type: "user", verified: true }],
  goals: [],
  recommendations: [],
  plans: ok([]),
  initiatives: [],
  operations: [],
  projects: [],
  tasks: [],
  budget: ok([]),
  deals: ok([]),
  competitors: ok([]),
  observations: [],
  seo: ok([]),
  content: ok([]),
  versions: [],
  decisions: [],
  campaigns: ok([
    {
      id: "c1",
      title: "Spring search",
      status: "active",
      category: "advertising",
      budget_eur: 0,
      results: "",
      start_date: null,
      end_date: null,
    },
  ]),
  connections: ok([]),
};
const sale = (id: string, amount: number, extra = {}) => ({
  id,
  kind: "sale",
  amount,
  currency: "EUR",
  occurred_at: "2026-10-10T12:00:00Z",
  data_class: "manual",
  source: "manual",
  source_ref: "",
  customer_ref: "",
  relates_to: null,
  unit_id: null,
  ...extra,
});

describe("Growth Officer revenue and learning context", () => {
  const ctx = renderBusinessContext(
    {
      ...base,
      revenue: ok([
        sale("s1", 100),
        sale("s2", 40, { data_class: "imported", source: "stripe" }),
        sale("s3", 900, { data_class: "estimated" }),
        { ...sale("r1", -30), kind: "refund", relates_to: "s1" },
      ]),
      touches: [
        {
          id: "t",
          revenue_event_id: "s1",
          campaign_id: "c1",
          initiative_id: null,
          channel: "search",
          touched_at: "2026-10-01T00:00:00Z",
          evidence: "manual",
          retracted_at: null,
        },
      ],
      experiments: ok([
        {
          title: "New headline",
          status: "completed",
          method: "before_after",
          evidence_strength: "correlational",
          conclusion: "Sign-ups rose",
          updated_at: "2026-11-01",
        },
      ]),
      proposals: ok([
        {
          title: "Review bids",
          status: "measured",
          category: "problem",
          outcome: "improved",
          created_at: "2026-10-01",
        },
      ]),
    },
    new Date("2026-11-20T00:00:00Z"),
  );
  it("separates imported, team-entered and estimated revenue per currency", () => {
    expect(ctx).toContain(
      "EUR last 12 months: net EUR 110 from 2 sales (imported from a connected source EUR 40; entered by the team, not verified EUR 70)",
    );
    expect(ctx).toContain("estimated EUR 900 (NOT revenue)");
  });
  it("names attributed campaigns and keeps unattributed revenue visible", () => {
    expect(ctx).toContain(
      "attributed EUR 70, unattributed EUR 40 (1 sales without a usable touchpoint)",
    );
    expect(ctx).toContain("campaign Spring search: EUR 70 over 1 sales, low confidence");
  });
  it("labels a before/after experiment as correlation, never cause", () => {
    expect(ctx).toContain("correlation only — not proven cause] New headline");
    expect(ctx).toContain("observed outcome improved, not proven cause");
  });
  it("lists business areas without a verified fact so the Growth Officer asks", () => {
    expect(ctx).toMatch(/BUSINESS AREAS WITHOUT A VERIFIED FACT[\s\S]*pricing/);
    expect(ctx).not.toMatch(/BUSINESS AREAS WITHOUT A VERIFIED FACT[^#]*business model,/);
  });
});
