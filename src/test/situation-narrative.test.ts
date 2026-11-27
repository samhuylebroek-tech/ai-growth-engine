import { describe, expect, it } from "vitest";
import {
  narrativeFindings,
  parseNarrative,
  questionsFor,
  type NarrativeFinding,
} from "@/lib/situation-narrative";
import { growthSituation, type SituationInput } from "@/lib/situation";

const F: NarrativeFinding[] = [
  {
    id: "execution.overdue.1",
    section: "execution",
    code: "overdue",
    reliability: "recorded",
    text: "3 tasks overdue",
  },
  {
    id: "marketing.over_budget.1",
    section: "marketing",
    code: "over_budget",
    reliability: "simulated",
    text: "1 campaign over budget",
  },
];
const reply = (answers: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ insufficient: false, uncertainty: "", answers, ...extra });

describe("AI growth situation explanation", () => {
  it("drops statements without a valid cited finding", () => {
    const n = parseNarrative(
      reply([
        {
          question: "happening",
          statements: [
            { text: "Tasks are late", kind: "fact", basis: ["execution.overdue.1"] },
            { text: "Sales are booming", kind: "fact", basis: ["sales.invented.0"] },
            { text: "No basis", kind: "fact", basis: [] },
          ],
        },
      ]),
      F,
      false,
    );
    expect(n.answers[0]?.statements.map((s) => s.text)).toEqual(["Tasks are late"]);
  });
  it("never lets a statement resting only on simulated data be a fact", () => {
    const n = parseNarrative(
      reply([
        {
          question: "risks",
          statements: [
            { text: "Budget exceeded", kind: "fact", basis: ["marketing.over_budget.1"] },
          ],
        },
      ]),
      F,
      false,
    );
    expect(n.answers[0]?.statements[0]?.kind).toBe("hypothesis");
  });
  it("forces the insufficient-data warning when most areas have no data, whatever the model says", () => {
    expect(parseNarrative(reply([]), F, true).insufficient).toBe(true);
  });
  it("offers missing information and empty areas as citable findings", () => {
    const empty: SituationInput = {
      today: "2026-11-21",
      facts: [],
      factsComplete: true,
      conflicts: null,
      opportunities: [],
      revenue: [],
      spend: null,
      deals: [],
      tasks: [],
      runs: [],
      campaigns: [],
      experiments: [],
      reviews: null,
      budget: [],
      metrics: 0,
      measuredRecently: 0,
      purchaseCostsRecorded: false,
    };
    const ids = narrativeFindings(growthSituation(empty), (f) => f.code).map((f) => f.id);
    expect(ids).toContain("financial.no_data");
    expect(ids).toContain("financial.missing.purchase_costs");
    expect(ids).toContain("health.missing.conflict_history");
  });
});

describe("AI campaign advice", () => {
  it("keeps only campaign questions and drops answers to unknown questions without failing the paid reply", () => {
    const n = parseNarrative(
      JSON.stringify({
        answers: [
          {
            question: "improvements",
            statements: [
              {
                text: "Link a leads metric",
                kind: "recommendation",
                basis: ["execution.overdue.1"],
              },
            ],
          },
          {
            question: "happening",
            statements: [
              { text: "Business question", kind: "fact", basis: ["execution.overdue.1"] },
            ],
          },
        ],
      }),
      F,
      false,
      questionsFor("campaign"),
    );
    expect(n.answers.map((a) => a.question)).toEqual(["improvements"]);
  });
});
