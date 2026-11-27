import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { ContentStudio } from "@/components/content/studio";
import { z } from "zod";
export const Route = createFileRoute("/_authenticated/app/content")({
  validateSearch: (search: Record<string, unknown>) => {
    const campaign = z.guid().safeParse(search["campaign"]);
    const asset = z.guid().safeParse(search["asset"]);
    return {
      ...(campaign.success ? { campaign: campaign.data } : {}),
      ...(asset.success ? { asset: asset.data } : {}),
    };
  },
  head: () => localHead("content"),
  component: ContentPage,
});
function ContentPage() {
  const { asset, campaign } = Route.useSearch();
  return (
    <ContentStudio
      key={`${campaign ?? "all"}/${asset ?? "none"}`}
      initialCampaign={campaign}
      initialAsset={asset}
    />
  );
}
