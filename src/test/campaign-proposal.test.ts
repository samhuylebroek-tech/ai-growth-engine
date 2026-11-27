import { describe, expect, it } from "vitest";
import {
  decide,
  isProposalNote,
  parseProposal,
  saveDraft,
  serialize,
  PROPOSAL_TITLE,
} from "@/lib/campaign-proposal";

describe("campaign proposal", () => {
  it("saving or modifying returns the proposal to draft", () => {
    const p = decide(saveDraft("Plan A"), true, "u1", new Date("2026-01-01"));
    expect(p.status).toBe("approved");
    expect(saveDraft("Plan B").status).toBe("draft");
  });
  it("rejects empty proposals", () => {
    expect(() => saveDraft("   ")).toThrow("empty_proposal");
  });
  it("cannot decide twice", () => {
    const p = decide(saveDraft("x"), false, "u1", new Date());
    expect(p.status).toBe("rejected");
    expect(() => decide(p, true, "u2", new Date())).toThrow("already_decided");
  });
  it("records who decided", () => {
    expect(decide(saveDraft("x"), true, "u9", new Date("2026-02-03T00:00:00Z")).decidedBy).toBe(
      "u9",
    );
  });
  it("round-trips and refuses malformed bodies", () => {
    const p = saveDraft("x");
    expect(parseProposal(serialize(p))).toEqual(p);
    expect(parseProposal("{")).toBeNull();
    expect(parseProposal(JSON.stringify({ ...p, status: "launched" }))).toBeNull();
  });
  it("identifies only proposal notes", () => {
    const base = {
      kind: "proposal",
      title: PROPOSAL_TITLE,
      content_type: "draft",
      body: "",
      entity_id: "c",
    };
    expect(isProposalNote(base)).toBe(true);
    expect(isProposalNote({ ...base, kind: "approval" })).toBe(false);
    expect(isProposalNote({ ...base, kind: "comment" })).toBe(false);
  });
});
