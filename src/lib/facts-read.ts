// Complete, scoped reads of a business's facts (pure paging logic; the caller supplies the scoped query).
// Conflict detection and source checks need every fact, so facts are read in ID keyset pages up to a hard
// ceiling instead of one capped request; if the ceiling is reached the read says so and callers must not treat
// the subset as complete (no "missing source", no "no conflicts").
export const FACTS_PAGE = 500;
export const FACTS_READ_MAX = 5000;
export type FactsRead<T> = { rows: T[]; complete: boolean };

export async function readFactPages<T extends { id: string }>(
  fetchPage: (
    cursor: string | undefined,
    size: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = FACTS_READ_MAX,
  size = FACTS_PAGE,
): Promise<FactsRead<T>> {
  if (!Number.isInteger(size) || size < 1 || size > 1000 || max < 1)
    throw new Error("Invalid fact page size");
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const r = await fetchPage(cursor, Math.min(size, max - rows.length + 1));
    if (r.error) throw r.error;
    if (!r.data) throw new Error("A page of business facts could not be read");
    if (r.data.length === 0) return { rows, complete: true };
    for (const row of r.data) {
      if (cursor !== undefined && row.id <= cursor) throw new Error("Non-advancing fact cursor");
      if (rows.length === max) return { rows, complete: false };
      rows.push(row);
      cursor = row.id;
    }
  }
}

/** Newest first for display, after the complete ID-ordered read. */
export const newestFirst = <T extends { created_at?: string | null }>(rows: T[]) =>
  [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
