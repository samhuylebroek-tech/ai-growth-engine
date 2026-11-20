import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { toast } from "sonner";
import { repurposeContent } from "@/lib/ai.functions";
import { CHANNELS } from "@/lib/content";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";

type Item = { channel: string; title: string; body: string; created?: boolean };

/** Explicit repurposing into other channels. Each result becomes a new draft piece only when the user creates it. */
export function RepurposePanel({ orgId, wsId, assetId, source, campaignId, profileId, userId }: { orgId: string; wsId: string; assetId: string; source: string; campaignId: string; profileId: string; userId: string }) {
  const run = useServerFn(repurposeContent); const qc = useQueryClient(); const { t: tx } = useI18n();
  const chLabel = (ch: string) => ((CHANNELS as readonly string[]).includes(ch) ? tx(`marketing.cs.ch.${ch as (typeof CHANNELS)[number]}`) : ch);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Set<string>>(new Set(CHANNELS.filter((c) => c !== source).slice(0, 2)));
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState<Item[]>([]);
  const toggle = (c: string, v: boolean) => { setChannels((s) => { const n = new Set(s); if (v) n.add(c); else n.delete(c); return n; }); setRequestKey(crypto.randomUUID()); };
  const submit = async () => {
    if (channels.size === 0) return void toast.error(tx("marketing.cs.pickChannel"));
    setBusy(true);
    try {
      const r = await run({ data: { orgId, workspaceId: wsId, assetId, requestKey, channels: CHANNELS.filter((c) => channels.has(c)) } });
      if (!r.ok) return void toast.error(r.error);
      setItems(r.data.items); setRequestKey(crypto.randomUUID()); toast.success(tx("marketing.cs.versionsReady", { n: r.data.items.length, c: r.data.credits })); qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error(tx("marketing.cs.unconfirmed")); }
    finally { setBusy(false); }
  };
  const create = async (i: number) => {
    const it = items[i]!;
    const r = await supabase.from("content_assets").insert({ org_id: orgId, workspace_id: wsId, title: it.title, channel: it.channel, draft_body: it.body, campaign_id: campaignId || null, writing_profile_id: profileId || null });
    if (r.error) return void toast.error(tx("marketing.cs.pieceFailed"));
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, created: true } : x))); toast.success(tx("marketing.cs.pieceAdded", { ch: chLabel(it.channel) })); qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
  };
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Repeat className="mr-1 h-4 w-4" />{tx("marketing.cs.repurpose")}</Button>;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Repeat className="h-4 w-4" />{tx("marketing.cs.repurposeTitle")}</h3><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tx("marketing.cs.close")}</Button></div>
      <p className="text-xs text-muted-foreground">{tx("marketing.cs.repurposeIntro")}</p>
      <div className="flex flex-wrap gap-3">{CHANNELS.filter((c) => c !== source).map((c) => <label key={c} className="flex items-center gap-1 text-sm"><Checkbox checked={channels.has(c)} onCheckedChange={(v) => toggle(c, !!v)} />{chLabel(c)}</label>)}</div>
      <Button size="sm" disabled={busy} onClick={submit}>{busy ? tx("marketing.cs.adapting") : tx("marketing.cs.createVersions")}</Button>
      {items.map((it, i) => (
        <div key={i} className="space-y-1 rounded border bg-background p-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{chLabel(it.channel)} · {it.title}</span>
            <Button size="sm" variant="outline" disabled={it.created} onClick={() => create(i)}>{it.created ? tx("marketing.cs.added") : tx("marketing.cs.addPiece")}</Button></div>
          <p className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">{it.body}</p>
        </div>))}
    </div>
  );
}
