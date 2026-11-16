export const CHANNELS = ["blog", "linkedin", "email", "website", "social", "ad"] as const;
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };
/** Line-level LCS diff between two versions; bounded to keep the browser responsive. */
export function diffLines(before: string, after: string, max = 2000): DiffLine[] {
  const a = before.split("\n").slice(0, max), b = after.split("\n").slice(0, max);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "removed", text: a[i++]! });
    else out.push({ kind: "added", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}
/** A version is publishable only when its own decision is approved; never inherited. */
export function versionApproved(versionId: string, decisions: { version_id: string; decision: string }[]) {
  return decisions.some((d) => d.version_id === versionId && d.decision === "approved");
}
