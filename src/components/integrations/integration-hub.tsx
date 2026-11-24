// Integration Hub: health overview, the Growth Officer's integration problems, every connection with its separately
// granted permissions, and simulated connections for testing. Real providers stay read-only here.
import { useState } from "react";
import { connectionErrorText } from "@/lib/integrations/error-text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FlaskConical, Plug, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { LEVELS, SIMULATED_PROVIDERS, providerByKey, type Level } from "@/lib/integrations/catalog";
import {
  connectionHealth,
  freshness,
  integrationOverview,
  type Problem,
} from "@/lib/integration-health";
import { syncSimulatedIntegration } from "@/lib/external-actions.functions";
import { hubOptions, hubKey, type HubConnection } from "./hub-data";
import { SectionHeading } from "@/components/app/section-heading";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SimulatedNotice({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      {t("xa.simNotice")}
    </p>
  );
}
export function SimBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warning">
      <FlaskConical className="h-3 w-3" aria-hidden />
      {t("xa.simulated")}
    </span>
  );
}
export const providerName = (key: string) => providerByKey(key)?.name ?? key;

export function IntegrationHub() {
  const o = useOrg();
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const q = useQuery(hubOptions(o.org?.id, o.workspace?.id));
  const admin = can(o.workspaceRole, "integrations.manage");
  const member = can(o.workspaceRole, "ai.use");
  const [busy, setBusy] = useState<string | null>(null);
  const sync = useServerFn(syncSimulatedIntegration);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: hubKey(o.org?.id, o.workspace?.id) });
    void qc.invalidateQueries({ queryKey: ["connector-status"] });
    void qc.invalidateQueries({ queryKey: ["connector-runs"] });
  };
  async function act(
    id: string,
    fn: () => PromiseLike<{ error: unknown } | { ok: boolean; error?: string }>,
    done: string,
  ) {
    setBusy(id);
    try {
      const r = await fn();
      const err =
        "ok" in r
          ? r.ok
            ? null
            : r.error
          : r.error
            ? ((r.error as { message?: string }).message ?? "error")
            : null;
      if (err) toast.error(t("xa.failed", { e: String(err) }));
      else toast.success(done);
      refresh();
    } finally {
      setBusy(null);
    }
  }
  if (q.isError && isNotInstalled(q.error))
    return <p className="mb-8 text-xs text-muted-foreground">{t("xa.notInstalled")}</p>;
  if (q.isLoading)
    return (
      <p role="status" className="mb-8 text-xs text-muted-foreground">
        {t("xa.loading")}
      </p>
    );
  if (q.isError || !q.data)
    return (
      <p role="alert" className="mb-8 text-xs text-destructive">
        {t("xa.loadFailed")}
      </p>
    );
  const d = q.data;
  const now = new Date();
  const ov = integrationOverview(d.connections, d.actions, now);
  const tiles: [string, number, boolean][] = [
    ["connected", ov.connections.connected, false],
    ["expired", ov.connections.expired, true],
    ["permission", ov.connections.permission, true],
    ["syncErrors", ov.connections.syncErrors, true],
    ["stale", ov.connections.stale, true],
    ["disconnected", ov.connections.disconnected, false],
    ["inReview", ov.actions.inReview, false],
    ["inProgress", ov.actions.inProgress, false],
    ["failed", ov.actions.failed + ov.actions.uncertain, true],
    ["awaitingVerification", ov.actions.awaitingVerification, false],
    ["verified", ov.actions.verified, false],
    ["verificationFailed", ov.actions.verificationFailed, true],
  ];
  const visible = d.connections.filter((c) => c.simulated || c.status !== "not_configured");
  return (
    <section aria-label={t("xa.hub.title")} className="mb-10">
      <SectionHeading eyebrow={t("xa.hub.eyebrow")} title={t("xa.hub.title")} />
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-muted-foreground">{t("xa.hub.intro")}</p>
      <SimulatedNotice className="mb-5" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map(([k, v, warn]) => (
          <div key={k} className="flex min-w-0 flex-col bg-card p-3">
            <span className="break-words text-2xs font-medium text-muted-foreground">
              {t(`xa.tile.${k}` as MessageKey)}
            </span>
            <span
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                warn && v > 0 && "text-destructive",
              )}
            >
              {v.toLocaleString(tag)}
            </span>
          </div>
        ))}
      </div>
      <Problems problems={ov.problems} data={d} />
      <h3 className="mb-3 mt-8 text-sm font-semibold">{t("xa.hub.connections")}</h3>
      {!visible.length && <p className="text-xs text-muted-foreground">{t("xa.hub.none")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((c) => (
          <ConnectionCard
            key={c.id}
            c={c}
            admin={admin}
            member={member}
            busy={busy === c.id}
            now={now}
            open={
              d.actions.filter(
                (a) =>
                  a.connection_id === c.id &&
                  ["draft", "in_review", "approved", "executing", "failed", "uncertain"].includes(
                    a.stage,
                  ),
              ).length
            }
            onLevels={(lv) =>
              act(
                c.id,
                () => growthDb.rpc("set_integration_levels", { _connection: c.id, _levels: lv }),
                t("xa.levelsSaved"),
              )
            }
            onHealth={(s) =>
              act(
                c.id,
                () =>
                  growthDb.rpc("set_simulated_integration_health", {
                    _connection: c.id,
                    _status: s,
                  }),
                t("xa.healthSaved"),
              )
            }
            onRevoke={() => {
              if (window.confirm(t("xa.revokeConfirm", { name: providerName(c.connector_key) })))
                void act(
                  c.id,
                  () => growthDb.rpc("revoke_simulated_integration", { _connection: c.id }),
                  t("xa.revoked"),
                );
            }}
            onSync={() =>
              act(
                c.id,
                () =>
                  sync({
                    data: {
                      workspaceId: o.workspace!.id,
                      connector: c.connector_key,
                      request: crypto.randomUUID(),
                    },
                  }),
                t("xa.synced"),
              )
            }
          />
        ))}
      </div>
      {admin && o.workspace && (
        <AddSimulated
          workspaceId={o.workspace.id}
          busy={busy === "new"}
          existing={
            new Set(
              d.connections.filter((c) => c.status !== "disabled").map((c) => c.connector_key),
            )
          }
          onAdd={(p, lv, sc) =>
            act(
              "new",
              () =>
                growthDb.rpc("connect_simulated_integration", {
                  _workspace: o.workspace!.id,
                  _provider: p,
                  _levels: lv,
                  _scenario: sc,
                }),
              t("xa.connectedSim"),
            )
          }
        />
      )}
    </section>
  );
}

function Problems({
  problems,
  data,
}: {
  problems: Problem[];
  data: {
    tasks: Map<string, { title: string }>;
    goals: Map<string, string>;
    plans: Map<string, string>;
  };
}) {
  const { t } = useI18n();
  return (
    <div className="mt-6 border-l-2 border-primary pl-4">
      <p className="section-label mb-1">{t("xa.officer")}</p>
      <h3 className="mb-2 text-sm font-semibold">{t("xa.problems.title")}</h3>
      {!problems.length ? (
        <p className="text-xs text-muted-foreground">{t("xa.problems.none")}</p>
      ) : (
        <ul className="space-y-3">
          {problems.slice(0, 8).map((p) => (
            <li key={p.kind + p.connectionId} className="text-xs">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <ShieldAlert className="h-3.5 w-3.5 text-destructive" aria-hidden />
                {t(`xa.problem.${p.kind}` as MessageKey, { name: providerName(p.connector) })}
                {p.simulated && <SimBadge />}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {p.actions.length
                  ? t("xa.problems.affects", {
                      a: p.actions.length,
                      t: p.tasks.length,
                      g: p.goals.length,
                      p: p.plans.length,
                    })
                  : t("xa.problems.noWork")}
              </p>
              {!!p.tasks.length && (
                <p className="mt-0.5 text-muted-foreground">
                  {p.tasks
                    .slice(0, 3)
                    .map((id) => data.tasks.get(id)?.title ?? "—")
                    .join(" · ")}
                  {p.goals.length
                    ? ` · ${t("xa.goal")}: ${p.goals
                        .slice(0, 2)
                        .map((g) => data.goals.get(g) ?? "—")
                        .join(", ")}`
                    : ""}
                  {p.plans.length
                    ? ` · ${t("xa.plan")}: ${p.plans
                        .slice(0, 1)
                        .map((g) => data.plans.get(g) ?? "—")
                        .join("")}`
                    : ""}
                </p>
              )}
              <p className="mt-0.5">
                {t(`xa.fix.${p.kind}` as MessageKey)}{" "}
                {!!p.actions.length && (
                  <Link
                    to="/app/actions"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t("xa.openActions")}
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectionCard({
  c,
  admin,
  member,
  busy,
  now,
  open,
  onLevels,
  onHealth,
  onRevoke,
  onSync,
}: {
  c: HubConnection;
  admin: boolean;
  member: boolean;
  busy: boolean;
  now: Date;
  open: number;
  onLevels: (l: Level[]) => void;
  onHealth: (s: string) => void;
  onRevoke: () => void;
  onSync: () => void;
}) {
  const { t, tag } = useI18n();
  const prov = providerByKey(c.connector_key);
  const h = connectionHealth(c, now);
  const fr = freshness(c.last_sync_at, now);
  const supported = new Set<string>(prov?.levels ?? []);
  const toggle = (l: Level, on: boolean) =>
    onLevels(LEVELS.filter((x) => (x === l ? on : c.granted_levels.includes(x))));
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h4 className="text-sm font-semibold">{providerName(c.connector_key)}</h4>
        {c.simulated ? (
          <SimBadge />
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {t("xa.real")}
          </span>
        )}
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-2xs font-medium",
            h === "connected"
              ? "border-success/40 text-success"
              : h === "disconnected"
                ? "border-border text-muted-foreground"
                : "border-destructive/40 text-destructive",
          )}
        >
          {t(`xa.health.${h}` as MessageKey)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
        <dt className="text-muted-foreground">{t("xa.category")}</dt>
        <dd>{prov ? t(`xa.cat.${prov.category}` as MessageKey) : "—"}</dd>
        <dt className="text-muted-foreground">{t("xa.account")}</dt>
        <dd className="break-words">
          {c.simulated ? t("xa.simAccount") : (c.account_label ?? "—")}
        </dd>
        <dt className="text-muted-foreground">{t("xa.connectedOn")}</dt>
        <dd>{c.connected_at ? new Date(c.connected_at).toLocaleDateString(tag) : "—"}</dd>
        <dt className="text-muted-foreground">{t("xa.lastSync")}</dt>
        <dd>
          {c.last_sync_at
            ? new Date(c.last_sync_at).toLocaleString(tag, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : t("xa.never")}{" "}
          · {t(`xa.fresh.${fr}` as MessageKey)}
        </dd>
        {c.last_error && (
          <>
            <dt className="text-muted-foreground">{t("xa.lastError")}</dt>
            <dd className="break-words text-destructive">{connectionErrorText(c.last_error, t)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t("xa.openActionsN")}</dt>
        <dd>{open}</dd>
      </dl>
      <fieldset className="mt-3" disabled={!admin || busy || h === "disconnected"}>
        <legend className="mb-1 text-2xs font-medium">{t("xa.permissions")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {LEVELS.map((l) => (
            <label
              key={l}
              className={cn(
                "flex items-center gap-1.5 text-2xs",
                !supported.has(l) && "text-muted-foreground line-through",
              )}
              title={supported.has(l) ? t(`xa.levelDesc.${l}` as MessageKey) : t("xa.unsupported")}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={c.granted_levels.includes(l)}
                disabled={!supported.has(l)}
                onChange={(e) => toggle(l, e.target.checked)}
              />
              {t(`xa.level.${l}` as MessageKey)}
            </label>
          ))}
        </div>
        {!c.simulated && (
          <p className="mt-1 text-2xs text-muted-foreground">{t("xa.realReadOnly")}</p>
        )}
      </fieldset>
      {c.simulated && h !== "disconnected" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {member && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onSync}>
              <RefreshCw />
              {t("xa.syncNow")}
            </Button>
          )}
          {admin && (
            <label className="flex items-center gap-1.5 text-2xs">
              {t("xa.simulateHealth")}
              <select
                className="rounded-md border border-border bg-card px-2 py-1 text-2xs"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && onHealth(e.target.value)}
              >
                <option value="">—</option>
                {["connected", "expired", "insufficient_scope", "error"].map((s) => (
                  <option key={s} value={s}>
                    {t(`xa.healthOpt.${s}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {admin && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={onRevoke}
            >
              <Unplug />
              {t("xa.revoke")}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function AddSimulated({
  busy,
  existing,
  onAdd,
}: {
  workspaceId: string;
  busy: boolean;
  existing: Set<string>;
  onAdd: (p: string, l: string[], s: string) => void;
}) {
  const { t } = useI18n();
  const options = SIMULATED_PROVIDERS.filter((p) => !existing.has(p.key));
  const [prov, setProv] = useState(options[0]?.key ?? "");
  const [levels, setLevels] = useState<string[]>(["read"]);
  const [scenario, setScenario] = useState("healthy");
  const p = providerByKey(prov);
  if (!options.length) return null;
  return (
    <form
      className="mt-6 rounded-lg border border-dashed border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (p)
          onAdd(
            p.key,
            levels.filter((l) => p.levels.includes(l as Level)),
            scenario,
          );
      }}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4 text-warning" aria-hidden />
        {t("xa.add.title")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("xa.add.intro")}</p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("xa.add.provider")}</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
            value={prov}
            onChange={(e) => {
              setProv(e.target.value);
              setLevels(["read"]);
            }}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name} · {t(`xa.cat.${o.category}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-2xs">
          <span className="mb-1 block font-medium">{t("xa.add.scenario")}</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            {["healthy", "expired", "insufficient_scope", "error"].map((s) => (
              <option key={s} value={s}>
                {t(`xa.scenario.${s}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-2xs font-medium">{t("xa.permissions")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {LEVELS.filter((l) => p?.levels.includes(l)).map((l) => (
            <label key={l} className="flex items-center gap-1.5 text-2xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={levels.includes(l)}
                disabled={l === "read"}
                onChange={(e) =>
                  setLevels((x) => (e.target.checked ? [...x, l] : x.filter((y) => y !== l)))
                }
              />
              {t(`xa.level.${l}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" size="sm" className="mt-3" disabled={busy || !p}>
        {t("xa.add.submit")}
      </Button>
    </form>
  );
}
