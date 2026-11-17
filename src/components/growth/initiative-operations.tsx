import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Operations = {
  owner_id: string | null; due_date: string | null; success_metric: string;
  baseline_value: number | string | null; target_value: number | string | null;
  current_value: number | string | null; blocker_note: string;
};
const empty: Operations = { owner_id: null, due_date: null, success_metric: "", baseline_value: null, target_value: null, current_value: null, blocker_note: "" };
const value = (v: number | string | null) => v == null ? "" : String(v);

export function InitiativeOperations({ initiativeId, workspaceId, userId, canEdit, status }: {
  initiativeId: string; workspaceId: string; userId: string; canEdit: boolean; status: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["growth-initiative-operations", workspaceId, initiativeId];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await supabase.from("growth_initiative_operations").select("owner_id,due_date,success_metric,baseline_value,target_value,current_value,blocker_note")
        .eq("workspace_id", workspaceId).eq("initiative_id", initiativeId).maybeSingle();
      if (r.error) throw r.error;
      return r.data as Operations | null;
    },
  });
  const [form, setForm] = useState<Operations>(empty);
  const [nextStatus, setNextStatus] = useState(status);
  useEffect(() => {
    if (query.data) setForm({ ...empty, ...query.data });
    setNextStatus(status);
  }, [query.data, status]);
  const save = async () => {
    const numeric = ["baseline_value", "target_value", "current_value"] as const;
    for (const key of numeric) {
      const raw = value(form[key]).trim();
      if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) return void toast.error("Outcome values must be zero or higher.");
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
    const r = await supabase.rpc("update_growth_initiative_operations", { _initiative: initiativeId, _patch: patch });
    if (r.error) return void toast.error("Initiative update could not be saved.");
    toast.success("Initiative updated");
    await qc.invalidateQueries({ queryKey });
    await qc.invalidateQueries({ queryKey: ["growth-initiatives", workspaceId] });
    await qc.invalidateQueries({ queryKey: ["execution-growth-initiatives"] });
  };
  const set = (key: keyof Operations, v: string) => setForm(current => ({ ...current, [key]: v }));
  const progress = form.baseline_value != null && form.target_value != null && form.current_value != null
    ? Number(form.target_value) === Number(form.baseline_value) ? null
      : Math.max(0, Math.min(100, Math.round((Number(form.current_value) - Number(form.baseline_value)) / (Number(form.target_value) - Number(form.baseline_value)) * 100)))
    : null;
  return <div className="mt-2 space-y-2 rounded-md border bg-background p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">Ownership & outcome</p>
      {form.blocker_note && <Badge variant="destructive">Blocked</Badge>}
    </div>
    {query.isLoading ? <p className="text-xs text-muted-foreground">Loading initiative operations…</p> : <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><label className="text-xs text-muted-foreground">Owner</label><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs">{form.owner_id === userId ? "Assigned to you" : form.owner_id ? "Assigned workspace member" : "Unassigned"}</span>{canEdit && <Button type="button" size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, owner_id: f.owner_id === userId ? null : userId }))}><UserRound className="mr-1 h-3.5 w-3.5" />{form.owner_id === userId ? "Unassign me" : "Assign to me"}</Button>}</div></div>
        <div className="space-y-1"><label className="text-xs text-muted-foreground" htmlFor={initiativeId+"-due"}>Deadline</label><Input id={initiativeId+"-due"} type="date" className="h-8" value={form.due_date ?? ""} disabled={!canEdit} onChange={e => set("due_date",e.target.value)} /></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><label className="text-xs text-muted-foreground">Success metric</label><Input className="h-8" placeholder="e.g. qualified leads / month" value={form.success_metric} disabled={!canEdit} onChange={e => set("success_metric",e.target.value)} /></div>
        {(["baseline_value","target_value","current_value"] as const).map(key => <div key={key} className="space-y-1"><label className="text-xs text-muted-foreground">{key === "baseline_value" ? "Baseline" : key === "target_value" ? "Target" : "Current result"}</label><Input type="number" min={0} className="h-8" value={value(form[key])} disabled={!canEdit} onChange={e => set(key,e.target.value)} /></div>)}
      </div>
      {progress != null && <p className="text-xs text-muted-foreground">Measured progress: {progress}% from baseline to target</p>}
      <div className="space-y-1"><label className="text-xs text-muted-foreground">Blocker / decision needed</label><Input className="h-8" maxLength={1000} placeholder="What is holding this initiative back?" value={form.blocker_note} disabled={!canEdit} onChange={e => set("blocker_note",e.target.value)} /></div>
      {canEdit && <div className="flex flex-wrap items-center justify-between gap-2"><select aria-label="Initiative status" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={nextStatus} onChange={e => setNextStatus(e.target.value)}>{["planned","in_progress","completed","paused","cancelled"].map(s => <option key={s} value={s}>{s.replace("_"," ")}</option>)}</select><Button size="sm" onClick={save}><Save className="mr-1 h-3.5 w-3.5" />Save operations</Button></div>}
    </>}
  </div>;
}
