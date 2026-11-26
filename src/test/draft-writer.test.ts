import { describe, it, expect, vi } from "vitest";
import { createDraftWriter } from "@/lib/draft-writer";
describe("content draft persistence", () => {
  it("does not dispatch a newer edit before the older write finishes", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const persist = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(undefined);
    const write = createDraftWriter<string>(persist);
    const first = write("first edit");
    const second = write("newest edit");
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
    expect(persist.mock.calls.map((c) => c[0])).toEqual(["first edit", "newest edit"]);
  });
  it("allows a deliberate retry after a rejected transport without silently claiming success", async () => {
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const write = createDraftWriter<string>(persist);
    await expect(write("unsaved text")).rejects.toThrow("offline");
    await expect(write("unsaved text")).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
