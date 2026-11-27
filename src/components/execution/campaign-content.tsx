import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FilePlus } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { collectPages } from "@/lib/pagination";
import { contentReviewState } from "@/lib/content-review-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** Shows the same content records and exact version decisions as Content Studio, never copied drafts. */
export function CampaignContent({ campaignId }: { campaignId: string }) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const q = useQuery({
    queryKey: ["campaign-content", o.org?.id, o.workspace?.id, campaignId],
    enabled: !!o.org && !!o.workspace,
    queryFn: async () => {
      const orgId = o.org?.id,
        wsId = o.workspace?.id;
      if (!orgId || !wsId) throw new Error("content_scope_missing");
      const watermark = new Date().toISOString();
      const assets = await collectPages(async (cursor, size) => {
        let query = supabase
          .from("content_assets")
          .select("id,title,channel,planned_date,draft_body")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("campaign_id", campaignId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) query = query.gt("id", cursor);
        return await query;
      });
      const result = [];
      // Bounded concurrency; one latest version per asset, not a truncated version history.
      for (const asset of assets) {
        const version = await supabase
          .from("content_versions")
          .select("id,version_no,body,title")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("asset_id", asset.id)
          .order("version_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (version.error) throw version.error;
        const decision = version.data
          ? await supabase
              .from("content_version_decisions")
              .select("decision")
              .eq("org_id", orgId)
              .eq("workspace_id", wsId)
              .eq("version_id", version.data.id)
              .maybeSingle()
          : null;
        if (decision?.error) throw decision.error;
        result.push({
          ...asset,
          version: version.data,
          reviewState: contentReviewState(asset, version.data, decision?.data?.decision),
        });
      }
      return result;
    },
  });
  return (
    <section className="space-y-3 border-b border-border pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("ph.content.title")}</h3>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/content" search={{ campaign: campaignId }}>
            <FilePlus />
            {t("marketing.care.openStudio")}
          </Link>
        </Button>
      </div>
      {q.isError ? (
        <div role="alert">
          <p className="text-sm text-destructive">{t("marketing.cs.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("lead.retry")}
          </Button>
        </div>
      ) : !q.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("marketing.cs.loading")}
        </p>
      ) : !q.data.length ? (
        <p className="text-sm text-muted-foreground">{t("marketing.care.noCampaignContent")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((asset) => (
            <li key={asset.id} className="flex flex-wrap items-center gap-3 py-3">
              <Link
                to="/app/content"
                search={{ campaign: campaignId, asset: asset.id }}
                className="inline-flex min-h-9 min-w-0 items-center break-words text-sm text-primary underline underline-offset-4"
              >
                {asset.title}
              </Link>
              <Badge variant="outline">
                {asset.reviewState === "draft"
                  ? t("marketing.cs.draftSaved")
                  : asset.reviewState === "approved"
                    ? t("marketing.cs.dec.approved")
                    : asset.reviewState === "rejected"
                      ? t("marketing.cs.dec.rejected")
                      : t("marketing.cs.awaiting")}
              </Badge>
              {asset.version && (
                <span className="text-xs text-muted-foreground">v{asset.version.version_no}</span>
              )}
              {asset.planned_date && (
                <span className="text-xs text-muted-foreground">
                  {new Date(`${asset.planned_date}T12:00:00`).toLocaleDateString(tag)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("work.draftNotPublished")}</p>
    </section>
  );
}
