/** Stable ID keyset traversal. A captured creation watermark excludes later inserts.
 * Callers must keep tenant predicates on every page and fail closed on any error.
 */
export type CursorRow = { id: string };
export async function collectPages<T extends CursorRow>(
  fetchPage: (cursor: string | undefined, size: number) => Promise<{ data: T[] | null; error: unknown }>,
  size = 500,
): Promise<T[]> {
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw new Error("Invalid page size");
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const result = await fetchPage(cursor, size);
    if (result.error) throw result.error;
    if (!result.data) throw new Error("A work page could not be read");
    if (result.data.length === 0) return rows;
    for (const row of result.data) {
      if (cursor !== undefined && row.id <= cursor) throw new Error("Non-advancing work cursor");
      rows.push(row);
      cursor = row.id;
    }
    // Continue even after a short page: the provider may enforce a smaller cap.
  }
}
export function pageSlice<T>(rows: T[], requestedPage: number, size = 50) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(1, Math.min(pages, requestedPage));
  return { rows: rows.slice((page - 1) * size, page * size), page, pages, total: rows.length };
}