import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { growthDraftKey } from "@/lib/growth-draft";

export function GrowthQuestion({ compact = false }: { compact?: boolean }) {
  const o = useOrg();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const { t } = useI18n();
  const allowed = can(o.workspaceRole, "ai.use");
  function start(message: string) {
    if (!message.trim() || !allowed || !o.org || !o.workspace) return;
    sessionStorage.setItem(growthDraftKey(o.org.id, o.workspace.id), message.trim());
    navigate({ to: "/app/growth-officer" });
  }
  const prompts = (
    compact
      ? (["officer.starter.prioritize", "officer.starter.plan30"] as const)
      : ([
          "officer.starter.opportunities",
          "officer.starter.tasksToday",
          "officer.starter.missing",
        ] as const)
  ).map((k) => t(k));
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(question);
        }}
        className="rounded-lg border border-border bg-card p-3 focus-within:border-primary/50"
      >
        <Textarea
          aria-label={t("officer.askLabel")}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!allowed}
          maxLength={4000}
          rows={compact ? 2 : 3}
          placeholder={allowed ? t("officer.askPlaceholder") : t("officer.memberRequired")}
          className="min-h-16 resize-none border-0 bg-transparent p-1 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("officer.askFooter")}
          </span>
          <Button
            size="icon"
            type="submit"
            disabled={!allowed || !question.trim()}
            aria-label={t("officer.askLabel")}
            title={t("officer.startQuestion")}
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            variant="ghost"
            size="sm"
            className="h-auto max-w-full whitespace-normal border border-border px-3 py-2 text-left text-[11px] text-muted-foreground"
            disabled={!allowed}
            onClick={() => start(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}
