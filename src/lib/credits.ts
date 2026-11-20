// AI credit economy. 1 credit = a fixed slice of provider cost; we charge a flat
// minimum per call plus token-based usage so cheap calls still cover overhead.
export const CREDIT_RULES = {
  minPerCall: 1,
  /** credits per 1,000 total tokens (input + output) */
  per1kTokens: 1,
  /** max credits one call may cost (protects against runaway responses) */
  maxPerCall: 50,
  /** credits reserved before a Growth Officer call; settled against actual tokens */
  reserveGrowthOfficer: 3,
  /** credits reserved before an Organization Growth Officer call (several businesses' context); settled against actual tokens */
  reserveOrganization: 12,
};

export function creditsForTokens(inputTokens: number, outputTokens: number): number {
  const total = Math.max(0, inputTokens) + Math.max(0, outputTokens);
  const c = Math.ceil(total / 1000) * CREDIT_RULES.per1kTokens;
  return Math.min(CREDIT_RULES.maxPerCall, Math.max(CREDIT_RULES.minPerCall, c));
}

/** Estimated provider cost in EUR. Rates are list rates used for margin reporting only. */
export const MODEL_RATES_EUR_PER_TOKEN: Record<string, { input: number; output: number }> = {
  "openai/gpt-6-astra": { input: 0.000005, output: 0.00003 },
};

export function estimateCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const r = MODEL_RATES_EUR_PER_TOKEN[model] ?? { input: 0.00001, output: 0.00004 };
  return +(inputTokens * r.input + outputTokens * r.output).toFixed(6);
}

/** Entitlement check: null limit = unlimited, undefined = feature not in plan. */
export function withinLimit(limit: number | null | undefined, used: number): boolean {
  if (limit === undefined) return false;
  if (limit === null) return true;
  return used < limit;
}
