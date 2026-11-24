import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn keeps the smallest type step", () => {
  it("keeps text-2xs beside a text colour", () => {
    expect(cn("text-2xs", "text-muted-foreground").split(" ")).toEqual([
      "text-2xs",
      "text-muted-foreground",
    ]);
  });
  it("still lets a later size replace text-2xs", () => {
    expect(cn("text-2xs", "text-sm")).toBe("text-sm");
  });
});
