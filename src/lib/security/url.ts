// SSRF guard for user-supplied URLs (website analysis). Only public http(s) hosts.
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function validatePublicUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: "Not a valid URL" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http and https are allowed" };
  if (url.username || url.password) return { ok: false, reason: "Credentials in URLs are not allowed" };
  if (url.port && !["80", "443"].includes(url.port)) return { ok: false, reason: "Non-standard ports are not allowed" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "Private hosts are not allowed" };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((r) => r.test(host))) return { ok: false, reason: "Private IP ranges are not allowed" };
  if (host.includes(":")) return { ok: false, reason: "IP literal hosts are not allowed" };
  if (/^\d+$/.test(host)) return { ok: false, reason: "Numeric hosts are not allowed" };
  if (!host.includes(".")) return { ok: false, reason: "Host must be a public domain" };
  return { ok: true, url };
}
