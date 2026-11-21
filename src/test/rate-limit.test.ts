import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n/messages";
import { limitAware, parseRateLimit, rateLimitText, waitText } from "@/lib/rate-limit";

const nl = (k: string, v?: Record<string, string | number>) => translate("nl", k, v);
const en = (k: string, v?: Record<string, string | number>) => translate("en", k, v);

describe("rate limit messages", () => {
  it("reads the database refusal", () => {
    expect(parseRateLimit('rate_limited:ai:user:42')).toEqual({ action: "ai", scope: "user", retryAfter: 42 });
    expect(parseRateLimit("ERROR: rate_limited:upload:workspace:600 (RL429)")).toEqual({ action: "upload", scope: "workspace", retryAfter: 600 });
    expect(parseRateLimit("document_limit_reached")).toBeNull();
    expect(parseRateLimit("rate_limited:payments:user:5")).toBeNull();
  });
  it("rounds the waiting time up, never shorter than the real wait", () => {
    expect(waitText(30, en)).toBe("less than a minute");
    expect(waitText(60, en)).toBe("1 minute");
    expect(waitText(61, en)).toBe("2 minutes");
    expect(waitText(7200, en)).toBe("about 2 hours");
  });
  it("says who reached the limit, and that a refused AI request used no credits", () => {
    expect(rateLimitText({ action: "ai", scope: "user", retryAfter: 120 }, nl)).toBe(
      "Je hebt de limiet voor AI-aanvragen bereikt. Je kunt het over 2 minuten opnieuw proberen. Voor deze aanvraag zijn geen credits gebruikt.",
    );
    expect(rateLimitText({ action: "seo", scope: "workspace", retryAfter: 900 }, en)).toBe(
      "This business has reached its limit for website checks. You can try again in 15 minutes.",
    );
    expect(rateLimitText({ action: "connect", scope: "failures", retryAfter: 300 }, en)).toContain("too many failed attempts");
  });
  it("leaves other errors unchanged", () => {
    expect(limitAware("Not enough AI credits left this period.", en)).toBe("Not enough AI credits left this period.");
  });
});
