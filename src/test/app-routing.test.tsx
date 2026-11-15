import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { NAVIGATION } from "@/lib/navigation";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
  it.each(NAVIGATION.flatMap(group => group.items.map(item => item.to)))("resolves the implemented navigation destination %s", (path) => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const matched = router.matchRoutes(path).at(-1);
    expect(matched?.routeId).toBe(path === "/app" ? "/_authenticated/app/" : `/_authenticated${path}`);
  });
});
