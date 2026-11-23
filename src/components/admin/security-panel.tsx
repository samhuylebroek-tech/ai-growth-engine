import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { OctagonX, Play, ShieldCheck, ShieldX } from "lucide-react";
import { getSecurityOverview, setPlatformStop } from "@/lib/security.functions";
import { Panel } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";

const EVENT_KINDS = [
  "owner_access_denied",
  "owner_mfa_required",
  "credit_price_denied",
  "platform_stop_denied",
] as const;

/** Platform Owner: audit chain verification, refused-access signals and the platform-wide emergency stop. */
export function SecurityPanel() {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getSecurityOverview);
  const stopFn = useServerFn(setPlatformStop);
  const q = useQuery({ queryKey: ["owner", "security"], queryFn: () => load() });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
  if (q.isLoading) return null;
  if (!q.data?.ok)
    return (
      <section className="mt-10">
        <h2 className="mb-2 font-semibold">{t("sec.own.title")}</h2>
        <p role="alert" className="text-sm text-muted-foreground">
          {t(
            q.data?.ok === false && q.data.error === "not_installed"
              ? "sec.own.notInstalled"
              : "sec.own.failed",
          )}
        </p>
      </section>
    );
  const { chain, overview } = q.data;
  const platformStop = overview.stops.find((s) => s.scope === "platform");
  async function toggle(stop: boolean) {
    if (stop && !window.confirm(t("sec.own.confirmStop"))) return;
    setBusy(true);
    const r = await stopFn({ data: { stop, reason } });
    setBusy(false);
    if (!r.ok) {
      toast.error(
        t(
          r.error === "reason"
            ? "sec.own.reasonNeeded"
            : r.error === "mfa_required"
              ? "sec.mfa.title"
              : "sec.own.stopFailed",
        ),
      );
      return;
    }
    toast.success(t(stop ? "sec.own.stopped" : "sec.own.resumed"));
    setReason("");
    await qc.invalidateQueries({ queryKey: ["owner", "security"] });
  }
  return (
    <section className="mt-10" aria-labelledby="owner-security">
      <h2 id="owner-security" className="mb-1 font-semibold">
        {t("sec.own.title")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">{t("sec.own.desc")}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <div className="flex items-center gap-2 text-sm font-medium">
            {chain.ok ? (
              <ShieldCheck className="h-4 w-4 text-success" />
            ) : (
              <ShieldX className="h-4 w-4 text-destructive" />
            )}
            {t("sec.own.chain")}
          </div>
          <p className="mt-2 text-sm" role="status">
            {chain.ok
              ? t("sec.own.chainOk", { n: chain.checked })
              : t("sec.own.chainBad", {
                  kind: t(
                    `sec.own.problem.${chain.problem?.kind ?? "head_mismatch"}` as MessageKey,
                  ),
                  seq: chain.problem?.seq ?? 0,
                })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("sec.own.unchained", {
              n: chain.unchained_before_start,
              date: when(chain.started_at),
            })}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {t("sec.own.head", { seq: chain.head_seq, hash: chain.head_hash.slice(0, 16) })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("sec.own.chainNote")}</p>
        </Panel>
        <Panel>
          <div className="text-sm font-medium">{t("sec.own.events", { n: overview.days })}</div>
          <ul className="mt-2 space-y-1 text-sm">
            {EVENT_KINDS.map((k) => (
              <li key={k} className="flex justify-between gap-3">
                <span>{t(`sec.own.kind.${k}` as MessageKey)}</span>
                <span className="tabular-nums">{overview.by_kind[`security.${k}`] ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs font-medium">{t("sec.own.repeated")}</div>
          {overview.repeated.length ? (
            <ul className="mt-1 space-y-1 text-xs">
              {overview.repeated.map((r) => (
                <li key={r.actor} className="break-all">
                  {t("sec.own.repeatedRow", {
                    actor: r.actor.slice(0, 8),
                    n: r.count,
                    when: when(r.last),
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("sec.own.noRepeated")}</p>
          )}
          <div className="mt-3 text-xs font-medium">{t("sec.own.spikes")}</div>
          {overview.credit_spikes.length ? (
            <ul className="mt-1 space-y-1 text-xs">
              {overview.credit_spikes.map((s) => (
                <li key={s.org} className="break-all">
                  {t("sec.own.spike", { org: s.org.slice(0, 8), a: s.last_24h, b: s.daily_avg_7d })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("sec.own.noSpikes")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("sec.own.signalsNote")}</p>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-sm font-medium">
            <OctagonX className="h-4 w-4" />
            {t("sec.own.stopTitle")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("sec.own.stopDesc")}</p>
          {platformStop ? (
            <>
              <p role="status" className="mt-3 text-sm font-medium text-destructive">
                {t("sec.own.stopActive", {
                  reason: platformStop.reason,
                  when: when(platformStop.started_at),
                })}
              </p>
              <Button
                className="mt-3"
                variant="outline"
                disabled={busy}
                onClick={() => toggle(false)}
              >
                <Play />
                {t("sec.own.resume")}
              </Button>
            </>
          ) : (
            <>
              <Textarea
                aria-label={t("sec.own.reason")}
                placeholder={t("sec.own.reason")}
                className="mt-3"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                className="mt-3"
                variant="destructive"
                disabled={busy || reason.trim().length < 3}
                onClick={() => toggle(true)}
              >
                <OctagonX />
                {t("sec.own.stop")}
              </Button>
            </>
          )}
        </Panel>
      </div>
    </section>
  );
}
