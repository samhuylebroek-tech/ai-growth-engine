// Credit pricing (pure). A credit has no money value by itself: a cost exists only when a credit price version is
// set. The price that applies is the latest version that was effective when the credits were used (a plan price
// before the platform price); new versions never change older costs. Credits without an applicable price stay
// "unpriced" and are never converted at an assumed rate.
export type PriceVersion = { scope: "platform" | "plan" | string; plan_key: string | null; currency: string; price_per_credit: number | string; effective_from: string };
export type CreditUse = { credits: number; at: string };

export function priceAt(versions: readonly PriceVersion[], planKey: string | null, currency: string, at: string): PriceVersion | null {
  const ok = versions.filter((v) => v.currency === currency && v.effective_from <= at).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return (planKey ? ok.find((v) => v.scope === "plan" && v.plan_key === planKey) : undefined) ?? ok.find((v) => v.scope === "platform") ?? null;
}

export function creditCost(uses: readonly CreditUse[], versions: readonly PriceVersion[], planKey: string | null, currency: string) {
  let amount = 0, priced = 0, unpriced = 0;
  const used = new Set<string>();
  for (const u of uses) {
    if (u.credits <= 0) continue;
    const v = priceAt(versions, planKey, currency, u.at);
    if (!v) { unpriced += u.credits; continue; }
    amount += u.credits * Number(v.price_per_credit); priced += u.credits; used.add(`${v.scope}:${v.plan_key ?? ""}:${v.effective_from}`);
  }
  return { currency, amount: Math.round(amount * 100) / 100, priced, unpriced, versions: used.size };
}
