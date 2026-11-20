// Conflicting business facts on the business profile: every value with its source, date and confirmation state,
// the more reliable one only when it is clearly determinable, and an editor's decision that confirms one value
// and returns the others to review in one step (resolve_fact_conflict, proposal 0074). Nothing is chosen silently.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { growthDb } from "@/lib/pending-schema";
import { detectFactConflicts, type FactRow } from "@/lib/fact-conflicts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/app/status";

export function FactConflicts({ facts, canDecide, sourceLabel, onResolved }: {
  facts: FactRow[]; canDecide: boolean; sourceLabel: (s: string) => string; onResolved: () => void;
}) {
  const { t, tag } = useI18n();
  const conflicts = useMemo(() => detectFactConflicts(facts), [facts]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!conflicts.length) return null;
  async function keep(topic: string, id: string, others: string[]) {
    setBusy(id);
    const r = await growthDb.rpc("resolve_fact_conflict", { _keep: id, _others: others, _note: notes[topic] ?? "" });
    setBusy(null);
    if (r.error) {
      const code = (r.error as { code?: string }).code;
      toast.error(code === "PGRST202" ? t("ev.cf.notInstalled") : code === "42501" ? t("ev.cf.editorOnly") : r.error.message);
      return;
    }
    toast.success(t("ev.cf.done"));
    onResolved();
  }
  return (
    <section aria-labelledby="fact-conflicts" className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <h2 id="fact-conflicts" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" />{t("ev.cf.title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("ev.cf.intro")}</p>
      <div className="mt-3 space-y-4">
        {conflicts.map((c) => (
          <article key={c.topic} className="min-w-0 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-sm font-medium">{c.key}</h3>
              <span className="text-[11px] text-muted-foreground">{t("ev.cf.values", { n: c.values })}</span>
            </div>
            {c.confirmedConflict && <p className="mt-1 text-[11px] text-warning">{t("ev.cf.bothConfirmed")}</p>}
            {!c.preferred && <p className="mt-1 text-[11px] text-muted-foreground">{t("ev.cf.undetermined")}</p>}
            <ul className="mt-2 divide-y divide-border">
              {c.facts.map((f) => (
                <li key={f.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{f.value}</p>
                    <p className="mt-0.5 break-all text-[10px] text-muted-foreground">
                      {sourceLabel(f.source_type)}{f.source_ref ? ` · ${f.source_ref}` : ""}{f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString(tag)}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusChip status={f.verified ? "approved" : "pending"}>{f.verified ? t("ev.cf.confirmed") : t("ev.cf.review")}</StatusChip>
                      {c.preferred === f.id && <StatusChip status="implemented">{t("ev.cf.preferred")} · {t(c.basis === "confirmed" ? "ev.cf.basis.confirmed" : "ev.cf.basis.source")}</StatusChip>}
                    </div>
                  </div>
                  {canDecide && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => keep(c.topic, f.id, c.facts.filter((x) => x.id !== f.id).map((x) => x.id))}>
                      {t("ev.cf.keep")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canDecide ? (
              <Input aria-label={t("ev.cf.note")} placeholder={t("ev.cf.note")} maxLength={500} className="mt-2 h-8" value={notes[c.topic] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.topic]: e.target.value }))} />
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">{t("ev.cf.editorOnly")}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
