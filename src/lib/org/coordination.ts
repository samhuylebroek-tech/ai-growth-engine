// Deterministic cross-business coordination for an organization. Pure and credit-free: it compares what each business
// has recorded (profile audiences, campaigns, open work, budgets, goals, specialist runs) and names possible overlaps
// with the evidence behind them. Findings are prompts to check, never conclusions or causes; nothing is changed.
import type { BusinessRow, SpecialistLoad } from "@/lib/org/consolidation";

export type CoordCampaign = { id: string; title: string; status: string; audience: string; channels: readonly string[]; start_date: string | null; end_date: string | null };
export type CoordGoal = { id: string; title: string; objective: string; status: string; achieved: boolean };
export type CoordBusiness = {
  id: string; name: string; audiences: readonly string[];
  campaigns: readonly CoordCampaign[]; openWork: readonly { id: string; title: string }[];
  budgetChannels: readonly { channel: string; month: string; planned: number; currency: string }[];
  goals: readonly CoordGoal[];
};
export type FindingCode =
  | "campaign_conflict" | "budget_overlap" | "duplicate_work" | "strategy_reuse" | "shared_audience" | "shared_bottleneck" | "specialist_contention";
export type Finding = { code: FindingCode; key: string; businesses: string[]; subject: string; evidence: string[] };

const STOP = new Set(["the", "and", "for", "with", "van", "de", "het", "een", "en", "voor", "le", "la", "les", "des", "et", "pour", "du", "a", "an", "of", "to", "in"]);
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0; for (const t of x) if (y.has(t)) both += 1;
  return both / (x.size + y.size - both);
}
/** Same audience: identical after normalization, or the same meaningful words (at least two, 60% overlap). */
export function sameAudience(a: string, b: string): boolean {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const x = tokens(a), y = tokens(b); let both = 0; for (const t of x) if (y.has(t)) both += 1;
  return both >= 2 && similarity(a, b) >= 0.6;
}
const overlaps = (a: CoordCampaign, b: CoordCampaign) => {
  const aStart = a.start_date ?? "0000-01-01", aEnd = a.end_date ?? "9999-12-31";
  const bStart = b.start_date ?? "0000-01-01", bEnd = b.end_date ?? "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
};
const LIVE = ["planned", "active"];
const pairKey = (...ids: string[]) => [...ids].sort().join("|");

export function coordinate(bs: readonly CoordBusiness[], rows: readonly BusinessRow[], load: readonly SpecialistLoad[]): Finding[] {
  const out: Finding[] = []; const seen = new Set<string>();
  const push = (f: Finding) => { if (!seen.has(f.key)) { seen.add(f.key); out.push(f); } };
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i]!, b = bs[j]!;
    // Conflicting campaigns: same audience, a shared channel and overlapping dates in two businesses.
    for (const ca of a.campaigns) for (const cb of b.campaigns) {
      if (!LIVE.includes(ca.status) || !LIVE.includes(cb.status) || !sameAudience(ca.audience, cb.audience) || !overlaps(ca, cb)) continue;
      const shared = ca.channels.filter((c) => cb.channels.some((d) => normalize(d) === normalize(c)));
      if (!shared.length) continue;
      push({ code: "campaign_conflict", key: `cc:${pairKey(ca.id, cb.id)}`, businesses: [a.id, b.id], subject: ca.audience,
        evidence: [`${a.name}: ${ca.title}`, `${b.name}: ${cb.title}`, shared.join(", ")] });
    }
    // Shared audiences from the confirmed profiles.
    const sharedAud = a.audiences.filter((x) => b.audiences.some((y) => sameAudience(x, y)));
    for (const aud of sharedAud) push({ code: "shared_audience", key: `sa:${pairKey(a.id, b.id)}:${normalize(aud)}`, businesses: [a.id, b.id], subject: aud, evidence: [a.name, b.name] });
    // Budget overlap: the same channel budgeted in the same month by businesses that share an audience.
    if (sharedAud.length) for (const la of a.budgetChannels) for (const lb of b.budgetChannels) {
      if (la.month !== lb.month || normalize(la.channel) !== normalize(lb.channel) || la.planned <= 0 || lb.planned <= 0) continue;
      push({ code: "budget_overlap", key: `bo:${pairKey(a.id, b.id)}:${normalize(la.channel)}:${la.month}`, businesses: [a.id, b.id], subject: la.channel,
        evidence: [`${a.name}: ${la.planned} ${la.currency}`, `${b.name}: ${lb.planned} ${lb.currency}`, la.month.slice(0, 7)] });
    }
    // Possibly duplicated work: open items with nearly the same title in two businesses.
    for (const wa of a.openWork) for (const wb of b.openWork) {
      if (similarity(wa.title, wb.title) < 0.8 || tokens(wa.title).size < 2) continue;
      push({ code: "duplicate_work", key: `dw:${pairKey(wa.id, wb.id)}`, businesses: [a.id, b.id], subject: wa.title, evidence: [`${a.name}: ${wa.title}`, `${b.name}: ${wb.title}`] });
    }
  }
  // Reuse: a business achieved a goal with the same objective another business is still pursuing.
  for (const a of bs) for (const ga of a.goals) {
    if (!ga.achieved) continue;
    for (const b of bs) if (b.id !== a.id) for (const gb of b.goals) {
      if (gb.achieved || gb.status !== "active" || gb.objective !== ga.objective) continue;
      push({ code: "strategy_reuse", key: `sr:${ga.id}:${gb.id}`, businesses: [a.id, b.id], subject: ga.objective, evidence: [`${a.name}: ${ga.title}`, `${b.name}: ${gb.title}`] });
    }
  }
  // Common bottlenecks: two or more businesses with overdue work or failed AI runs.
  const overdue = rows.filter((r) => r.overdueTasks >= 3);
  if (overdue.length >= 2) push({ code: "shared_bottleneck", key: "sb:overdue", businesses: overdue.map((r) => r.id), subject: "overdue_tasks", evidence: overdue.map((r) => `${r.name}: ${r.overdueTasks}`) });
  const failing = rows.filter((r) => r.failedRuns >= 2);
  if (failing.length >= 2) push({ code: "shared_bottleneck", key: "sb:failed", businesses: failing.map((r) => r.id), subject: "failed_runs", evidence: failing.map((r) => `${r.name}: ${r.failedRuns}`) });
  // Shared specialist capacity: open work in several businesses, or a business near its monthly cap.
  for (const l of load) {
    const busy = l.businesses.filter((b) => b.open > 0);
    const near = l.businesses.filter((b) => b.cap != null && b.used >= b.cap * 0.8);
    if (busy.length >= 2 || near.length) push({ code: "specialist_contention", key: `sc:${l.specialist}`, businesses: [...new Set([...busy, ...near].map((b) => b.id))], subject: l.specialist,
      evidence: [...busy.map((b) => `${b.id}:open:${b.open}`), ...near.map((b) => `${b.id}:cap:${b.used}/${b.cap}`)] });
  }
  return out;
}

export type OrgAction = { code: "attend_business" | FindingCode; key: string; businesses: string[]; subject: string; rank: number };
const ORDER: Record<OrgAction["code"], number> = { attend_business: 0, campaign_conflict: 1, budget_overlap: 2, specialist_contention: 3, duplicate_work: 4, shared_bottleneck: 5, strategy_reuse: 6, shared_audience: 7 };
/** Next best organization actions: businesses needing attention first, then coordination findings, in a fixed order. */
export function nextOrgActions(rows: readonly BusinessRow[], findings: readonly Finding[], limit = 8): OrgAction[] {
  const acts: OrgAction[] = rows.filter((r) => r.attention > 0)
    .sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name)).slice(0, 3)
    .map((r) => ({ code: "attend_business", key: `ab:${r.id}`, businesses: [r.id], subject: r.reasons[0] ?? "", rank: 0 }));
  for (const f of findings) acts.push({ code: f.code, key: f.key, businesses: f.businesses, subject: f.subject, rank: 0 });
  return acts.sort((a, b) => ORDER[a.code] - ORDER[b.code]).slice(0, limit).map((a, i) => ({ ...a, rank: i + 1 }));
}
