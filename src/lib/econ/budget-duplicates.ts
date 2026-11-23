// Possible duplicate budget lines (pure): same channel (case and spacing ignored), month, currency and earmarks.
// Duplicates may be legitimate (two separately approved budgets), so they are flagged, never merged or removed;
// each line gets a distinguishing label (note, creation date, short reference) so nobody picks the wrong one.
export type DupLine = {
  id: string;
  channel: string;
  period_month: string;
  currency: string;
  planned: number | string;
  note?: string | null;
  goal_id?: string | null;
  initiative_id?: string | null;
  unit_id?: string | null;
  created_at?: string | null;
};

export const dupKey = (l: DupLine) =>
  [
    l.channel.trim().toLowerCase().replace(/\s+/g, " "),
    l.period_month.slice(0, 7),
    l.currency,
    l.goal_id ?? "",
    l.initiative_id ?? "",
    l.unit_id ?? "",
  ].join("|");

/** Groups of two or more lines that look the same; each group keeps every line. */
export function duplicateGroups<T extends DupLine>(lines: readonly T[]): T[][] {
  const by = new Map<string, T[]>();
  for (const l of lines) by.set(dupKey(l), [...(by.get(dupKey(l)) ?? []), l]);
  return [...by.values()]
    .filter((g) => g.length > 1)
    .map((g) =>
      [...g].sort(
        (a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id),
      ),
    );
}

/** Would a new line duplicate an existing one? */
export const wouldDuplicate = (lines: readonly DupLine[], draft: Omit<DupLine, "id" | "planned">) =>
  lines.filter((l) => dupKey(l) === dupKey({ ...draft, id: "", planned: 0 }));

/** Short distinguishing label: note when present, otherwise creation date, plus a short reference. */
export function lineLabel(l: DupLine, tag: string) {
  const note = (l.note ?? "").trim();
  const when = l.created_at ? new Date(l.created_at).toLocaleDateString(tag) : "";
  return [note ? note.slice(0, 40) : when, `#${l.id.slice(0, 4)}`].filter(Boolean).join(" · ");
}
