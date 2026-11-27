import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CrmGuidance } from "@/components/crm/guidance";
import { consumeGrowthContext, consumeGrowthDraft, growthDraftKey } from "@/lib/growth-draft";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { OrgRole } from "@/lib/permissions";
const scope = vi.hoisted(() => ({
  org: { id: "org-a" },
  workspace: { id: "business-a" },
  workspaceRole: "member" as OrgRole,
  navigate: vi.fn(),
}));
vi.mock("@/lib/org-context", () => ({ useOrg: () => scope }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => scope.navigate }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: MessageKey) => translate("nl", key) }),
}));
const id = "a0000000-0000-4000-8000-000000000001";
describe("CRM handoff component interactions (not authenticated E2E)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    scope.navigate.mockClear();
    scope.workspaceRole = "member";
  });
  afterEach(cleanup);
  it("hands off the exact deal without leaking a different business draft", () => {
    sessionStorage.setItem(growthDraftKey("org-a", "business-b"), "Other draft");
    render(<CrmGuidance kind="crm_deals" id={id} stage="qualified" />);
    fireEvent.click(screen.getByRole("button"));
    const question = consumeGrowthDraft(sessionStorage, "org-a", "business-a");
    expect(consumeGrowthContext(sessionStorage, "org-a", "business-a", question)).toEqual([
      { kind: "crm_deals", id },
    ]);
    expect(sessionStorage.getItem(growthDraftKey("org-a", "business-b"))).toBe("Other draft");
    expect(scope.navigate).toHaveBeenCalledWith({ to: "/app/growth-officer" });
  });
  it("a viewer cannot start a handoff", () => {
    scope.workspaceRole = "viewer";
    render(<CrmGuidance kind="crm_contacts" id={id} />);
    fireEvent.click(screen.getByRole("button"));
    expect(sessionStorage.length).toBe(0);
    expect(scope.navigate).not.toHaveBeenCalled();
  });
  it("won and lost deals keep their own exact record reference", () => {
    render(<CrmGuidance kind="crm_deals" id={id} stage="won" />);
    fireEvent.click(screen.getByRole("button"));
    const question = consumeGrowthDraft(sessionStorage, "org-a", "business-a");
    expect(consumeGrowthContext(sessionStorage, "org-a", "business-b", question)).toEqual([]);
    expect(consumeGrowthContext(sessionStorage, "org-a", "business-a", question)).toEqual([
      { kind: "crm_deals", id },
    ]);
  });
});
