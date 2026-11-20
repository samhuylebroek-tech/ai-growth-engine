// Deterministic cross-business opportunity detection. Pure and credit-free: it compares what each business has
// recorded (confirmed profile audiences, offerings and markets, budgets, campaigns, goals, experiments and specialist
// work) and names opportunities one business alone would not see. Every result is a hypothesis with its evidence,
// what is missing, costs, dependencies, risks and a next step; nothing is shared or changed. Customer-level data is
// never compared across businesses: the rules only use aggregate, business-level records.
import { normalize, sameAudience, type Finding } from "@/lib/org/coordination";
import type { BusinessRef, ProfileLite } from "@/lib/org/overview";

export type EvidenceClass = "verified" | "recorded" | "estimate" | "assumption" | "missing";
export type OppKind = "cross_sell" | "bundle" | "joint_campaign" | "shared_channel" | "shared_content" | "strategy_reuse" | "specialist_reuse";
export type EvidenceItem = { code: string; class: EvidenceClass; params: Record<string, string> };
export type OppDraft = {
  ruleKey: string; kind: OppKind; businesses: string[]; subject: string; confidence: "low" | "medium" | "high";
  evidence: EvidenceItem[]; impact: "revenue" | "efficiency" | "learning"; cost: "low" | "medium"; dependencies: string[]; risks: string[];
  next: string; strategic: number;
};
export type OppBusiness = BusinessRef & {
  profile: ProfileLite;
  campaigns: readonly { title: string; status: string; channels: readonly string[] }[];
  budget: readonly { channel: string; month: string; planned: number; currency: string }[];
  experiments: readonly { title: string; objective: string; conclusion: string; evidence_strength: string | null }[];
  activeObjectives: readonly string[];
  specialistDone: Readonly<Record<string, number>>;
  specialistOpen: Readonly<Record<string, number>>;
};

const key = (...p: string[]) => p.join(":");
const pair = (a: string, b: string) => [a, b].sort().join("|");
const LIVE = ["planned", "active"];
const differs = (a: readonly string[], b: readonly string[]) => a.some((x) => !b.some((y) => normalize(x) === normalize(y)));

export function detectOpportunities(bs: readonly OppBusiness[], findings: readonly Finding[]): OppDraft[] {
  const out: OppDraft[] = []; const seen = new Set<string>();
  const push = (d: OppDraft) => { if (!seen.has(d.ruleKey)) { seen.add(d.ruleKey); out.push(d); } };
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i]!, b = bs[j]!; const p = pair(a.id, b.id);
    const shared = a.profile.audiences.filter((x) => b.profile.audiences.some((y) => sameAudience(x, y)));
    // 1. Shared audience + different offerings: cross-selling between the businesses.
    for (const aud of shared) {
      const cross = a.profile.offerings.length > 0 && b.profile.offerings.length > 0 && (differs(a.profile.offerings, b.profile.offerings) || differs(b.profile.offerings, a.profile.offerings));
      const exact = a.profile.audiences.some((x) => b.profile.audiences.some((y) => normalize(x) === normalize(y) && normalize(x) === normalize(aud)));
      push({
        ruleKey: key(cross ? "cs" : "jc", p, normalize(aud)), kind: cross ? "cross_sell" : "joint_campaign", businesses: [a.id, b.id], subject: aud,
        confidence: exact && cross ? "medium" : "low",
        evidence: [
          { code: "ev.sharedAudience", class: "recorded", params: { a: a.name, b: b.name, audience: aud } },
          ...(cross ? [{ code: "ev.offerings", class: "recorded" as const, params: { a: a.name, b: b.name, oa: a.profile.offerings.slice(0, 3).join(", "), ob: b.profile.offerings.slice(0, 3).join(", ") } }] : []),
          ...(!a.profile.confirmed || !b.profile.confirmed ? [{ code: "ev.profileUnconfirmed", class: "assumption" as const, params: {} }] : []),
          { code: "ev.customerOverlapUnknown", class: "missing", params: {} },
        ],
        impact: "revenue", cost: "low", dependencies: ["dep.consentForContact"], risks: ["risk.brandConfusion", "risk.privacy"],
        next: cross ? "nx.validateCrossSell" : "nx.planJointCampaign", strategic: cross ? 4 : 3,
      });
    }
    // 2. Same market, different offerings, no shared audience recorded: complementary bundle or partnership.
    const markets = a.profile.markets.filter((x) => b.profile.markets.some((y) => normalize(x) === normalize(y)));
    if (!shared.length && markets.length && a.profile.offerings.length && b.profile.offerings.length && differs(a.profile.offerings, b.profile.offerings)) push({
      ruleKey: key("bu", p, normalize(markets[0]!)), kind: "bundle", businesses: [a.id, b.id], subject: markets[0]!, confidence: "low",
      evidence: [
        { code: "ev.sharedMarket", class: "recorded", params: { a: a.name, b: b.name, market: markets.join(", ") } },
        { code: "ev.offerings", class: "recorded", params: { a: a.name, b: b.name, oa: a.profile.offerings.slice(0, 3).join(", "), ob: b.profile.offerings.slice(0, 3).join(", ") } },
        { code: "ev.demandUnknown", class: "missing", params: {} },
      ],
      impact: "revenue", cost: "medium", dependencies: ["dep.pricingAgreement"], risks: ["risk.margin"], next: "nx.testBundle", strategic: 3,
    });
    // 3. The same paid channel budgeted in the same month: shared buying, creative or reporting.
    for (const la of a.budget) for (const lb of b.budget) {
      if (la.month !== lb.month || normalize(la.channel) !== normalize(lb.channel) || la.planned <= 0 || lb.planned <= 0) continue;
      push({
        ruleKey: key("ch", p, normalize(la.channel), la.month.slice(0, 7)), kind: "shared_channel", businesses: [a.id, b.id], subject: la.channel, confidence: "medium",
        evidence: [
          { code: "ev.budgetLine", class: "recorded", params: { business: a.name, channel: la.channel, amount: `${la.planned} ${la.currency}` } },
          { code: "ev.budgetLine", class: "recorded", params: { business: b.name, channel: lb.channel, amount: `${lb.planned} ${lb.currency}` } },
          { code: "ev.savingsUnknown", class: "estimate", params: {} },
        ],
        impact: "efficiency", cost: "low", dependencies: ["dep.separateTracking"], risks: ["risk.attributionMix"], next: "nx.shareChannelSetup", strategic: 2,
      });
    }
    // 4. Both run live campaigns on the same channel: shared content production.
    const ca = a.campaigns.filter((c) => LIVE.includes(c.status)), cb = b.campaigns.filter((c) => LIVE.includes(c.status));
    const channels = [...new Set(ca.flatMap((c) => c.channels.map(normalize)))].filter((ch) => ch && cb.some((c) => c.channels.some((x) => normalize(x) === ch)));
    if (channels.length) push({
      ruleKey: key("sc", p, channels.sort().join(",")), kind: "shared_content", businesses: [a.id, b.id], subject: channels.join(", "), confidence: "low",
      evidence: [
        { code: "ev.liveCampaigns", class: "recorded", params: { business: a.name, n: String(ca.length), channels: channels.join(", ") } },
        { code: "ev.liveCampaigns", class: "recorded", params: { business: b.name, n: String(cb.length), channels: channels.join(", ") } },
        { code: "ev.reuseUntested", class: "assumption", params: {} },
      ],
      impact: "efficiency", cost: "low", dependencies: ["dep.writingProfiles"], risks: ["risk.brandConfusion"], next: "nx.shareContentCalendar", strategic: 2,
    });
  }
  // 5. Reuse a strategy that reached its goal in one business for the same objective in another.
  for (const f of findings) if (f.code === "strategy_reuse") push({
    ruleKey: key("sr", f.key), kind: "strategy_reuse", businesses: f.businesses, subject: f.subject, confidence: "medium",
    evidence: [{ code: "ev.goalAchieved", class: "recorded", params: { from: f.evidence[0] ?? "", to: f.evidence[1] ?? "" } }, { code: "ev.contextDiffers", class: "assumption", params: {} }],
    impact: "learning", cost: "low", dependencies: [], risks: ["risk.contextDiffers"], next: "nx.reviewWinningPlan", strategic: 3,
  });
  // 6. A controlled experiment in one business answers a question another business is pursuing.
  for (const a of bs) for (const e of a.experiments) {
    if (e.evidence_strength !== "controlled" || !e.objective) continue;
    for (const b of bs) if (b.id !== a.id && b.activeObjectives.includes(e.objective)) push({
      ruleKey: key("ex", a.id, b.id, normalize(e.title).slice(0, 60)), kind: "strategy_reuse", businesses: [a.id, b.id], subject: e.title, confidence: "medium",
      evidence: [{ code: "ev.experiment", class: "recorded", params: { business: a.name, title: e.title, conclusion: e.conclusion.slice(0, 160) } }, { code: "ev.contextDiffers", class: "assumption", params: {} }],
      impact: "learning", cost: "low", dependencies: [], risks: ["risk.contextDiffers"], next: "nx.repeatExperiment", strategic: 3,
    });
  }
  // 7. A specialist delivered work in one business while the same kind of work waits in another: reuse the output.
  for (const a of bs) for (const [sp, done] of Object.entries(a.specialistDone)) {
    if (done < 1) continue;
    for (const b of bs) if (b.id !== a.id && (b.specialistOpen[sp] ?? 0) > 0) push({
      ruleKey: key("su", sp, pair(a.id, b.id)), kind: "specialist_reuse", businesses: [a.id, b.id], subject: sp, confidence: "low",
      evidence: [{ code: "ev.specialistDone", class: "recorded", params: { business: a.name, n: String(done) } }, { code: "ev.specialistOpen", class: "recorded", params: { business: b.name, n: String(b.specialistOpen[sp] ?? 0) } }],
      impact: "efficiency", cost: "low", dependencies: ["dep.noCustomerData"], risks: ["risk.contextDiffers"], next: "nx.reuseOutput", strategic: 2,
    });
  }
  return out.sort((x, y) => y.strategic - x.strategic || x.ruleKey.localeCompare(y.ruleKey));
}
