import { describe, expect, it } from "vitest";
import { MESSAGES } from "@/lib/i18n/messages";
import { CONNECTORS } from "@/lib/registry/connectors";
import { READ_ONLY_METRICS } from "@/lib/integrations/read-only";
import { CONTENT_TYPES, LENGTHS } from "@/lib/content-draft";
import { DIMENSION_KEYS, IMPROVEMENT_ACTIONS, CLAIM_STATUSES } from "@/lib/content-review";

const has = (k: string) => k in MESSAGES.en;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");

describe("every fixed list shown on screen has a translation", () => {
  it("data source descriptions and categories", () => {
    for (const c of CONNECTORS) {
      expect(has(`pages.int.c.${c.key}`), c.key).toBe(true);
      expect(has(`pages.int.cat.${c.category.toLowerCase().replace(/[^a-z]+/g, "_")}`), c.category).toBe(true);
    }
  });
  it("values a read-only data source provides", () => {
    for (const list of Object.values(READ_ONLY_METRICS)) for (const m of list) expect(has(`pages.int.m.${m.key}`), m.key).toBe(true);
  });
  it("content types, lengths and review checks", () => {
    for (const t of CONTENT_TYPES) expect(has(`marketing.cs.ct.${slug(t)}`), t).toBe(true);
    for (const l of LENGTHS) expect(has(`marketing.cs.len.${l}`)).toBe(true);
    for (const d of DIMENSION_KEYS) { expect(has(`marketing.cs.dim.${d}`)).toBe(true); expect(has(`marketing.cs.dimm.${d}`)).toBe(true); }
    for (const a of IMPROVEMENT_ACTIONS) expect(has(`marketing.cs.act.${a}`), a).toBe(true);
    for (const s of CLAIM_STATUSES) expect(has(`marketing.cs.cl.${s}`), s).toBe(true);
  });
});
