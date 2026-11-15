import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function requirePlatformOwner(sb: SupabaseClient<Database>) {
  const result = await sb.rpc("has_platform_role", { _role: "platform_owner" });
  if (result.error || !result.data) throw new Error("Platform Owner access required.");
}