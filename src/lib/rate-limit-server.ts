// Server-side rate-limit checks for work that fetches outside the database (website checks, data-source
// connections). Fails closed on a database error; a database without proposal 0090 has no limits to apply.
import { readLocale } from "@/lib/i18n";
import { translate } from "@/lib/i18n/messages";
import { isNotInstalled } from "@/lib/pending-schema";
import { limitAware, rateLimitText, type LimitAction } from "@/lib/rate-limit";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
export const serverT = (key: string, vars?: Record<string, string | number>) => translate(readLocale(), key, vars);
export const dbText = (message: string) => limitAware(message, serverT);

/** null when allowed; otherwise the sentence to show. Counts the attempt when allowed. */
export async function takeLimit(sb: unknown, action: Exclude<LimitAction, "ai" | "upload">, workspaceId: string): Promise<string | null> {
  const r = await (sb as Rpc).rpc("consume_rate_limit", { _action: action, _workspace: workspaceId });
  if (r.error) return isNotInstalled(r.error) ? null : serverT("lim.unavailable");
  const v = r.data as { allowed?: boolean; scope?: string; retry_after?: number } | null;
  if (v?.allowed) return null;
  if (v?.scope === "forbidden") return serverT("lim.unavailable");
  return rateLimitText({ action, scope: (v?.scope ?? "user") as "user", retryAfter: Number(v?.retry_after ?? 60) }, serverT);
}

/** Records a failed attempt (refused target, rejected token, missing permission); never blocks the caller. */
export async function noteFailure(sb: unknown, action: Exclude<LimitAction, "ai" | "upload">, workspaceId: string | null): Promise<void> {
  try { await (sb as Rpc).rpc("record_failed_attempt", { _action: action, _workspace: workspaceId }); } catch { /* best effort */ }
}
