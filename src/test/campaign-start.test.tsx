import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampaignStart } from "@/components/execution/campaign-start";
import { growthDraftKey } from "@/lib/growth-draft";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { OrgRole } from "@/lib/permissions";

const context = vi.hoisted(() => ({
  org: { id: "test-organization" },
  workspace: { id: "test-business" },
  workspaceRole: "editor" as OrgRole,
  navigate: vi.fn(),
}));
vi.mock("@/lib/org-context", () => ({ useOrg: () => context }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => context.navigate }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) => translate("nl", key, params),
  }),
}));

describe("guided campaign start (component interactions, not authenticated browser validation)", () => {
  beforeEach(() => {
    context.workspaceRole = "editor";
    context.workspace.id = "test-business";
    context.navigate.mockClear();
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it("passes the selected objective into the manual draft without creating an AI handoff", () => {
    const form = vi.fn(() => <div />);
    render(<CampaignStart renderForm={form} />);
    fireEvent.click(screen.getByRole("radio", { name: "Meer verkopen" }));
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    fireEvent.click(screen.getByRole("button", { name: "Zelf het concept aanmaken" }));
    expect(form).toHaveBeenCalledWith("Meer verkopen");
    expect(sessionStorage.length).toBe(0);
    expect(context.navigate).not.toHaveBeenCalled();
  });

  it("hands off only an editable question in the selected organization/business session scope", () => {
    const other = growthDraftKey(context.org.id, "another-business");
    sessionStorage.setItem(other, "Existing private draft");
    render(<CampaignStart renderForm={() => <div />} />);
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    expect(context.navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Voorstel voorbereiden met de Growth Officer" }),
    );
    expect(
      sessionStorage.getItem(growthDraftKey(context.org.id, context.workspace.id)),
    ).not.toBeNull();
    expect(sessionStorage.getItem(other)).toBe("Existing private draft");
    expect(context.navigate).toHaveBeenCalledOnce();
    expect(context.navigate).toHaveBeenCalledWith({ to: "/app/growth-officer" });
  });

  it("a viewer cannot initiate an AI handoff", () => {
    context.workspaceRole = "viewer";
    render(<CampaignStart renderForm={() => <div />} />);
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Voorstel voorbereiden met de Growth Officer" }),
    );
    expect(context.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it("passes a custom objective into the manual draft without replacing it with a preset", () => {
    const form = vi.fn(() => <div />);
    render(<CampaignStart renderForm={form} />);
    fireEvent.click(screen.getByRole("radio", { name: "Een ander bedrijfsdoel" }));
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Doelstelling" }), {
      target: { value: "Sell 40 event tickets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zelf het concept aanmaken" }));
    expect(form).toHaveBeenCalledWith("Sell 40 event tickets");
    expect(sessionStorage.length).toBe(0);
  });
});
