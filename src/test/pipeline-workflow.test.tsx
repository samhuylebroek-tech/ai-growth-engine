import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Pipeline } from "@/components/crm/pipeline";
const db = vi.hoisted(() => ({ insert: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/components/crm/guidance", () => ({ CrmGuidance: () => null }));
vi.mock("@/lib/org-context", () => ({
  useOrg: () => ({
    org: { id: "org-a" },
    workspace: { id: "ws-a" },
    workspaceRole: "member",
    loading: false,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: db.invalidate }),
  useQuery: () => ({
    isLoading: false,
    error: null,
    data: {
      contacts: [
        {
          id: "contact-a",
          name: "Élodie",
          company: "Studio",
          email: "elodie@example.test",
          phone: "",
          source: "lead-form:website",
          status: "active",
        },
      ],
      deals: [
        {
          id: "deal-a",
          title: "Design proposal",
          contact_id: "contact-a",
          stage: "proposal",
          value: 100,
          currency: "EUR",
          expected_close: null,
          updated_at: "2026-11-26",
        },
        {
          id: "deal-b",
          title: "Completed sale",
          contact_id: "contact-a",
          stage: "won",
          value: 500,
          currency: "USD",
          expected_close: null,
          updated_at: "2026-11-25",
        },
      ],
      goals: [],
    },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: db.insert }) },
}));
describe("CRM workflows (mocked caller data, not authenticated E2E)", () => {
  beforeEach(() => {
    db.insert.mockReset().mockResolvedValue({ error: null });
    db.invalidate.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  it("shows open sales first and reveals won sales only when requested", () => {
    render(<Pipeline />);
    expect(screen.getByText("Design proposal")).toBeInTheDocument();
    expect(screen.queryByText("Completed sale")).toBeNull();
    fireEvent.change(screen.getByLabelText("Sales to show"), { target: { value: "won" } });
    expect(screen.getByText("Completed sale")).toBeInTheDocument();
    expect(screen.queryByText("Design proposal")).toBeNull();
  });
  it("finds the contact without accents and preserves the route back to enquiries", () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: /Contacts/ }));
    fireEvent.change(screen.getByLabelText("Search customers or sales"), {
      target: { value: "elodie" },
    });
    expect(screen.getByText("Élodie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enquiries & follow-up" })).toHaveAttribute(
      "href",
      "/app/leads",
    );
  });
  it("opens a labeled contact form, persists scoped input and reads back through invalidation", async () => {
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: /Contacts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "New person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " NEW@Example.test " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add contact" }).at(-1) as HTMLElement);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1));
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-a",
        workspace_id: "ws-a",
        name: "New person",
        email: "new@example.test",
      }),
    );
    expect(db.invalidate).toHaveBeenCalled();
  });
});
