// External actions: one traceable lifecycle for every action on a connected platform.
// Recommendation (the task) → draft → review → approval → execution → verification → result.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronRight, Play, SearchCheck, X } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { growthDb, isNotInstalled, type ExternalActionRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTIONS,
  actionByType,
  adminToExecute,
  approvalRequired,
  isSpecialist,
  payloadSchema,
  preparableActions,
  providerByKey,
  type Level,
} from "@/lib/integrations/catalog";
import { SCENARIOS, type Scenario } from "@/lib/integrations/simulated";
import { STEPS, lifecycleStep } from "@/lib/integration-health";
import { executeExternalAction, verifyExternalAction } from "@/lib/external-actions.functions";
import { clientGate, hubKey, hubOptions, type HubData } from "./hub-data";
import { SimBadge, SimulatedNotice, providerName } from "./integration-hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const FILTERS = {
  all: [],
  review: ["draft", "in_review"],
  progress: ["approved", "executing"],
  problems: ["failed", "uncertain"],
  verify: ["executed"],
  closed: ["rejected", "cancelled"],
} as const;
type Filter = keyof typeof FILTERS;

export function ExternalActions({ initialTask }: { initialTask?: string }) {
  const o = useOrg();
  const { t } = useI18n();
  const q = useQuery(hubOptions(o.org?.id, o.workspace?.id));
  const [filter, setFilter] = useState<Filter>("all");
  if (!o.workspace) return <p className="text-sm text-muted-foreground">{t("xa.chooseWs")}</p>;
  if (q.isError && isNotInstalled(q.error))
    return <p className="text-sm text-muted-foreground">{t("xa.notInstalled")}</p>;
  if (q.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("xa.loading")}
      </p>
    );
  if (q.isError || !q.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("xa.loadFailed")}
      </p>
    );
  const d = q.data;
  const shown = d.actions.filter(
    (a) =>
      filter === "all" ||
      ((FILTERS[filter] as readonly string[]).includes(a.stage) &&
        (filter !== "verify" || a.verification !== "verified")),
  );
  return (
    <>
      <SimulatedNotice className="mb-5" />
      <Prepare data={d} initialTask={initialTask} />
      <div role="tablist" aria-label={t("xa.filter")} className="mb-4 mt-8 flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {t(`xa.f.${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <p className="py-6 text-sm text-muted-foreground">
          {d.actions.length ? t("xa.noneInFilter") : t("xa.noneYet")}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((a) => (
            <ActionCard key={a.id} a={a} data={d} />
          ))}
        </ul>
      )}
    </>
  );
}

function Prepare({ data, initialTask }: { data: HubData; initialTask?: string | undefined }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const tasks = [...data.tasks.values()].filter(
    (x) =>
      x.specialist &&
      isSpecialist(x.specialist) &&
      data.connections.some(
        (c) => preparableActions(x.specialist as never, c.connector_key).length,
      ),
  );
  const [taskId, setTaskId] = useState(
    initialTask && tasks.some((x) => x.id === initialTask) ? initialTask : "",
  );
  const task = tasks.find((x) => x.id === taskId);
  const usable = data.connections.filter(
    (c) => c.status !== "disabled" && c.status !== "not_configured",
  );
  const types = useMemo(
    () =>
      task && isSpecialist(task.specialist ?? "")
        ? [
            ...new Set(
              usable.flatMap((c) =>
                preparableActions(task.specialist as never, c.connector_key).map((a) => a.type),
              ),
            ),
          ]
        : [],
    [task, usable],
  );
  const [type, setType] = useState("");
  const spec = actionByType(type);
  const conns = spec
    ? usable.filter((c) => {
        const p = providerByKey(c.connector_key);
        return p && spec.providers.includes(p.base) && p.levels.includes(spec.level);
      })
    : [];
  const [conn, setConn] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!member) return null;
  const reset = () => {
    setType("");
    setConn("");
    setTitle("");
    setDesc("");
    setFields({});
    setCost("");
    setKey(crypto.randomUUID());
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !spec || !conn || !o.workspace) return;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== ""));
    const parsed = payloadSchema(spec).safeParse(clean);
    if (!parsed.success) {
      toast.error(t("xa.invalidFields"));
      return;
    }
    if (cost && !/^\d+(\.\d{1,2})?$/.test(cost)) {
      toast.error(t("xa.invalidCost"));
      return;
    }
    setBusy(true);
    const r = await growthDb.rpc("create_external_action", {
      _workspace: o.workspace.id,
      _request: key,
      _task: task.id,
      _connection: conn,
      _specialist: task.specialist!,
      _type: spec.type,
      _title: title.trim() || t(`xa.type.${spec.type}` as MessageKey),
      _description: desc,
      _payload: parsed.data as Json,
      _cost: cost ? Number(cost) : null,
      _currency: cost ? currency : null,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("xa.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("xa.draftSaved"));
    reset();
    void qc.invalidateQueries({ queryKey: hubKey(o.org?.id, o.workspace?.id) });
  }
  const sel = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs";
  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-border bg-card p-4"
      aria-label={t("xa.prepare.title")}
    >
      <h2 className="text-sm font-semibold">{t("xa.prepare.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("xa.prepare.intro")}</p>
      {!tasks.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("xa.prepare.noTasks")}{" "}
          <Link to="/app/tasks" className="text-primary hover:underline">
            {t("xa.openTasks")}
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-2xs">
              <span className="mb-1 block font-medium">{t("xa.prepare.task")}</span>
              <select
                className={sel}
                value={taskId}
                onChange={(e) => {
                  setTaskId(e.target.value);
                  setType("");
                  setConn("");
                }}
              >
                <option value="">{t("xa.choose")}</option>
                {tasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-2xs">
              <span className="mb-1 block font-medium">{t("xa.prepare.type")}</span>
              <select
                className={sel}
                value={type}
                disabled={!task}
                onChange={(e) => {
                  setType(e.target.value);
                  setConn("");
                  setFields({});
                }}
              >
                <option value="">{t("xa.choose")}</option>
                {types.map((x) => (
                  <option key={x} value={x}>
                    {t(`xa.type.${x}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-2xs">
              <span className="mb-1 block font-medium">{t("xa.prepare.connection")}</span>
              <select
                className={sel}
                value={conn}
                disabled={!spec}
                onChange={(e) => setConn(e.target.value)}
              >
                <option value="">{t("xa.choose")}</option>
                {conns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {providerName(c.connector_key)}
                    {c.simulated ? ` (${t("xa.simulated")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {task?.specialist && (
            <p className="mt-2 text-2xs text-muted-foreground">
              {t("xa.prepare.specialist", { s: t(`run.sp.${task.specialist}` as MessageKey) })}
            </p>
          )}
          {spec && (
            <div className="mt-3 space-y-3">
              <p className="text-2xs text-muted-foreground">
                {t("xa.prepare.needs", { level: t(`xa.level.${spec.level}` as MessageKey) })}{" "}
                {approvalRequired(spec.level, data.mode)
                  ? t("xa.prepare.approvalNeeded")
                  : t("xa.prepare.policy")}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-2xs">
                  <span className="mb-1 block font-medium">{t("xa.field.actionTitle")}</span>
                  <Input
                    value={title}
                    maxLength={160}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t(`xa.type.${spec.type}` as MessageKey)}
                  />
                </label>
                <label className="text-2xs">
                  <span className="mb-1 block font-medium">{t("xa.field.actionNote")}</span>
                  <Input value={desc} maxLength={2000} onChange={(e) => setDesc(e.target.value)} />
                </label>
                {spec.fields.map((fd) => (
                  <label
                    key={fd.key}
                    className={cn("text-2xs", fd.kind === "textarea" && "md:col-span-2")}
                  >
                    <span className="mb-1 block font-medium">
                      {t(`xa.field.${fd.key}` as MessageKey)}
                      {fd.required ? " *" : ""}
                    </span>
                    {fd.kind === "textarea" ? (
                      <Textarea
                        rows={3}
                        value={fields[fd.key] ?? ""}
                        maxLength={4000}
                        onChange={(e) => setFields((x) => ({ ...x, [fd.key]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        type={fd.kind === "url" ? "url" : "text"}
                        inputMode={fd.kind === "money" ? "decimal" : undefined}
                        value={fields[fd.key] ?? ""}
                        onChange={(e) => setFields((x) => ({ ...x, [fd.key]: e.target.value }))}
                        required={fd.required}
                      />
                    )}
                  </label>
                ))}
                <div className="flex items-end gap-2 text-2xs">
                  <label className="flex-1">
                    <span className="mb-1 block font-medium">{t("xa.field.cost")}</span>
                    <Input
                      inputMode="decimal"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block font-medium">{t("xa.field.currency")}</span>
                    <select
                      className="rounded-md border border-border bg-card px-2 py-2 text-xs"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {["EUR", "USD", "GBP"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <Button type="submit" size="sm" disabled={busy || !conn}>
                {t("xa.prepare.submit")}
              </Button>
            </div>
          )}
        </>
      )}
    </form>
  );
}

function ActionCard({ a, data }: { a: ExternalActionRow; data: HubData }) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const admin = can(o.workspaceRole, "approvals.decide");
  const member = can(o.workspaceRole, "ai.use");
  const conn = data.connections.find((c) => c.id === a.connection_id);
  const gate = ["approved", "failed"].includes(a.stage) ? clientGate(a, conn, data.paused) : null;
  const exec = useServerFn(executeExternalAction);
  const verify = useServerFn(verifyExternalAction);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [scenario, setScenario] = useState<Scenario>("success");
  const [open, setOpen] = useState(false);
  const [execKey, setExecKey] = useState(() => crypto.randomUUID());
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: hubKey(o.org?.id, o.workspace?.id) });
    void qc.invalidateQueries({ queryKey: ["xa-history", a.id] });
  };
  const errText = (e: string) =>
    e.startsWith("gate:") ? t(`xa.gate.${e.slice(5)}` as MessageKey) : e;
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.error) toast.error(t("xa.failed", { e: errText(r.error.message) }));
    else toast.success(done);
    refresh();
  }
  async function execute() {
    setBusy(true);
    const r = await exec({ data: { actionId: a.id, key: execKey, scenario } });
    setBusy(false);
    setExecKey(crypto.randomUUID());
    if (!r.ok) toast.error(t("xa.failed", { e: errText(r.error) }));
    else if (r.data.stage === "executed") toast.success(t("xa.executedToast"));
    else
      toast.warning(
        t(r.data.stage === "uncertain" ? "xa.uncertainToast" : "xa.failedToast", {
          e: r.data.error ?? "",
        }),
      );
    refresh();
  }
  async function doVerify() {
    setBusy(true);
    const r = await verify({ data: { actionId: a.id } });
    setBusy(false);
    if (!r.ok) toast.error(t("xa.failed", { e: r.error }));
    else
      toast[r.data.verification === "verified" ? "success" : "warning"](
        t(
          `xa.verifyToast.${r.data.stage === "failed" ? "absent" : r.data.verification}` as MessageKey,
        ),
      );
    refresh();
  }
  const step = lifecycleStep(a);
  const idx = STEPS.indexOf(step.step);
  const task = data.tasks.get(a.task_id);
  const level = a.required_level as Level;
  const mayExecute = member && (!adminToExecute(level) || admin);
  const payload = (a.payload ?? {}) as Record<string, string>;
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-semibold">{a.title}</h3>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {t(`xa.type.${a.action_type}` as MessageKey)} · {providerName(a.provider)} ·{" "}
            {t(`run.sp.${a.specialist_key}` as MessageKey)} ·{" "}
            {t("xa.needsLevel", { level: t(`xa.level.${level}` as MessageKey) })}
          </p>
        </div>
        {a.simulated && <SimBadge />}
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-medium">
          {t(`xa.stage.${a.stage}` as MessageKey)}
        </span>
        {a.stage === "executed" && (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-2xs font-medium",
              a.verification === "verified"
                ? "border-success/40 text-success"
                : a.verification === "failed"
                  ? "border-destructive/40 text-destructive"
                  : "border-border text-muted-foreground",
            )}
          >
            {t(`xa.verification.${a.verification}` as MessageKey)}
          </span>
        )}
      </div>
      <ol
        aria-label={t("xa.lifecycle")}
        className="mt-3 flex flex-wrap items-center gap-1 text-2xs"
      >
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded px-1.5 py-0.5",
                i < idx || (i === idx && step.state === "done")
                  ? "bg-primary/15 text-primary"
                  : i === idx
                    ? step.state === "blocked"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-warning/15 font-semibold text-foreground"
                    : "text-muted-foreground",
              )}
              aria-current={i === idx ? "step" : undefined}
            >
              {t(`xa.step.${s}` as MessageKey)}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-2xs text-muted-foreground">
        {t("xa.task")}:{" "}
        <Link to="/app/tasks" className="text-foreground hover:underline">
          {task?.title ?? "—"}
        </Link>
        {a.goal_id && (
          <>
            {" "}
            · {t("xa.goal")}: {data.goals.get(a.goal_id) ?? "—"}
          </>
        )}
        {a.plan_version_id && (
          <>
            {" "}
            · {t("xa.plan")}: {data.plans.get(a.plan_version_id) ?? "—"}
          </>
        )}
        {a.estimated_cost != null && (
          <>
            {" "}
            · {t("xa.estCost")}:{" "}
            {Number(a.estimated_cost).toLocaleString(tag, {
              style: "currency",
              currency: a.currency ?? "EUR",
            })}
            {a.simulated ? ` (${t("xa.notSpent")})` : ""}
          </>
        )}
      </p>
      {a.error && <p className="mt-1 break-words text-2xs text-destructive">{a.error}</p>}
      {gate && <p className="mt-1 text-2xs text-warning">{t(`xa.gate.${gate}` as MessageKey)}</p>}
      {a.stage === "executed" && (
        <p className="mt-1 text-2xs text-muted-foreground">{t("xa.businessImpact")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.stage === "draft" && member && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(
                () => growthDb.rpc("submit_external_action", { _action: a.id }),
                t("xa.submitted"),
              )
            }
          >
            {t("xa.submit")}
          </Button>
        )}
        {a.stage === "in_review" && admin && (
          <>
            <Input
              className="h-8 max-w-56 text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("xa.notePh")}
              aria-label={t("xa.notePh")}
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    growthDb.rpc("decide_external_action", {
                      _action: a.id,
                      _approve: true,
                      _note: note,
                    }),
                  t("xa.approvedToast"),
                )
              }
            >
              <Check />
              {t("xa.approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() =>
                run(
                  () =>
                    growthDb.rpc("decide_external_action", {
                      _action: a.id,
                      _approve: false,
                      _note: note,
                    }),
                  t("xa.rejectedToast"),
                )
              }
            >
              <X />
              {t("xa.reject")}
            </Button>
          </>
        )}
        {a.stage === "in_review" && !admin && (
          <span className="text-2xs text-muted-foreground">{t("xa.awaitAdmin")}</span>
        )}
        {["approved", "failed"].includes(a.stage) && a.attempts < 3 && mayExecute && (
          <>
            {a.simulated && (
              <label className="flex items-center gap-1.5 text-2xs">
                {t("xa.simResponse")}
                <select
                  className="rounded-md border border-border bg-card px-2 py-1 text-2xs"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as Scenario)}
                >
                  {SCENARIOS.map((s) => (
                    <option key={s} value={s}>
                      {t(`xa.sim.${s}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button size="sm" disabled={busy || !!gate} onClick={execute}>
              <Play />
              {a.stage === "failed" ? t("xa.retry", { n: a.attempts + 1 }) : t("xa.execute")}
            </Button>
          </>
        )}
        {["approved", "failed"].includes(a.stage) && member && !mayExecute && (
          <span className="text-2xs text-muted-foreground">{t("xa.gate.admin_required")}</span>
        )}
        {a.stage === "failed" && a.attempts >= 3 && (
          <span className="text-2xs text-muted-foreground">{t("xa.gate.attempts_exhausted")}</span>
        )}
        {a.stage === "executing" &&
          member &&
          Date.now() - new Date(a.updated_at).getTime() > 600_000 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(
                  () => growthDb.rpc("mark_stalled_external_action", { _action: a.id }),
                  t("xa.markedStalled"),
                )
              }
            >
              {t("xa.markStalled")}
            </Button>
          )}
        {(a.stage === "uncertain" || (a.stage === "executed" && a.verification !== "verified")) &&
          member && (
            <Button size="sm" variant="outline" disabled={busy} onClick={doVerify}>
              <SearchCheck />
              {a.stage === "uncertain" ? t("xa.resolve") : t("xa.verify")}
            </Button>
          )}
        {["draft", "in_review", "approved", "failed"].includes(a.stage) &&
          member &&
          (a.created_by === o.userId || admin) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(
                  () => growthDb.rpc("cancel_external_action", { _action: a.id }),
                  t("xa.cancelled"),
                )
              }
            >
              {t("xa.cancel")}
            </Button>
          )}
        <Button
          size="sm"
          variant="link"
          className="ml-auto px-0"
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
        >
          {open ? t("xa.hideDetails") : t("xa.details")}
        </Button>
      </div>
      {a.stage === "uncertain" && (
        <p className="mt-2 text-2xs text-muted-foreground">{t("xa.uncertainHelp")}</p>
      )}
      {open && <Details a={a} payload={payload} />}
    </li>
  );
}

function Details({ a, payload }: { a: ExternalActionRow; payload: Record<string, string> }) {
  const { t, tag } = useI18n();
  const h = useQuery({
    queryKey: ["xa-history", a.id],
    queryFn: async () => {
      const r = await supabase
        .from("activity_events")
        .select("id,action,created_at,metadata")
        .eq("workspace_id", a.workspace_id)
        .eq("entity_type", "external_actions")
        .eq("entity_id", a.id)
        .order("created_at")
        .limit(100);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const ev = (a.evidence ?? {}) as Record<string, unknown>;
  const spec = ACTIONS.find((x) => x.type === a.action_type);
  return (
    <div className="mt-3 grid gap-4 border-t border-border pt-3 text-2xs md:grid-cols-2">
      <div>
        <p className="mb-1 font-medium">{t("xa.draftContent")}</p>
        <dl className="space-y-1">
          {(spec?.fields ?? [])
            .filter((f) => payload[f.key])
            .map((f) => (
              <div key={f.key}>
                <dt className="text-muted-foreground">{t(`xa.field.${f.key}` as MessageKey)}</dt>
                <dd className="whitespace-pre-wrap break-words">{payload[f.key]}</dd>
              </div>
            ))}
        </dl>
        {a.description && (
          <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
            {a.description}
          </p>
        )}
        {a.decided_at && (
          <p className="mt-2">
            {a.approval_mode === "policy" ? t("xa.byPolicy") : t("xa.byAdmin")} ·{" "}
            {new Date(a.decided_at).toLocaleString(tag, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {a.decision_note ? ` · “${a.decision_note}”` : ""}
          </p>
        )}
        {a.external_ref && (
          <p className="mt-1">
            {t("xa.externalRef")}: <code className="break-all">{a.external_ref}</code>
          </p>
        )}
        {a.executed_at && (
          <p className="mt-1">
            {t("xa.executedAt")}:{" "}
            {new Date(a.executed_at).toLocaleString(tag, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}
        {a.verified_at && (
          <p className="mt-1">
            {t("xa.verifiedAt")}:{" "}
            {new Date(a.verified_at).toLocaleString(tag, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {"provider_state" in ev
              ? ` · ${t("xa.providerState", { s: String(ev["provider_state"]), e: String(ev["expected_state"] ?? "") })}`
              : ""}
          </p>
        )}
      </div>
      <div>
        <p className="mb-1 font-medium">{t("xa.history")}</p>
        {h.isLoading ? (
          <p className="text-muted-foreground">{t("xa.loading")}</p>
        ) : h.isError ? (
          <p className="text-destructive">{t("xa.loadFailed")}</p>
        ) : (
          <ol className="space-y-1">
            {(h.data ?? []).map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {new Date(e.created_at).toLocaleString(tag, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span>{t(`xa.ev.${e.action}` as MessageKey)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
