import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { executionOptions } from "@/lib/execution";
import type { ExecutionRef } from "@/lib/execution-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookOpen, X } from "lucide-react";

export function ExecutionContextPicker({ value, onChange, disabled }: { value: ExecutionRef[]; onChange: (value: ExecutionRef[]) => void; disabled?: boolean }) {
  const o = useOrg();
  const query = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const [search, setSearch] = useState("");
  const records = query.data ? [
    ...(["projects", "tasks", "campaigns"] as const).flatMap(kind => query.data[kind].map(r => ({ kind, id: r.id, title: r.title, detail: r.status }))),
    ...query.data.approvals.filter(r => ["approved", "executed"].includes(r.status)).map(r => ({ kind: "approvals" as const, id: r.id, title: r.title, detail: r.status })),
    ...query.data.events.map(r => ({ kind: "activity_events" as const, id: r.id, title: `${r.entity_type} · ${r.action}`, detail: r.created_at.slice(0, 10) })),
  ] : [];
  const matches = records.filter(r => `${r.title} ${r.kind}`.toLowerCase().includes(search.toLowerCase()));
  return <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" disabled={disabled}><BookOpen />Selected work{value.length ? ` (${value.length}/12)` : ""}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">Execution context</p><Button variant="ghost" size="icon" aria-label="Clear selected context" disabled={!value.length} onClick={() => onChange([])}><X /></Button></div><Input aria-label="Find context records" placeholder="Find work or approved decisions…" value={search} onChange={e => setSearch(e.target.value)} />
    {query.isError ? <p role="alert" className="mt-3 text-xs text-destructive">Work could not load.<Button variant="link" onClick={() => query.refetch()}>Retry</Button></p> : query.isLoading ? <p role="status" className="mt-3 text-xs">Loading work…</p> : <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">{matches.slice(0, 80).map(r => {
      const checked = value.some(v => v.kind === r.kind && v.id === r.id);
      return <label key={`${r.kind}:${r.id}`} className="flex cursor-pointer items-start gap-2 text-xs"><Checkbox checked={checked} disabled={disabled || (!checked && value.length >= 12)} onCheckedChange={next => onChange(next ? [...value, { kind: r.kind, id: r.id }] : value.filter(v => v.id !== r.id || v.kind !== r.kind))} /><span className="min-w-0 break-words">{r.title}<span className="mt-1 block text-[10px] text-muted-foreground">{r.kind.replace("_", " ")} · {r.detail}</span></span></label>;
    })}{!matches.length && <p className="text-xs text-muted-foreground">No matching records.</p>}{matches.length > 80 && <p className="text-xs text-muted-foreground">{matches.length} matches · refine your search.</p>}</div>}
  </PopoverContent></Popover>;
}