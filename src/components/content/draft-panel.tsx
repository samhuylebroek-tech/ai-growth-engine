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

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Explicit, user-started AI draft. The result is only a suggestion until the user saves and approves a version. */
export function DraftPanel({ orgId, wsId, assetId, hasDraft, onUse }: { orgId: string; wsId: string; assetId: string; hasDraft: boolean; onUse: (text: string, mode: "replace" | "append") => void }) {
  const run = useServerFn(draftContent); const qc = useQueryClient();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [result, setResult] = useState<string | null>(null);
  const [brief, setBrief] = useState<DraftBrief>({ contentType: "Blog article", audience: "", language: "English", objective: "", keywords: "", tone: "", length: "medium", cta: "" });
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const set = <K extends keyof DraftBrief>(k: K, v: DraftBrief[K]) => { setBrief((b) => ({ ...b, [k]: v })); setRequestKey(crypto.randomUUID()); };
  const submit = async () => {
    if (brief.objective.trim().length < 3) return void toast.error("Describe the objective first.");
    setBusy(true);
    try {
      const r = await run({ data: { orgId, workspaceId: wsId, assetId, requestKey, brief } });
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data.draft); setRequestKey(crypto.randomUUID()); toast.success(`Draft ready · ${r.data.credits} AI credits`);
      qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error("The draft request could not be confirmed. Check saved requests before trying again."); }
    finally { setBusy(false); }
  };
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Sparkles className="mr-1 h-4 w-4" />Draft with AI</Button>;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Sparkles className="h-4 w-4" />Draft with AI</h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      <p className="text-xs text-muted-foreground">Uses this item's channel, writing profile, campaign and your confirmed business facts. Writing examples are used only if you authorized them. One draft uses AI credits.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label="Content type" className={sel} value={brief.contentType} onChange={(e) => set("contentType", e.target.value as DraftBrief["contentType"])}>{CONTENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <select aria-label="Length" className={sel} value={brief.length} onChange={(e) => set("length", e.target.value as DraftBrief["length"])}>{LENGTHS.map((l) => <option key={l} value={l}>{l[0]!.toUpperCase() + l.slice(1)} length</option>)}</select>
        <Input aria-label="Audience" placeholder="Audience (optional)" value={brief.audience} onChange={(e) => set("audience", e.target.value)} />
        <Input aria-label="Language" placeholder="Language" value={brief.language} onChange={(e) => set("language", e.target.value)} />
        <Input aria-label="Tone" placeholder="Tone (optional)" value={brief.tone} onChange={(e) => set("tone", e.target.value)} />
        <Input aria-label="Keywords" placeholder="Keywords (optional)" value={brief.keywords} onChange={(e) => set("keywords", e.target.value)} />
        <Input aria-label="Call to action" placeholder="Call to action (optional)" value={brief.cta} onChange={(e) => set("cta", e.target.value)} className="sm:col-span-2" />
      </div>
      <Textarea aria-label="Objective" placeholder="What should this content achieve?" value={brief.objective} onChange={(e) => set("objective", e.target.value)} className="min-h-[70px]" />
      <Button onClick={submit} disabled={busy}>{busy ? "Drafting…" : "Generate draft"}</Button>
      {result && <div className="space-y-2 rounded-md border bg-background p-3">
        <p className="text-xs text-muted-foreground">AI suggestion — review before saving a version. Check anything marked [needs source].</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm">{result}</pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { if (hasDraft && !confirm("Replace the current draft? Saved versions are kept.")) return; onUse(result, "replace"); setResult(null); }}>Use as draft</Button>
          <Button size="sm" variant="outline" onClick={() => { onUse(result, "append"); setResult(null); }}>Add below draft</Button>
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Discard</Button>
        </div></div>}
    </div>);
}
