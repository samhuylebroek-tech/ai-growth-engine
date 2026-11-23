import { describe, expect, it } from "vitest";
import { questionFocus, MAX_FOCUS_TOPICS } from "@/lib/ai/question-focus";
import { renderBusinessContext, type BusinessDomains } from "@/lib/security/business-context";

const NOW = new Date("2026-11-23T12:00:00Z");
const empty = () => ({ status: "ok" as const, rows: [], truncated: false });
const base = (): BusinessDomains => ({
  workspace: { id: "w", name: "W" }, objectives: null, facts: [], goals: [], recommendations: [], plans: empty(), initiatives: [],
  operations: [], projects: [], tasks: [], budget: empty(), deals: empty(), competitors: empty(), observations: [], seo: empty(),
  content: empty(), versions: [], decisions: [], campaigns: empty(), connections: empty(),
});

describe("question focus (keyword rules, EN/NL/FR)", () => {
  it("maps a Dutch campaign question to the campaign sections", () => {
    const f = questionFocus("Waarom presteert mijn campagne slecht?");
    expect(f.topics).toContain("campaigns");
    expect(f.sections).toContain("campaigns-and-performance");
  });
  it("maps a French revenue question to money and figures, accents ignored", () => {
    const f = questionFocus("Pourquoi notre chiffre d’affaires baisse-t-il ce mois-ci ?");
    expect(f.topics).toEqual(expect.arrayContaining(["money", "kpis"]));
    expect(f.sections).toContain("growth-economics");
  });
  it("maps an English blocked-work question to blocked work", () => {
    expect(questionFocus("Which tasks are blocked right now?").sections).toContain("blocked-work");
  });
  it("lets a short follow-up borrow the previous question", () => {
    expect(questionFocus("En waarom?", "Hoe gaan mijn campagnes?").topics).toEqual(["campaigns"]);
  });
  it("matches word starts only: the French article 'les' or 'leads' does not trigger experiments or ads", () => {
    const f = questionFocus("Quels sont les leads ouverts ?");
    expect(f.topics).toEqual(["customers"]);
  });
  it("gives no focus to a question without topic words, or to a broad one", () => {
    expect(questionFocus("Hallo, hoe gaat het?").sections).toEqual([]);
    const broad = questionFocus("Budget, campagne, taken, KPI, klanten en concurrenten: geef een overzicht");
    expect(broad.topics.length).toBe(0);
    expect(MAX_FOCUS_TOPICS).toBe(4);
  });
});

describe("focused business context", () => {
  const domains = (): BusinessDomains => ({
    ...base(),
    competitors: { status: "ok", truncated: false, rows: [{ id: "c1", name: "Rival BV", website: "https://rival.example" }] },
    campaigns: { status: "ok", truncated: false, rows: Array.from({ length: 30 }, (_, i) => ({ title: `Campaign ${i} ${"x".repeat(40)}`, status: "active", category: "ads", budget_eur: 100, results: "", start_date: null, end_date: null })) },
  });
  it("without focus renders exactly as before, with no focus line", () => {
    expect(renderBusinessContext(domains(), NOW)).toBe(renderBusinessContext(domains(), NOW, []));
    expect(renderBusinessContext(domains(), NOW)).not.toContain("QUESTION FOCUS");
  });
  it("puts the question's sections right after identity and facts, and names them", () => {
    const out = renderBusinessContext(domains(), NOW, ["campaigns-and-performance"]);
    expect(out).toContain("QUESTION FOCUS");
    expect(out.indexOf("## CAMPAIGNS AND PERFORMANCE DATA")).toBeLessThan(out.indexOf("## COMPETITOR INTELLIGENCE"));
    expect(out.indexOf("## VERIFIED BUSINESS FACTS")).toBeLessThan(out.indexOf("## CAMPAIGNS AND PERFORMANCE DATA"));
  });
  it("gives a focused section more room than it gets unfocused", () => {
    const section = (s: string) => s.slice(s.indexOf("## CAMPAIGNS AND PERFORMANCE DATA"), s.indexOf("</untrusted>", s.indexOf("## CAMPAIGNS AND PERFORMANCE DATA")));
    const plain = section(renderBusinessContext(domains(), NOW));
    const focused = section(renderBusinessContext(domains(), NOW, ["campaigns-and-performance"]));
    expect(focused.length).toBeGreaterThan(plain.length);
  });
  it("keeps the question's sections when the context is over its size limit; background is shortened or dropped first", () => {
    const long = "y".repeat(110);
    const big: BusinessDomains = {
      ...domains(),
      facts: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, key: `fact ${i}`, value: long, source_type: "manual", verified: true })),
      goals: Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i} ${long}`, objective: long, metric: "leads", baseline: 1, target: 2, current_value: 1, due_date: null, priority: "high", status: "active" })),
      deals: { status: "ok", truncated: false, rows: Array.from({ length: 30 }, () => ({ stage: "lead", value: 10, currency: "EUR", expected_close: null, closed_at: null, updated_at: null, goal_id: null })) },
      recommendations: Array.from({ length: 30 }, (_, i) => ({ title: `Recommendation ${i} ${long}`, status: "open" })),
      tasks: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, project_id: null, title: `Task ${i} ${long}`, status: "todo", priority: "high", due_date: "2026-11-01", owner_id: null })),
    };
    const out = renderBusinessContext(big, NOW, ["campaigns-and-performance"]);
    expect(out.length).toBeLessThanOrEqual(12_000);
    const campaigns = out.slice(out.indexOf("## CAMPAIGNS AND PERFORMANCE DATA"));
    expect(campaigns.split("\n")[1]).not.toContain("(omitted to keep the context within size limits)");
    expect(campaigns).toContain("Campaign 3");
    expect(out).toMatch(/PREVIOUS RECOMMENDATIONS[^\n]*\n<untrusted source="recommendations">\n[^\n]*\n\(\+29 more omitted for length\)/);
  });
  it("shows the start of a section whose first line alone is too long, instead of nothing", async () => {
    const { fitLines } = await import("@/lib/security/business-context");
    const [first, rest] = fitLines(["z".repeat(500), "short"], 260);
    expect(first?.startsWith("zzz")).toBe(true);
    expect(first?.endsWith("…")).toBe(true);
    expect(rest).toBe("(+1 more omitted for length)");
  });
});
