// "Ask the Growth Officer to design experiments": one explicit metered request; results become drafts only.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { designExperiments } from "@/lib/ai.functions";
import { requestAttemptKey } from "@/lib/single-ai-request";
import { CREDIT_RULES } from "@/lib/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { biKey } from "./bi-data";
import { experimentDetailKey } from "./experiment-data";

export function ExperimentAI() {
  const o = useOrg();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const run = useServerFn(designExperiments);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  if (!o.org || !o.workspace) return null;
  const orgId = o.org.id;
  const wsId = o.workspace.id;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const scope = `experiments/${orgId}/${wsId}`;
    // Same inputs keep the same request key until success, so a retry never pays twice.
    const requestKey = requestAttemptKey(
      sessionStorage,
      scope,
      JSON.stringify({ focus: focus.trim(), locale }),
      () => crypto.randomUUID(),
    );
    try {
      const r = await run({
        data: { orgId, workspaceId: wsId, requestKey, focus: focus.trim(), locale },
      });
      if (!r.ok) return void toast.error(r.error);
      sessionStorage.removeItem(`single-ai-attempt:${scope}`);
      toast.success(t("exp.ai.done", { n: r.data.saved, c: r.data.credits }));
      setFocus("");
      void qc.invalidateQueries({ queryKey: biKey(orgId, wsId) });
      void qc.invalidateQueries({ queryKey: experimentDetailKey(orgId, wsId) });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(t("exp.ai.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="mt-4 rounded-lg border border-border bg-card p-3 text-xs"
      aria-label={t("exp.ai.title")}
    >
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <Sparkles className="h-4 w-4" aria-hidden />
        {t("exp.ai.title")}
      </h2>
      <p className="mt-1 text-muted-foreground">
        {t("exp.ai.intro", { c: CREDIT_RULES.reserveGrowthOfficer })}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={500}
          placeholder={t("exp.ai.focus")}
          aria-label={t("exp.ai.focus")}
          className="h-8"
        />
        <Button size="sm" onClick={go} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
          {t("exp.ai.run")}
        </Button>
      </div>
    </section>
  );
}
