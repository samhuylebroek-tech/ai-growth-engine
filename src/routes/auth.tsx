import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { LanguagePicker } from "@/components/app/language-picker";

function safeRedirect(r: unknown): string {
  if (typeof r !== "string") return "/app";
  try { const u = new URL(r, "http://x"); if (u.origin !== "http://x" && typeof window !== "undefined" && u.origin !== window.location.origin) return "/app"; return u.pathname + u.search; } catch { return "/app"; }
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s["redirect"] === "string" ? s["redirect"] : undefined }),
  head: () => ({ meta: [
    { title: "Sign in — AI Growth Engine" }, { name: "description", content: "Sign in or create your AI Growth Engine account." },
    { property: "og:title", content: "Sign in — AI Growth Engine" }, { property: "og:description", content: "Sign in or create your AI Growth Engine account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate(); const { t: tx } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState<string | null>(null);
  const target = safeRedirect(redirect);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: target as "/app" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + target, data: { full_name: name } } });
        if (error) throw error;
        setSent(tx("pages.au.confirm"));
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setSent(tx("pages.au.resetSent"));
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : tx("pages.au.wrong")); }
    finally { setBusy(false); }
  }

  async function social(provider: "google" | "microsoft") {
    if (redirect) sessionStorage.setItem("ago.postAuth", target);
    const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/auth" });
    if (r.error) { toast.error(tx("pages.au.socialFailed", { p: provider === "google" ? "Google" : "Microsoft" })); return; }
    if (r.redirected) return;
    navigate({ to: target as "/app" });
  }

  async function organizationSso() {
    if (redirect) sessionStorage.setItem("ago.postAuth", target);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "custom:app-oidc", options: { redirectTo: window.location.origin + "/auth" } });
    if (error) toast.error(tx("pages.au.ssoMissing"));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-glow px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between gap-3"><Link to="/" className="flex items-center gap-2 font-display text-lg font-bold"><Zap className="h-5 w-5 text-primary" /> AI Growth Engine</Link><LanguagePicker /></div>
        <div className="rounded-lg border border-border bg-card p-7">
          <h1 className="text-xl font-bold">{mode === "signin" ? tx("pages.au.welcome") : mode === "signup" ? tx("pages.au.create") : tx("pages.au.reset")}</h1>
          {sent ? <p className="mt-4 text-sm text-muted-foreground">{sent}</p> : (
            <>
              {mode !== "forgot" && (
                <>
                  <div className="mt-6 grid gap-2">
                    <Button type="button" variant="outline" className="w-full border-google-border bg-google-background px-3 text-google-foreground hover:bg-google-background/90" onClick={() => social("google")}><GoogleLogo />{tx("pages.au.google")}</Button>
                    <Button type="button" variant="outline" className="w-full" onClick={() => social("microsoft")}>{tx("pages.au.microsoft")}</Button>
                    <Button type="button" variant="ghost" className="w-full text-xs" onClick={organizationSso}>{tx("pages.au.sso")}</Button>
                    <p className="text-center text-xs text-muted-foreground">{tx("pages.au.ssoNote")}</p>
                  </div>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />{tx("pages.au.or")}<div className="h-px flex-1 bg-border" /></div>
                </>
              )}
              <form onSubmit={submit} className="space-y-4">
                {mode === "signup" && <div className="space-y-1.5"><Label htmlFor="name">{tx("pages.au.name")}</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></div>}
                <div className="space-y-1.5"><Label htmlFor="email">{tx("pages.au.email")}</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
                {mode !== "forgot" && <div className="space-y-1.5"><Label htmlFor="password">{tx("pages.au.password")}</Label><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>}
                <Button type="submit" className="w-full" disabled={busy}>{busy ? tx("pages.au.wait") : mode === "signin" ? tx("pages.au.signIn") : mode === "signup" ? tx("pages.au.createAccount") : tx("pages.au.sendReset")}</Button>
              </form>
            </>
          )}
          <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
            {mode === "signin" && <><Button variant="link" onClick={() => { setMode("forgot"); setSent(null); }}>{tx("pages.au.forgot")}</Button><div>{tx("pages.au.newHere")} <Button variant="link" onClick={() => { setMode("signup"); setSent(null); }}>{tx("pages.au.createLink")}</Button></div></>}
            {mode !== "signin" && <Button variant="link" onClick={() => { setMode("signin"); setSent(null); }}>{tx("pages.au.back")}</Button>}
          </div>
        </div>
      </div>
      <PostOAuthRedirect />
    </div>
  );
}

function GoogleLogo() {
  return <svg aria-hidden="true" className="h-[18px] w-[18px]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>;
}

function PostOAuthRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { const t = sessionStorage.getItem("ago.postAuth") ?? "/app"; sessionStorage.removeItem("ago.postAuth"); navigate({ to: safeRedirect(t) as "/app" }); }
    });
  }, [navigate]);
  return null;
}
