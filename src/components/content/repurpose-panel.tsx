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

type Item = { channel: string; title: string; body: string; created?: boolean };

/** Explicit repurposing into other channels. Each result becomes a new draft piece only when the user creates it. */
export function RepurposePanel({ orgId, wsId, assetId, source, campaignId, profileId, userId }: { orgId: string; wsId: string; assetId: string; source: string; campaignId: string; profileId: string; userId: string }) {
  const run = useServerFn(repurposeContent); const qc = useQueryClient();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Set<string>>(new Set(CHANNELS.filter((c) => c !== source).slice(0, 2)));
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState<Item[]>([]);
  const toggle = (c: string, v: boolean) => { setChannels((s) => { const n = new Set(s); if (v) n.add(c); else n.delete(c); return n; }); setRequestKey(crypto.randomUUID()); };
  const submit = async () => {
    if (channels.size === 0) return void toast.error("Pick at least one channel.");
    setBusy(true);
    try {
      const r = await run({ data: { orgId, workspaceId: wsId, assetId, requestKey, channels: CHANNELS.filter((c) => channels.has(c)) } });
      if (!r.ok) return void toast.error(r.error);
      setItems(r.data.items); setRequestKey(crypto.randomUUID()); toast.success(`${r.data.items.length} versions ready · ${r.data.credits} AI credits`); qc.invalidateQueries({ queryKey: ["credits"] });
    } catch { toast.error("The request could not be confirmed. Check saved requests before trying again."); }
    finally { setBusy(false); }
  };
  const create = async (i: number) => {
    const it = items[i]!;
    const r = await supabase.from("content_assets").insert({ org_id: orgId, workspace_id: wsId, title: it.title, channel: it.channel, draft_body: it.body, campaign_id: campaignId || null, writing_profile_id: profileId || null });
    if (r.error) return void toast.error("Could not create the piece.");
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, created: true } : x))); toast.success(`New ${it.channel} draft added to the library`); qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
  };
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Repeat className="mr-1 h-4 w-4" />Repurpose</Button>;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1 text-sm font-semibold"><Repeat className="h-4 w-4" />Repurpose for other channels</h3><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      <p className="text-xs text-muted-foreground">Adapts the current draft for each channel and keeps its facts. One request uses AI credits. New pieces start as drafts with no approval.</p>
      <div className="flex flex-wrap gap-3">{CHANNELS.filter((c) => c !== source).map((c) => <label key={c} className="flex items-center gap-1 text-sm"><Checkbox checked={channels.has(c)} onCheckedChange={(v) => toggle(c, !!v)} />{c}</label>)}</div>
      <Button size="sm" disabled={busy} onClick={submit}>{busy ? "Adapting…" : "Create versions"}</Button>
      {items.map((it, i) => (
        <div key={i} className="space-y-1 rounded border bg-background p-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{it.channel} · {it.title}</span>
            <Button size="sm" variant="outline" disabled={it.created} onClick={() => create(i)}>{it.created ? "Added" : "Add as new piece"}</Button></div>
          <p className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">{it.body}</p>
        </div>))}
    </div>
  );
}
