import { describe, expect, it } from "vitest";
import { MESSAGES } from "@/lib/i18n/messages";
import { detectOpportunities, type OppBusiness } from "@/lib/org/opportunities";
import { allocationRecommendations, type BudgetLineLite } from "@/lib/org/allocation";
import {
  parseOrgStrategy,
  OPP_KINDS,
  EVIDENCE_CLASSES,
  nameRefs,
  strategyRefs,
  businessLabels,
} from "@/lib/org/strategy";
import { attribution, creditOverviewSchema, specialistTotals } from "@/lib/org/credits";
import { score, explain, rankActions, FACTORS, type Factors } from "@/lib/org/priorities";
import { parseTaskLines, parseMetricLines } from "@/lib/org/initiative-input";
import type { BusinessRow } from "@/lib/org/consolidation";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const biz = (id: string, name: string, p: Partial<OppBusiness["profile"]>): OppBusiness => ({
  id,
  name,
  profile: {
    audiences: [],
    offerings: [],
    markets: [],
    businessModel: null,
    industry: null,
    reportingCurrency: "EUR",
    confirmed: true,
    ...p,
  },
  campaigns: [],
  budget: [],
  experiments: [],
  activeObjectives: [],
  specialistDone: {},
  specialistOpen: {},
});
const row = (id: string, behind = 0) => ({ id, goals: { behind } }) as unknown as BusinessRow;

describe("organization opportunities", () => {
  it("a shared audience with different offerings becomes a cross-sell hypothesis that names what is unknown", () => {
    const out = detectOpportunities(
      [
        biz(A, "Bakery", { audiences: ["Office managers"], offerings: ["Bread"] }),
        biz(B, "Catering", { audiences: ["office managers"], offerings: ["Lunch catering"] }),
      ],
      [],
    );
    const cs = out.find((o) => o.kind === "cross_sell");
    expect(cs?.businesses.sort()).toEqual([A, B].sort());
    expect(cs?.evidence.some((e) => e.class === "missing")).toBe(true);
  });
  it("finds nothing between businesses without overlapping records", () => {
    expect(
      detectOpportunities(
        [
          biz(A, "Bakery", { audiences: ["Families"] }),
          biz(B, "Catering", { audiences: ["Hospitals"] }),
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe("organization resource recommendations", () => {
  const line = (
    id: string,
    ws: string,
    planned: number,
    actual: number,
    currency = "EUR",
  ): BudgetLineLite => ({
    id,
    workspace_id: ws,
    channel: "Google Ads",
    period_month: "2026-06-01",
    planned,
    actual,
    hard_cap: null,
    currency,
  });
  it("suggests moving unspent budget to a business overspending in the same currency", () => {
    const recs = allocationRecommendations(
      [row(A), row(B)],
      [line("l1", A, 1000, 50), line("l2", B, 1000, 900)],
      [],
      "2026-06-20",
    );
    const shift = recs.find((r) => r.kind === "budget_shift");
    expect(
      shift &&
        shift.kind === "budget_shift" && {
          from: shift.from,
          to: shift.to,
          currency: shift.currency,
        },
    ).toEqual({ from: A, to: B, currency: "EUR" });
  });
  it("never moves money between different currencies", () => {
    const recs = allocationRecommendations(
      [row(A), row(B)],
      [line("l1", A, 1000, 50, "EUR"), line("l2", B, 1000, 900, "GBP")],
      [],
      "2026-06-20",
    );
    expect(recs.filter((r) => r.kind === "budget_shift")).toEqual([]);
  });
  it("does not take budget from a business whose goals are behind", () => {
    const recs = allocationRecommendations(
      [row(A, 2), row(B)],
      [line("l1", A, 1000, 50), line("l2", B, 1000, 900)],
      [],
      "2026-06-20",
    );
    expect(recs.filter((r) => r.kind === "budget_shift")).toEqual([]);
  });
  it("waits until 40% of the month has passed before suggesting budget moves", () => {
    const recs = allocationRecommendations(
      [row(A), row(B)],
      [line("l1", A, 1000, 0), line("l2", B, 1000, 900)],
      [],
      "2026-06-05",
    );
    expect(recs.filter((r) => r.kind === "budget_shift")).toEqual([]);
  });
});

describe("organization strategy answers", () => {
  const raw = JSON.stringify({
    title: "Grow office customers",
    summary: "Together.",
    business_priorities: [
      { business: "B1", priority: 1, focus: "Lunch" },
      { business: "B9", priority: 1, focus: "Unknown business" },
    ],
    initiatives: [
      { title: "Office bundle", businesses: ["B1", "B2"], shared_objective: "Sell bundles" },
      { title: "Leak", businesses: ["B1", "B9"], shared_objective: "x" },
    ],
    opportunities: [
      {
        kind: "bundle",
        title: "Bundle",
        businesses: ["B1", "B2"],
        evidence: [{ text: "Profiles", class: "recorded" }],
      },
    ],
  });
  it("maps business references to ids and drops statements about businesses outside the analysis", () => {
    const s = parseOrgStrategy(raw, { B1: A, B2: B });
    expect(s.business_priorities.map((p) => p.business_id)).toEqual([A]);
    expect(s.initiatives.map((i) => i.title)).toEqual(["Office bundle"]);
    expect(s.opportunities[0]?.business_ids).toEqual([A, B]);
  });
  it("keeps the stored text unchanged and saves the reference map with the strategy", () => {
    const s = parseOrgStrategy(
      JSON.stringify({ title: "Plan", summary: "Protect B1 while B2 builds facts." }),
      { B1: A, B2: B },
    );
    expect(s.summary).toBe("Protect B1 while B2 builds facts.");
    expect(s.refs).toEqual({ B1: A, B2: B });
  });
  it("fills in business names at display time, leaving unknown references and id fields alone", () => {
    const named = nameRefs(
      { summary: "B1 and B2, not B9", business_id: A },
      { B1: "Bakery", B2: "Catering" },
    );
    expect(named).toEqual({ summary: "Bakery and Catering, not B9", business_id: A });
  });
  it("reconstructs references of an earlier draft in generation order (name, then id)", () => {
    const r = strategyRefs(
      { title: "old" },
      [A, B],
      [
        { id: B, name: "Bakery" },
        { id: A, name: "Catering" },
      ],
    );
    expect(r).toEqual({ refs: { B1: B, B2: A }, reconstructed: true });
    expect(strategyRefs({ refs: { B1: A } }, [A, B], []).refs).toEqual({ B1: A });
  });
  it("keeps businesses with the same name distinguishable", () => {
    const l = businessLabels([
      { id: A, name: "Bakery" },
      { id: B, name: " bakery " },
      { id: "c".repeat(36), name: "Catering" },
    ]);
    expect(l.get(A)).not.toBe(l.get(B));
    expect(l.get("c".repeat(36))).toBe("Catering");
  });
  it("rejects answers that are not valid JSON", () => {
    expect(() => parseOrgStrategy("not json", { B1: A })).toThrow();
  });
});

describe("organization action ranking", () => {
  const f = (over: Partial<Factors>): Factors =>
    ({ ...Object.fromEntries(FACTORS.map((k) => [k, 3])), ...over }) as Factors;
  it("ranks a more important action first and explains the strongest factors", () => {
    const ranked = rankActions([
      {
        key: "a",
        code: "x",
        businesses: [],
        params: {},
        factors: f({}),
        target: { kind: "tab", tab: "risks" },
      },
      {
        key: "b",
        code: "y",
        businesses: [],
        params: {},
        factors: f({ importance: 5, impact: 5 }),
        target: { kind: "tab", tab: "risks" },
      },
    ]);
    expect(ranked.map((r) => r.key)).toEqual(["b", "a"]);
    expect(explain(f({ importance: 5, impact: 5 }))).toEqual(["importance", "impact"]);
    expect(score(f({}))).toBeLessThan(score(f({ importance: 5 })));
  });
});

describe("shared initiative form input", () => {
  it("reads at most ten tasks with optional due dates", () => {
    expect(parseTaskLines("Prepare page | 2026-09-01\nCall partner\n\n")).toEqual([
      { title: "Prepare page", due_date: "2026-09-01" },
      { title: "Call partner" },
    ]);
    expect(parseTaskLines(Array.from({ length: 12 }, (_, i) => `T${i}`).join("\n"))).toHaveLength(
      10,
    );
  });
  it("reads success measures as measure and target", () => {
    expect(parseMetricLines("New office customers: 20")).toEqual([
      { metric: "New office customers", target: "20" },
    ]);
  });
});

describe("organization interface texts", () => {
  const en = MESSAGES.en as Record<string, string>;
  const need = [
    ...["overview", "strategy", "opportunities", "initiatives", "resources", "risks"].map(
      (x) => `ogo.tab.${x}`,
    ),
    ...[...FACTORS, "balanced"].map((x) => `ogo.factor.${x}`),
    ...EVIDENCE_CLASSES.map((x) => `ogo.cls.${x}`),
    ...OPP_KINDS.map((x) => `ogo.kind.${x}`),
    ...[
      "cross_sell",
      "joint_campaign",
      "bundle",
      "shared_channel",
      "shared_content",
      "strategy_reuse",
      "specialist_reuse",
    ].flatMap((x) => [`ogo.opp.title.${x}`, `ogo.act.opp_${x}`]),
    ...[
      "behind_target",
      "exceeding",
      "conflicting_strategies",
      "shared_bottleneck",
      "budget_imbalance",
      "specialist_capacity",
      "coordination_waiting",
      "validated_without_initiative",
      "multi_business_risk",
      "priority_without_goal",
      "execution_paused",
    ].flatMap((x) => [`ogo.mon.${x}`, `ogo.act.${x}`]),
  ];
  it("has every organization text used by the rules, in all three languages", () => {
    for (const k of need)
      for (const l of ["en", "nl", "fr"] as const)
        expect((MESSAGES[l] as Record<string, string>)[k], `${l}:${k}`).toBeTruthy();
    expect(Object.keys(en).filter((k) => k.startsWith("ogo.")).length).toBeGreaterThan(300);
  });
});

describe("organization AI credits", () => {
  const o = creditOverviewSchema.parse({
    month: "2026-11-01",
    balance: 300,
    granted: 400,
    reserved_pending: 4,
    consumed: 95,
    consumed_month: 20,
    released: 7,
    direct_used: 1,
    other_debits: 1,
    runs: 5,
    reconciles: true,
    org_officer: { consumed: 10, consumed_month: 10, reserved_pending: 0, runs: 1 },
    businesses: [
      {
        workspace_id: A,
        consumed: 60,
        consumed_month: 9,
        reserved_pending: 0,
        released: 2,
        runs: 2,
      },
      {
        workspace_id: B,
        consumed: 20,
        consumed_month: 1,
        reserved_pending: 4,
        released: 3,
        runs: 2,
      },
    ],
    specialists: [
      {
        workspace_id: A,
        agent_key: "seo",
        consumed: 60,
        consumed_month: 9,
        reserved_pending: 0,
        runs: 2,
      },
      {
        workspace_id: B,
        agent_key: "seo",
        consumed: 15,
        consumed_month: 1,
        reserved_pending: 0,
        runs: 1,
      },
      {
        workspace_id: B,
        agent_key: "content",
        consumed: 5,
        consumed_month: 0,
        reserved_pending: 4,
        runs: 1,
      },
    ],
    not_visible: { consumed: 4, consumed_month: 0, reserved_pending: 0 },
  });
  it("adds businesses, the Organization Growth Officer, hidden businesses and older usage up to the organization total exactly once", () => {
    expect(attribution(o)).toMatchObject({ total: 95, matches: true });
  });
  it("totals one specialist across businesses without counting a run twice", () => {
    expect(specialistTotals(o)[0]).toMatchObject({
      agent_key: "seo",
      consumed: 75,
      runs: 3,
      businesses: 2,
    });
  });
});
