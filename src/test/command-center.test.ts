import { describe, expect, it } from "vitest";
import { mergeActivity, prioritizeApprovals, homePreferenceKey, commandCenterOptions } from "@/lib/command-center";

const run = { id: "r1", agent_key: "growth_officer", status: "failed", summary: null, error: "Recorded failure", created_at: "2026-11-14T10:00:00Z", finished_at: "2026-11-15T10:00:00Z" };
describe("Command center data rules", () => {
  it("returns no invented events for an empty workspace", () => { expect(mergeActivity([], [], [])).toEqual([]); });
  it("deduplicates entity events and sorts by recorded latest time", () => {
    const events = mergeActivity([run, run], [{ id: "d1", name: "Plan", status: "ready", created_at: "2026-11-15T11:00:00Z" }], []);
    expect(events.map(e => e.id)).toEqual(["document:d1", "ai:r1"]);
    expect(events[1]?.detail).toBe("Recorded failure");
  });
  it("places higher-risk decisions before routine follow-up and oldest first within risk", () => {
    expect(prioritizeApprovals([{ risk: "low", created_at: "2026-01-01", id: "low" }, { risk: "high", created_at: "2026-01-03", id: "high-new" }, { risk: "high", created_at: "2026-01-02", id: "high-old" }]).map(a => a.id)).toEqual(["high-old", "high-new", "low"]);
  });
  it("keeps display preferences separate per user and workspace", () => {
    const key = homePreferenceKey("a", "org", "ws");
    expect(key).not.toBe(homePreferenceKey("b", "org", "ws"));
    expect(key).not.toBe(homePreferenceKey("a", "org", "other"));
    expect(key).not.toBe(homePreferenceKey("a", "other", "ws"));
  });
  it("keeps command data user and workspace scoped and disables incomplete contexts", () => {
    const options = commandCenterOptions("org", "ws", "user");
    expect(options.queryKey).not.toEqual(commandCenterOptions("org", "other", "user").queryKey);
    expect(options.queryKey).not.toEqual(commandCenterOptions("org", "ws", "other").queryKey);
    expect(commandCenterOptions("org", undefined, "user").enabled).toBe(false);
    expect(options.refetchInterval).toBe(30000);
    expect(options.refetchIntervalInBackground).toBe(false);
  });
  it("handles large real-record-shaped streams without merging unrelated source ids", () => {
    const events = mergeActivity(Array.from({ length: 100 }, (_, i) => ({ ...run, id: String(i) })), [{ id: "1", name: "Document", status: "ready", created_at: run.created_at }], []);
    expect(events).toHaveLength(101);
    expect(events.filter(e => e.kind === "ai")).toHaveLength(100);
  });
});