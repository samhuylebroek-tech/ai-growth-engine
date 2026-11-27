import { describe, expect, it } from "vitest";
import { designKey, designPayload, parseDesigns } from "@/lib/experiment-design-ai";

const one = (o: Record<string, unknown> = {}) => ({
  title: "Checkout banner",
  hypothesis: "h because x",
  intervention: "banner",
  control_description: "random half",
  method: "ab_test",
  primary_kpi: "Order conversion",
  duration_days: 14,
  success_criteria: "s",
  stop_criteria: "t",
  ...o,
});

describe("Growth Officer experiment designs", () => {
  it("drops a baseline rate that names no recorded source, so the sample size stays unknown", () => {
    const [d] = parseDesigns(
      JSON.stringify({
        experiments: [one({ baseline_rate: 4, min_effect: 1, baseline_source: "" })],
      }),
    );
    expect(d!.baseline_rate).toBeNull();
    expect(designPayload(d!)).not.toHaveProperty("baseline_rate");
  });
  it("keeps a sourced baseline and records where it came from", () => {
    const [d] = parseDesigns(
      JSON.stringify({
        experiments: [
          one({
            baseline_rate: 4,
            min_effect: 1,
            baseline_source: "Tracked metric: checkout conversion, Oct",
          }),
        ],
      }),
    );
    const p = designPayload(d!);
    expect(p["baseline_rate"]).toBe(4);
    expect(String(p["risks"])).toContain("Tracked metric: checkout conversion");
    expect(p["origin"]).toBe("growth_officer");
  });
  it("keeps at most three unique designs and rejects an answer without any", () => {
    const many = {
      experiments: [
        one(),
        one(),
        one({ title: "Bundle offer" }),
        one({ title: "Cart reminder" }),
        one({ title: "Delivery promise" }),
      ],
    };
    expect(parseDesigns(JSON.stringify(many)).map((d) => d.title)).toEqual([
      "Checkout banner",
      "Bundle offer",
      "Cart reminder",
    ]);
    expect(() => parseDesigns(JSON.stringify({ experiments: [{ title: "x" }] }))).toThrow();
  });
  it("derives the same draft key for the same request and position", async () => {
    const k = "6f1c2e3a-1b2c-4d5e-8f90-123456789abc";
    expect(await designKey(k, 0)).toBe(await designKey(k, 0));
    expect(await designKey(k, 0)).not.toBe(await designKey(k, 1));
    expect(await designKey(k, 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
