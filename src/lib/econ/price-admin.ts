// Credit price administration (pure). History is insert-only; the status of each version is derived from its
// effective time and the next version for the same scope/plan/currency, so nothing is ever edited in place.
import type { CreditPriceVersionRow } from "@/lib/pending-schema";

export type PriceStatus = "scheduled" | "active" | "superseded";
export type PriceHistoryRow = CreditPriceVersionRow & { status: PriceStatus; effective_to: string | null };

const key = (r: Pick<CreditPriceVersionRow, "scope" | "plan_key" | "currency">) => `${r.scope}:${r.plan_key ?? ""}:${r.currency}`;
const ms = (iso: string) => new Date(iso).getTime();

export function priceHistory(rows: readonly CreditPriceVersionRow[], now: Date): PriceHistoryRow[] {
  const groups = new Map<string, CreditPriceVersionRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const out: PriceHistoryRow[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => ms(a.effective_from) - ms(b.effective_from));
    const activeIdx = sorted.map((r) => ms(r.effective_from) <= now.getTime()).lastIndexOf(true);
    sorted.forEach((r, i) => out.push({
      ...r,
      status: i > activeIdx ? "scheduled" : i === activeIdx ? "active" : "superseded",
      effective_to: sorted[i + 1]?.effective_from ?? null,
    }));
  }
  return out.sort((a, b) => key(a).localeCompare(key(b)) || ms(b.effective_from) - ms(a.effective_from));
}

/** The version that applies at `at` for a scope/plan/currency, or null. */
export function versionAt(rows: readonly CreditPriceVersionRow[], scope: string, plan: string | null, currency: string, at: Date) {
  return rows
    .filter((r) => r.scope === scope && (r.plan_key ?? null) === plan && r.currency === currency && ms(r.effective_from) <= at.getTime())
    .sort((a, b) => ms(b.effective_from) - ms(a.effective_from))[0] ?? null;
}

export type PriceDraft = { scope: "platform" | "plan"; plan: string | null; currency: string; price: number; effectiveFrom: string; methodology: string };
export type DraftProblem = "plan_required" | "plan_not_allowed" | "currency" | "price" | "backdated" | "methodology";

/** Same rules as `set_credit_price` (the database re-checks them), so the form explains a refusal before it is sent. */
export function draftProblems(d: PriceDraft, now: Date): DraftProblem[] {
  const p: DraftProblem[] = [];
  if (d.scope === "plan" && !d.plan) p.push("plan_required");
  if (d.scope === "platform" && d.plan) p.push("plan_not_allowed");
  if (!/^[A-Z]{3}$/.test(d.currency)) p.push("currency");
  if (!Number.isFinite(d.price) || d.price <= 0 || d.price >= 1000) p.push("price");
  const t = ms(d.effectiveFrom);
  if (!Number.isFinite(t) || t < now.getTime() - 5 * 60_000) p.push("backdated");
  const m = d.methodology.trim().length;
  if (m < 3 || m > 500) p.push("methodology");
  return p;
}

/**
 * Impact of a new price on the credits used in the last 30 days, as an estimate for a comparable future month.
 * Credits already used keep the price that applied when they were used; this preview never reprices them.
 */
export function impactPreview(credits30d: number, current: number | null, next: number) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const nextMonthly = round(credits30d * next);
  return { credits30d, currentMonthly: current === null ? null : round(credits30d * current), nextMonthly, change: current === null ? null : round(nextMonthly - credits30d * current) };
}
