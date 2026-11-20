import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";

type Asset = { id: string; title: string; channel: string; status: string; planned_date: string | null };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Editorial calendar from each piece's planned date. Planning only; nothing is scheduled or published. */
export function EditorialCalendar({ assets, onOpen }: { assets: Asset[]; onOpen: (id: string) => void }) {
  const { t: tx, tag } = useI18n();
  const chLabel = (ch: string) => (`marketing.cs.ch.${ch}` in MESSAGES.en ? tx(`marketing.cs.ch.${ch}` as MessageKey) : ch);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = useMemo(() => {
    const start = new Date(cursor); start.setDate(1 - ((cursor.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);
  const byDay = useMemo(() => { const m = new Map<string, Asset[]>(); for (const a of assets) if (a.planned_date) m.set(a.planned_date, [...(m.get(a.planned_date) ?? []), a]); return m; }, [assets]);
  const unplanned = assets.filter((a) => !a.planned_date);
  const today = iso(new Date());
  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{cursor.toLocaleDateString(tag, { month: "long", year: "numeric" })}</h2>
        <div className="flex gap-1"><Button size="icon" variant="outline" aria-label={tx("marketing.cs.prevMonth")} onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="outline" aria-label={tx("marketing.cs.nextMonth")} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
      <p className="text-xs text-muted-foreground">{tx("marketing.cs.calNote")}</p>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2024, 0, 1 + i).toLocaleDateString(tag, { weekday: "short" })).map((d) => <div key={d} className="bg-muted p-1 text-center font-medium">{d}</div>)}
        {days.map((d) => { const k = iso(d); const items = byDay.get(k) ?? []; return (
          <div key={k} className={`min-h-20 bg-card p-1 ${d.getMonth() !== cursor.getMonth() ? "opacity-50" : ""}`}>
            <div className={`mb-1 ${k === today ? "font-bold text-primary" : "text-muted-foreground"}`}>{d.getDate()}</div>
            {items.map((a) => <button key={a.id} type="button" onClick={() => onOpen(a.id)} className="mb-0.5 block w-full truncate rounded bg-accent px-1 text-left hover:bg-primary hover:text-primary-foreground" title={`${a.title} · ${chLabel(a.channel)}`}>{chLabel(a.channel)}: {a.title}</button>)}
          </div>); })}
      </div>
      {unplanned.length > 0 && <div className="text-sm"><p className="font-medium">{tx("marketing.cs.unplanned", { n: unplanned.length })}</p>
        <div className="flex flex-wrap gap-2 pt-1">{unplanned.slice(0, 30).map((a) => <button key={a.id} type="button" onClick={() => onOpen(a.id)} className="rounded border px-2 py-0.5 text-xs hover:bg-accent">{a.title}</button>)}</div></div>}
    </div>);
}
