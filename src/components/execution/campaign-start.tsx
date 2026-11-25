import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { growthDraftKey, storeGrowthContext } from "@/lib/growth-draft";
import { can } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";

const INTENTS = [
  "customers",
  "sales",
  "leads",
  "visitors",
  "returning",
  "launch",
  "improve",
  "discover",
  "custom",
] as const;
export function CampaignStart({ renderForm }: { renderForm: (objective: string) => ReactNode }) {
  const { t } = useI18n();
  const o = useOrg();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<string>("customers");
  const [customObjective, setCustomObjective] = useState("");
  const [step, setStep] = useState<"intent" | "choice" | "form">("intent");
  const objective =
    intent === "custom"
      ? customObjective.trim()
      : t(`ch.intent.${intent}` as `ch.intent.${Exclude<(typeof INTENTS)[number], "custom">}`);
  function ask() {
    if (!o.org || !o.workspace || !can(o.workspaceRole, "ai.use")) return;
    storeGrowthContext(sessionStorage, o.org.id, o.workspace.id, [], "");
    sessionStorage.setItem(
      growthDraftKey(o.org.id, o.workspace.id),
      t("ch.prompt", { objective: objective || t("ch.custom") }),
    );
    void navigate({ to: "/app/growth-officer" });
  }
  if (step !== "intent")
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => setStep("intent")}>
          <ChevronLeft />
          {t("ch.back")}
        </Button>
        {step === "form" ? (
          renderForm(objective)
        ) : (
          <>
            <h3 className="text-lg font-semibold">{objective || t("ch.custom")}</h3>
            {intent === "custom" && (
              <Field label={t("ch.objective")}>
                <Input
                  value={customObjective}
                  onChange={(e) => setCustomObjective(e.target.value)}
                />
              </Field>
            )}
            <Button
              disabled={!can(o.workspaceRole, "ai.use")}
              className="h-auto min-h-11 w-full justify-start whitespace-normal py-3 text-left"
              onClick={ask}
            >
              <Sparkles />
              {t("ch.ask")}
            </Button>
            <p className="text-sm text-muted-foreground">{t("ch.aiCost")}</p>
            <Button
              variant="outline"
              className="h-auto min-h-11 w-full justify-start whitespace-normal py-3 text-left"
              onClick={() => setStep("form")}
            >
              <Plus />
              {t("ch.manual")}
            </Button>
          </>
        )}
      </div>
    );
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold">{t("ch.question")}</h3>
      <RadioGroup value={intent} onValueChange={setIntent} className="grid gap-2 sm:grid-cols-2">
        {INTENTS.map((key) => (
          <label
            key={key}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-3 text-sm"
          >
            <RadioGroupItem value={key} />
            {key === "custom" ? t("ch.custom") : t(`ch.intent.${key}`)}
          </label>
        ))}
      </RadioGroup>
      <Button onClick={() => setStep("choice")}>
        {t("ch.continue")}
        <ArrowRight />
      </Button>
    </div>
  );
}
