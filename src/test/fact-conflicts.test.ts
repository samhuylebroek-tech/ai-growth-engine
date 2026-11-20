import { describe, expect, it } from "vitest";
import { detectFactConflicts, factTopic, sameValue } from "@/lib/fact-conflicts";

const f = (
  id: string,
  key: string,
  value: string,
  source_type: string,
  verified: boolean,
  created_at = "2026-11-01",
) => ({ id, key, value, source_type, verified, created_at });

describe("conflicting business facts", () => {
  it("treats case, spacing and punctuation in the topic as the same topic", () => {
    expect(factTopic(" Price. ")).toBe(factTopic("price"));
    expect(factTopic("Opening-hours")).toBe(factTopic("opening hours"));
    // Matches the database rule: a currency sign is part of the topic, so these are never offered as one conflict.
    expect(factTopic("Price €")).not.toBe(factTopic("Price"));
  });
  it("does not call two spellings of the same amount a conflict", () => {
    expect(sameValue("€25", "25 EUR")).toBe(true);
    expect(sameValue("1.250", "1250")).toBe(true);
    expect(
      detectFactConflicts([
        f("a", "Price", "€25", "user", true),
        f("b", "price", "25 eur", "document", true),
      ]),
    ).toEqual([]);
  });
  it("flags two confirmed prices and does not pick one when both sources are equally strong", () => {
    const [c] = detectFactConflicts([
      f("a", "Price", "€25", "user", true),
      f("b", "Price", "€29", "document", true),
    ]);
    expect(c?.confirmedConflict).toBe(true);
    expect(c?.preferred).toBeNull();
    expect(c?.basis).toBe("undetermined");
  });
  it("names the confirmed value as more reliable than an unconfirmed AI guess", () => {
    const [c] = detectFactConflicts([
      f("a", "Audience", "Families", "user", true),
      f("b", "Audience", "Students", "ai_assumption", false),
    ]);
    expect(c?.confirmedConflict).toBe(false);
    expect(c?.preferred).toBe("a");
    expect(c?.basis).toBe("confirmed");
  });
  it("prefers a document over the website when neither is confirmed", () => {
    const [c] = detectFactConflicts([
      f("a", "Model", "B2B", "website", false),
      f("b", "Model", "B2C", "document", false),
    ]);
    expect(c?.preferred).toBe("b");
    expect(c?.basis).toBe("source");
  });
  it("ignores saved opportunity suggestions", () => {
    expect(
      detectFactConflicts([
        f("a", "Opportunity: X", "one", "website", false),
        f("b", "Opportunity: X", "two", "website", false),
      ]),
    ).toEqual([]);
  });
});
