// Parser for the European Central Bank's daily euro foreign exchange reference rates (eurofxref-daily.xml).
// Pure and strict: one publication date, three-letter codes, positive decimal rates; anything else is rejected.
export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_MAX_BYTES = 64_000;
export type EcbDaily = { date: string; rates: { currency: string; rate: string }[] };

/** Validates the currency/rate entries of one publication day. */
function parseDayRates(inner: string): EcbDaily["rates"] {
  const rates: EcbDaily["rates"] = []; const seen = new Set<string>();
  for (const m of inner.matchAll(/<Cube\s+currency=['"]([A-Za-z]+)['"]\s+rate=['"]([^'"]*)['"]\s*\/>/g)) {
    const currency = m[1]!, rate = m[2]!;
    if (!/^[A-Z]{3}$/.test(currency) || currency === "EUR" || seen.has(currency)) throw new Error(`ECB response has an invalid currency: ${currency}`);
    if (!/^\d{1,7}(\.\d{1,8})?$/.test(rate) || !(Number(rate) > 0)) throw new Error(`ECB response has an invalid rate for ${currency}`);
    seen.add(currency); rates.push({ currency, rate });
  }
  if (!rates.length || rates.length > 60) throw new Error("ECB response has no usable rates");
  return rates;
}

export function parseEcbDaily(xml: string): EcbDaily {
  if (xml.length > ECB_MAX_BYTES) throw new Error("ECB response too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("ECB response not accepted");
  const dates = [...xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)].map((m) => m[1]!);
  if (dates.length !== 1) throw new Error("ECB response has no single publication date");
  return { date: dates[0]!, rates: parseDayRates(xml) };
}

// The ECB's last-90-days history (one block per working day; weekends and TARGET holidays have no block).
export const ECB_HIST90_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export const ECB_HIST_MAX_BYTES = 200_000;
export const ECB_HIST_MAX_DAYS = 100;
export function parseEcbHistory(xml: string): EcbDaily[] {
  if (xml.length > ECB_HIST_MAX_BYTES) throw new Error("ECB response too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("ECB response not accepted");
  const days: EcbDaily[] = []; const seen = new Set<string>();
  for (const m of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const date = m[1]!;
    if (seen.has(date)) throw new Error("ECB response repeats a publication date");
    seen.add(date); days.push({ date, rates: parseDayRates(m[2]!) });
  }
  if (!days.length || days.length > ECB_HIST_MAX_DAYS) throw new Error("ECB response has no usable publication days");
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export type EcbFetchResult = { ok: true; daily: EcbDaily } | { ok: false; reason: "unreachable" | "too_large" | "unreadable" | "future_date" };
/**
 * Fetches and validates one ECB publication. Any failure (outage, timeout, oversize, malformed XML, a publication
 * dated in the future) returns a reason and changes nothing; stored rates keep being used and totals that need a
 * missing rate stay withheld. Weekends and TARGET holidays need no handling: the ECB then simply serves its latest
 * working-day publication, which is stored once.
 */
export async function fetchEcbDaily(fetchImpl: typeof fetch, today: string): Promise<EcbFetchResult> {
  let xml: string;
  try {
    const res = await fetchImpl(ECB_DAILY_URL, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    if (Number(res.headers.get("content-length") ?? "0") > ECB_MAX_BYTES) return { ok: false, reason: "too_large" };
    xml = await res.text();
  } catch { return { ok: false, reason: "unreachable" }; }
  let daily: EcbDaily;
  try { daily = parseEcbDaily(xml); } catch { return { ok: false, reason: "unreadable" }; }
  const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (daily.date > tomorrow.toISOString().slice(0, 10)) return { ok: false, reason: "future_date" };
  return { ok: true, daily };
}

export type EcbHistoryResult = { ok: true; days: EcbDaily[] } | { ok: false; reason: "unreachable" | "too_large" | "unreadable" | "future_date" };
/** Fetches and validates the 90-day history; any failure changes nothing (same rules as the daily fetch). */
export async function fetchEcbHistory(fetchImpl: typeof fetch, today: string): Promise<EcbHistoryResult> {
  let xml: string;
  try {
    const res = await fetchImpl(ECB_HIST90_URL, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    if (Number(res.headers.get("content-length") ?? "0") > ECB_HIST_MAX_BYTES) return { ok: false, reason: "too_large" };
    xml = await res.text();
  } catch { return { ok: false, reason: "unreachable" }; }
  if (xml.length > ECB_HIST_MAX_BYTES) return { ok: false, reason: "too_large" };
  let days: EcbDaily[];
  try { days = parseEcbHistory(xml); } catch { return { ok: false, reason: "unreadable" }; }
  const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (days.some((d) => d.date > tomorrow.toISOString().slice(0, 10))) return { ok: false, reason: "future_date" };
  return { ok: true, days };
}
