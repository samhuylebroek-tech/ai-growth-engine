import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampaignGuidance } from "@/components/execution/campaign-guidance";
import { consumeGrowthContext, consumeGrowthDraft, growthDraftKey } from "@/lib/growth-draft";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { OrgRole } from "@/lib/permissions";
const o = vi.hoisted(() => ({
  org: { id: "org-a" },
  workspace: { id: "business-a" },
  workspaceRole: "member" as OrgRole,
  navigate: vi.fn(),
}));
vi.mock("@/lib/org-context", () => ({ useOrg: () => o }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => o.navigate }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: MessageKey) => translate("nl", key) }),
}));
const id = "a0000000-0000-4000-8000-000000000001";
describe("Contextual campaign guidance interactions (not signed-in browser validation)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    o.navigate.mockClear();
    o.workspaceRole = "member";
  });
  afterEach(cleanup);
  it("passes an explicit campaign reference with a user-started question without touching another business draft", () => {
    sessionStorage.setItem(growthDraftKey("org-a", "business-b"), "Other draft");
    render(<CampaignGuidance campaignId={id} />);
    fireEvent.click(screen.getByRole("button"));
    const draft = consumeGrowthDraft(sessionStorage, "org-a", "business-a");
    expect(draft.length).toBeGreaterThan(0);
    expect(consumeGrowthContext(sessionStorage, "org-a", "business-a", draft)).toEqual([
      { kind: "campaigns", id },
    ]);
    expect(sessionStorage.getItem(growthDraftKey("org-a", "business-b"))).toBe("Other draft");
    expect(o.navigate).toHaveBeenCalledWith({ to: "/app/growth-officer" });
  });
  it("does not create drafts or navigation for a viewer", () => {
    o.workspaceRole = "viewer";
    render(<CampaignGuidance campaignId={id} />);
    fireEvent.click(screen.getByRole("button"));
    expect(sessionStorage.length).toBe(0);
    expect(o.navigate).not.toHaveBeenCalled();
  });
});
