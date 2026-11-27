import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({ status: "idle", reset: undefined, proceed: undefined }),
}));
const state = vi.hoisted(() => ({
  update: vi.fn(),
  single: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/org-context", () => ({
  useOrg: () => ({
    org: { id: "org-a" },
    workspace: { id: "ws-a" },
    workspaceRole: "member",
    loading: false,
    userId: "user-a",
  }),
}));
vi.mock("@/components/content/draft-panel", () => ({ DraftPanel: () => null }));
vi.mock("@/components/content/review-panel", () => ({ ReviewPanel: () => null }));
vi.mock("@/components/content/repurpose-panel", () => ({ RepurposePanel: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    isError: false,
    data:
      queryKey[0] === "content-assets"
        ? [
            {
              id: "asset-a",
              title: "Original draft",
              channel: "blog",
              status: "draft",
              planned_date: null,
              campaign_id: "campaign-a",
            },
          ]
        : {
            asset: {
              id: "asset-a",
              title: "Original draft",
              draft_body: "Original text",
              channel: "blog",
              planned_date: null,
              campaign_id: "campaign-a",
              writing_profile_id: null,
              updated_at: "2026-11-26T20:00:00Z",
            },
            versions: [],
            decisions: [],
            campaigns: [{ id: "campaign-a", title: "Campaign A" }],
            profiles: [],
          },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: state.rpc,
    from: () => {
      const query = {
        update: state.update,
        eq: state.eq,
        select: () => query,
        single: state.single,
      };
      state.update.mockReturnValue(query);
      state.eq.mockReturnValue(query);
      return query;
    },
  },
}));
import { ContentStudio } from "@/components/content/studio";
describe("Content Studio save/version interactions (mocked transport)", () => {
  beforeEach(() => {
    state.update.mockReset();
    state.single
      .mockReset()
      .mockResolvedValue({ data: { updated_at: "2026-11-26T20:00:01Z" }, error: null });
    state.eq.mockReset();
    state.rpc.mockReset().mockResolvedValue({ error: null });
    state.invalidate.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  it("blocks saving a version while the working draft is unconfirmed", async () => {
    state.single.mockRejectedValueOnce(new Error("offline"));
    render(<ContentStudio initialAsset="asset-a" />);
    fireEvent.change(await screen.findByLabelText("Content"), {
      target: { value: "Unsaved latest text" },
    });
    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    await screen.findByRole("alert", {}, { timeout: 2500 });
    expect(screen.getByLabelText("Content")).toHaveValue("Unsaved latest text");
    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("only enables a new version after the exact scoped draft revision is acknowledged", async () => {
    render(<ContentStudio initialAsset="asset-a" />);
    fireEvent.change(await screen.findByLabelText("Content"), {
      target: { value: "New material" },
    });
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Save version" })).toBeEnabled(),
      { timeout: 2500 },
    );
    expect(state.eq).toHaveBeenCalledWith("org_id", "org-a");
    expect(state.eq).toHaveBeenCalledWith("workspace_id", "ws-a");
    expect(state.eq).toHaveBeenCalledWith("updated_at", "2026-11-26T20:00:00Z");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("save_content_version", {
        _asset: "asset-a",
        _note: "",
      }),
    );
  });
  it("treats a zero-row optimistic update as unconfirmed rather than saved", async () => {
    state.single.mockResolvedValueOnce({ data: null, error: null });
    render(<ContentStudio initialAsset="asset-a" />);
    fireEvent.change(await screen.findByLabelText("Content"), {
      target: { value: "Conflicting edit" },
    });
    await screen.findByRole("alert", {}, { timeout: 2500 });
    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("recovers a failed draft save through an explicit retry without discarding text", async () => {
    state.single.mockRejectedValueOnce(new Error("offline"));
    render(<ContentStudio initialAsset="asset-a" />);
    fireEvent.change(await screen.findByLabelText("Content"), {
      target: { value: "Preserved draft" },
    });
    await screen.findByRole("alert", {}, { timeout: 2500 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Save version" })).toBeEnabled(),
      { timeout: 2500 },
    );
    expect(screen.getByLabelText("Content")).toHaveValue("Preserved draft");
    expect(state.single).toHaveBeenCalledTimes(2);
  });
});
