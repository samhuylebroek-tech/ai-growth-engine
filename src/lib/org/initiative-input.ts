// Plain-text form input for shared initiatives: tasks and success measures, one per line, bounded like the SQL function.
/** "Title" or "Title | 2026-12-15", one task per line, at most ten. */
export function parseTaskLines(s: string) {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((l) => {
      const [title, date] = l.split("|").map((x) => x.trim());
      return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
        ? { title: (title ?? "").slice(0, 200), due_date: date! }
        : { title: l.slice(0, 200) };
    })
    .filter((x) => x.title.length > 0);
}
/** "Metric: target", one per line, at most ten. */
export function parseMetricLines(s: string) {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0
        ? {
            metric: l.slice(0, i).trim().slice(0, 200),
            target: l
              .slice(i + 1)
              .trim()
              .slice(0, 200),
          }
        : { metric: l.slice(0, 200), target: "" };
    });
}
