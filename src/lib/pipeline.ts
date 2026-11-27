export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};
type Deal = { stage: string; value: number | string };
/** Summary of entered deals only; no forecast probabilities are invented. */
export function pipelineSummary(deals: Deal[]) {
  let open = 0,
    won = 0,
    wonCount = 0,
    lostCount = 0,
    openCount = 0;
  for (const d of deals) {
    const v = Number(d.value) || 0;
    if (d.stage === "won") {
      won += v;
      wonCount++;
    } else if (d.stage === "lost") lostCount++;
    else {
      open += v;
      openCount++;
    }
  }
  const closed = wonCount + lostCount;
  return {
    open,
    openCount,
    won,
    wonCount,
    lostCount,
    winRate: closed === 0 ? null : Math.round((wonCount / closed) * 100),
  };
}
export function nextStage(stage: string): Stage | null {
  const i = STAGES.indexOf(stage as Stage);
  return i >= 0 && i < 3 ? (STAGES[i + 1] ?? null) : null;
}

export function pipelineMatches(fields: readonly (string | null)[], term: string) {
  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const query = normalize(term.trim().slice(0, 100));
  return !query || fields.some((field) => field !== null && normalize(field).includes(query));
}

/** Monetary totals have one currency each; no implicit EUR conversion. */
export function pipelineCurrencies(deals: readonly (Deal & { currency: string })[]) {
  const grouped = new Map<string, Deal[]>();
  for (const deal of deals) {
    const currency = deal.currency.trim().toUpperCase();
    const entries = grouped.get(currency) ?? [];
    entries.push(deal);
    grouped.set(currency, entries);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, rows]) => ({
      currency,
      ...pipelineSummary(rows),
    }));
}
