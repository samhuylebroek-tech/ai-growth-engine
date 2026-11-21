// Home: this business's money converted to its reporting currency (Phase 9). Shown only when the period has amounts
// in more than one currency or in a currency other than the reporting currency. It reuses the organization view's
// monthly closing-rate conversion and the canonical economics summary, so Home, Growth economics and the organization
// overview agree; original amounts stay visible and a converted total is withheld, with the reason, when a rate is missing.
import { useQuery } from "@tanstack/react-query";
import { econOptions } from "@/components/econ/econ-data";
import { OrgEconomicsConverted } from "@/components/org/org-economics-converted";
import { economicsSummary } from "@/lib/econ/summary";
import { growthDb } from "@/lib/pending-schema";
import { localDay } from "@/lib/execution";

/** Currencies that actually carry money in [from, to] (revenue, campaign spending, business costs). */
export function periodCurrencies(d: { revenue: readonly { currency: string; occurred_at: string }[]; spend: readonly { currency: string; occurred_on: string }[]; costs: readonly { currency: string; period_start: string; period_end: string }[] }, from: string, to: string) {
  const s = new Set<string>();
  for (const r of d.revenue) if (r.occurred_at.slice(0, 10) >= from && r.occurred_at.slice(0, 10) <= to) s.add(r.currency);
  for (const r of d.spend) if (r.occurred_on >= from && r.occurred_on <= to) s.add(r.currency);
  for (const c of d.costs) if (c.period_start >= from && c.period_end <= to) s.add(c.currency);
  return [...s].sort();
}
/** Conversion is worth showing only when the figures are not already all in the reporting currency. */
export const needsConversion = (currencies: readonly string[], reporting: string) => currencies.length > 1 || (currencies.length === 1 && currencies[0] !== reporting);

export function HomeConverted({ orgId, wsId, name, from, to }: { orgId: string; wsId: string; name: string; from: string; to: string }) {
  const econ = useQuery(econOptions(orgId, wsId));
  const cur = useQuery({
    queryKey: ["reporting-currency", orgId, wsId],
    queryFn: async () => {
      const r = await growthDb.from("business_profiles").select("reporting_currency").eq("org_id", orgId).eq("workspace_id", wsId).maybeSingle();
      if (r.error) throw r.error;
      return (r.data as { reporting_currency?: string } | null)?.reporting_currency ?? "EUR";
    },
  });
  // Optional extra on Home: if either read fails, the per-currency figures above stay the only figures shown.
  if (!econ.data || !cur.data) return null;
  if (!needsConversion(periodCurrencies(econ.data, from, to), cur.data)) return null;
  const today = localDay();
  return <OrgEconomicsConverted orgId={orgId} cur={cur.data} from={from} to={to} today={today}
    rows={[{ id: wsId, name, data: econ.data, summary: economicsSummary(econ.data, from, to, "last_touch", today) }]} />;
}
