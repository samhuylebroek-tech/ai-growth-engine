import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isRegisteredTarget, registeredHost, sameSite } from "@/lib/security/outbound";
import { platformOwnerGate, sessionAal } from "@/lib/security/owner";

describe("outbound website checks only reach registered sites", () => {
  const registered = ["https://www.bakkerij-jansen.be/", "rival.example.com"];
  it("normalizes registered websites", () => {
    expect(registeredHost("https://WWW.Bakkerij-Jansen.be/contact")).toBe("bakkerij-jansen.be");
    expect(registeredHost("localhost")).toBeNull();
    expect(registeredHost("")).toBeNull();
  });
  it("allows the business website and its subdomains", () => {
    expect(isRegisteredTarget("https://bakkerij-jansen.be", registered)).toBe(true);
    expect(isRegisteredTarget("shop.bakkerij-jansen.be/products", registered)).toBe(true);
  });
  it("allows a registered competitor", () => {
    expect(isRegisteredTarget("https://rival.example.com/pricing", registered)).toBe(true);
  });
  it("refuses any other host, including lookalikes", () => {
    expect(isRegisteredTarget("https://example.com", registered)).toBe(false);
    expect(isRegisteredTarget("https://evilbakkerij-jansen.be", registered)).toBe(false);
    expect(isRegisteredTarget("https://bakkerij-jansen.be.attacker.net", registered)).toBe(false);
    expect(isRegisteredTarget("https://internal-service", registered)).toBe(false);
  });
  it("refuses everything when nothing is registered", () => {
    expect(isRegisteredTarget("https://bakkerij-jansen.be", [null, undefined, ""])).toBe(false);
  });
  it("keeps sitemaps on the audited site", () => {
    expect(sameSite("https://bakkerij-jansen.be/sitemap2.xml", "https://bakkerij-jansen.be")).toBe(true);
    expect(sameSite("http://169.254.169.254/latest", "https://bakkerij-jansen.be")).toBe(false);
  });
});

function client(isOwner: boolean, events: string[]) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "has_platform_role") return { data: isOwner && args["_role"] === "platform_owner", error: null };
      if (name === "record_security_event") { events.push(String(args["_kind"])); return { data: true, error: null }; }
      return { data: null, error: new Error("unexpected") };
    },
  } as unknown as SupabaseClient<Database>;
}

describe("Platform Owner operations require the role and a second factor", () => {
  it("reads the assurance level only from verified token claims", () => {
    expect(sessionAal({ aal: "aal2" })).toBe("aal2");
    expect(sessionAal({ aal: "AAL2" })).toBeNull();
    expect(sessionAal(null)).toBeNull();
  });
  it("refuses an organization admin even with a second factor, and records it", async () => {
    const events: string[] = [];
    expect(await platformOwnerGate(client(false, events), { aal: "aal2" }, "owner_center")).toBe("forbidden");
    expect(events).toEqual(["owner_access_denied"]);
  });
  it("asks the Platform Owner for the second step when the session is aal1", async () => {
    const events: string[] = [];
    expect(await platformOwnerGate(client(true, events), { aal: "aal1" }, "credit_prices")).toBe("mfa_required");
    expect(events).toEqual(["owner_mfa_required"]);
  });
  it("allows the Platform Owner with a verified second factor", async () => {
    const events: string[] = [];
    expect(await platformOwnerGate(client(true, events), { aal: "aal2" }, "owner_center")).toBe("ok");
    expect(events).toEqual([]);
  });
});
