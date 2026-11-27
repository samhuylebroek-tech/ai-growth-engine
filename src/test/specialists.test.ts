import { describe, expect, it } from "vitest";
import { executionSelectionSchema } from "@/lib/execution-context";
import { parseSpecialistOutput, specialistKeySchema, specialistMarkdown } from "@/lib/specialists";
describe("bounded specialist input and output", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("caps explicitly selected records at twelve", () => {
    expect(
      executionSelectionSchema.safeParse(
        Array.from({ length: 13 }, (_, i) => ({
          kind: "tasks",
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        })),
      ).success,
    ).toBe(false);
  });
  it("rejects duplicate selections", () => {
    expect(
      executionSelectionSchema.safeParse([
        { kind: "tasks", id },
        { kind: "tasks", id },
      ]).success,
    ).toBe(false);
  });
  it("does not accept arbitrary tables as AI context", () => {
    expect(executionSelectionSchema.safeParse([{ kind: "messages", id }]).success).toBe(false);
  });
  it("accepts only the four operational specialist domains", () => {
    for (const domain of ["strategy", "research", "seo", "content"])
      expect(specialistKeySchema.safeParse(domain).success).toBe(true);
    expect(specialistKeySchema.safeParse("email_sender").success).toBe(false);
  });
  it("rejects malformed or empty model output", () => {
    expect(() =>
      parseSpecialistOutput('{"title":"Plan","sections":[],"evidence_gaps":[],"actions":[]}'),
    ).toThrow();
    expect(() => parseSpecialistOutput("not JSON")).toThrow();
  });
  it("preserves validated result sections and selected source identity", () => {
    const result = parseSpecialistOutput(
      '```json\n{"title":"Plan","sections":[{"heading":"Draft","body":"Complete article"}],"evidence_gaps":[],"actions":[]}\n```',
    );
    expect(specialistMarkdown(result, [`tasks:${id}`])).toContain(`tasks:${id}`);
    expect(result.sections[0]?.body).toBe("Complete article");
  });
});
