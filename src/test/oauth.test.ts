import { describe, expect, it } from "vitest";
import {
  allowedRedirectOrigin,
  pkceChallenge,
  pkcePair,
  safeEqual,
  signState,
  verifyState,
  type GoogleState,
} from "@/lib/integrations/oauth";

const secret = "x".repeat(40);
const state = (over: Partial<GoogleState> = {}): GoogleState => ({
  u: "user-1",
  w: "ws-1",
  c: "google_analytics",
  p: "123456",
  r: "https://app.example.com/app/integrations/google",
  e: Date.now() + 60_000,
  n: "nonce-1",
  ...over,
});

describe("Google sign-in safety", () => {
  it("only returns to origins on the server's own list", () => {
    expect(
      allowedRedirectOrigin("https://app.example.com/anything", "https://app.example.com"),
    ).toBe("https://app.example.com");
    expect(allowedRedirectOrigin("https://evil.example.net", "https://app.example.com")).toBeNull();
    expect(
      allowedRedirectOrigin("https://app.example.com.evil.net", "https://app.example.com"),
    ).toBeNull();
    expect(allowedRedirectOrigin("https://app.example.com", undefined)).toBeNull();
  });
  it("refuses plain http except on the local machine", () => {
    expect(allowedRedirectOrigin("http://app.example.com", "http://app.example.com")).toBeNull();
    expect(allowedRedirectOrigin("http://localhost:8091", "http://localhost:8091")).toBe(
      "http://localhost:8091",
    );
  });
  it("accepts a correctly signed, unexpired state and rejects tampering", async () => {
    const signed = await signState(secret, state());
    expect((await verifyState(secret, signed))?.u).toBe("user-1");
    const [payload, sig] = signed.split(".");
    const forged = `${btoa(JSON.stringify(state({ u: "attacker" }))).replace(/=+$/, "")}.${sig}`;
    expect(await verifyState(secret, forged)).toBeNull();
    expect(await verifyState("y".repeat(40), signed)).toBeNull();
    expect(await verifyState(secret, `${payload}.${sig}.extra`)).toBeNull();
  });
  it("rejects an expired state", async () => {
    expect(
      await verifyState(secret, await signState(secret, state({ e: Date.now() - 1 }))),
    ).toBeNull();
  });
  it("creates a PKCE pair whose challenge is the S256 hash of the verifier", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(await pkceChallenge(verifier));
    expect(challenge).not.toBe(verifier);
  });
  it("compares strings exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
