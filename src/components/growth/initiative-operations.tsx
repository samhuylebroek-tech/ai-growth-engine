import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { growthDb as supabase } from "@/lib/pending-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Operations = {
  owner_id: string | null;
  due_date: string | null;
  success_metric: string;
  baseline_value: number | string | null;
  target_value: number | string | null;
  current_value: number | string | null;
  blocker_note: string;
};
const empty: Operations = {
  owner_id: null,
  due_date: null,
  success_metric: "",
  baseline_value: null,
  target_value: null,
  current_value: null,
  blocker_note: "",
};
const value = (v: number | string | null) => (v == null ? "" : String(v));

export function InitiativeOperations({
  initiativeId,
  orgId,
  workspaceId,
  userId,
  canEdit,
  status,
}: {
  initiativeId: string;
  orgId: string;
  workspaceId: string;
  userId: string;
  canEdit: boolean;
  status: string;
}) {
  const qc = useQueryClient();
  const { t: tr } = useI18n();
  const queryKey = ["growth-initiative-operations", orgId, workspaceId, initiativeId];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await supabase
        .from("growth_initiative_operations")
        .select(
          "owner_id,due_date,success_metric,baseline_value,target_value,current_value,blocker_note",
        )
        .eq("org_id", orgId)
        .eq("workspace_id", workspaceId)
        .eq("initiative_id", initiativeId)
        .maybeSingle();
      if (r.error) throw r.error;
      return r.data as Operations | null;
    },
  });
  const members = useQuery({
    queryKey: ["initiative-assignable-members", workspaceId],
    enabled: canEdit,
    queryFn: async () => {
      const result = await supabase.rpc("execution_workspace_members", { _workspace: workspaceId });
      if (result.error) throw result.error;
      return (result.data ?? [])
        .map((member) => ({ id: member.user_id, name: member.display_name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const [form, setForm] = useState<Operations>(empty);
  const [nextStatus, setNextStatus] = useState(status);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (query.data) setForm({ ...empty, ...query.data });
    setNextStatus(status);
  }, [query.data, status]);
  const save = async () => {
    if (saving || query.isLoading || query.isError) return;
    const numeric = ["baseline_value", "target_value", "current_value"] as const;
    for (const key of numeric) {
      const raw = value(form[key]).trim();
      if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0))
        return void toast.error(tr("goals.op.valuesInvalid"));
    }
    const patch = {
      owner_id: form.owner_id ?? "",
      due_date: form.due_date ?? "",
      success_metric: form.success_metric,
      baseline_value: value(form.baseline_value),
      target_value: value(form.target_value),
      current_value: value(form.current_value),
      blocker_note: form.blocker_note,
      status: nextStatus,
    };
    setSaving(true);
    try {
      const r = await supabase.rpc("update_growth_initiative_operations", {
        _initiative: initiativeId,
        _patch: patch,
      });
      if (r.error) {
        toast.error(tr("goals.op.saveFailed"));
        return;
      }
      toast.success(tr("goals.op.updated"));
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", orgId, workspaceId] });
      await qc.invalidateQueries({ queryKey: ["growth-initiatives", workspaceId] });
      await qc.invalidateQueries({ queryKey: ["execution-growth-initiatives"] });
      await qc.invalidateQueries({ queryKey: ["command-center-approved-initiatives"] });
      await qc.invalidateQueries({ queryKey: ["command-center-initiative-ops"] });
      await qc.invalidateQueries({ queryKey: ["command-center-initiative-operations"] });
    } finally {
      setSaving(false);
    }
  };
  const set = (key: keyof Operations, v: string) =>
    setForm((current) => ({ ...current, [key]: v }));
  const progress =
    form.baseline_value != null && form.target_value != null && form.current_value != null
      ? Number(form.target_value) === Number(form.baseline_value)
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((Number(form.current_value) - Number(form.baseline_value)) /
                  (Number(form.target_value) - Number(form.baseline_value))) *
                  100,
              ),
            ),
          )
      : null;
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">{tr("goals.op.title")}</p>
        {form.blocker_note && <Badge variant="destructive">{tr("goals.op.blocked")}</Badge>}
      </div>
      {query.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {tr("goals.op.loading")}
        </p>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 text-xs text-destructive"
        >
          <span>{tr("goals.op.loadFailed")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
          >
            {tr("goals.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor={initiativeId + "-owner"}>
                {tr("goals.op.owner")}
              </label>
              {canEdit ? (
                <select
                  id={initiativeId + "-owner"}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
                  value={form.owner_id ?? ""}
                  disabled={members.isLoading || members.isError}
                  onChange={(e) => set("owner_id", e.target.value)}
                >
                  <option value="">{tr("officer.plan.unassigned")}</option>
                  {(members.data ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                      {member.id === userId ? tr("goals.op.you") : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs">
                  {form.owner_id === userId
                    ? tr("goals.op.assignedYou")
                    : form.owner_id
                      ? tr("goals.op.assignedMember")
                      : tr("officer.plan.unassigned")}
                </p>
              )}
              {members.isError && canEdit && (
                <p role="alert" className="text-2xs text-destructive">
                  {tr("goals.op.membersFailed")}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor={initiativeId + "-due"}>
                {tr("goals.deadline")}
              </label>
              <Input
                id={initiativeId + "-due"}
                type="date"
                className="h-8"
                value={form.due_date ?? ""}
                disabled={!canEdit}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor={initiativeId + "-metric"}>
                {tr("goals.op.metric")}
              </label>
              <Input
                id={initiativeId + "-metric"}
                className="h-8"
                placeholder={tr("goals.op.metricPh")}
                value={form.success_metric}
                disabled={!canEdit}
                onChange={(e) => set("success_metric", e.target.value)}
              />
            </div>
            {(["baseline_value", "target_value", "current_value"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor={`${initiativeId}-${key}`}>
                  {key === "baseline_value"
                    ? tr("goals.baseline")
                    : key === "target_value"
                      ? tr("goals.target")
                      : tr("goals.op.current")}
                </label>
                <Input
                  id={`${initiativeId}-${key}`}
                  type="number"
                  min={0}
                  className="h-8"
                  value={value(form[key])}
                  disabled={!canEdit}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          {progress != null && (
            <p className="text-xs text-muted-foreground">
              {tr("goals.op.progress", { p: progress })}
            </p>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={initiativeId + "-blocker"}>
              {tr("goals.op.blocker")}
            </label>
            <Input
              id={initiativeId + "-blocker"}
              className="h-8"
              maxLength={1000}
              placeholder={tr("goals.op.blockerPh")}
              value={form.blocker_note}
              disabled={!canEdit}
              onChange={(e) => set("blocker_note", e.target.value)}
            />
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                aria-label={tr("goals.op.status")}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value)}
              >
                {(["planned", "in_progress", "completed", "paused", "cancelled"] as const).map(
                  (s) => (
                    <option key={s} value={s}>
                      {tr(`goals.status.${s}`)}
                    </option>
                  ),
                )}
              </select>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || query.isLoading || query.isError}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? tr("goals.s.saving") : tr("goals.op.save")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
