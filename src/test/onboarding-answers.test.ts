import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANSWER_KEYS, ANSWER_SOURCE, QUESTIONS, SECTIONS, questionById } from "@/lib/onboarding/questions";
import { changedAnswers, firstGrowthSteps, decodeAnswer, draftsFromFacts, encodeAnswer, isVisible, optionsOf, overallProgress, savedAnswers, sectionProgress, understandingSummary, type AnswerFact, type Draft } from "@/lib/onboarding/answers";
import { labelIn, labelsOf } from "@/lib/onboarding/labels";
import { ob } from "@/lib/i18n/areas/ob";
import { businessUnderstanding } from "@/lib/business-understanding";

const q = (id: string) => {
  const x = questionById(id);
  if (!x) throw new Error(id);
  return x;
};
const answer = (key: string, value: string, verified = true, created_at = "2026-11-20T00:00:00Z"): AnswerFact => ({ key, value, verified, source_type: "user", source_ref: ANSWER_SOURCE, created_at });
const d = (p: Partial<Draft>): Draft => ({ choices: [], other: "", text: "", ...p });

describe("onboarding questions", () => {
  it("only lets the database save the question keys the app asks (SQL allowlist = manifest)", () => {
    const sql = readFileSync("docs/proposals/0091_business_answers.sql", "utf8");
    const list = sql.match(/allowed constant text\[\] := ARRAY\[(.*?)\];/s)?.[1] ?? "";
    const keys = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? "").replace(/''/g, "'"));
    expect(keys).toEqual([...ANSWER_KEYS]);
    expect(new Set(ANSWER_KEYS).size).toBe(ANSWER_KEYS.length);
    expect(ANSWER_KEYS.every((k) => k.length <= 120)).toBe(true);
  });
  it("has a question, a reason and every option label in English, Dutch and French", () => {
    for (const lang of [ob.en, ob.nl, ob.fr] as Record<string, string>[]) {
      for (const x of QUESTIONS) {
        expect(lang[`ob.q.${x.id}.label`], x.id).toBeTruthy();
        expect(lang[`ob.q.${x.id}.why`], x.id).toBeTruthy();
        for (const o of x.options ?? []) expect(lang[`ob.o.${x.id}.${o}`], `${x.id}.${o}`).toBeTruthy();
      }
      for (const s of SECTIONS) expect(lang[`ob.section.${s}.title`]).toBeTruthy();
    }
  });
  it("covers customers, sales, challenges, resources, ambitions, time horizon and boundaries", () => {
    expect(new Set(QUESTIONS.map((x) => x.area))).toEqual(new Set(["customers", "sales", "challenges", "resources", "ambitions", "horizon", "constraints"]));
  });
});

describe("saving and reading answers", () => {
  it("reads an answer saved in Dutch back as the same choices in French", () => {
    const value = encodeAnswer(q("discovery_channels"), d({ choices: ["referrals", "search"], other: "Via de bakkersvereniging" }), labelIn("nl"));
    expect(value).toBe("Mond-tot-mondreclame\nGoogle of andere zoekmachine\nVia de bakkersvereniging");
    const back = decodeAnswer(q("discovery_channels"), value, labelsOf);
    expect(back.choices).toEqual(["referrals", "search"]);
    expect(back.other).toBe("Via de bakkersvereniging");
    expect(encodeAnswer(q("discovery_channels"), back, labelIn("fr"))).toBe("Bouche-à-oreille\nGoogle ou autre moteur\nVia de bakkersvereniging");
  });
  it("keeps one choice for single-choice questions", () => {
    expect(decodeAnswer(q("customer_type"), "Businesses\nConsumers", labelsOf).choices).toEqual(["b2b"]);
  });
  it("asks who decides only for business or public customers", () => {
    const drafts = (c: string[]) => ({ customer_type: d({ choices: c }) });
    expect(isVisible(q("decision"), drafts(["b2c"]))).toBe(false);
    expect(isVisible(q("decision"), drafts(["b2b"]))).toBe(true);
    expect(isVisible(q("decision"), drafts(["public"]))).toBe(true);
  });
  it("asks which challenge matters most only when two or more are picked, offering only those", () => {
    expect(isVisible(q("main_challenge"), { challenges: d({ choices: ["few_leads"] }) })).toBe(false);
    const two = { challenges: d({ choices: ["few_leads", "retention"] }) };
    expect(isVisible(q("main_challenge"), two)).toBe(true);
    expect(optionsOf(q("main_challenge"), two)).toEqual(["few_leads", "retention"]);
  });
  it("sends only changed answers, each with the value last seen", () => {
    const facts = [answer("Customer type", "Consumers"), answer("Ideal customer", "Office workers")];
    const saved = savedAnswers(facts);
    const drafts = draftsFromFacts(facts, labelsOf);
    expect(changedAnswers("customers", drafts, saved, labelIn("en"))).toEqual([]);
    const edited = { ...drafts, ideal_customer: d({ text: "Office workers nearby" }) };
    expect(changedAnswers("customers", edited, saved, labelIn("en"))).toEqual([{ key: "Ideal customer", value: "Office workers nearby", expected: "Office workers" }]);
  });
  it("never clears a saved follow-up answer just because it is hidden", () => {
    const facts = [answer("Customer type", "Businesses"), answer("Who decides on a purchase", "The office manager")];
    const drafts = { ...draftsFromFacts(facts, labelsOf), customer_type: d({ choices: ["b2c"] }) };
    const rows = changedAnswers("sales", drafts, savedAnswers(facts), labelIn("en"));
    expect(rows.find((r) => r.key === "Who decides on a purchase")).toBeUndefined();
  });
  it("counts only confirmed onboarding answers; an unconfirmed look-alike does not count", () => {
    const p = sectionProgress([answer("Customer type", "Consumers"), answer("Ideal customer", "x", false)]);
    expect(p.find((s) => s.section === "customers")?.coreAnswered).toBe(1);
    const all = overallProgress([]);
    expect(all.answered).toBe(0);
    expect(all.total).toBe(QUESTIONS.filter((x) => x.core).length);
    expect(all.nextSection).toBe("customers");
  });
});

describe("what AI Growth Engine understands", () => {
  it("labels confirmed, found-not-confirmed and AI assumptions, and leaves unknown topics empty", () => {
    const topics = understandingSummary(
      { description: "Bakery in Ghent", offerings: ["Bread"], monthly_budget_eur: 500 },
      [
        { key: "Target audiences", value: "Families", verified: false, source_type: "website", source_ref: "https://x.test" },
        { key: "Business model", value: "Shop sales", verified: false, source_type: "ai_assumption", source_ref: null },
        answer("Business challenges", "Too few enquiries"),
      ],
    );
    const get = (k: string) => topics.find((x) => x.topic === k);
    expect(get("does")?.items).toEqual([{ source: "profile:description", value: "Bakery in Ghent", status: "confirmed" }]);
    expect(get("customers")?.items[0]?.status).toBe("unconfirmed");
    expect(get("revenue")?.items[0]?.status).toBe("assumption");
    expect(get("challenges")?.items[0]).toEqual({ source: "question:challenges", value: "Too few enquiries", status: "confirmed" });
    expect(get("constraints")?.items).toEqual([]);
    expect(get("resources")?.items[0]?.value).toBe("500");
  });
  it("shows the new topics as missing until answered and confirmed afterwards", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const before = businessUnderstanding(null, [], [], true, now);
    expect(before.find((a) => a.key === "sales")?.status).toBe("missing");
    const after = businessUnderstanding(null, [{ id: "1", ...answer("Typical sales cycle", "A few weeks") }], [], true, now);
    expect(after.find((a) => a.key === "sales")?.status).toBe("confirmed");
    expect(after.find((a) => a.key === "constraints")?.status).toBe("missing");
  });
});

describe("first growth steps", () => {
  const role = (r: "viewer" | "member" | "editor") => (a: string) =>
    r === "editor" || (r === "member" && a !== "profile.confirm");
  it("shows a viewer only the growth situation", () => {
    expect(firstGrowthSteps(role("viewer"), 3)).toEqual(["situation"]);
  });
  it("lets a member ask and set a goal but not fill in business answers", () => {
    expect(firstGrowthSteps(role("member"), 3)).toEqual(["situation", "ask", "goal"]);
  });
  it("starts an editor with the missing topics, and drops that step when nothing is missing", () => {
    expect(firstGrowthSteps(role("editor"), 2)).toEqual(["fill", "situation", "ask", "goal"]);
    expect(firstGrowthSteps(role("editor"), 0)).toEqual(["situation", "ask", "goal"]);
  });
});
