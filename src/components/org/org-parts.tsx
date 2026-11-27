import { useI18n } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n/messages";
import type { Finding } from "@/lib/org/coordination";
import { Panel } from "@/components/app/status";
import { tk } from "@/components/org/org-model";

export function subjectLabel(t: ReturnType<typeof useI18n>["t"], code: string, subject: string) {
  const known = (k: string) => (k in MESSAGES.en ? t(tk(k)) : subject);
  if (code === "attend_business") return subject ? known(`org.reason.${subject}`) : "";
  if (code === "specialist_contention" || code === "opp_specialist_reuse")
    return known(`run.sp.${subject}`);
  if (code === "shared_bottleneck") return known(`org.bottleneck.${subject}`);
  if (code === "strategy_reuse" || code === "opp_strategy_reuse")
    return known(`goals.obj.${subject}`);
  return subject;
}

export function FindingCard({ f, name }: { f: Finding; name: (id: string) => string }) {
  const { t } = useI18n();
  return (
    <li>
      <Panel className="h-full">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(tk(`org.find.${f.code}`))}
        </p>
        <p className="mt-1 text-sm font-medium">
          {f.businesses.map(name).join(" · ")} — {subjectLabel(t, f.code, f.subject)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t(tk(`org.findHow.${f.code}`))}</p>
        {f.code !== "specialist_contention" && f.evidence.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs">
            {f.evidence.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
      </Panel>
    </li>
  );
}
