// Rate limits (proposal 0090). The database enforces them: AI runs and uploads by triggers, website checks and
// data-source connections through consume_rate_limit() before anything is fetched. A refusal reads
// "rate_limited:<action>:<scope>:<seconds>"; this module turns it into a plain sentence in the user's language.
export type LimitAction = "ai" | "upload" | "seo" | "connect";
export type LimitScope = "user" | "workspace" | "organization" | "failures";
export type RateLimit = { action: LimitAction; scope: LimitScope; retryAfter: number };
type T = (key: string, vars?: Record<string, string | number>) => string;

const RE = /rate_limited:(ai|upload|seo|connect):(user|workspace|organization|failures):(\d+)/;

export function parseRateLimit(message: string | null | undefined): RateLimit | null {
  const m = message ? RE.exec(message) : null;
  return m ? { action: m[1] as LimitAction, scope: m[2] as LimitScope, retryAfter: Number(m[3]) } : null;
}

/** Waiting time rounded up to whole minutes (never shorter than the real wait). */
export function waitText(seconds: number, t: T): string {
  if (seconds < 60) return t("lim.wait.seconds");
  const min = Math.ceil(seconds / 60);
  if (min === 1) return t("lim.wait.minute");
  if (min < 120) return t("lim.wait.minutes", { n: min });
  return t("lim.wait.hours", { n: Math.ceil(min / 60) });
}

export function rateLimitText(r: RateLimit, t: T): string {
  const text = t(`lim.${r.scope}`, { what: t(`lim.what.${r.action}`), wait: waitText(r.retryAfter, t) });
  return r.action === "ai" ? `${text} ${t("lim.noCredits")}` : text;
}

/** A database error message, with a rate-limit refusal replaced by its plain sentence. */
export function limitAware(message: string, t: T): string {
  const r = parseRateLimit(message);
  return r ? rateLimitText(r, t) : message;
}
