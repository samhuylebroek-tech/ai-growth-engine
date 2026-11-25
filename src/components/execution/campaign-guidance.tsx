import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDraftKey, storeGrowthContext } from "@/lib/growth-draft";

/** This button prepares a question with explicit selected records, never dispatches inference. */
export function CampaignGuidance({ campaignId }: { campaignId?: string }) {
  const o = useOrg();
  const { t } = useI18n();
  const navigate = useNavigate();
  const allowed = can(o.workspaceRole, "ai.use");
  function open() {
    if (!allowed || !o.org || !o.workspace) return;
    const refs = campaignId ? [{ kind: "campaigns" as const, id: campaignId }] : [];
    const question = t(campaignId ? "ch.guide.campaignPrompt" : "ch.guide.overviewPrompt");
    storeGrowthContext(sessionStorage, o.org.id, o.workspace.id, refs, question);
    sessionStorage.setItem(growthDraftKey(o.org.id, o.workspace.id), question);
    void navigate({ to: "/app/growth-officer" });
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-11 whitespace-normal text-left"
        disabled={!allowed}
        onClick={open}
      >
        <Sparkles />
        {t(campaignId ? "ch.guide.campaign" : "ch.guide.overview")}
      </Button>
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {t(allowed ? "ch.guide.cost" : "ch.guide.denied")}
      </p>
    </div>
  );
}
