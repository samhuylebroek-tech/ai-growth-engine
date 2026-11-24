import { describe, expect, it, vi } from "vitest";
import { isModuleLoadError, retryPageLoad } from "@/lib/module-load-error";

describe("page module recovery", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://example.test/assets/app-ChlFoh4W.js",
    "error loading dynamically imported module: https://example.test/assets/app.js",
    "Importing a module script failed.",
    "Failed to load module script: expected JavaScript",
    "Loading chunk 42 failed.",
  ])("recognizes browser import failure: %s", (message) => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true);
  });

  it("does not reload for ordinary fetch or permission failures", () => {
    expect(isModuleLoadError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isModuleLoadError(new Error("permission denied"))).toBe(false);
    expect(isModuleLoadError(null)).toBe(false);
  });

  it("reloads the document for the reported failed chunk instead of reusing the cached import", async () => {
    const actions = {
      reload: vi.fn(),
      invalidate: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    };
    await retryPageLoad(
      new TypeError(
        "Failed to fetch dynamically imported module: https://example.test/assets/app-ChlFoh4W.js",
      ),
      actions,
    );
    expect(actions.reload).toHaveBeenCalledTimes(1);
    expect(actions.invalidate).not.toHaveBeenCalled();
    expect(actions.reset).not.toHaveBeenCalled();
  });

  it("awaits ordinary data retry before resetting the boundary without reloading", async () => {
    const calls: string[] = [];
    const reload = vi.fn();
    await retryPageLoad(new Error("Data temporarily unavailable"), {
      reload,
      invalidate: async () => {
        calls.push("invalidate");
      },
      reset: () => {
        calls.push("reset");
      },
    });
    expect(calls).toEqual(["invalidate", "reset"]);
    expect(reload).not.toHaveBeenCalled();
  });
});
