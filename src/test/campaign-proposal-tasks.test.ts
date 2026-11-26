import { describe, expect, it } from "vitest";
import { PROPOSAL_TASK_MAX, proposalTaskLabel, proposalTasks } from "@/lib/campaign-proposal";

describe("proposalTasks", () => {
  it("takes list items under the activities heading only", () => {
    const text =
      "## KPIs\n- Leads per week\n## Activiteiten\n- Landingspagina schrijven\n1. **Advertentie** opzetten\n## Risico's\n- Laag budget";
    expect(proposalTasks(text)).toEqual(["Landingspagina schrijven", "Advertentie opzetten"]);
  });
  it("falls back to all list items and removes duplicates", () => {
    expect(proposalTasks("- Mail klanten\n- mail klanten\n- Post")).toEqual([
      "Mail klanten",
      "Post",
    ]);
  });
  it("returns nothing for prose and caps the count", () => {
    expect(proposalTasks("Just a paragraph.")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `- Task ${i}`).join("\n");
    expect(proposalTasks(many)).toHaveLength(PROPOSAL_TASK_MAX);
  });
  it("labels tasks with the proposal id", () => {
    expect(proposalTaskLabel("abc")).toBe("proposal:abc");
  });
});
