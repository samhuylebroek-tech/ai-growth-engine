// Campaign spending limits, alerts and forecast (pure). Mirrors the hard-limit check of staging proposal 0083
// (record_campaign_spend): exposure in a period is spending plus open reservations of ONE data class and currency, and
// a correction or release counts on the day of the entry it adjusts. Weeks start on Monday (ISO); days are the
// business's calendar days as entered. Simulated entries never use or free room for real ones. Forecasts are labelled
// estimates built only from actual entries and never become records.
import type { CampaignSpendRow } from "@/lib/pending-schema";

export type SpendLimits = {
  currency: string;
  daily_max: number | string | null; weekly_max: number | string | null; monthly_max: number | string | null;
  lifetime_max: number | string | null; reserve_amount: number | string | null;
  alert_thresholds: number[]; emergency_stop: boolean; stop_reason: string;
};
export type LimitKey = "daily" | "weekly" | "monthly" | "lifetime";
export type LimitUsage = { key: LimitKey; max: number; used: number; share: number; remaining: number; crossed: number | null };
type Row = Pick<CampaignSpendRow, "id" | "kind" | "amount" | "currency" | "occurred_on" | "data_class" | "relates_to">;

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const DAY = 86_400_000;
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}
const monthOf = (day: string) => day.slice(0, 7);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Effective maxima; the lifetime room excludes the reserve that is held back. */
export function limitMaxima(l: SpendLimits): Partial<Record<LimitKey, number>> {
  const out: Partial<Record<LimitKey, number>> = {};
  const d = num(l.daily_max), w = num(l.weekly_max), m = num(l.monthly_max), t = num(l.lifetime_max);
  if (d !== null) out.daily = d;
  if (w !== null) out.weekly = w;
  if (m !== null) out.monthly = m;
  if (t !== null) out.lifetime = cents(t - (num(l.reserve_amount) ?? 0));
  return out;
}
export const hasLimits = (l: SpendLimits | null | undefined) => !!l && Object.keys(limitMaxima(l)).length > 0;

function exposure(rows: readonly Row[], cls: "manual" | "simulated", currency: string, day: string) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let d = 0, w = 0, m = 0, l = 0;
  const wk = weekStart(day), mo = monthOf(day);
  for (const r of rows) {
    if (r.data_class !== cls || r.currency !== currency) continue;
    const a = Number(r.amount);
    const at = (r.relates_to ? byId.get(r.relates_to)?.occurred_on : undefined) ?? r.occurred_on;
    l += a;
    if (at === day) d += a;
    if (weekStart(at) === wk) w += a;
    if (monthOf(at) === mo) m += a;
  }
  return { daily: cents(d), weekly: cents(w), monthly: cents(m), lifetime: cents(l) };
}

/** Usage of every configured limit on `day` for one data class, with the highest alert threshold crossed. */
export function limitUsage(l: SpendLimits, rows: readonly Row[], day: string, cls: "manual" | "simulated" = "manual"): LimitUsage[] {
  const max = limitMaxima(l);
  const used = exposure(rows, cls, l.currency, day);
  const thresholds = [...l.alert_thresholds].sort((a, b) => a - b);
  return (["daily", "weekly", "monthly", "lifetime"] as const).flatMap((key) => {
    const m = max[key];
    if (m === undefined) return [];
    const u = used[key];
    const share = m > 0 ? u / m : 1;
    const crossed = thresholds.filter((t) => share * 100 >= t).pop() ?? null;
    return [{ key, max: m, used: u, share, remaining: cents(m - u), crossed }];
  });
}

export type Block = { limit: "emergency_stop" | "currency" | "allocation" | LimitKey; max: number | null; used: number | null };
/** The limit a new entry would hit, or null. Same order as the database: stop, currency, daily, weekly, monthly, lifetime. */
export function wouldExceed(l: SpendLimits | null | undefined, rows: readonly Row[], e: Pick<Row, "kind" | "amount" | "currency" | "occurred_on" | "data_class" | "relates_to">): Block | null {
  const amt = Number(e.amount);
  if (!l || !(amt > 0)) return null;
  if (l.emergency_stop) return { limit: "emergency_stop", max: null, used: null };
  const max = limitMaxima(l);
  if (Object.keys(max).length === 0) return null;
  if (l.currency !== e.currency) return { limit: "currency", max: null, used: null };
  const day = (e.relates_to ? rows.find((r) => r.id === e.relates_to)?.occurred_on : undefined) ?? e.occurred_on;
  const used = exposure(rows, e.data_class, e.currency, day);
  for (const key of ["daily", "weekly", "monthly", "lifetime"] as const) {
    const m = max[key];
    if (m !== undefined && used[key] + amt > m + 1e-9) return { limit: key, max: m, used: used[key] };
  }
  return null;
}

export type Forecast = {
  /** Average actual spending per day since the start (estimate). */
  perDay: number; spent: number; projected: number; budget: number | null; projectedRemaining: number | null;
  overspend: number | null; basisDays: number; entries: number; confidence: "low" | "medium";
};
/**
 * Linear spending forecast to the end date from ACTUAL expenditure only (simulated entries and reservations excluded).
 * Null without an end date, before the start, after the end or without any actual spending — missing data is no zero.
 */
export function spendForecast(c: { start_date: string | null; end_date: string | null }, rows: readonly Row[], currency: string, budget: number | null, today: string): Forecast | null {
  if (!c.end_date || today > c.end_date) return null;
  const actual = rows.filter((r) => r.data_class === "manual" && r.currency === currency && (r.kind === "spend" || r.kind === "correction"));
  if (actual.length === 0) return null;
  const first = actual.reduce((m, r) => (r.occurred_on < m ? r.occurred_on : m), actual[0]!.occurred_on);
  const start = c.start_date && c.start_date < first ? c.start_date : first;
  if (today < start) return null;
  const basisDays = daysBetween(start, today) + 1;
  const spent = cents(actual.reduce((s, r) => s + Number(r.amount), 0));
  const perDay = spent / basisDays;
  const projected = cents(spent + perDay * Math.max(0, daysBetween(today, c.end_date)));
  const entries = actual.filter((r) => r.kind === "spend").length;
  return {
    perDay: cents(perDay), spent, projected, budget,
    projectedRemaining: budget === null ? null : cents(budget - projected),
    overspend: budget === null ? null : projected > budget ? cents(projected - budget) : 0,
    basisDays, entries, confidence: basisDays >= 14 && entries >= 5 ? "medium" : "low",
  };
}

export type BudgetAlert =
  | { kind: "emergency_stop"; reason: string }
  | { kind: "threshold"; limit: LimitKey; threshold: number; used: number; max: number }
  | { kind: "forecast_overspend"; projected: number; budget: number }
  | { kind: "reservations_exceed"; reserved: number; room: number }
  | { kind: "faster_than_time"; spentShare: number; timeShare: number };

/**
 * Deduplicated alerts (at most one per kind and limit; only the highest threshold crossed). Thresholds and forecasts
 * use actual entries only.
 */
export function budgetAlerts(input: {
  limits: SpendLimits | null; rows: readonly Row[]; today: string;
  campaign: { start_date: string | null; end_date: string | null; budget_eur: number };
}): BudgetAlert[] {
  const { limits, rows, today, campaign } = input;
  const out: BudgetAlert[] = [];
  if (limits?.emergency_stop) out.push({ kind: "emergency_stop", reason: limits.stop_reason });
  const currency = limits && hasLimits(limits) ? limits.currency : "EUR";
  if (limits) for (const u of limitUsage(limits, rows, today)) if (u.crossed !== null) out.push({ kind: "threshold", limit: u.key, threshold: u.crossed, used: u.used, max: u.max });
  const lifetime = limits ? limitMaxima(limits).lifetime : undefined;
  const budget = lifetime ?? (currency === "EUR" && campaign.budget_eur > 0 ? campaign.budget_eur : null);
  const f = spendForecast(campaign, rows, currency, budget, today);
  if (f && budget !== null && f.projected > budget) out.push({ kind: "forecast_overspend", projected: f.projected, budget });
  if (budget !== null) {
    const real = rows.filter((r) => r.data_class === "manual" && r.currency === currency);
    const spent = cents(real.filter((r) => r.kind === "spend" || r.kind === "correction").reduce((s, r) => s + Number(r.amount), 0));
    const reserved = cents(real.filter((r) => r.kind === "commitment" || r.kind === "release").reduce((s, r) => s + Number(r.amount), 0));
    if (reserved > 0 && reserved > budget - spent) out.push({ kind: "reservations_exceed", reserved, room: cents(budget - spent) });
    if (campaign.start_date && campaign.end_date && campaign.end_date > campaign.start_date && today >= campaign.start_date && today <= campaign.end_date && budget > 0) {
      const timeShare = (daysBetween(campaign.start_date, today) + 1) / (daysBetween(campaign.start_date, campaign.end_date) + 1);
      const spentShare = spent / budget;
      if (spentShare - timeShare > 0.15 && spentShare < 1) out.push({ kind: "faster_than_time", spentShare, timeShare });
    }
  }
  return out;
}
