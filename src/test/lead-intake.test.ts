import { describe, expect, it } from "vitest";
import { checkLeadIntake, leadIdempotencyKey } from "@/lib/lead-intake";

const now = Date.UTC(2026, 10, 26, 12);
const base = {
  formKey: "acme-contact",
  name: "Ann",
  email: "Ann@Example.com",
  consent: true,
  startedAt: now - 10000,
};

describe("lead intake", () => {
  it("accepts a valid lead and normalises email", () => {
    const v = checkLeadIntake(base, now);
    expect(v.ok && v.lead.email).toBe("ann@example.com");
  });
  it("requires consent", () => {
    expect(checkLeadIntake({ ...base, consent: false }, now)).toEqual({
      ok: false,
      reason: "consent",
    });
  });
  it("rejects a filled honeypot", () => {
    expect(checkLeadIntake({ ...base, website: "x" }, now)).toEqual({ ok: false, reason: "spam" });
  });
  it("rejects forms submitted under 3 seconds", () => {
    expect(checkLeadIntake({ ...base, startedAt: now - 1000 }, now)).toEqual({
      ok: false,
      reason: "spam",
    });
  });
  it("rejects malformed email", () => {
    expect(checkLeadIntake({ ...base, email: "nope" }, now)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
  it("same lead on the same day yields the same key", async () => {
    const a = await leadIdempotencyKey("acme-contact", "ANN@example.com ", now);
    const b = await leadIdempotencyKey("acme-contact", "ann@example.com", now + 3600000);
    const c = await leadIdempotencyKey("acme-contact", "ann@example.com", now + 86400000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
