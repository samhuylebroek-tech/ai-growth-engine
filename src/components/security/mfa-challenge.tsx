import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

/** Asks for the authenticator code so the session becomes two-step verified (aal2); the server re-checks every request. */
export function MfaChallenge({ onVerified }: { onVerified: () => void }) {
  const { t } = useI18n();
  const f = useQuery({ queryKey: ["mfa-factors-challenge"], queryFn: async () => { const r = await supabase.auth.mfa.listFactors(); if (r.error) throw r.error; return r.data.totp; } });
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [bad, setBad] = useState(false);
  const factor = f.data?.[0];
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!factor) return;
    setBusy(true); setBad(false);
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (r.error) { setBad(true); return; }
    onVerified();
  }
  return <div className="mx-auto max-w-md px-6 py-16">
    <h1 className="flex items-center gap-2 text-xl font-semibold"><ShieldAlert className="h-5 w-5" />{t("sec.mfa.title")}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{t("sec.mfa.desc")}</p>
    {f.isLoading ? null : !factor ? <div className="mt-6 space-y-3">
      <p className="text-sm">{t("sec.mfa.noFactor")}</p>
      <Button asChild variant="outline"><Link to="/app/settings">{t("sec.mfa.goSetup")}</Link></Button>
    </div> : <form onSubmit={submit} className="mt-6 space-y-3">
      <div className="space-y-1"><Label htmlFor="owner-mfa">{t("sec.mfa.code")}</Label>
        <Input id="owner-mfa" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
      {bad && <p role="alert" className="text-sm text-destructive">{t("sec.mfa.bad")}</p>}
      <Button type="submit" disabled={busy || code.length !== 6}>{t("sec.mfa.verify")}</Button>
    </form>}
  </div>;
}
