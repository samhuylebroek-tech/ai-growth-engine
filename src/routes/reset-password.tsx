import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isRecoveryHash } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [
    { title: "Set a new password — AI Growth OS" }, { name: "description", content: "Choose a new password for your account." },
    { property: "og:title", content: "Set a new password — AI Growth OS" }, { property: "og:description", content: "Choose a new password for your account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: ResetPassword,
});

function ResetPassword() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const navigate = useNavigate();

  useEffect(() => {
    if (!isRecoveryHash(window.location.hash)) { setState("invalid"); return; }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === "PASSWORD_RECOVERY") setState("ready");
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session && isRecoveryHash(window.location.hash)) setState("ready");
    });
    const timeout = window.setTimeout(() => { if (active) setState((current) => current === "ready" ? "ready" : "invalid"); }, 8000);
    return () => { active = false; window.clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state !== "ready" || !isRecoveryHash(window.location.hash)) { setState("invalid"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated"); navigate({ to: "/app" });
  }

  if (state === "invalid") return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-7 text-center">
        <h1 className="text-xl font-bold">This reset link isn't valid</h1>
        <p className="mt-3 text-sm text-muted-foreground">Request a new password-reset link and open it directly from your email.</p>
        <Button asChild className="mt-6 w-full"><Link to="/auth" search={{ redirect: undefined }}>Request a new link</Link></Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-7">
        <h1 className="text-xl font-bold">Set a new password</h1>
        {state === "checking" ? <p role="status" className="text-sm text-muted-foreground">Checking your recovery link…</p> : <>
          <div className="space-y-1.5"><Label htmlFor="pw">New password</Label><Input id="pw" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
          <Button className="w-full" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
        </>}
      </form>
    </div>
  );
}
