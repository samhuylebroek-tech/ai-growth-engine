import { describe, expect, it } from "vitest";
import { statedEvidence } from "@/lib/claims";
import { resolveRefs, support, type EvidenceRecord } from "@/lib/evidence-refs";

const fact = (id: string, verified: boolean, updatedAt?: string): EvidenceRecord => ({ type: "fact", id, title: "Customers", verified, ...(updatedAt ? { updatedAt } : {}) });
const s = (text: string, records: EvidenceRecord[], asOf?: string) => { const e = statedEvidence(text); return resolveRefs(e.refs, records, asOf); };

describe("evidence behind a statement", () => {
  it("links a cited, confirmed fact", () => {
    const r = s("(source: #F-1a2b3c4d)", [fact("1a2b3c4d-0000-0000-0000-000000000000", true)]);
    expect(r[0]?.status).toBe("found");
    expect(support("fact", r, statedEvidence("(source: #F-1a2b3c4d)"))).toBe("linked");
  });
  it("a cited fact that is not confirmed is not shown as linked", () => {
    const r = s("(source: #F-1a2b3c4d)", [fact("1a2b3c4d-9", false)]);
    expect(support("fact", r, statedEvidence(""))).toBe("unconfirmed");
  });
  it("a reference to a record the viewer cannot see is not found, never trusted", () => {
    const r = s("(source: #F-1a2b3c4d)", []);
    expect(r[0]?.status).toBe("not_found");
    expect(support("fact", r, statedEvidence("(source: #F-1a2b3c4d)"))).toBe("broken");
  });
  it("two records sharing the short reference are ambiguous", () => {
    expect(s("#F-1a2b3c4d", [fact("1a2b3c4d-1", true), fact("1a2b3c4d-2", true)])[0]?.status).toBe("ambiguous");
  });
  it("flags a record changed after the answer", () => {
    expect(s("#F-1a2b3c4d", [fact("1a2b3c4d", true, "2026-11-20T10:00:00Z")], "2026-11-19T10:00:00Z")[0]?.changedAfter).toBe(true);
  });
  it("a fact with only a source written by the AI is 'stated', with nothing at all 'none'", () => {
    expect(support("fact", [], statedEvidence("(source: business profile)"))).toBe("stated");
    expect(support("fact", [], statedEvidence("Plain claim"))).toBe("none");
  });
  it("estimates, hypotheses and recommendations are never results; missing stays missing", () => {
    expect(support("estimate", [], statedEvidence("(basis: x)"))).toBe("not_result");
    expect(support("recommendation", s("#F-1a2b3c4d", [fact("1a2b3c4d", true)]), statedEvidence("#F-1a2b3c4d"))).toBe("not_result");
    expect(support("missing", [], statedEvidence(""))).toBe("missing");
  });
});
