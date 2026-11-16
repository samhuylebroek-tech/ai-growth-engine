import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validatePublicUrl } from "@/lib/security/url";
import { parsePage, parseRobots, parseSitemap, siteFindings, type SeoPage } from "@/lib/seo-audit";

const MAX_PAGES = 15;
type Fetched = { status: number; url: string; body: string; type: string };

async function fetchPublic(raw: string, accept: string, limit = 800_000): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const v = validatePublicUrl(current); if (!v.ok) throw new Error(v.reason);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(v.url.toString(), { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "AIGrowthEngine-SEO/1.0", accept } });
      if (res.status >= 300 && res.status < 400) { const loc = res.headers.get("location"); if (!loc) throw new Error("Bad redirect"); current = new URL(loc, v.url).toString(); continue; }
      const reader = res.body?.getReader(); let body = "";
      if (reader && res.ok) { const dec = new TextDecoder(); let size = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; body += dec.decode(value, { stream: true }); if (size > limit) { await reader.cancel(); break; } } }
      return { status: res.status, url: v.url.toString(), body, type: res.headers.get("content-type") ?? "" };
    } finally { clearTimeout(t); }
  }
  throw new Error("Too many redirects.");
}

export const runSeoAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), url: z.string().trim().min(4).max(500) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const sb = context.supabase;
    const { data: ws } = await sb.from("workspaces").select("id,org_id").eq("id", data.workspaceId).maybeSingle();
    if (!ws) return { ok: false, error: "Workspace not found." };
    const access = await sb.rpc("has_workspace_role", { _workspace: ws.id, _min: "member" });
    if (access.error || !access.data) return { ok: false, error: "You need member access to run an SEO check." };
    const start = validatePublicUrl(/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`);
    if (!start.ok) return { ok: false, error: start.reason };
    try {
      const home = await fetchPublic(start.url.toString(), "text/html");
      if (home.status >= 400) return { ok: false, error: `The website responded with status ${home.status}.` };
      const origin = new URL(home.url).origin; const host = new URL(home.url).hostname;
      const robotsRes = await fetchPublic(`${origin}/robots.txt`, "text/plain", 100_000).catch(() => null);
      const robotsFound = !!robotsRes && robotsRes.status === 200 && !/html/i.test(robotsRes.type);
      const robots = robotsFound ? parseRobots(robotsRes!.body) : { blocksAll: false, sitemaps: [] };
      let sitemapUrls: string[] = []; let sitemapAt = "";
      for (const sm of [...robots.sitemaps, `${origin}/sitemap.xml`].slice(0, 3)) {
        const r = await fetchPublic(sm, "application/xml", 2_000_000).catch(() => null);
        if (r && r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) {
          let locs = parseSitemap(r.body);
          if (/<sitemapindex/i.test(r.body) && locs[0]) { const child = await fetchPublic(locs[0], "application/xml", 2_000_000).catch(() => null); locs = child && child.status === 200 ? parseSitemap(child.body) : []; }
          sitemapUrls = locs; sitemapAt = sm; break;
        }
      }
      const homePage = parsePage(home.body, home.url, home.status);
      const sameHost = (u: string) => { try { return new URL(u).hostname === host; } catch { return false; } };
      const queue = [...new Set([...sitemapUrls.filter(sameHost), ...homePage.links].map(u => u.replace(/#.*$/, "")))].filter(u => u !== home.url).slice(0, MAX_PAGES - 1);
      const pages: SeoPage[] = [strip(homePage)];
      for (let i = 0; i < queue.length; i += 3) {
        const batch = await Promise.all(queue.slice(i, i + 3).map(async u => {
          try { const r = await fetchPublic(u, "text/html"); if (r.status < 400 && !/html/i.test(r.type)) return null; return strip(parsePage(r.body, u, r.status)); } catch { return null; }
        }));
        pages.push(...batch.filter((p): p is SeoPage => !!p));
      }
      const findings = siteFindings(pages, { found: robotsFound, blocksAll: robots.blocksAll }, { found: !!sitemapAt, urls: sitemapUrls.length }, origin).slice(0, 400);
      const ins = await sb.from("seo_audits").insert({ org_id: ws.org_id, workspace_id: ws.id, site_url: origin, robots: { found: robotsFound, blocksAll: robots.blocksAll, sitemaps: robots.sitemaps }, sitemap: { found: !!sitemapAt, url: sitemapAt, urls: sitemapUrls.length }, pages, findings, page_count: pages.length }).select("id").single();
      if (ins.error) return { ok: false, error: "The check finished but could not be saved." };
      return { ok: true, id: ins.data.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error && /allowed|URL|redirect|domain/i.test(e.message) ? e.message : "The website could not be reached." };
    }
  });

function strip(p: SeoPage & { links?: string[] }): SeoPage { const { links: _l, ...rest } = p; return { ...rest, title: rest.title.slice(0, 300), description: rest.description.slice(0, 400), canonical: rest.canonical.slice(0, 500), h1: rest.h1.map(h => h.slice(0, 200)).slice(0, 5) }; }
