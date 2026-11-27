import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PendingDatabase } from "@/lib/pending-schema";

export async function requirePlatformOwner(sb: SupabaseClient<Database>) {
  const result = await sb.rpc("has_platform_role", { _role: "platform_owner" });
  if (result.error || !result.data) throw new Error("Platform Owner access required.");
}

/** Authentication assurance level of the verified access token ("aal2" = signed in with a second factor). */
export function sessionAal(claims: unknown): "aal1" | "aal2" | null {
  const aal =
    typeof claims === "object" && claims !== null ? (claims as { aal?: unknown }).aal : undefined;
  return aal === "aal1" || aal === "aal2" ? aal : null;
}

export type OwnerGate = "ok" | "forbidden" | "mfa_required";

/**
 * Platform Owner operations need the exact role AND a session verified with a second factor. The token claims come
 * from the server-verified access token (requireSupabaseAuth), never from the browser. A refusal is recorded as a
 * security event attributed to the caller (best effort; the database bounds it per user).
 */
export async function platformOwnerGate(
  sb: SupabaseClient<Database>,
  claims: unknown,
  area: string,
): Promise<OwnerGate> {
  const record = async (kind: "owner_access_denied" | "owner_mfa_required") => {
    try {
      await (sb as unknown as SupabaseClient<PendingDatabase>).rpc("record_security_event", {
        _kind: kind,
        _detail: { area },
      });
    } catch {
      /* logging must never turn a refusal into an error */
    }
  };
  try {
    await requirePlatformOwner(sb);
  } catch {
    await record("owner_access_denied");
    return "forbidden";
  }
  if (sessionAal(claims) !== "aal2") {
    await record("owner_mfa_required");
    return "mfa_required";
  }
  return "ok";
}
