import { describe, expect, it } from "vitest";
import { probeCode, probeToken, ProviderError } from "@/lib/integrations/providers";

const status = (code: number) => async () => new Response("{}", { status: code });
async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ProviderError ? probeCode(e) : "other";
  }
}

describe("explaining a refused key", () => {
  it("a key the provider rejects is 'not accepted', not 'saved access expired'", async () =>
    expect(await codeOf(probeToken(status(401), "stripe", "rk_test_abcdefghijklmnop"))).toBe(
      "key_rejected",
    ));
  it("a key without read permission says so", async () =>
    expect(await codeOf(probeToken(status(403), "stripe", "rk_test_abcdefghijklmnop"))).toBe(
      "key_no_read",
    ));
  it("a Stripe secret key is refused before the provider is contacted", async () => {
    let called = false;
    const f = async () => {
      called = true;
      return new Response("{}");
    };
    expect(await codeOf(probeToken(f, "stripe", "sk_test_abcdefghijklmnop"))).toBe(
      "key_secret_not_restricted",
    );
    expect(called).toBe(false);
  });
  it("wrong formats are named per provider", async () => {
    expect(await codeOf(probeToken(status(200), "stripe", "hello-world-123"))).toBe(
      "key_format_stripe",
    );
    expect(await codeOf(probeToken(status(200), "hubspot", "hello-world-123"))).toBe(
      "key_format_hubspot",
    );
  });
  it("an outage is not blamed on the key", async () =>
    expect(await codeOf(probeToken(status(500), "stripe", "rk_test_abcdefghijklmnop"))).toBe(
      "provider_unavailable",
    ));
});
