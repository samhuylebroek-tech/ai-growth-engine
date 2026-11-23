import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

type Enrolling = { id: string; qr: string; secret: string };

/** Two-step verification (authenticator app) and signing out other devices, for the signed-in account. */
export function AccountSecurity() {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const [f, a] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (f.error) throw f.error;
      return {
        verified: f.data.totp,
        pending: f.data.all.filter((x) => x.factor_type === "totp" && x.status !== "verified"),
        level: a.data?.currentLevel ?? null,
      };
    },
  });
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-factors"] });

  async function start() {
    setBusy(true);
    try {
      // Abandoned set-ups would otherwise pile up as unverified factors.
      for (const p of q.data?.pending ?? []) await supabase.auth.mfa.unenroll({ factorId: p.id });
      const r = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
      });
      if (r.error || !r.data) {
        toast.error(t("sec.acc.failed"));
        return;
      }
      setEnrolling({ id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret });
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling || !/^\d{6}$/.test(code)) {
      toast.error(t("sec.acc.badCode"));
      return;
    }
    setBusy(true);
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code });
    setBusy(false);
    if (r.error) {
      toast.error(t("sec.acc.badCode"));
      return;
    }
    toast.success(t("sec.acc.verified"));
    setEnrolling(null);
    setCode("");
    await refresh();
  }
  async function cancel() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.id });
    setEnrolling(null);
    setCode("");
    await refresh();
  }
  async function remove(id: string) {
    if (!window.confirm(t("sec.acc.confirmRemove"))) return;
    const r = await supabase.auth.mfa.unenroll({ factorId: id });
    if (r.error) {
      toast.error(t("sec.acc.needVerify"));
      return;
    }
    await supabase.auth.refreshSession();
    toast.success(t("sec.acc.removed"));
    await refresh();
  }
  async function signOutOthers() {
    if (!window.confirm(t("sec.acc.confirmOthers"))) return;
    const r = await supabase.auth.signOut({ scope: "others" });
    if (r.error) toast.error(t("sec.acc.failed"));
    else toast.success(t("sec.acc.signedOutOthers"));
  }

  const verified = q.data?.verified ?? [];
  return (
    <section aria-labelledby="account-security" className="mt-10 max-w-2xl">
      <h2 id="account-security" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4" />
        {t("sec.acc.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("sec.acc.desc")}</p>
      {q.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t("sec.acc.loadFailed")}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm" role="status">
            {q.data?.level === "aal2"
              ? t("sec.acc.level2")
              : verified.length
                ? t("sec.acc.level1")
                : t("sec.acc.noFactor")}
          </p>
          {verified.length > 0 && (
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {verified.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    {t("sec.acc.enabled", { date: new Date(f.created_at).toLocaleDateString(tag) })}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => remove(f.id)}>
                    {t("sec.acc.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!enrolling && verified.length === 0 && (
            <Button className="mt-4" onClick={start} disabled={busy || q.isLoading}>
              {t("sec.acc.setup")}
            </Button>
          )}
          {enrolling && (
            <form onSubmit={verify} className="mt-4 space-y-3 rounded-md border border-border p-4">
              <p className="text-sm">{t("sec.acc.scan")}</p>
              <img
                src={enrolling.qr}
                alt={t("sec.acc.qrAlt")}
                className="h-44 w-44 rounded bg-background p-2"
              />
              <p className="text-xs text-muted-foreground">
                {t("sec.acc.secret")}{" "}
                <code className="break-all font-mono">{enrolling.secret}</code>
              </p>
              <div className="max-w-xs space-y-1">
                <Label htmlFor="mfa-code">{t("sec.acc.code")}</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {t("sec.acc.verify")}
                </Button>
                <Button type="button" variant="ghost" onClick={cancel}>
                  {t("sec.acc.cancel")}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <div className="mt-8 border-t border-border pt-6">
        <h3 className="text-sm font-semibold">{t("sec.acc.sessionsTitle")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("sec.acc.sessionsDesc")}</p>
        <Button variant="outline" className="mt-3" onClick={signOutOthers}>
          <LogOut />
          {t("sec.acc.signOutOthers")}
        </Button>
      </div>
    </section>
  );
}
