import { describe, expect, it } from "vitest";
import { selectSpecialistsForRequest } from "@/lib/coordination";

describe("selectSpecialistsForRequest", () => {
  it("routes SEO and content work to both relevant capabilities", () => {
    expect(selectSpecialistsForRequest("Build an SEO keyword strategy and blog content plan")).toEqual(["seo", "content"]);
  });
  it("adds research to a search visibility assignment", () => {
    expect(selectSpecialistsForRequest("Improve technical SEO and organic search rankings")).toEqual(["research", "seo"]);
  });
  it("pairs content requests with strategy", () => {
    expect(selectSpecialistsForRequest("Write a blog article and social media posts")).toEqual(["strategy", "content"]);
  });
  it("pairs market questions with research and strategy", () => {
    expect(selectSpecialistsForRequest("Research competitors, customer segments and market pricing")).toEqual(["research", "strategy"]);
  });
  it("uses a bounded strategy and research default", () => {
    expect(selectSpecialistsForRequest("What is my best next growth move?")).toEqual(["strategy", "research"]);
  });
});
