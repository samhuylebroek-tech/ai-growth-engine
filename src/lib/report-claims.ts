// What kind of statement each report figure is (pure manifest), using the same six kinds as AI answers
// (src/lib/claims.ts), so a "fact" in a report and a "fact" in a Growth Officer answer mean the same thing:
// recorded data, counted. Anything derived carries a formula; estimates are never facts; missing inputs are "missing".
import type { ClaimKind } from "@/lib/claims";

export type FigureSource = "revenue" | "spend" | "campaign" | "tasks" | "runs" | "reviews" | "experiments" | "economics" | "budget" | "usage" | "records" | "plan" | "proposals";
export type Figure = { kind: Extract<ClaimKind, "fact" | "calc" | "estimate" | "missing">; source: FigureSource; formula?: string };

const f = (kind: Figure["kind"], source: FigureSource, formula?: string): Figure => (formula ? { kind, source, formula } : { kind, source });

export const REPORT_FIGURES = {
  "fin.sales": f("fact", "revenue"),
  "fin.refunds": f("fact", "revenue", "refunds"),
  "fin.net": f("calc", "revenue", "net"),
  "fin.prev": f("calc", "revenue", "net"),
  "fin.change": f("calc", "revenue", "change"),
  "fin.spent": f("fact", "spend"),
  "fin.perSpend": f("calc", "spend", "perSpend"),
  "fin.estimated": f("estimate", "revenue"),
  "spend.total": f("fact", "spend"),
  "camp.state": f("calc", "campaign", "health"),
  "camp.budget": f("fact", "campaign"),
  "camp.spent": f("fact", "spend"),
  "camp.remaining": f("calc", "spend", "remaining"),
  "camp.tasks": f("fact", "tasks"),
  "task.done": f("fact", "tasks"),
  "task.created": f("fact", "tasks"),
  "task.open": f("fact", "tasks"),
  "task.overdue": f("calc", "tasks", "overdue"),
  "task.change": f("calc", "tasks", "change"),
  "run.count": f("fact", "runs"),
  "run.credits": f("fact", "runs"),
  "run.change": f("calc", "runs", "change"),
  "sp.counts": f("fact", "runs"),
  "sp.perSuccess": f("calc", "runs", "perSuccess"),
  "sp.reviews": f("fact", "reviews"),
  "sp.avgScore": f("calc", "reviews", "avgScore"),
  "sp.decisions": f("fact", "reviews"),
  "exp.counts": f("fact", "experiments"),
  "econ.costs": f("fact", "economics"),
  "econ.estCosts": f("estimate", "economics"),
  "econ.gp": f("calc", "economics", "gp"),
  "econ.margin": f("calc", "economics", "margin"),
  "econ.gpEstimated": f("estimate", "economics", "gpEstimate"),
  "econ.marginEstimated": f("estimate", "economics", "gpEstimate"),
  "econ.cac": f("calc", "economics", "cac"),
  "econ.rpc": f("calc", "economics", "rpc"),
  "econ.budget": f("fact", "budget"),
  "econ.ai": f("fact", "usage"),
  "econ.aiCost": f("calc", "usage", "aiCost"),
  "init.status": f("fact", "plan"),
  "init.work": f("fact", "tasks"),
  "init.overdue": f("calc", "tasks", "overdue"),
  "init.campaigns": f("fact", "campaign"),
  "init.spent": f("fact", "spend"),
  "init.reserved": f("fact", "spend"),
  "init.credits": f("fact", "usage"),
  "init.kpi": f("calc", "plan", "progress"),
  "goal.progress": f("calc", "plan", "progress"),
  "learn.counts": f("fact", "proposals"),
  "learn.patterns": f("calc", "proposals", "pattern"),
  "missing": f("missing", "records"),
} as const satisfies Record<string, Figure>;
export type FigureId = keyof typeof REPORT_FIGURES;
