import { localHead } from "@/lib/page-head";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/invite/$token")({
  head: () => ({
    ...localHead("invite"),
    meta: [...localHead("invite").meta, { name: "robots", content: "noindex" }],
  }),
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_invitation", { _token: token });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("different email")
          ? "This invitation was sent to a different email address."
          : "This invitation is invalid or has expired.",
      );
      return;
    }
    localStorage.setItem("ago.org", data as string);
    localStorage.removeItem("ago.ws");
    toast.success("You joined the organization");
    navigate({ to: "/app" });
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 text-center">
        <h1 className="text-xl font-bold">You've been invited</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accept to join the organization with the role you were invited as.
        </p>
        <Button className="mt-6 w-full" onClick={accept} disabled={busy}>
          Accept invitation
        </Button>
      </div>
    </div>
  );
}
