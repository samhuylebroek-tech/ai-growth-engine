import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { draftContent } from "@/lib/ai.functions";
import { CONTENT_TYPES, LENGTHS, type DraftBrief } from "@/lib/content-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
const typeKey = (t: string) => `marketing.cs.ct.${t.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`;
const AI_LANGUAGE = { en: "English", nl: "Dutch", fr: "French" } as const;

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Explicit, user-started AI draft. The result is only a suggestion until the user saves and approves a version. */
export function DraftPanel({ orgId, wsId, assetId, hasDraft, onUse }: { orgId: string; wsId: string; assetId: string; hasDraft: boolean; onUse: (text: string, mode: "replace" | "append") => void }) {
  const run = useServerFn(draftContent); const qc = useQueryClient(); const { t: tx, locale } = useI18n();
  const typeLabel = (t: string) => (typeKey(t) in MESSAGES.en ? tx(typeKey(t) as MessageKey) : t);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [result, setResult] = useState<string | null>(null);
  const [brief, setBrief] = useState<DraftBrief>({ contentType: "Blog article", audience: "", language: AI_LANGUAGE[locale], objective: "", keywords: "", tone: "", length: "medium", cta: "" });
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const set = <K extends keyof DraftBrief>(k: K, v: DraftBrief[K]) => { setBrief((b) => ({ ...b, [k]: v })); setRequestKey(crypto.randomUUID()); };
  const submit = async () => {
    if (brief.objective.trim().length < 3) return void toast.error(tx("marketing.cs.objNeeded"));
    setBusy(true);
    try {
      const r = await run({ data: { orgId, workspaceId: wsId, assetId, requestKey, brief } });
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data.draft); setRequestKey(crypto.randomUUID()); toast.success(tx("marketing.cs.draftReady", { n: r.data.credits }));
      qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error(tx("marketing.cs.unconfirmed")); }
    finally { setBusy(false); }
  };
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Sparkles className="mr-1 h-4 w-4" />{tx("marketing.cs.draftAi")}</Button>;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Sparkles className="h-4 w-4" />{tx("marketing.cs.draftAi")}</h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tx("marketing.cs.close")}</Button></div>
      <p className="text-xs text-muted-foreground">{tx("marketing.cs.draftIntro")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label={tx("marketing.cs.contentType")} className={sel} value={brief.contentType} onChange={(e) => set("contentType", e.target.value as DraftBrief["contentType"])}>{CONTENT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}</select>
        <select aria-label={tx("marketing.cs.length")} className={sel} value={brief.length} onChange={(e) => set("length", e.target.value as DraftBrief["length"])}>{LENGTHS.map((l) => <option key={l} value={l}>{tx(`marketing.cs.len.${l}`)}</option>)}</select>
        <Input aria-label={tx("marketing.cs.audience")} placeholder={tx("marketing.cs.audiencePh")} value={brief.audience} onChange={(e) => set("audience", e.target.value)} />
        <Input aria-label={tx("marketing.cs.language")} placeholder={tx("marketing.cs.language")} value={brief.language} onChange={(e) => set("language", e.target.value)} />
        <Input aria-label={tx("marketing.cs.tone")} placeholder={tx("marketing.cs.tonePh")} value={brief.tone} onChange={(e) => set("tone", e.target.value)} />
        <Input aria-label={tx("marketing.cs.keywords")} placeholder={tx("marketing.cs.keywordsPh")} value={brief.keywords} onChange={(e) => set("keywords", e.target.value)} />
        <Input aria-label={tx("marketing.cs.cta")} placeholder={tx("marketing.cs.ctaPh")} value={brief.cta} onChange={(e) => set("cta", e.target.value)} className="sm:col-span-2" />
      </div>
      <Textarea aria-label={tx("marketing.cs.objective")} placeholder={tx("marketing.cs.objectivePh")} value={brief.objective} onChange={(e) => set("objective", e.target.value)} className="min-h-[70px]" />
      <Button onClick={submit} disabled={busy}>{busy ? tx("marketing.cs.drafting") : tx("marketing.cs.generate")}</Button>
      {result && <div className="space-y-2 rounded-md border bg-background p-3">
        <p className="text-xs text-muted-foreground">{tx("marketing.cs.suggestionNote")}</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm">{result}</pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { if (hasDraft && !confirm(tx("marketing.cs.replaceConfirm"))) return; onUse(result, "replace"); setResult(null); }}>{tx("marketing.cs.useDraft")}</Button>
          <Button size="sm" variant="outline" onClick={() => { onUse(result, "append"); setResult(null); }}>{tx("marketing.cs.addBelow")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>{tx("marketing.cs.discard")}</Button>
        </div></div>}
    </div>);
}
