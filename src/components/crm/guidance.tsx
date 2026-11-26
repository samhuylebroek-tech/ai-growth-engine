import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDraftKey, storeGrowthContext } from "@/lib/growth-draft";

export function CrmGuidance({
  kind,
  id,
  stage,
}: {
  kind: "crm_contacts" | "crm_deals";
  id: string;
  stage?: string;
}) {
  const o = useOrg();
  const { t } = useI18n();
  const navigate = useNavigate();
  const allowed = can(o.workspaceRole, "ai.use");
  const label =
    stage === "won"
      ? "marketing.crm.retention"
      : stage === "lost"
        ? "marketing.crm.reactivation"
        : "marketing.crm.followup";
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-auto min-h-9 whitespace-normal text-left"
      disabled={!allowed}
      onClick={() => {
        if (!allowed || !o.org || !o.workspace) return;
        const question = t(
          stage === "won"
            ? "marketing.crm.retentionPrompt"
            : stage === "lost"
              ? "marketing.crm.reactivationPrompt"
              : "marketing.crm.followupPrompt",
        );
        storeGrowthContext(sessionStorage, o.org.id, o.workspace.id, [{ kind, id }], question);
        sessionStorage.setItem(growthDraftKey(o.org.id, o.workspace.id), question);
        void navigate({ to: "/app/growth-officer" });
      }}
    >
      <Sparkles />
      {t(label)}
    </Button>
  );
}
