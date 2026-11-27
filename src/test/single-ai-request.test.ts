import { describe, it, expect } from "vitest";
import { requestAttemptKey } from "@/lib/single-ai-request";

describe("persistent request identities", () => {
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  function store() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
  }
  it("reuses the same request after interruption and reload", () => {
    const storage = store();
    expect(requestAttemptKey(storage, "user/org/workspace/officer", "question", () => a)).toBe(a);
    expect(requestAttemptKey(storage, "user/org/workspace/officer", "question", () => b)).toBe(a);
  });
  it("never reuses an identity across workspace scope", () => {
    const storage = store();
    requestAttemptKey(storage, "user/org/one/officer", "question", () => a);
    expect(requestAttemptKey(storage, "user/org/two/officer", "question", () => b)).toBe(b);
  });
  it("changed input needs a different identity", () => {
    const storage = store();
    requestAttemptKey(storage, "scope", "old", () => a);
    expect(requestAttemptKey(storage, "scope", "new", () => b)).toBe(b);
  });
});
