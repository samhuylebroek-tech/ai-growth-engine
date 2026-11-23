// Shared state for the Organization Command Center tabs: the overview reads, organization records (proposal 0070),
// the caller's rights per business, and the pure intelligence pass. All reads run as the signed-in user.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { growthDb } from "@/lib/pending-schema";
import { buildOrgView } from "@/lib/org/overview";
import { orgIntelligence } from "@/lib/org/intelligence";
import { businessLabels, nameRefs, strategyRefs } from "@/lib/org/strategy";
import { monthStartIso, orgIntelOptions, orgOverviewOptions } from "@/components/org/org-data";
import { Badge } from "@/components/bi/parts";
import { Panel } from "@/components/app/status";

export type Period = "month" | "90d" | "year";
export const tk = (k: string) => k as MessageKey;
export const todayIso = () => new Date().toISOString().slice(0, 10);
export function periodFrom(p: Period): string {
  const d = new Date();
  if (p === "month") return monthStartIso(d);
  if (p === "year") return `${d.getUTCFullYear()}-01-01`;
  return new Date(d.getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
}
export const newKey = () => crypto.randomUUID();

export type BusinessRights = Record<string, { admin: boolean; editor: boolean; member: boolean }>;
/** The caller's own role per business, checked by the same database helper the policies use. */
export function useBusinessRights(ids: readonly string[]) {
  const o = useOrg();
  return useQuery({
    queryKey: ["org-business-rights", o.userId, o.org?.id, [...ids].sort().join(",")],
    enabled: ids.length > 0, staleTime: 60_000,
    queryFn: async () => {
      const out: BusinessRights = {};
      const rpc = growthDb.rpc as unknown as (n: "has_workspace_role", a: { _workspace: string; _min: string }) => PromiseLike<{ data: boolean | null; error: unknown }>;
      await Promise.all(ids.map(async (id) => {
        const [a, e, m] = await Promise.all([rpc.call(growthDb, "has_workspace_role", { _workspace: id, _min: "admin" }), rpc.call(growthDb, "has_workspace_role", { _workspace: id, _min: "editor" }), rpc.call(growthDb, "has_workspace_role", { _workspace: id, _min: "member" })]);
        out[id] = { admin: !!a.data, editor: !!e.data, member: !!m.data };
      }));
      return out;
    },
  });
}

export function useOrgModel(orgId: string, period: Period) {
  const o = useOrg();
  const businesses = o.workspaces;
  const ids = businesses.map((w) => w.id);
  const q = useQuery(orgOverviewOptions(orgId, ids, periodFrom(period)));
  const intel = useQuery(orgIntelOptions(orgId));
  const rights = useBusinessRights(ids);
  const model = useMemo(() => {
    if (!q.data) return null;
    const view = buildOrgView(q.data, businesses, periodFrom(period), todayIso(), monthStartIso());
    const iq = orgIntelligence(q.data, view, businesses, todayIso(), intel.data ?? null, { userCanDecide: (ws) => !!rights.data?.[ws]?.admin });
    return { view, iq };
  }, [q.data, intel.data, rights.data, businesses, period]);
  const name = (id: string) => businesses.find((b) => b.id === id)?.name ?? null;
  return { q, intel, rights, model, businesses, ids, name };
}
export type OrgModel = ReturnType<typeof useOrgModel>;

export function useNames() {
  const o = useOrg(); const { t } = useI18n();
  const labels = useMemo(() => businessLabels(o.workspaces), [o.workspaces]);
  return (id: string) => labels.get(id) ?? t("ogo.otherBusiness");
}
/** Turns B1/B2 references in a stored organization strategy (or an opportunity it produced) into business labels at display time. */
export function useRefNamer() {
  const o = useOrg(); const name = useNames();
  return (body: unknown, businessIds: readonly string[]) => {
    const { refs, reconstructed } = strategyRefs(body, businessIds, o.workspaces);
    const labels = Object.fromEntries(Object.entries(refs).map(([r, id]) => [r, name(id)]));
    return { named: <T,>(v: T) => nameRefs(v, labels), reconstructed };
  };
}
export function useKnown() {
  const { t } = useI18n();
  return (k: string, fallback: string, params?: Record<string, string>) => (k in MESSAGES.en ? t(tk(k), params) : fallback);
}

const EV_TONE: Record<string, string> = { verified: "actual", recorded: "manual", calculated: "manual", estimate: "estimated", assumption: "planned", missing: "low" };
export function EvidenceBadge({ cls }: { cls: string }) {
  const { t } = useI18n();
  return <Badge kind={EV_TONE[cls] ?? "none"}>{t(tk(`ogo.cls.${cls}`))}</Badge>;
}
export function Tile({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return <Panel><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>{note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}</Panel>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
