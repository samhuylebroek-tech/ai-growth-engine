import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validatePublicUrl } from "@/lib/security/url";
import { fetchPublic } from "@/lib/seo.functions";
import { changeObservations, pageObservations, pickPages, readCompetitorPage, type CompetitorPage } from "@/lib/competitor-intel";

export const checkCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ competitorId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; added: number; changes: number } | { ok: false; error: string }> => {
    const sb = context.supabase;
    const c = await sb.from("competitors").select("id,org_id,workspace_id,website,status").eq("id", data.competitorId).maybeSingle();
    if (c.error || !c.data) return { ok: false, error: "Competitor not found." };
    if (c.data.status !== "active") return { ok: false, error: "This competitor is archived." };
    const access = await sb.rpc("has_workspace_role", { _workspace: c.data.workspace_id, _min: "member" });
    if (access.error || !access.data) return { ok: false, error: "You need member access to check a competitor." };
    if (!c.data.website) return { ok: false, error: "Add the competitor's website first." };
    const start = validatePublicUrl(/^https?:\/\//i.test(c.data.website) ? c.data.website : `https://${c.data.website}`);
    if (!start.ok) return { ok: false, error: start.reason };
    try {
      const home = await fetchPublic(start.url.toString(), "text/html");
      if (home.status >= 400) return { ok: false, error: `The website responded with status ${home.status}.` };
      const first = readCompetitorPage(home.body, home.url);
      const pages: CompetitorPage[] = [strip(first)];
      for (const u of pickPages(first.links, home.url)) {
        try { const r = await fetchPublic(u, "text/html"); if (r.status < 400 && /html/i.test(r.type)) pages.push(strip(readCompetitorPage(r.body, u))); } catch { /* skip unreachable page */ }
      }
      const prev = await sb.from("competitor_snapshots").select("pages").eq("competitor_id", c.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const snap = await sb.from("competitor_snapshots").insert({ org_id: c.data.org_id, workspace_id: c.data.workspace_id, competitor_id: c.data.id, site_url: new URL(home.url).origin, pages }).select("id,created_at").single();
      if (snap.error) return { ok: false, error: "The check finished but could not be saved." };
      const changes = prev.data ? changeObservations(prev.data.pages as CompetitorPage[], pages) : [];
      const facts = prev.data ? changes : pages.flatMap(pageObservations);
      if (facts.length) {
        const ins = await sb.from("competitor_observations").insert(facts.slice(0, 60).map(f => ({ ...f, org_id: c.data!.org_id, workspace_id: c.data!.workspace_id, competitor_id: c.data!.id, snapshot_id: snap.data.id, observed_at: snap.data.created_at })));
        if (ins.error) return { ok: false, error: "Page snapshot saved, but observations could not be saved." };
      }
      return { ok: true, added: facts.length, changes: changes.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error && /allowed|URL|redirect|domain/i.test(e.message) ? e.message : "The website could not be reached." };
    }
  });

function strip(p: CompetitorPage & { links?: string[] }): CompetitorPage { const { links: _l, ...rest } = p; return rest; }
