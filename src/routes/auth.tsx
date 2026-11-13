import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function safeRedirect(r: unknown): string {
  if (typeof r !== "string") return "/app";
  try { const u = new URL(r, "http://x"); if (u.origin !== "http://x" && typeof window !== "undefined" && u.origin !== window.location.origin) return "/app"; return u.pathname + u.search; } catch { return "/app"; }
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s["redirect"] === "string" ? s["redirect"] : undefined }),
  head: () => ({ meta: [
    { title: "Sign in — AI Growth OS" }, { name: "description", content: "Sign in or create your AI Growth OS account." },
    { property: "og:title", content: "Sign in — AI Growth OS" }, { property: "og:description", content: "Sign in or create your AI Growth OS account." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
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
        setSent("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setSent("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function google() {
    if (redirect) sessionStorage.setItem("ago.postAuth", target);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) { toast.error("Google sign-in failed"); return; }
    if (r.redirected) return;
    navigate({ to: target as "/app" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-glow px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-display text-lg font-bold"><Zap className="h-5 w-5 text-primary" /> AI Growth OS</Link>
        <div className="rounded-2xl border border-border bg-card p-7">
          <h1 className="text-xl font-bold">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}</h1>
          {sent ? <p className="mt-4 text-sm text-muted-foreground">{sent}</p> : (
            <>
              {mode !== "forgot" && (
                <>
                  <Button type="button" variant="outline" className="mt-6 w-full" onClick={google}>Continue with Google</Button>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
                </>
              )}
              <form onSubmit={submit} className="space-y-4">
                {mode === "signup" && <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></div>}
                <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
                {mode !== "forgot" && <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>}
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</Button>
              </form>
            </>
          )}
          <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
            {mode === "signin" && <><button className="hover:text-foreground" onClick={() => { setMode("forgot"); setSent(null); }}>Forgot password?</button><div>New here? <button className="text-primary hover:underline" onClick={() => { setMode("signup"); setSent(null); }}>Create an account</button></div></>}
            {mode !== "signin" && <button className="text-primary hover:underline" onClick={() => { setMode("signin"); setSent(null); }}>Back to sign in</button>}
          </div>
        </div>
      </div>
      <PostOAuthRedirect />
    </div>
  );
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
