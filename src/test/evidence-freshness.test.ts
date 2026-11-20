import { describe, expect, it } from "vitest";
import { evidenceFreshness, sourceState } from "@/lib/evidence-freshness";
import { evidenceQuality, fromEvidenceItem } from "@/lib/evidence";
import { detectSignals } from "@/lib/signals";

const now = new Date("2026-11-20T12:00:00Z");
const base = { collected_at: "2026-11-01T00:00:00Z", version_no: 1, updated_at: "2026-11-01T00:00:00Z" };

describe("evidence freshness depends on what the evidence is", () => {
  it("keeps a sale from two years ago as a current historical record", () => {
    const r = evidenceFreshness({ ...base, evidence_type: "measured_observation", source_kind: "revenue_event", period_end: "2024-10-01" }, now);
    expect(r).toMatchObject({ level: "current", historical: true });
  });
  it("marks a measurement whose month ended 90 days ago as outdated and after 200 days as expired", () => {
    expect(evidenceFreshness({ ...base, evidence_type: "measured_observation", source_kind: "measurement", period_end: "2026-08-22" }, now).level).toBe("outdated");
    expect(evidenceFreshness({ ...base, evidence_type: "measured_observation", source_kind: "measurement", period_end: "2026-05-01" }, now).level).toBe("expired");
  });
  it("asks to reconfirm a business fact after a year instead of expiring it", () => {
    expect(evidenceFreshness({ ...base, collected_at: "2025-10-01T00:00:00Z", evidence_type: "verified_fact", source_kind: "business_fact" }, now).level).toBe("verify");
  });
  it("flags evidence whose fact was deleted or is no longer confirmed", () => {
    const e = { source_kind: "business_fact" as const, source_ref: "f1" };
    expect(sourceState(e, { facts: new Map() })).toBe("missing");
    expect(sourceState(e, { facts: new Map([["f1", false]]) })).toBe("unconfirmed");
    expect(evidenceFreshness({ ...base, evidence_type: "verified_fact", source_kind: "business_fact", source: "missing" }, now).level).toBe("unavailable");
    expect(evidenceFreshness({ ...base, evidence_type: "verified_fact", source_kind: "business_fact", source: "unconfirmed" }, now).level).toBe("verify");
  });
  it("says 'recently updated' for a new version within two weeks", () => {
    expect(evidenceFreshness({ ...base, version_no: 2, updated_at: "2026-11-15T00:00:00Z", evidence_type: "estimate", source_kind: "user_statement" }, now).level).toBe("updated");
  });
  it("does not count stale facts as strong evidence", () => {
    const fresh = fromEvidenceItem({ evidence_type: "verified_fact", origin: "user", status: "accepted" })!;
    const stale = fromEvidenceItem({ evidence_type: "verified_fact", origin: "user", status: "accepted" }, "supports", true)!;
    expect(evidenceQuality([fresh, fresh]).level).toBe("strong");
    const q = evidenceQuality([stale, stale]);
    expect(q.level).toBe("limited");
    expect(q.reasons).toContain("stale");
  });
});

describe("conflicting confirmed facts raise one alert", () => {
  it("points to the business profile with the number of topics", () => {
    const d = {
      workspace: { id: "w" }, objectives: null, goals: [], recommendations: [], plans: { rows: [] }, initiatives: [], operations: [],
      projects: [], tasks: [], budget: { rows: [] }, deals: { rows: [] }, competitors: { rows: [] }, observations: [], seo: { rows: [] },
      content: { rows: [] }, versions: [], decisions: [], campaigns: { rows: [] }, connections: { rows: [] },
      facts: [
        { key: "Price", value: "€25", source_type: "user", verified: true, created_at: "2026-11-01" },
        { key: "price", value: "€29", source_type: "document", verified: true, created_at: "2026-11-02" },
      ],
    };
    const s = detectSignals(d as never, now).filter((x) => x.code === "facts_conflict");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ to: "/app/profile", vars: { n: 1 } });
  });
});
