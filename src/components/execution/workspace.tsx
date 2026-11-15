import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  format,
} from "date-fns";
import {
  Plus,
  Search,
  List,
  Columns3,
  CalendarDays,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Trash2,
  Repeat,
  Sparkles,
  X,
  FolderKanban,
  Megaphone,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { growthDraftKey } from "@/lib/growth-draft";
import { useNavigate as useWorkNavigate } from "@tanstack/react-router";
import {
  executionOptions,
  executionSummary,
  STATUSES,
  PRIORITIES,
  localDay,
  taskProgress,
  type WorkKind,
  type WorkItem,
  type Note,
} from "@/lib/execution";

const label = (s: string) => s.replace(/_/g, " ");
const due = (item: WorkItem) => ("due_date" in item ? item.due_date : item.end_date);
const inputClass = "min-w-0 rounded-md border border-border bg-background px-2 py-2 text-xs";

export function ExecutionWorkspace({
  kind,
  itemId,
}: {
  kind: WorkKind;
  itemId?: string | undefined;
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const [search, setSearch] = useState("");
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState(kind === "tasks" ? "mine" : "all");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [newParent, setNewParent] = useState<{
    project_id?: string;
    campaign_id?: string;
    parent_task_id?: string;
  }>({});
  const editable = can(o.workspaceRole, "profile.edit");
  const items = q.data?.[kind] ?? [];
  const deep = items.find((x) => x.id === itemId);
  const active = selected ? (items.find((x) => x.id === selected.id) ?? selected) : deep;
  const assignees = new Set(
    q.data?.notes
      .filter((n) => n.kind === "member" && n.user_id === o.userId)
      .map((n) => n.entity_id),
  );
  const today = localDay();
  const filtered = items.filter(
    (x) =>
      `${x.title} ${x.description} ${"labels" in x ? x.labels.join(" ") : ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" || x.status === status) &&
      (priority === "all" || x.priority === priority) &&
      (filter === "all" ||
        (filter === "team" && (x.owner_id !== null || assignees.has(x.id))) ||
        (filter === "mine" && (x.owner_id === o.userId || assignees.has(x.id))) ||
        (filter === "today" && due(x) === today) ||
        (filter === "upcoming" && !!due(x) && String(due(x)) > today) ||
        (filter === "overdue" &&
          !!due(x) &&
          String(due(x)) < today &&
          !["done", "cancelled", "completed", "archived"].includes(x.status))),
  );
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["execution"] });
  }
  async function updateStatus(x: WorkItem, value: string) {
    try {
      const r = await supabase
        .from(kind)
        .update({ status: value })
        .eq("id", x.id)
        .eq("org_id", o.org?.id ?? "")
        .eq("workspace_id", o.workspace?.id ?? "");
      if (r.error) throw r.error;
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status could not change");
    }
  }
  function close() {
    setSelected(null);
    if (itemId) {
      if (kind === "projects")
        navigate({ to: "/app/projects", search: { item: undefined }, replace: true });
      if (kind === "tasks")
        navigate({ to: "/app/tasks", search: { item: undefined }, replace: true });
      if (kind === "campaigns")
        navigate({ to: "/app/campaigns", search: { item: undefined }, replace: true });
    }
  }
  const open = (x: WorkItem) => {
    setSelected(x);
  };
  const name = (id: string | null) =>
    q.data?.members.find((m) => m.user_id === id)?.display_name ??
    (id ? "Assigned teammate" : "Unassigned");
  const dates = [];
  for (
    let d = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    d <= endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    d = addDays(d, 1)
  )
    dates.push(d);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label mb-2">Execution / {o.workspace?.name}</p>
          <h1 className="text-2xl font-semibold capitalize">{kind}</h1>
        </div>
        {editable && (
          <Button
            onClick={() => {
              setNewParent({});
              setCreate(true);
            }}
            size="sm"
          >
            <Plus />
            New {kind.slice(0, -1)}
          </Button>
        )}
      </div>
      <div className="mb-5 flex flex-wrap gap-1">
        {(kind === "tasks"
          ? ["mine", "team", "all", "today", "upcoming", "overdue"]
          : ["all", "today", "upcoming", "overdue"]
        ).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f === "mine"
              ? "My tasks"
              : f === "team"
                ? "Team tasks"
                : f === "all"
                  ? "All " + kind
                  : label(f)}
          </Button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-36 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label={`Search ${kind}`}
            placeholder={`Search ${kind}…`}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Work status"
          className={inputClass}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUSES[kind].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          aria-label="Work priority"
          className={inputClass}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="flex">
          {[
            { id: "list", icon: List },
            { id: "kanban", icon: Columns3 },
            { id: "calendar", icon: CalendarDays },
            { id: "timeline", icon: ArrowUpRight },
          ].map((v) => (
            <Button
              variant={view === v.id ? "secondary" : "ghost"}
              size="icon"
              key={v.id}
              title={label(v.id)}
              aria-label={`${label(v.id)} view`}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              <v.icon />
            </Button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <p role="status">Loading work…</p>
      ) : q.isError ? (
        <div role="alert" className="text-sm text-destructive">
          Work could not load.
          <Button variant="link" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {view === "list" && (
            <div className="divide-y divide-border border-y border-border">
              {filtered.map((x) => (
                <div key={x.id} className="flex min-w-0 flex-wrap items-center gap-3 py-4">
                  {kind === "tasks" && editable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={`Complete ${x.title}`}
                      disabled={x.status === "done"}
                      onClick={() => updateStatus(x, "done")}
                    >
                      <Check
                        className={cn(
                          x.status === "done" ? "text-success" : "text-muted-foreground",
                        )}
                      />
                    </Button>
                  )}
                  <div className="min-w-0 flex-1">
                    <Button
                      variant="link"
                      className="h-auto whitespace-normal p-0 text-left text-sm text-foreground"
                      onClick={() => open(x)}
                    >
                      {x.title}
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {name(x.owner_id)} · {x.priority}
                      {due(x) && ` · ${due(x)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs capitalize",
                      due(x) &&
                        String(due(x)) < today &&
                        !["done", "completed", "cancelled"].includes(x.status)
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {label(x.status)}
                  </span>
                  {kind !== "tasks" && (
                    <span className="text-xs text-muted-foreground">
                      {taskProgress(
                        q.data?.tasks.filter((t) =>
                          kind === "projects" ? t.project_id === x.id : t.campaign_id === x.id,
                        ) ?? [],
                      )}
                      %
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Open ${x.title}`}
                    onClick={() => open(x)}
                  >
                    <ArrowUpRight />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {view === "kanban" && (
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {STATUSES[kind].map((s) => (
                <section key={s} className="min-w-0 border-t-2 border-border pt-3">
                  <h2 className="mb-4 flex justify-between text-xs font-semibold capitalize">
                    {label(s)}
                    <span className="text-muted-foreground">
                      {filtered.filter((x) => x.status === s).length}
                    </span>
                  </h2>
                  <div className="space-y-3">
                    {filtered
                      .filter((x) => x.status === s)
                      .map((x) => (
                        <article key={x.id} className="rounded-lg border border-border bg-card p-3">
                          <Button
                            variant="link"
                            className="h-auto whitespace-normal p-0 text-left text-sm text-foreground"
                            onClick={() => open(x)}
                          >
                            {x.title}
                          </Button>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {name(x.owner_id)} · {x.priority}
                          </p>
                          {due(x) && (
                            <p className="mt-2 text-xs text-muted-foreground">Due {due(x)}</p>
                          )}
                          {editable && (
                            <select
                              className={`${inputClass} mt-3 w-full`}
                              aria-label={`Status for ${x.title}`}
                              value={x.status}
                              onChange={(e) => updateStatus(x, e.target.value)}
                            >
                              {STATUSES[kind].map((v) => (
                                <option key={v} value={v}>
                                  {label(v)}
                                </option>
                              ))}
                            </select>
                          )}
                        </article>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {view === "calendar" && (
            <>
              <div className="mb-4 flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous month"
                  onClick={() => setMonth(addMonths(month, -1))}
                >
                  <ChevronLeft />
                </Button>
                <h2 className="text-sm font-semibold">{format(month, "MMMM yyyy")}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next month"
                  onClick={() => setMonth(addMonths(month, 1))}
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className="grid grid-cols-7 border-l border-t border-border">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div
                    key={d}
                    className="border-b border-r border-border py-2 text-center text-[10px] text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
                {dates.map((d) => (
                  <div
                    key={d.toISOString()}
                    className={cn(
                      "min-h-24 min-w-0 border-b border-r border-border p-1 sm:p-2",
                      d.getMonth() !== month.getMonth() && "bg-secondary/40",
                    )}
                  >
                    <p
                      className={cn(
                        "mb-2 text-xs",
                        format(d, "yyyy-MM-dd") === today && "font-bold text-primary",
                      )}
                    >
                      {d.getDate()}
                    </p>
                    {filtered
                      .filter((x) => due(x) === format(d, "yyyy-MM-dd"))
                      .map((x) => (
                        <Button
                          variant="ghost"
                          key={x.id}
                          className="mb-1 h-auto w-full justify-start whitespace-normal break-words p-1 text-left text-[10px] leading-tight"
                          onClick={() => open(x)}
                        >
                          {x.title}
                        </Button>
                      ))}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {filtered.filter((x) => !due(x)).length} items have no deadline.
              </p>
            </>
          )}
          {view === "timeline" && (
            <div className="divide-y divide-border">
              {[...filtered]
                .sort((a, b) =>
                  (a.start_date ?? due(a) ?? "9999").localeCompare(
                    b.start_date ?? due(b) ?? "9999",
                  ),
                )
                .map((x) => (
                  <div
                    key={x.id}
                    className="grid gap-2 border-l-2 border-primary py-4 pl-4 sm:grid-cols-[180px_1fr]"
                  >
                    <p className="text-xs text-muted-foreground">
                      {x.start_date ?? "No start date"} → {due(x) ?? "No deadline"}
                    </p>
                    <Button
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left text-sm"
                      onClick={() => open(x)}
                    >
                      {x.title}
                    </Button>
                  </div>
                ))}
            </div>
          )}
          {!filtered.length && (
            <div className="py-12 text-center">
              <p className="text-sm font-medium">
                {items.length ? "No matching work" : `No ${kind} yet`}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {items.length
                  ? "Try another filter."
                  : "Create your first item or review a Growth Officer recommendation."}
              </p>
              {items.length > 0 && (
                <Button
                  variant="link"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                    setStatus("all");
                    setPriority("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New {kind.slice(0, -1)}</DialogTitle>
            <DialogDescription>
              {o.workspace?.name} · Saved only in this workspace.
            </DialogDescription>
          </DialogHeader>
          {create && (
            <WorkForm
              kind={kind}
              parents={newParent}
              onSaved={() => {
                setCreate(false);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!active}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{active?.title}</DialogTitle>
            <DialogDescription>
              {kind.slice(0, -1)} · {o.workspace?.name}
            </DialogDescription>
          </DialogHeader>
          {active && (
            <WorkDetails
              key={active.id}
              item={active}
              kind={kind}
              onTask={(parent) => {
                close();
                setNewParent(parent);
                setCreate(false);
                navigate({ to: "/app/tasks", search: { item: undefined } });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkForm({
  kind,
  item,
  parents = {},
  onSaved,
}: {
  kind: WorkKind;
  item?: WorkItem;
  parents?: { project_id?: string; campaign_id?: string; parent_task_id?: string };
  onSaved: () => void;
}) {
  const o = useOrg();
  const q = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    title: item?.title ?? "",
    description: item?.description ?? "",
    objective: item && "objective" in item ? item.objective : "",
    status: item?.status ?? STATUSES[kind][0] ?? "",
    priority: item?.priority ?? "medium",
    start_date: item?.start_date ?? "",
    end_date: item && "end_date" in item ? (item.end_date ?? "") : "",
    due_date: item && "due_date" in item ? (item.due_date ?? "") : "",
    owner_id: item?.owner_id ?? "",
    category:
      item && "category" in item ? item.category : kind === "campaigns" ? "marketing" : "general",
    audience: item && "audience" in item ? item.audience : "",
    budget_eur: item && "budget_eur" in item ? String(item.budget_eur) : "0",
    channels: item && "channels" in item ? item.channels.join(", ") : "",
    results: item && "results" in item ? item.results : "",
    project_id: item && "project_id" in item ? (item.project_id ?? "") : (parents.project_id ?? ""),
    campaign_id:
      item && "campaign_id" in item ? (item.campaign_id ?? "") : (parents.campaign_id ?? ""),
    parent_task_id:
      item && "parent_task_id" in item
        ? (item.parent_task_id ?? "")
        : (parents.parent_task_id ?? ""),
    labels: item && "labels" in item ? item.labels.join(", ") : "",
    agent_key: item && "agent_key" in item ? (item.agent_key ?? "") : "",
    recurrence: item && "recurrence" in item ? item.recurrence : "none",
  }));
  const [busy, setBusy] = useState(false);
  const editable = can(o.workspaceRole, "profile.edit");
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.org || !o.workspace || busy || !editable) return;
    if (
      form.start_date &&
      (kind === "tasks" ? form.due_date : form.end_date) &&
      form.start_date > (kind === "tasks" ? form.due_date : form.end_date)
    ) {
      toast.error("End date precedes start date");
      return;
    }
    setBusy(true);
    try {
      const common = {
        title: form.title.trim(),
        description: form.description,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date || null,
        owner_id: form.owner_id || null,
      };
      let r;
      if (kind === "tasks") {
        const values = {
          ...common,
          due_date: form.due_date || null,
          project_id: form.project_id || null,
          campaign_id: form.campaign_id || null,
          parent_task_id: form.parent_task_id || null,
          labels: form.labels
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          agent_key: form.agent_key || null,
          recurrence: form.recurrence,
        };
        r = item
          ? await supabase
              .from("tasks")
              .update(values)
              .eq("id", item.id)
              .eq("org_id", o.org.id)
              .eq("workspace_id", o.workspace.id)
          : await supabase
              .from("tasks")
              .insert({
                ...values,
                org_id: o.org.id,
                workspace_id: o.workspace.id,
                created_by: o.userId,
              });
      } else if (kind === "projects") {
        const values = {
          ...common,
          objective: form.objective,
          category: form.category,
          end_date: form.end_date || null,
        };
        r = item
          ? await supabase
              .from("projects")
              .update(values)
              .eq("id", item.id)
              .eq("org_id", o.org.id)
              .eq("workspace_id", o.workspace.id)
          : await supabase
              .from("projects")
              .insert({
                ...values,
                org_id: o.org.id,
                workspace_id: o.workspace.id,
                created_by: o.userId,
              });
      } else {
        const values = {
          ...common,
          objective: form.objective,
          category: form.category,
          end_date: form.end_date || null,
          audience: form.audience,
          budget_eur: Number(form.budget_eur),
          channels: form.channels
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          results: form.results,
        };
        r = item
          ? await supabase
              .from("campaigns")
              .update(values)
              .eq("id", item.id)
              .eq("org_id", o.org.id)
              .eq("workspace_id", o.workspace.id)
          : await supabase
              .from("campaigns")
              .insert({
                ...values,
                org_id: o.org.id,
                workspace_id: o.workspace.id,
                created_by: o.userId,
              });
      }
      if (r.error) throw r.error;
      await qc.invalidateQueries({ queryKey: ["execution"] });
      toast.success(item ? "Work updated" : "Work created");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save work");
    } finally {
      setBusy(false);
    }
  }
  const field = (key: keyof typeof form, title: string, type = "text") => (
    <label className="space-y-1 text-xs" key={key}>
      {title}
      <Input
        aria-label={title}
        type={type}
        required={key === "title"}
        maxLength={key === "title" ? 200 : undefined}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        disabled={!editable}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const select = (
    key: keyof typeof form,
    title: string,
    options: { value: string; label: string }[],
  ) => (
    <label className="space-y-1 text-xs" key={key}>
      {title}
      <select
        aria-label={title}
        disabled={!editable}
        className={`${inputClass} w-full`}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      >
        {options.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {field("title", "Title")}
      <label className="block space-y-1 text-xs">
        Description
        <Textarea
          aria-label="Description"
          disabled={!editable}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
        />
      </label>
      {kind !== "tasks" && field("objective", "Objective")}
      <div className="grid gap-3 sm:grid-cols-2">
        {select(
          "status",
          "Status",
          STATUSES[kind].map((s) => ({ value: s, label: label(s) })),
        )}
        {select(
          "priority",
          "Priority",
          PRIORITIES.map((s) => ({ value: s, label: s })),
        )}
        {field("start_date", "Start date", "date")}
        {kind === "tasks"
          ? field("due_date", "Deadline", "date")
          : field("end_date", "End date", "date")}
        {select("owner_id", "Responsible person", [
          { value: "", label: "Unassigned" },
          ...(q.data?.members.map((m) => ({ value: m.user_id, label: m.display_name })) ?? []),
        ])}
        {kind === "projects" && field("category", "Category")}
        {kind === "campaigns" &&
          select(
            "category",
            "Campaign type",
            ["marketing", "seo", "content", "social", "advertising", "email", "sales"].map((c) => ({
              value: c,
              label: c,
            })),
          )}
        {kind === "tasks" && (
          <>
            {select("project_id", "Project", [
              { value: "", label: "No project" },
              ...(q.data?.projects.map((p) => ({ value: p.id, label: p.title })) ?? []),
            ])}
            {select("campaign_id", "Campaign", [
              { value: "", label: "No campaign" },
              ...(q.data?.campaigns.map((p) => ({ value: p.id, label: p.title })) ?? []),
            ])}
            {select("parent_task_id", "Parent task", [
              { value: "", label: "No parent task" },
              ...(q.data?.tasks
                .filter((t) => t.id !== item?.id)
                .map((p) => ({ value: p.id, label: p.title })) ?? []),
            ])}
            {field("labels", "Labels (comma separated)")}
            {select("agent_key", "AI specialist", [
              { value: "", label: "No AI assignment" },
              { value: "growth_officer", label: "Growth Officer · research only" },
            ])}
            {select("recurrence", "Repeat", [
              { value: "none", label: "Does not repeat" },
              { value: "weekly", label: "Weekly · confirm next occurrence" },
              { value: "monthly", label: "Monthly · confirm next occurrence" },
            ])}
          </>
        )}
        {kind === "campaigns" && (
          <>
            {field("audience", "Audience")}
            {field("budget_eur", "Budget EUR", "number")}
            {field("channels", "Channels (comma separated)")}
          </>
        )}
      </div>
      {kind === "campaigns" && (
        <label className="block space-y-1 text-xs">
          Recorded results
          <Textarea
            aria-label="Recorded results"
            disabled={!editable}
            value={form.results}
            onChange={(e) => set("results", e.target.value)}
          />
        </label>
      )}
      {editable && (
        <Button type="submit" disabled={busy || q.isError}>
          {busy ? "Saving…" : item ? "Save changes" : "Create " + kind.slice(0, -1)}
        </Button>
      )}
    </form>
  );
}

function WorkDetails({
  item,
  kind,
}: {
  item: WorkItem;
  kind: WorkKind;
  onTask: (p: { project_id?: string; campaign_id?: string; parent_task_id?: string }) => void;
}) {
  const o = useOrg();
  const navigate = useWorkNavigate();
  const qc = useQueryClient();
  const q = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const [tab, setTab] = useState("overview");
  const [text, setText] = useState("");
  const [related, setRelated] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [addTask, setAddTask] = useState(false);
  const editable = can(o.workspaceRole, "profile.edit");
  const notes = q.data?.notes.filter((n) => n.entity_id === item.id) ?? [];
  const tasks =
    q.data?.tasks.filter((t) =>
      kind === "tasks"
        ? t.parent_task_id === item.id
        : kind === "projects"
          ? t.project_id === item.id
          : t.campaign_id === item.id,
    ) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["execution"] });
  async function note(noteKind: Note["kind"], extra: Partial<Note> = {}) {
    if (!o.org || !o.workspace || busy) return;
    setBusy(true);
    try {
      const r = await supabase
        .from("execution_notes")
        .insert({
          org_id: o.org.id,
          workspace_id: o.workspace.id,
          entity_type: kind,
          entity_id: item.id,
          kind: noteKind,
          title: text,
          body: noteKind === "comment" ? text : "",
          created_by: o.userId,
          ...extra,
        });
      if (r.error) throw r.error;
      setText("");
      setRelated("");
      setDeadline("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add item");
    } finally {
      setBusy(false);
    }
  }
  async function remove(n: Note) {
    const r = await supabase
      .from("execution_notes")
      .delete()
      .eq("id", n.id)
      .eq("org_id", o.org?.id ?? "")
      .eq("workspace_id", o.workspace?.id ?? "");
    if (r.error) toast.error(r.error.message);
    else await refresh();
  }
  async function upload(file: File) {
    if (!o.org || !o.workspace || busy) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Maximum file size is 10 MB");
      return;
    }
    setBusy(true);
    const path = `${o.org.id}/${o.workspace.id}/${item.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    try {
      const u = await supabase.storage
        .from("execution-files")
        .upload(path, file, { upsert: false });
      if (u.error) throw u.error;
      const n = await supabase
        .from("execution_notes")
        .insert({
          org_id: o.org.id,
          workspace_id: o.workspace.id,
          entity_type: kind,
          entity_id: item.id,
          kind: "asset",
          title: file.name,
          storage_path: path,
          created_by: o.userId,
        });
      if (n.error) {
        await supabase.storage.from("execution-files").remove([path]);
        throw n.error;
      }
      await refresh();
      toast.success("Attachment added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function download(n: Note) {
    if (!n.storage_path) return;
    const r = await supabase.storage.from("execution-files").download(n.storage_path);
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = n.title;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function runAgent() {
    if (!("agent_key" in item) || item.agent_key !== "growth_officer") return;
    if (!o.org || !o.workspace) return;
    sessionStorage.setItem(
      growthDraftKey(o.org.id, o.workspace.id),
      `Research this task. Do not publish or perform external actions.\n\n${item.title}\n${item.description}`,
    );
    navigate({ to: "/app/growth-officer" });
  }
  const tabs = [
    "overview",
    "tasks",
    ...(kind === "projects" ? ["milestones"] : []),
    "team",
    "comments",
    "files",
    ...(kind === "tasks" ? ["dependencies"] : []),
    ...(kind === "campaigns" ? ["content", "approvals"] : []),
    "history",
  ];
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? "secondary" : "ghost"}
            onClick={() => setTab(t)}
          >
            {label(t)}
          </Button>
        ))}
      </div>
      {item.source_message_id && (
        <p className="text-xs text-muted-foreground">
          Linked to Growth Officer recommendation · {item.source_message_id.slice(0, 8)}
        </p>
      )}
      {tab === "overview" && (
        <>
          <WorkForm item={item} kind={kind} onSaved={() => refresh()} />
          {kind === "tasks" && "agent_key" in item && item.agent_key && editable && (
            <Button variant="outline" onClick={runAgent}>
              <Sparkles />
              Review with Growth Officer
            </Button>
          )}
          {kind === "tasks" &&
            "recurrence" in item &&
            item.recurrence !== "none" &&
            item.status === "done" &&
            editable && (
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await supabase.rpc("repeat_execution_task", { _task: item.id });
                  if (r.error) toast.error(r.error.message);
                  else {
                    await refresh();
                    toast.success("Next occurrence created once");
                  }
                }}
              >
                <Repeat />
                Create next occurrence
              </Button>
            )}
        </>
      )}
      {tab === "tasks" && (
        <>
          <p className="text-xs text-muted-foreground">
            {tasks.length} {kind === "tasks" ? "subtasks" : "tasks"} · {taskProgress(tasks)}%
            completed
          </p>
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 border-b border-border py-3"
            >
              <span className="min-w-0 break-words text-sm">{t.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {label(t.status)} · {t.due_date ?? "No deadline"}
              </span>
            </div>
          ))}
          {editable && (
            <Button variant="outline" onClick={() => setAddTask(!addTask)}>
              <Plus />
              {kind === "tasks" ? "Add subtask" : "Add task"}
            </Button>
          )}
          {addTask && (
            <WorkForm
              kind="tasks"
              parents={
                kind === "projects"
                  ? { project_id: item.id }
                  : kind === "campaigns"
                    ? { campaign_id: item.id }
                    : { parent_task_id: item.id }
              }
              onSaved={() => {
                setAddTask(false);
                refresh();
              }}
            />
          )}
        </>
      )}
      {tab === "comments" && (
        <>
          {notes
            .filter((n) => n.kind === "comment")
            .map((n) => (
              <article key={n.id} className="border-b border-border py-3">
                <p className="text-xs text-muted-foreground">
                  {q.data?.members.find((m) => m.user_id === n.created_by)?.display_name ??
                    "Teammate"}{" "}
                  · {new Date(n.created_at).toLocaleString()}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{n.body}</p>
              </article>
            ))}
          {editable && (
            <>
              <Textarea
                aria-label="Comment"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={10000}
                placeholder="Add a comment…"
              />
              <Button disabled={busy || !text.trim()} onClick={() => note("comment")}>
                Add comment
              </Button>
            </>
          )}
        </>
      )}
      {tab === "milestones" && (
        <>
          {notes
            .filter((n) => n.kind === "milestone")
            .map((n) => (
              <div key={n.id} className="flex items-center gap-2 border-b border-border py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!editable}
                  aria-label={`Complete milestone ${n.title}`}
                  onClick={async () => {
                    const r = await supabase
                      .from("execution_notes")
                      .update({ completed: !n.completed })
                      .eq("id", n.id)
                      .eq("workspace_id", o.workspace?.id ?? "");
                    if (r.error) toast.error(r.error.message);
                    else refresh();
                  }}
                >
                  <Check className={n.completed ? "text-success" : "text-muted-foreground"} />
                </Button>
                <span className="min-w-0 flex-1 break-words text-sm">{n.title}</span>
                <span className="text-xs">{n.due_date}</span>
              </div>
            ))}
          {editable && (
            <>
              <Input
                aria-label="Milestone title"
                placeholder="Milestone"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Input
                aria-label="Milestone deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <Button
                disabled={busy || !text.trim()}
                onClick={() => note("milestone", { due_date: deadline || null })}
              >
                <Plus />
                Add milestone
              </Button>
            </>
          )}
        </>
      )}
      {tab === "team" && (
        <>
          <p className="text-xs text-muted-foreground">
            Responsible ·{" "}
            {q.data?.members.find((m) => m.user_id === item.owner_id)?.display_name ?? "Unassigned"}
          </p>
          {notes
            .filter((n) => n.kind === "member")
            .map((n) => (
              <div key={n.id} className="flex items-center justify-between py-2">
                <span className="text-sm">
                  {q.data?.members.find((m) => m.user_id === n.user_id)?.display_name ?? "Teammate"}
                </span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove team assignment"
                    onClick={() => remove(n)}
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
          {editable && (
            <>
              <select
                aria-label="Add teammate"
                className={inputClass}
                value={related}
                onChange={(e) => setRelated(e.target.value)}
              >
                <option value="">Select teammate</option>
                {q.data?.members
                  .filter((m) => !notes.some((n) => n.kind === "member" && n.user_id === m.user_id))
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
              <Button
                disabled={busy || !related}
                onClick={() => note("member", { user_id: related })}
              >
                <Plus />
                Assign teammate
              </Button>
            </>
          )}
        </>
      )}
      {tab === "files" && (
        <>
          {notes
            .filter((n) => n.kind === "asset" && n.content_type === "file")
            .map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-2 py-3">
                <Button
                  variant="link"
                  className="h-auto whitespace-normal p-0 text-left"
                  onClick={() => download(n)}
                >
                  <Paperclip />
                  {n.title}
                </Button>
                {editable &&
                  (n.created_by === o.userId || can(o.workspaceRole, "members.manage")) && (
                    <Button
                      aria-label={`Remove ${n.title}`}
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (n.storage_path && n.created_by === o.userId) {
                          const r = await supabase.storage
                            .from("execution-files")
                            .remove([n.storage_path]);
                          if (r.error) {
                            toast.error(r.error.message);
                            return;
                          }
                        }
                        await remove(n);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
              </div>
            ))}
          {editable && (
            <label className="block text-xs">
              Add attachment · max 10 MB
              <Input
                aria-label="Add attachment"
                type="file"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </>
      )}
      {tab === "content" && (
        <>
          {notes
            .filter((n) => n.kind === "asset" && n.content_type === "draft")
            .map((n) => (
              <article key={n.id} className="border-b border-border py-3">
                <h3 className="text-sm font-semibold">{n.title}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {n.body}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {n.due_date ?? "No scheduled date"} · Draft, not published
                </p>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove content ${n.title}`}
                    onClick={() => remove(n)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </article>
            ))}
          {editable && (
            <>
              <Input
                aria-label="Content title"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Content piece"
              />
              <Textarea
                aria-label="Content draft"
                value={related}
                onChange={(e) => setRelated(e.target.value)}
                maxLength={12000}
                placeholder="Draft copy…"
              />
              <Input
                type="date"
                aria-label="Content planned date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <Button
                disabled={busy || !text.trim()}
                onClick={() =>
                  note("asset", {
                    content_type: "draft",
                    body: related,
                    due_date: deadline || null,
                  })
                }
              >
                <Plus />
                Save content draft
              </Button>
            </>
          )}
        </>
      )}
      {tab === "dependencies" && (
        <>
          {notes
            .filter((n) => n.kind === "dependency")
            .map((n) => (
              <div className="flex items-center justify-between gap-2 py-2" key={n.id}>
                <p className="min-w-0 break-words text-sm">
                  {q.data?.tasks.find((t) => t.id === n.related_id)?.title} ·{" "}
                  {q.data?.tasks.find((t) => t.id === n.related_id)?.status}
                </p>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove dependency"
                    onClick={() => remove(n)}
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
          {editable && (
            <>
              <select
                aria-label="Task dependency"
                className={inputClass}
                value={related}
                onChange={(e) => setRelated(e.target.value)}
              >
                <option value="">Select prerequisite task</option>
                {q.data?.tasks
                  .filter(
                    (t) =>
                      t.id !== item.id &&
                      !notes.some((n) => n.kind === "dependency" && n.related_id === t.id),
                  )
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
              <Button
                disabled={busy || !related}
                onClick={() => note("dependency", { related_id: related })}
              >
                <Plus />
                Add dependency
              </Button>
            </>
          )}
        </>
      )}
      {tab === "approvals" && (
        <>
          {notes
            .filter((n) => n.kind === "approval")
            .map((n) => (
              <p className="border-b border-border py-3 text-sm" key={n.id}>
                {q.data?.approvals.find((a) => a.id === n.related_id)?.title} ·{" "}
                {q.data?.approvals.find((a) => a.id === n.related_id)?.status}
              </p>
            ))}
          {editable && (
            <>
              <select
                aria-label="Campaign approval"
                className={inputClass}
                value={related}
                onChange={(e) => setRelated(e.target.value)}
              >
                <option value="">Select workspace approval</option>
                {q.data?.approvals
                  .filter((a) => !notes.some((n) => n.related_id === a.id))
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.title}
                    </option>
                  ))}
              </select>
              <Button
                disabled={busy || !related}
                onClick={() => note("approval", { related_id: related })}
              >
                <Plus />
                Link approval
              </Button>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Campaign status is internal planning. No external publishing is connected.
          </p>
        </>
      )}
      {tab === "history" &&
        q.data?.events
          .filter((e) => e.entity_id === item.id)
          .map((e) => (
            <div key={e.id} className="border-b border-border py-3 text-xs">
              <p>
                {e.action} ·{" "}
                {e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
                  ? String(e.metadata["kind"] ?? e.metadata["status"] ?? "")
                  : ""}
              </p>
              <p className="mt-1 text-muted-foreground">
                {q.data?.members.find((m) => m.user_id === e.actor_id)?.display_name ?? "Teammate"}{" "}
                · {new Date(e.created_at).toLocaleString()}
              </p>
            </div>
          ))}
    </>
  );
}
