// Pure assembly of the organization view from rows read under the caller's own access (see org-data.ts).
// Shared by the Organization Command Center and the server-side Organization Growth Officer so both reason over
// exactly the same figures.
import { businessRow, byAttention, orgTotals, revenueByUnit, specialistLoad, type BusinessRow, type Money } from "@/lib/org/consolidation";
import { coordinate, type CoordBusiness, type Finding } from "@/lib/org/coordination";
import type { OrgOverviewData } from "@/components/org/org-data";

export const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
/** Offerings and audiences are stored as strings or {name|title|label} objects; both are read as plain names. */
export const names = (x: unknown) => (Array.isArray(x) ? x.map((v) => typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>)["name"] ?? (v as Record<string, unknown>)["title"] ?? (v as Record<string, unknown>)["label"] ?? "") : "").filter((v) => v.trim().length > 0) : []);

export type BusinessRef = { id: string; name: string };
export type ProfileLite = { audiences: string[]; offerings: string[]; markets: string[]; businessModel: string | null; industry: string | null; reportingCurrency: string; confirmed: boolean };

export function buildOrgView(d: OrgOverviewData, businesses: readonly BusinessRef[], from: string, now: string, month: string) {
  const prof = new Map(d.profiles.map((p) => [p.workspace_id, p]));
  const by = <T extends { workspace_id: string | null }>(rows: readonly T[], id: string) => rows.filter((r) => r.workspace_id === id);
  const profiles = new Map<string, ProfileLite>(businesses.map((b) => {
    const p = prof.get(b.id);
    return [b.id, {
      audiences: names(p?.audiences), offerings: names(p?.offerings), markets: names(p?.markets),
      businessModel: p?.business_model ?? null, industry: p?.industry ?? null,
      reportingCurrency: (p as { reporting_currency?: string } | undefined)?.reporting_currency ?? "EUR", confirmed: !!p?.onboarding_completed_at,
    }];
  }));
  const rows: BusinessRow[] = businesses.map((b) => businessRow({
    id: b.id, name: b.name, reportingCurrency: profiles.get(b.id)!.reportingCurrency,
    revenue: by(d.revenue ?? [], b.id), goals: by(d.goals, b.id), tasks: by(d.tasks, b.id), budget: by(d.budget, b.id),
    runs: by(d.runs, b.id), pendingApprovals: by(d.approvals, b.id).length, truncated: false,
  }, month, now, from, now));
  const coord: CoordBusiness[] = businesses.map((b) => ({
    id: b.id, name: b.name, audiences: profiles.get(b.id)!.audiences,
    campaigns: by(d.campaigns, b.id).map((c) => ({ id: c.id, title: c.title, status: c.status, audience: c.audience, channels: c.channels ?? [], start_date: c.start_date, end_date: c.end_date })),
    openWork: by(d.tasks, b.id).map((x) => ({ id: x.id, title: x.title })),
    budgetChannels: by(d.budget, b.id).map((l) => ({ channel: l.channel, month: l.period_month, planned: Number(l.planned), currency: l.currency })),
    goals: by(d.goals, b.id).map((g) => ({ id: g.id, title: g.title, objective: g.objective, status: g.status, achieved: g.status === "achieved" || (g.target != null && g.current_value != null && Number(g.current_value) >= Number(g.target)) })),
  }));
  const load = specialistLoad(businesses.map((b) => ({ id: b.id, runs: by(d.runs, b.id) })), d.allocations ?? [], `${month}T00:00:00Z`);
  const findings: Finding[] = coordinate(coord, rows, load);
  const units = d.units ?? [];
  const brandRows = d.revenue ? businesses.map((b) => ({
    id: b.id, name: b.name, hasUnits: units.some((u) => u.workspace_id === b.id),
    units: revenueByUnit(by(d.revenue ?? [], b.id), from, now).map((u) => ({ ...u, label: units.find((x) => x.id === u.unitId)?.name ?? "" })),
  })).filter((b) => b.hasUnits && b.units.length) : [];
  const counts = new Map<string, number>(); for (const r of rows) counts.set(r.reportingCurrency, (counts.get(r.reportingCurrency) ?? 0) + 1);
  const defaultCurrency = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "EUR";
  return {
    rows, sorted: byAttention(rows), totals: orgTotals(rows), findings, load, brandRows, coord, profiles,
    defaultCurrency, revenueOff: d.revenue === null, initiatives: d.initiatives.length, allocationsOff: d.allocations === null,
  };
}
export type OrgView = ReturnType<typeof buildOrgView>;
export type { Money };
