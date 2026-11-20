import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { hubOptions } from "./hub-data";

/** Review & approvals: external actions are decided on their own screen, where their full lifecycle is visible. */
export function ExternalApprovalsNotice() {
  const { org, workspace } = useOrg(); const { t } = useI18n();
  const q = useQuery(hubOptions(org?.id, workspace?.id));
  const n = q.data?.actions.filter((a) => a.stage === "in_review").length ?? 0;
  if (!n) return null;
  return <div role="status" className="mb-6 flex flex-wrap items-center gap-3 border-l-2 border-warning pl-4 text-sm">
    {t("xa.approvalsNotice", { n })}
    <Link to="/app/actions" className="inline-flex items-center gap-1 text-primary hover:underline">{t("xa.openActions")}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
  </div>;
}
