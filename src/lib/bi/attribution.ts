// Revenue and attribution, computed from the permanent revenue ledger and recorded touchpoints. Pure.
// Rules: currencies are never added together; estimated entries never count as revenue; refunds, cancellations and
// corrections reduce their own sale; each sale's net amount is split so the credited parts add up to exactly that
// amount (no double counting across campaigns or channels); a sale without usable evidence stays unattributed.
export type RevenueEvent = {
  id: string;
  kind: "sale" | "refund" | "cancellation" | "correction" | string;
  amount: number | string;
  currency: string;
  occurred_at: string;
  data_class: "imported" | "manual" | "estimated" | string;
  source: string;
  source_ref: string;
  customer_ref: string;
  relates_to: string | null;
  unit_id: string | null;
  deal_id?: string | null;
};
export type Touch = {
  id: string;
  revenue_event_id: string;
  campaign_id: string | null;
  initiative_id: string | null;
  channel: string;
  touched_at: string;
  evidence: "verified_link" | "tracked" | "manual" | string;
  retracted_at: string | null;
};
export type Model =
  "first_touch" | "last_touch" | "linear" | "time_decay" | "position_based" | "direct";
export const MODELS: Model[] = [
  "last_touch",
  "first_touch",
  "linear",
  "time_decay",
  "position_based",
  "direct",
];
export type Confidence = "high" | "medium" | "low";

export type NetSale = {
  sale: RevenueEvent;
  net: number;
  refunded: number;
  cancelled: number;
  corrected: number;
};
const cents = (v: number | string) => Math.round(Number(v) * 100);

/** Net amount of every sale after its own refunds, cancellations and corrections. */
export function netSales(events: readonly RevenueEvent[]): NetSale[] {
  const byRelates = new Map<string, RevenueEvent[]>();
  for (const e of events)
    if (e.relates_to) byRelates.set(e.relates_to, [...(byRelates.get(e.relates_to) ?? []), e]);
  return events
    .filter((e) => e.kind === "sale")
    .map((sale) => {
      let refunded = 0,
        cancelled = 0,
        corrected = 0;
      for (const r of byRelates.get(sale.id) ?? []) {
        const c = cents(r.amount);
        if (r.kind === "refund") refunded += c;
        else if (r.kind === "cancellation") cancelled += c;
        else corrected += c;
      }
      const net = cents(sale.amount) + refunded + cancelled + corrected;
      return {
        sale,
        net: Math.max(0, net) / 100,
        refunded: refunded / 100,
        cancelled: cancelled / 100,
        corrected: corrected / 100,
      };
    });
}

export type CurrencyTotals = {
  currency: string;
  gross: number;
  refunds: number;
  net: number;
  imported: number;
  manual: number;
  estimated: number;
  sales: number;
};
const inPeriod = (iso: string, from?: string, to?: string) =>
  (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);

/** Totals per currency for sales that happened in the period. Estimated is reported separately, never inside net. */
export function revenueTotals(
  events: readonly RevenueEvent[],
  from?: string,
  to?: string,
): CurrencyTotals[] {
  const out = new Map<string, CurrencyTotals>();
  for (const n of netSales(events)) {
    if (!inPeriod(n.sale.occurred_at, from, to)) continue;
    const t = out.get(n.sale.currency) ?? {
      currency: n.sale.currency,
      gross: 0,
      refunds: 0,
      net: 0,
      imported: 0,
      manual: 0,
      estimated: 0,
      sales: 0,
    };
    if (n.sale.data_class === "estimated") t.estimated = round(t.estimated + n.net);
    else {
      t.gross = round(t.gross + Number(n.sale.amount));
      t.refunds = round(t.refunds + n.refunded + n.cancelled + n.corrected);
      t.net = round(t.net + n.net);
      t.sales += 1;
      if (n.sale.data_class === "imported") t.imported = round(t.imported + n.net);
      else t.manual = round(t.manual + n.net);
    }
    out.set(t.currency, t);
  }
  return [...out.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
const round = (v: number) => Math.round(v * 100) / 100;

export const targetKey = (t: Pick<Touch, "campaign_id" | "initiative_id" | "channel">) =>
  t.campaign_id
    ? `campaign:${t.campaign_id}`
    : t.initiative_id
      ? `initiative:${t.initiative_id}`
      : `channel:${t.channel.trim().toLowerCase()}`;
const CONF: Record<string, Confidence> = {
  verified_link: "high",
  tracked: "medium",
  manual: "low",
};
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Weights per touch for a model; touches are sorted oldest first. Empty when the model cannot use these touches. */
export function weights(
  model: Model,
  touches: readonly Touch[],
  saleAt: string,
  halfLifeDays = 7,
): number[] {
  const n = touches.length;
  if (!n) return [];
  if (model === "direct") {
    const v: number[] = touches.map((t) => (t.evidence === "verified_link" ? 1 : 0));
    const s = v.reduce((a, b) => a + b, 0);
    return s ? v.map((x) => x / s) : [];
  }
  if (model === "first_touch") return touches.map((_, i) => (i === 0 ? 1 : 0));
  if (model === "last_touch") return touches.map((_, i) => (i === n - 1 ? 1 : 0));
  if (model === "linear") return touches.map(() => 1 / n);
  if (model === "time_decay") {
    const end = new Date(saleAt).getTime();
    const raw = touches.map((t) =>
      Math.pow(
        0.5,
        Math.max(0, end - new Date(t.touched_at).getTime()) / 86_400_000 / halfLifeDays,
      ),
    );
    const s = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => x / s);
  }
  // position based: 40% first, 40% last, 20% shared by the middle
  if (n === 1) return [1];
  if (n === 2) return [0.5, 0.5];
  return touches.map((_, i) => (i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2)));
}

export type Credit = {
  key: string;
  amount: number;
  sales: number;
  confidence: Confidence;
  evidence: Record<string, number>;
};
export type Attribution = {
  model: Model;
  currency: string;
  total: number;
  attributed: number;
  unattributed: number;
  unattributedSales: number;
  credits: Credit[];
  estimatedExcluded: number;
};

/** Splits each actual sale's net amount over its touches with the chosen model, in cents, so nothing is counted twice. */
export function attribute(
  events: readonly RevenueEvent[],
  touches: readonly Touch[],
  model: Model,
  from?: string,
  to?: string,
  by: "target" | "channel" = "target",
): Attribution[] {
  const bySale = new Map<string, Touch[]>();
  for (const t of touches)
    if (!t.retracted_at)
      bySale.set(t.revenue_event_id, [...(bySale.get(t.revenue_event_id) ?? []), t]);
  const out = new Map<string, { a: Attribution; credits: Map<string, Credit> }>();
  for (const n of netSales(events)) {
    if (!inPeriod(n.sale.occurred_at, from, to)) continue;
    const cur = n.sale.currency;
    const slot = out.get(cur) ?? {
      a: {
        model,
        currency: cur,
        total: 0,
        attributed: 0,
        unattributed: 0,
        unattributedSales: 0,
        credits: [],
        estimatedExcluded: 0,
      },
      credits: new Map(),
    };
    out.set(cur, slot);
    if (n.sale.data_class === "estimated") {
      slot.a.estimatedExcluded = round(slot.a.estimatedExcluded + n.net);
      continue;
    }
    const netC = Math.round(n.net * 100);
    slot.a.total = round(slot.a.total + n.net);
    if (netC <= 0) continue;
    const ts = (bySale.get(n.sale.id) ?? [])
      .filter((t) => t.touched_at <= n.sale.occurred_at)
      .sort((a, b) => a.touched_at.localeCompare(b.touched_at));
    const w = weights(model, ts, n.sale.occurred_at);
    if (!w.length || w.every((x) => x === 0)) {
      slot.a.unattributed = round(slot.a.unattributed + n.net);
      slot.a.unattributedSales += 1;
      continue;
    }
    // Largest-remainder rounding in cents: the parts always add up to the sale's net amount exactly.
    const exact = w.map((x) => x * netC);
    const parts = exact.map(Math.floor);
    let rest = netC - parts.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      if (rest <= 0) break;
      if (w[i]! > 0) {
        parts[i]! += 1;
        rest -= 1;
      }
    }
    const seen = new Set<string>();
    ts.forEach((t, i) => {
      const part = parts[i]!;
      if (part <= 0) return;
      const key =
        by === "channel" ? `channel:${t.channel.trim().toLowerCase() || "unknown"}` : targetKey(t);
      const c: Credit = slot.credits.get(key) ?? {
        key,
        amount: 0,
        sales: 0,
        confidence: "high",
        evidence: {},
      };
      c.amount = round(c.amount + part / 100);
      if (!seen.has(key)) {
        c.sales += 1;
        seen.add(key);
      }
      const conf: Confidence = CONF[t.evidence] ?? "low";
      if (CONF_RANK[conf] < CONF_RANK[c.confidence]) c.confidence = conf;
      c.evidence[t.evidence] = (c.evidence[t.evidence] ?? 0) + 1;
      slot.credits.set(key, c);
    });
    slot.a.attributed = round(slot.a.attributed + n.net);
  }
  return [...out.values()]
    .map(({ a, credits }) => ({
      ...a,
      credits: [...credits.values()].sort((x, y) => y.amount - x.amount),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Data quality of an attribution: share of revenue backed by verified links, tracked visits or manual notes. */
export function attributionQuality(a: Attribution): Confidence | "none" {
  if (!a.attributed) return "none";
  const all = a.credits.map((c) => c.confidence);
  if (all.every((c) => c === "high")) return "high";
  if (all.some((c) => c === "low")) return "low";
  return "medium";
}
