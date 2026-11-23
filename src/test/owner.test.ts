import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requirePlatformOwner } from "@/lib/security/owner";

function client(platformRole: string | null, error = false) {
  return {
    rpc: async (name: string, args: { _role: string }) => ({
      data: name === "has_platform_role" && args._role === platformRole,
      error: error ? new Error("Denied") : null,
    }),
  } as unknown as SupabaseClient<Database>;
}
describe("owner-center server authorization", () => {
  it.each(["organization owner", "organization admin", "ordinary member"])(
    "denies %s without a platform role",
    async () => {
      await expect(requirePlatformOwner(client(null))).rejects.toThrow(
        "Platform Owner access required",
      );
    },
  );
  it.each(["support", "platform_admin", "finance"])(
    "denies non-owner platform role %s",
    async (role) => {
      await expect(requirePlatformOwner(client(role))).rejects.toThrow(
        "Platform Owner access required",
      );
    },
  );
  it("permits an explicitly assigned Platform Owner", async () => {
    await expect(requirePlatformOwner(client("platform_owner"))).resolves.toBeUndefined();
  });
  it("fails closed when the role check fails", async () => {
    await expect(requirePlatformOwner(client("platform_owner", true))).rejects.toThrow(
      "Platform Owner access required",
    );
  });
});
