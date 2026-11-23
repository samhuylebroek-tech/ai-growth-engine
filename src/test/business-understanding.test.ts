import { describe, expect, it } from "vitest";
import { AREAS, businessUnderstanding, OUTDATED_DAYS } from "@/lib/business-understanding";
import { detectFactConflicts } from "@/lib/fact-conflicts";

const now = new Date("2026-11-22T12:00:00Z");
const fact = (
  id: string,
  key: string,
  value: string,
  verified: boolean,
  source_type = "user",
  created_at = "2026-11-01T00:00:00Z",
) => ({ id, key, value, verified, source_type, created_at });
const status = (areas: ReturnType<typeof businessUnderstanding>, key: string) =>
  areas.find((a) => a.key === key)?.status;

describe("what we know about the business", () => {
  it("covers every topic once", () =>
    expect(new Set(businessUnderstanding(null, [], [], true, now).map((a) => a.key)).size).toBe(
      AREAS.length,
    ));
  it("says missing only after a complete read; otherwise not checked", () => {
    expect(status(businessUnderstanding(null, [], [], true, now), "usps")).toBe("missing");
    expect(status(businessUnderstanding(null, [], [], false, now), "usps")).toBe("unknown");
  });
  it("counts a confirmed profile field and a confirmed fact as confirmed", () => {
    const a = businessUnderstanding(
      { industry: "Bakery", updated_at: "2026-10-01T00:00:00Z" },
      [fact("1", "Tone of voice", "Warm", true)],
      [],
      true,
      now,
    );
    expect(status(a, "industry")).toBe("confirmed");
    expect(status(a, "tone")).toBe("confirmed");
  });
  it("separates found-but-unconfirmed from AI guesses", () => {
    const a = businessUnderstanding(
      null,
      [
        fact("1", "Industry", "Bakery", false, "website"),
        fact("2", "Brand positioning", "Premium", false, "ai_assumption"),
      ],
      [],
      true,
      now,
    );
    expect(status(a, "industry")).toBe("inferred");
    expect(status(a, "positioning")).toBe("estimated");
  });
  it("marks a topic outdated when its newest confirmation is older than the fact window", () => {
    const old = new Date(now.getTime() - (OUTDATED_DAYS + 1) * 86_400_000).toISOString();
    expect(
      status(
        businessUnderstanding(
          null,
          [fact("1", "Markets", "Belgium", true, "user", old)],
          [],
          true,
          now,
        ),
        "markets",
      ),
    ).toBe("outdated");
  });
  it("reports two different values on one topic as contradicting, even when one is confirmed", () => {
    const facts = [
      fact("1", "Industry", "Bakery", true),
      fact("2", "industry", "Coffee bar", false, "website"),
    ];
    expect(
      status(
        businessUnderstanding({ industry: "Bakery" }, facts, detectFactConflicts(facts), true, now),
        "industry",
      ),
    ).toBe("conflicting");
  });
  it("needs a person for goals and budget; the website check can look for the rest", () => {
    const a = businessUnderstanding(null, [], [], true, now);
    expect(a.find((x) => x.key === "budget")?.discoverable).toBe(false);
    expect(a.find((x) => x.key === "objectives")?.discoverable).toBe(false);
    expect(a.find((x) => x.key === "offerings")?.discoverable).toBe(true);
  });
  it("never counts an empty list or zero budget as known", () => {
    const a = businessUnderstanding({ offerings: [" "], monthly_budget_eur: 0 }, [], [], true, now);
    expect(status(a, "offerings")).toBe("missing");
    expect(status(a, "budget")).toBe("missing");
  });
});
