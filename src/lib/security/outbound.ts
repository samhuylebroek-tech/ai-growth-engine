// Outbound fetch targets (security hardening). Server-side website checks may only contact sites the business has
// registered — its own website or an active competitor — so a signed-in member cannot use the app to probe
// arbitrary hosts. Pure, so the rule is unit tested and identical everywhere.

/** Normalized host of a registered website ("https://www.Example.com/x" or "example.com" -> "example.com"). */
export function registeredHost(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const h = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

/** True when the target's host is a registered host or one of its subdomains. */
export function isRegisteredTarget(target: string, registered: (string | null | undefined)[]): boolean {
  const host = registeredHost(target);
  if (!host) return false;
  return registered.map(registeredHost).some((r) => !!r && (host === r || host.endsWith(`.${r}`)));
}

/** Same-site check for links a fetched page points to (sitemaps, sitemap indexes). */
export function sameSite(url: string, origin: string): boolean {
  try {
    return new URL(url).hostname === new URL(origin).hostname;
  } catch {
    return false;
  }
}
