import { describe, expect, it } from "vitest";
import { coordinationInputSchema, selectSpecialistsForRequest } from "@/lib/coordination";

describe("selectSpecialistsForRequest", () => {
  it("routes SEO and content work to both relevant capabilities", () => {
    expect(selectSpecialistsForRequest("Build an SEO keyword strategy and blog content plan")).toEqual(["seo", "content"]);
  });
  it("adds research to a search visibility assignment", () => {
    expect(selectSpecialistsForRequest("Improve technical SEO and organic search rankings")).toEqual(["research", "seo"]);
  });
  it("pairs content requests with strategy", () => {
    expect(selectSpecialistsForRequest("Write a blog article and social media posts")).toEqual(["strategy", "content"]);
  });
  it("pairs market questions with research and strategy", () => {
    expect(selectSpecialistsForRequest("Research competitors, customer segments and market pricing")).toEqual(["research", "strategy"]);
  });
  it("routes Dutch SEO and content requests to both relevant capabilities", () => {
    expect(selectSpecialistsForRequest("Verbeter onze zoekmachineoptimalisatie en schrijf drie artikelen voor sociale media")).toEqual(["seo", "content"]);
  });
  it("routes Dutch market and competitor research to research and strategy", () => {
    expect(selectSpecialistsForRequest("Onderzoek de concurrentie en doelgroep in de Belgische markt")).toEqual(["research", "strategy"]);
  });
  it("routes French SEO and content requests to both relevant capabilities", () => {
    expect(selectSpecialistsForRequest("Améliore notre référencement naturel et rédige trois articles pour les réseaux sociaux")).toEqual(["seo", "content"]);
  });
  it("routes French market and competitor research to research and strategy", () => {
    expect(selectSpecialistsForRequest("Étudie la concurrence et le public cible sur le marché belge")).toEqual(["research", "strategy"]);
  });
  it("uses a bounded strategy and research default", () => {
    expect(selectSpecialistsForRequest("What is my best next growth move?")).toEqual(["strategy", "research"]);
  });
});

describe("coordinationInputSchema", () => {
  const base = {
    orgId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    requestKey: "33333333-3333-4333-8333-333333333333",
    request: "Prepare a growth strategy",
    executionContext: [],
  };
  it("accepts automatic routing without exposing agent selection", () => {
    const parsed = coordinationInputSchema.parse({ ...base, mode: "auto" });
    expect(parsed.mode).toBe("auto");
    expect(parsed.agents).toEqual([]);
  });
  it("rejects client-supplied specialist choices in automatic mode", () => {
    expect(() => coordinationInputSchema.parse({ ...base, mode: "auto", agents: ["strategy", "research"] })).toThrow();
  });
  it("preserves explicit specialist selection in advanced manual mode", () => {
    const parsed = coordinationInputSchema.parse({ ...base, agents: ["strategy", "research"] });
    expect(parsed.mode).toBe("manual");
    expect(parsed.agents).toEqual(["strategy", "research"]);
  });
  it("requires two specialists in advanced manual mode", () => {
    expect(() => coordinationInputSchema.parse(base)).toThrow();
  });
});

describe("deep analysis conversation context", () => {
  const conversationId = "44444444-4444-4444-8444-444444444444";
  const base = {
    orgId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    requestKey: "33333333-3333-4333-8333-333333333333",
    request: "Review my current growth plan",
    executionContext: [],
    mode: "auto" as const,
  };
  it("accepts an explicitly selected existing conversation", () => {
    expect(coordinationInputSchema.parse({ ...base, conversationId }).conversationId).toBe(conversationId);
  });
  it("supports a fresh analysis without prior conversation history", () => {
    expect(coordinationInputSchema.parse({ ...base, conversationId: null }).conversationId).toBeNull();
  });
});
